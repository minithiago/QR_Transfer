# QR Transfer

Pasar un archivo de un móvil a otro **sin Bluetooth, sin cables, sin cuenta y sin
red compartida**: el teléfono emisor convierte el archivo en un flujo continuo de
códigos QR y el receptor lo va reconstruyendo con la cámara.

Todo ocurre en el navegador. El archivo no sale de los dos dispositivos: no hay
servidor, no hay subida, no hay nada que interceptar por la red.

---

## Uso

1. Los dos móviles abren la misma página (una vez cargada ya no hace falta red).
2. El que tiene el archivo → **Enviar un archivo** → lo elige → **Empezar a emitir**.
3. El otro → **Recibir un archivo** → **Abrir cámara** y apunta a la pantalla.
4. Al llegar al 100% aparece el botón de descarga. Se comprueba el CRC-32, así que
   o el archivo llega idéntico o avisa del error.

Consejos: brillo al máximo en el emisor, unos 15–25 cm de distancia, el código
entero dentro del encuadre y el móvil quieto. Si no avanza, baja la **densidad**
o la **velocidad** en los ajustes del emisor.

---

## Cómo servir la página

La cámara sólo funciona en un **contexto seguro**: `localhost` o **HTTPS**. Es una
restricción del navegador, no de esta aplicación.

**Opción A — GitHub Pages (lo más cómodo).** Ver la sección siguiente. Da HTTPS
gratis, que es justo lo que hace falta para la cámara.

**Opción B — servidor local.**

```bash
node server.mjs
```

Sirve en `http://localhost:8080` y muestra también las IP de tu red local. Desde
el propio ordenador funciona; desde el móvil por la IP, el navegador bloqueará la
cámara salvo que uses HTTPS.

**Opción C — servidor local con HTTPS.** Genera un certificado autofirmado en la
carpeta del proyecto (sustituye la IP por la tuya) y vuelve a arrancar `server.mjs`,
que lo detecta solo:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=qrtransfer" -addext "subjectAltName=IP:192.168.1.50"
```

El móvil pedirá aceptar el aviso de seguridad la primera vez.

> El **emisor** no necesita cámara, así que funciona igual por HTTP. Sólo el
> receptor exige contexto seguro.

---

## Publicar en GitHub Pages

El repositorio ya viene listo: `index.html` está en la raíz, todas las rutas son
relativas (funciona igual en `usuario.github.io/qr-transfer/` que en un dominio
propio), hay un `.nojekyll` para que Pages no toque nada y el workflow
`.github/workflows/pages.yml` pasa las pruebas, genera `dist/qrtransfer.html` y
despliega en cada push a `main`.

1. Crea un repositorio vacío en GitHub (sin README ni licencia).
2. Conéctalo y sube la rama:

   ```bash
   git remote add origin https://github.com/USUARIO/qr-transfer.git
   git push -u origin main
   ```

3. En el repositorio: **Settings → Pages → Source: GitHub Actions**.
4. La pestaña **Actions** mostrará el despliegue. Al terminar, la página queda en
   `https://USUARIO.github.io/qr-transfer/`.

Para que el segundo móvil llegue a esa dirección sin teclearla, el primero tiene
en la pantalla de inicio el botón **«Abrir esta página en el otro móvil»**, que
muestra un QR con la URL (se escanea con la cámara normal del teléfono).

> Si prefieres no usar Actions, también vale **Settings → Pages → Deploy from a
> branch → main / (root)**: la aplicación funciona igual directamente desde el
> repositorio. La única diferencia es que `dist/qrtransfer.html` está en el
> `.gitignore` y sólo lo genera el workflow, así que por esa vía no existiría
> (quítalo del `.gitignore` si lo quieres publicado también).

---

## Cómo funciona

**Codificación.** Los datos van en modo *alfanumérico* del QR usando **Base45**
(RFC 9285), cuyo alfabeto coincide exactamente con el del modo alfanumérico:
2 bytes → 3 caracteres, un 3% de sobrecoste frente al 33% que costaría Base64.
Un QR versión 16 con ECC L lleva así **556 bytes útiles** por código.

**Códigos fountain.** El canal es de ida y sin retorno: el receptor no puede pedir
"repíteme el trozo 37". Por eso el archivo no se manda como una secuencia fija de
trozos, sino con un **código LT (Luby Transform)**: cada QR es el XOR de un
subconjunto pseudoaleatorio de bloques, derivado de una semilla que viaja en el
propio código. Da igual *qué* códigos se pierdan; sólo importa *cuántos* se leen
en total (~1,3 × el número de bloques). Los primeros K códigos son los bloques
originales tal cual, así que con buena luz el archivo pasa en una sola vuelta.

**Formato de fotograma** (sólo caracteres del alfabeto alfanumérico del QR):

```
QT1:M:<SID>:<base45(json de metadatos)>      metadatos (nombre, tamaño, K, CRC…)
QT1:D:<SID>:<semilla base36>:<base45(XOR)>   datos
```

Los metadatos se reemiten cada 17 fotogramas para que el receptor pueda
engancharse en cualquier momento; los símbolos que lleguen antes se guardan en un
buffer y se procesan en cuanto llegan.

**Extras.** Compresión gzip automática cuando compensa (`CompressionStream`),
CRC-32 del original y del payload, bloqueo de pantalla del emisor (`wakeLock`) y
lectura con `BarcodeDetector` nativo cuando existe (Chrome/Android), con
respaldo en jsQR para el resto (Safari/iOS, Firefox).

---

## Rendimiento

| Densidad | Bytes por código | A 8 códigos/s (bruto) |
|---|---|---|
| v8 · 49×49 | 172 B | ~1,3 KB/s |
| v12 · 65×65 | 344 B | ~2,7 KB/s |
| v16 · 81×81 (por defecto) | 556 B | ~4,3 KB/s |
| v20 · 97×97 | 820 B | ~6,4 KB/s |
| v24 · 113×113 | 1124 B | ~8,8 KB/s |

En la práctica, contando el sobrecoste del código fountain y los fotogramas que
la cámara pierde, cuenta con **2–5 KB/s reales**. Es decir: un PDF de 500 KB son
un par de minutos y una foto de 3 MB puede irse a un cuarto de hora. Para vídeos
no es la herramienta.

---

## Estructura

```
index.html          interfaz
styles.css
js/base45.js        Base45 (RFC 9285)
js/crc32.js
js/fountain.js      código LT: reparto en bloques, codificador y decodificador
js/protocol.js      formato de los fotogramas
js/qrgen.js         generación y pintado de los QR
js/sender.js        emisor
js/scanner.js       cámara + BarcodeDetector/jsQR
js/receiver.js      ensamblado y verificación
js/app.js           interfaz
vendor/qrcode.js    qrcode-generator (MIT)
vendor/jsQR.js      jsQR (Apache-2.0)
server.mjs          servidor estático de pruebas (HTTP/HTTPS)
build.mjs           empaqueta todo en dist/qrtransfer.html
.github/workflows/pages.yml   pruebas + despliegue en GitHub Pages
test/sim.mjs        simulación del código fountain con pérdidas
test/e2e.mjs        cadena completa, decodificando QR reales con jsQR
```

## Pruebas

```bash
node test/sim.mjs
node test/e2e.mjs
```

`e2e.mjs` recorre la cadena entera sin navegador: trocea el archivo, genera las
matrices QR de verdad, las rasteriza a píxeles, las lee con jsQR, tira fotogramas
al azar y comprueba que el archivo reconstruido es idéntico byte a byte.

Para probar la interfaz de recepción en un ordenador, sin cámara: abre la página
con `#autotest` al final de la URL y ejecuta `qrtSelfTest()` en la consola.
