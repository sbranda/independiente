// Worker de Cloudflare — scraper para la app de Independiente.
//
// Expone:
//   GET /fixture   -> resultados y proximos partidos (scrapea Promiedos)
//   GET /standings -> tabla de posiciones de la Zona A o B (scrapea Wikipedia,
//                     porque la tabla de Promiedos se carga con JavaScript y
//                     no se puede leer con un fetch simple del lado del
//                     servidor, y ESPN bloquea los pedidos automáticos)
//
// Cachea cada resultado 30 minutos en el edge de Cloudflare, y siempre
// devuelve CORS abierto para que la PWA pueda consumirlo con fetch().
//
// Como desplegarlo: pegar este archivo entero en el editor del Worker en
// Cloudflare (Workers & Pages -> tu Worker -> Edit Code), reemplazando todo
// el codigo de ejemplo, y despues Deploy. Probar en el navegador entrando a
// tu-worker.tu-subdominio.workers.dev/fixture y /standings.

const TEAM_URL = "https://www.promiedos.com.ar/team/independiente/ihe";
const CACHE_TTL_SECONDS = 1800; // 30 minutos

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (url.pathname === "/fixture") {
      return withEdgeCache(url, request, ctx, scrapePromiedos);
    }
    if (url.pathname === "/standings") {
      const zona = (url.searchParams.get("zona") || "A").toUpperCase();
      return withEdgeCache(url, request, ctx, () => scrapeStandings(zona));
    }
    if (url.pathname === "/standings-debug") {
      // Ruta temporal de diagnóstico: no cachea, muestra la estructura real
      // de la tabla (filas de encabezado, primeras filas de datos) para poder
      // ajustar el parser sin seguir adivinando a ciegas.
      try {
        const debugInfo = await debugStandingsTable();
        return json(debugInfo, 200);
      } catch (err) {
        return json({ error: "Error en debug", detail: String(err) }, 502);
      }
    }
    return json({ error: "Ruta no encontrada. Usá /fixture o /standings" }, 404);
  },
};

// Envuelve un scraper con caché de edge + manejo de errores, para no repetir código.
async function withEdgeCache(url, request, ctx, scraperFn) {
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  try {
    const data = await scraperFn();
    const response = json(data, 200);
    response.headers.set("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`);
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (err) {
    return json({ error: "No se pudo obtener los datos", detail: String(err) }, 502);
  }
}

// ---------- FIXTURE Y RESULTADOS (Promiedos) ----------

async function scrapePromiedos() {
  const res = await fetch(TEAM_URL, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36" },
  });
  if (!res.ok) throw new Error(`Promiedos respondió ${res.status}`);
  const html = await res.text();

  const proximos = extractMatchTable(html, "PRÓXIMOS PARTIDOS", "Resultados");
  const resultados = extractMatchTable(html, ">Resultados<", "PLANTEL");

  return {
    proximos,
    resultados,
    actualizado: new Date().toISOString(),
  };
}

// Busca el <table> que aparece entre dos marcadores de texto y devuelve sus filas parseadas.
function extractMatchTable(html, startMarker, endMarker) {
  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) return [];
  const endIdx = html.indexOf(endMarker, startIdx);
  const chunk = html.slice(startIdx, endIdx === -1 ? undefined : endIdx);

  const tableMatch = chunk.match(/<table[\s\S]*?<\/table>/i);
  if (!tableMatch) return [];

  const rows = [...tableMatch[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const parsed = [];

  for (const row of rows) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) =>
      dedupe(stripTags(c[1]))
    );
    if (cells.length < 3) continue; // saltea filas de encabezado

    const [dia, cond, rivalRaw, extra] = cells;
    if (!dia || !/^\d{1,2}\/\d{1,2}$/.test(dia.trim())) continue;

    parsed.push({
      dia: dia.trim(),
      condicion: cond.trim(), // "L" o "V"
      rival: rivalRaw.trim(),
      dato: (extra || "").trim(), // hora (próximos) o resultado (jugados)
    });
  }
  return parsed;
}

// ---------- TABLA DE POSICIONES (Wikipedia) ----------
// Promiedos hidrata la tabla con JavaScript (no se puede leer con un fetch
// simple) y ESPN bloquea los pedidos automáticos con un desafío anti-bot.
// Wikipedia no bloquea bots y usa tablas HTML estándar (wikitable), así que
// es la fuente más confiable para esto, aunque puede estar un poco atrasada
// respecto al resultado más reciente (la actualizan editores voluntarios).

const WIKI_PAGE = "Anexo:Torneo_Clausura_2026_(Argentina)";

// Función de diagnóstico temporal: devuelve las primeras filas crudas de la
// tabla de la Zona A (sin parsear números) para poder ver la estructura real
// y ajustar el mapeo de columnas con datos concretos, no adivinando.
async function debugStandingsTable() {
  const apiUrl = `https://es.wikipedia.org/w/api.php?action=parse&page=${WIKI_PAGE}&format=json&formatversion=2&prop=text`;
  const res = await fetch(apiUrl, {
    headers: { "User-Agent": "IndependientePWA/1.0 (app personal de un hincha, sin fines de lucro)" },
  });
  if (!res.ok) throw new Error(`Wikipedia respondió ${res.status}`);
  const data = await res.json();
  const html = data.parse.text;

  const headingMatches = [...html.matchAll(/<h([234])[^>]*>([\s\S]*?)<\/h\1>/gi)];
  let zonaHeadingEnd = -1;
  for (const hm of headingMatches) {
    const text = stripTags(hm[2]).trim();
    if (/^zona\s*a$/i.test(text)) {
      zonaHeadingEnd = hm.index + hm[0].length;
      break;
    }
  }
  if (zonaHeadingEnd === -1) return { error: "No se encontró el título Zona A" };

  const afterZona = html.slice(zonaHeadingEnd);
  const tableMatch = afterZona.match(/<table[^>]*class="[^"]*wikitable[^"]*"[^>]*>[\s\S]*?<\/table>/i);
  if (!tableMatch) return { error: "No se encontró la tabla wikitable" };

  const rowsHtml = [...tableMatch[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);

  // Mostramos las primeras 4 filas tal cual, celda por celda, en texto plano.
  const preview = rowsHtml.slice(0, 4).map((row) =>
    [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => stripTags(m[1]))
  );

  return {
    total_filas: rowsHtml.length,
    primeras_filas: preview,
  };
}

async function scrapeStandings(zona = "A") {
  const apiUrl = `https://es.wikipedia.org/w/api.php?action=parse&page=${WIKI_PAGE}&format=json&formatversion=2&prop=text`;
  const res = await fetchWithRetry429(apiUrl);
  if (!res.ok) throw new Error(`Wikipedia respondió ${res.status}`);
  const data = await res.json();
  if (!data.parse || !data.parse.text) throw new Error("Respuesta inesperada de la API de Wikipedia");
  const html = data.parse.text;

  // 1) Ubicar la tabla de la zona pedida: el primer wikitable después del
  // título "Zona A" o "Zona B". Ojo: ese texto también aparece en el índice
  // del artículo y a veces dentro de oraciones de texto ("...la zona A
  // comenzó..."). Por eso no alcanza con buscar la primera aparición:
  // exigimos un título de sección (<h2>/<h3>/<h4>) cuyo texto completo sea
  // exactamente "Zona A" (o "Zona B"), no solo que la contenga.
  const zonaRegex = new RegExp(`^zona\\s*${zona}$`, "i");
  const headingMatches = [...html.matchAll(/<h([234])[^>]*>([\s\S]*?)<\/h\1>/gi)];
  let zonaHeadingEnd = -1;
  for (const hm of headingMatches) {
    const text = stripTags(hm[2]).trim();
    if (zonaRegex.test(text)) {
      zonaHeadingEnd = hm.index + hm[0].length;
      break;
    }
  }
  if (zonaHeadingEnd === -1) {
    const headingTexts = headingMatches.map((hm) => stripTags(hm[2]).trim()).filter(Boolean);
    throw new Error(
      `No se encontró un título de sección "Zona ${zona}" en el artículo de Wikipedia (títulos encontrados: ${headingTexts.join(" | ")})`
    );
  }

  const afterZona = html.slice(zonaHeadingEnd);
  const tableMatch = afterZona.match(/<table[^>]*class="[^"]*wikitable[^"]*"[^>]*>[\s\S]*?<\/table>/i);
  if (!tableMatch) throw new Error(`No se encontró la tabla (wikitable) de la Zona ${zona}`);
  const tableHtml = tableMatch[0];

  const rowsHtml = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
  if (rowsHtml.length < 2) throw new Error(`La tabla de la Zona ${zona} no tiene filas`);

  // 2) Encabezado: mapear qué columna es cada estadística (el orden puede variar).
  // Se normaliza sacando puntos y espacios ("Pts." -> "PTS") porque Wikipedia
  // suele abreviar los encabezados con puntuación.
  const headerCells = [...rowsHtml[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map((m) =>
    stripTags(m[1]).toUpperCase().replace(/[^A-Z0-9#]/g, "")
  );
  const exactCol = (names) => headerCells.findIndex((h) => names.includes(h));
  const looseCol = (fragments) => headerCells.findIndex((h) => fragments.some((f) => h.includes(f)));
  const idx = {
    pos: exactCol(["POS", "#", "U"]),
    pj: exactCol(["PJ", "J"]),
    g: exactCol(["G", "PG"]),
    e: exactCol(["E", "PE"]),
    p: exactCol(["P", "PP"]),
    gf: exactCol(["GF"]),
    gc: exactCol(["GC"]),
    dif: exactCol(["DIF", "DG", "DIFGOLES"]),
    pts: exactCol(["PTS", "PUNTOS", "PT", "PTOS"]),
    equipo: looseCol(["EQUIPO", "CLUB"]),
  };

  // 3) Filas de datos
  const equipos = [];
  for (let i = 1; i < rowsHtml.length; i++) {
    const cells = [...rowsHtml[i].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => m[1]);
    if (cells.length < 5) continue; // saltea filas raras (notas, separadores)

    const getNum = (colIdx) => {
      if (colIdx === -1 || !cells[colIdx]) return null;
      const n = parseInt(stripTags(cells[colIdx]).replace(/[^\d+-]/g, ""), 10);
      return Number.isNaN(n) ? null : n;
    };
    const equipoCellIdx = idx.equipo !== -1 ? idx.equipo : 1;
    const equipoName = stripTags(cells[equipoCellIdx] || "");
    if (!equipoName) continue;

    equipos.push({
      pos: getNum(idx.pos) ?? equipos.length + 1,
      equipo: equipoName,
      jugados: getNum(idx.pj),
      ganados: getNum(idx.g),
      empatados: getNum(idx.e),
      perdidos: getNum(idx.p),
      gf: getNum(idx.gf),
      gc: getNum(idx.gc),
      dif: getNum(idx.dif),
      pts: getNum(idx.pts),
    });
  }
  if (!equipos.length) {
    const firstRowSnippet = stripTags(rowsHtml[1] || "").slice(0, 150);
    throw new Error(
      `No se pudieron leer filas de la tabla de la Zona ${zona} (encabezados: [${headerCells.join(", ")}], filas totales: ${rowsHtml.length}, primera fila: "${firstRowSnippet}")`
    );
  }

  return {
    grupo: zona,
    equipos,
    fuente: "Wikipedia (puede estar algo atrasada respecto al último resultado)",
    actualizado: new Date().toISOString(),
  };
}

// ---------- HELPERS ----------

// Reintenta una vez si Wikipedia responde 429 (demasiados pedidos), esperando
// un momento antes de reintentar. Wikipedia suele liberar el límite rápido.
async function fetchWithRetry429(url) {
  const headers = { "User-Agent": "IndependientePWA/1.0 (app personal de un hincha, sin fines de lucro)" };
  const res = await fetch(url, { headers });
  if (res.status !== 429) return res;

  await new Promise((resolve) => setTimeout(resolve, 1500));
  return fetch(url, { headers });
}

function stripTags(str) {
  return str.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// Promiedos suele repetir el nombre del equipo dos veces en la misma celda
// (ej. "Estudiantes  Estudiantes"). Esto lo colapsa a una sola aparición.
function dedupe(str) {
  const s = str.trim();
  const half = s.length / 2;
  if (Number.isInteger(half)) {
    const a = s.slice(0, half).trim();
    const b = s.slice(half).trim();
    if (a && a === b) return a;
  }
  const words = s.split(" ");
  if (words.length % 2 === 0) {
    const mid = words.length / 2;
    const a = words.slice(0, mid).join(" ");
    const b = words.slice(mid).join(" ");
    if (a === b) return a;
  }
  return s;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}
