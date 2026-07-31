// Servidor estatico minimo para probar la pagina en el movil.
//
//   node server.mjs            -> http://localhost:8080  (+ IPs de la red local)
//   node server.mjs 3000       -> otro puerto
//
// La camara solo funciona en un "contexto seguro": localhost o HTTPS. Si en la
// carpeta hay un cert.pem y un key.pem, este servidor arranca en HTTPS
// automaticamente. Para generarlos (necesita openssl):
//
//   openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem \
//     -days 365 -subj "/CN=qrtransfer" -addext "subjectAltName=IP:TU.IP.LOCAL"

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.argv[2]) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
};

function handler(req, res) {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  const rel = url === '/' ? 'index.html' : url.replace(/^\/+/, '');
  const file = path.join(ROOT, rel);

  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('403');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('No encontrado: ' + rel);
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    }).end(data);
  });
}

const certPath = path.join(ROOT, 'cert.pem');
const keyPath = path.join(ROOT, 'key.pem');
const secure = fs.existsSync(certPath) && fs.existsSync(keyPath);

const server = secure
  ? https.createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, handler)
  : http.createServer(handler);

server.listen(PORT, () => {
  const proto = secure ? 'https' : 'http';
  console.log(`\n  QR Transfer servido en ${proto.toUpperCase()}\n`);
  console.log(`  ${proto}://localhost:${PORT}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) console.log(`  ${proto}://${ni.address}:${PORT}`);
    }
  }
  if (!secure) {
    console.log('\n  Aviso: sin HTTPS el navegador del movil NO dejara abrir la camara');
    console.log('  cuando entres por la IP de red. Mira las instrucciones del README.\n');
  } else {
    console.log('\n  Certificado autofirmado: el movil pedira aceptar el riesgo la primera vez.\n');
  }
});
