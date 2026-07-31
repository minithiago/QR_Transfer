// Genera dist/qrtransfer.html: la aplicacion entera (HTML + CSS + librerias +
// modulos) en un unico fichero, comodo para subirlo a cualquier hosting
// estatico o pasarlo por correo.
//
//   node build.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// orden de dependencias (no hay ciclos)
const MODULES = [
  'js/base45.js',
  'js/crc32.js',
  'js/fountain.js',
  'js/protocol.js',
  'js/qrgen.js',
  'js/sender.js',
  'js/scanner.js',
  'js/receiver.js',
  'js/app.js',
];

/** Empaquetador minimo: quita los import/export y concatena. */
function flatten(file) {
  return read(file)
    .replace(/^\s*import\s+[^;]*?from\s+['"][^'"]+['"];\s*$/gm, '')
    .replace(/^export\s+(?=(const|let|var|function|async|class))/gm, '')
    .trimEnd();
}

const bundle = MODULES.map((f) => `\n// ───── ${f} ─────\n${flatten(f)}`).join('\n');

// ojo: el reemplazo debe ir en una funcion, si no `$&` o `$'` dentro del codigo
// insertado se interpretarian como referencias a la coincidencia
const sub = (html, needle, text) => html.replace(needle, () => text);

let html = read('index.html');
html = sub(html, '<link rel="stylesheet" href="styles.css">', `<style>\n${read('styles.css')}\n</style>`);
html = sub(html, '<script src="vendor/qrcode.js"></script>', `<script>\n${read('vendor/qrcode.js')}\n</script>`);
html = sub(html, '<script src="vendor/jsQR.js"></script>', `<script>\n${read('vendor/jsQR.js')}\n</script>`);
html = sub(
  html,
  '<script type="module" src="js/app.js"></script>',
  `<script>\n(function(){\n'use strict';${bundle}\n})();\n</script>`,
);
for (const tag of ['styles.css', 'vendor/qrcode.js', 'vendor/jsQR.js', 'js/app.js']) {
  if (html.includes(`"${tag}"`)) throw new Error('no se pudo incrustar ' + tag);
}

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const out = path.join(ROOT, 'dist', 'qrtransfer.html');
fs.writeFileSync(out, html);
console.log(`dist/qrtransfer.html  ${(Buffer.byteLength(html) / 1024).toFixed(0)} KB`);
