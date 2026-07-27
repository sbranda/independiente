const CACHE_NAME = 'independiente-pwa-v1';

// App shell: mismo origen que la PWA.
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
];

// Recursos de otros dominios que hacen falta para que Historia, Identidad,
// Estadio y Planteles se vean completos (con fotos) sin conexión.
// Se piden con mode:'no-cors' porque son cross-origin y no tienen headers CORS;
// eso los guarda como "respuesta opaca", que sirve igual para mostrarlos en <img>.
const CROSS_ORIGIN_ASSETS = [
  'https://commons.wikimedia.org/wiki/Special:FilePath/Escudo_del_Club_Atl%C3%A9tico_Independiente.svg',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Bandera_del_Club_Atl%C3%A9tico_Independiente.svg',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Estadio_Libertadores_de_America_2014.JPG',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Estadio_Libertadores_de_Am%C3%A9rica_-_Ricardo_Enrique_Bochini.jpg',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Panorama_Estadio_Libertadores_de_Am%C3%A9rica.jpg',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Independiente_vista_tribuna_1940.jpg',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Racing_Club_de_Avellaneda_1900.svg',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Boca_Juniors_logo18.svg',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Escudo_del_C_A_River_Plate.svg',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Escudo_del_Club_Atl%C3%A9tico_San_Lorenzo_de_Almagro.svg',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Escudo_de_Huracan.svg',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Escudo_de_V%C3%A9lez_Sarsfield.svg',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Escudo_de_Estudiantes_de_La_Plata.svg',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Escudo_del_Club_de_Gimnasia_y_Esgrima_La_Plata.svg',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Escudo_de_Gimnasia_y_Esgrima_de_Mendoza.png',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Newells_Old_Boys.svg',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Rosario_Central_Isologo.svg',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Escudo_de_Talleres_de_C%C3%B3rdoba.svg',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Escudo_de_Belgrano.svg',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Escudo_de_Independiente_Rivadavia.png',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Escudo_de_Platense.svg',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Escudo_de_Barracas_Central.svg',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Escudo_de_Defensa_y_Justicia.svg',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Escudo_del_Club_Atl%C3%A9tico_Tigre.svg',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Escudo_de_Banfield.svg',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Escudo_de_Lan%C3%BAs.svg',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Escudo_At._Tucum%C3%A1n.png',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Escudo_de_Central_C%C3%B3rdoba_(SdE).png',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Escudo_de_Instituto_Atl%C3%A9tico_Central_C%C3%B3rdoba.png',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Escudo_de_Uni%C3%B3n_de_Santa_Fe.svg',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Escudo_de_Sarmiento_de_Junin.png',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Escudo_de_Deportivo_Riestra.png',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Escudo_de_Aldosivi.png',
  'https://commons.wikimedia.org/wiki/Special:FilePath/Escudo_de_Argentinos_Juniors.svg',
  'https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@400;600;700;900&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&family=IBM+Plex+Mono:wght@400;500&display=swap',
];

// Precachea un recurso sin que un solo error tumbe la instalación entera.
async function precacheOne(cache, url) {
  try {
    const isSameOrigin = url.startsWith('./') || url.startsWith(self.location.origin);
    const request = new Request(url, { mode: isSameOrigin ? 'same-origin' : 'no-cors' });
    const response = await fetch(request);
    await cache.put(url, response);
  } catch (err) {
    console.warn('[sw] No se pudo precachear (se intentará de nuevo al usarse online):', url, err);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      const all = [...APP_SHELL, ...CROSS_ORIGIN_ASSETS];
      await Promise.all(all.map((url) => precacheOne(cache, url)));
    })
  );
  self.skipWaiting();
});

// Limpia caches de versiones anteriores
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// No cachear las llamadas al Worker de fixture/resultados: esos datos tienen
// que pedirse siempre a la red para no mostrar resultados viejos como si fueran
// actuales. Si falla la red, index.html ya tiene su propio respaldo (RESULTS_FALLBACK).
function isLiveDataRequest(url) {
  return url.pathname === '/fixture' || url.hostname.endsWith('workers.dev');
}

// Estrategia para todo lo demás: cache-first (instantáneo y funciona offline),
// y en segundo plano actualiza la caché por si cambió algo.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (isLiveDataRequest(url)) return; // dejá pasar directo a la red

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchAndUpdate = fetch(event.request)
        .then((response) => {
          if (response && (response.status === 200 || response.type === 'opaque')) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetchAndUpdate;
    })
  );
});
