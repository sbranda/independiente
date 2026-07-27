# Club Atlético Independiente — PWA

Estos cuatro archivos forman una Progressive Web App instalable:

- `index.html` — la app completa (HTML/CSS/JS, sin dependencias de build)
- `manifest.json` — nombre, ícono y colores para "agregar a pantalla de inicio"
- `sw.js` — service worker que cachea la app para que funcione offline
- `worker.js` — Cloudflare Worker opcional para traer datos en vivo (fixture y tabla de posiciones)

## Importante: necesita HTTPS

Los navegadores **no activan el service worker ni el botón de instalación si abrís `index.html` directamente desde tu computadora** (protocolo `file://`). Necesitás servir estos archivos desde un servidor con HTTPS (o `localhost` para probar).

## Cómo probarlo rápido en tu computadora

Con Python instalado, parado en la carpeta de estos archivos:

```bash
python3 -m http.server 8000
```

Después abrí `http://localhost:8000` en Chrome o Safari desde tu celular (mismo Wi-Fi) o en tu computadora.

## Cómo publicarlo gratis (con HTTPS real)

Cualquiera de estas opciones sirve, subiendo los archivos tal cual:

- **Netlify Drop**: arrastrás la carpeta a [app.netlify.com/drop](https://app.netlify.com/drop)
- **Vercel**: `vercel` desde la carpeta (requiere cuenta)
- **GitHub Pages**: subís los archivos a un repo y activás Pages

Una vez publicado, entrá desde el celular con Chrome (Android) o Safari (iPhone) y usá "Agregar a pantalla de inicio" — o esperá el cartel de instalación que aparece solo.

## Datos en vivo (fixture, resultados y tabla de posiciones)

`worker.js` es un Cloudflare Worker con estas rutas:

- **`/fixture`** — scrapea la página de Independiente en Promiedos (próximos partidos y resultados)
- **`/standings?zona=A`** (o `zona=B`) — trae la tabla de posiciones completa de esa zona desde Wikipedia, para el Torneo Clausura 2026. Independiente juega en la **Zona A**.

(La tabla de Promiedos no se puede leer con un scraper simple porque se carga
con JavaScript del lado del cliente, y ESPN bloquea los pedidos automáticos
con un desafío anti-bot. Wikipedia no bloquea bots y usa tablas HTML
estándar, así que es la fuente más confiable para esto — a cambio, puede
estar algo atrasada respecto al resultado más reciente, porque la actualizan
editores voluntarios y no en tiempo real.)

Sin esto, la app funciona igual pero con el resultado fijo que está en el
código (fecha 1 del Clausura 2026), y el botón "Ver tabla completa de la
zona" muestra un aviso en vez de la tabla.

1. Entrá a [dash.cloudflare.com](https://dash.cloudflare.com) (cuenta gratis, sin tarjeta)
2. Workers & Pages → Create → Create Worker
3. Pegá todo el contenido de `worker.js` reemplazando el código de ejemplo
4. Deploy — te da una URL tipo `https://independiente-fixture.tu-nombre.workers.dev`
5. Probalo en el navegador: esa URL + `/fixture` y esa URL + `/standings?zona=A` (ambas deberían devolver JSON)
6. En `index.html`, buscá la línea `const WORKER_BASE = "..."` y poné tu URL ahí (sin barra al final, sin `/fixture`)
7. Volvé a subir `index.html` a donde tengas publicada la PWA

El Worker cachea cada respuesta 30 minutos de su lado, así que no golpea
Promiedos ni Wikipedia en cada visita. Si en algún momento alguno de los dos
sitios cambia el diseño de su página, ese scraper puede dejar de funcionar —
en ese caso esa parte puntual de la app deja de actualizarse (muestra un
aviso o el dato fijo), pero el resto sigue funcionando normalmente.

**Nota sobre torneos**: el Torneo Clausura 2026 arrancó el 23 de julio y usa
el formato de dos zonas (A y B) con 15 equipos cada una, igual que el
Apertura. Cuando termine el Clausura y arranque el próximo torneo, vas a
tener que actualizar la constante `WIKI_PAGE` en `worker.js` con el nombre
del nuevo artículo de Wikipedia (por ejemplo `Anexo:Torneo_Apertura_2027_(Argentina)`).

## Notas

- **Marcador en vivo:** cuando el próximo partido llega a su hora de inicio, la app sondea el Worker cada 60 segundos durante 3 horas buscando cambios. No hay ninguna fuente confiable de minuto a minuto (Promiedos lo oculta con JavaScript, ESPN bloquea bots), así que en el peor de los casos vas a ver "Independiente está jugando ahora" sin marcador hasta que termine, y recién ahí aparece el resultado final.
- Para el marcador en vivo minuto a minuto de verdad, lo más simple sigue siendo preguntarme directamente en el chat ("¿cómo va Independiente?") — ahí busco en la web en el momento, sin las limitaciones del scraping.
- **Ícono con badge:** cuando instalás la app y hay resultados nuevos que todavía no viste en la pestaña Resultados, el ícono va a mostrar un numerito (como los mensajes sin leer). Se limpia solo apenas entrás a esa pestaña.
  - Funciona en Chrome/Edge de escritorio y en Android con la app instalada. En iPhone (Safari) todavía no está soportado.
  - El badge solo se actualiza cuando **abrís la app** y ella misma chequea contra el Worker si hay resultados nuevos. No hay forma de que aparezca el número mientras la app está cerrada — eso requeriría notificaciones push con un servidor propio.
- El service worker precachea el escudo, la bandera, las fotos del estadio y los escudos de los rivales más conocidos apenas se instala la PWA, así Historia, Identidad, Estadio y Planteles se ven completos sin conexión desde el principio.
- Las tipografías de Google Fonts se intentan precachear también, pero si tu conexión es lenta esa parte puede fallar sin romper nada.
- Sin desplegar el Worker, los datos de resultados quedan fijos en el código. Con el Worker desplegado, el fixture y los resultados se actualizan solos.
- El plantel actual (nombres, edades) queda fijo en el código — no se scrapea. Los datos están tomados de fuentes públicas de 2026 y conviene revisarlos cada tanto, porque el mercado de pases puede cambiarlos.
