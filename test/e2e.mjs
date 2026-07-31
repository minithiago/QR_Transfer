// Prueba de extremo a extremo sin navegador:
//   fichero -> Sender.prepare (gzip + troceado) -> texto del fotograma
//           -> matriz QR real -> pixeles -> jsQR (decodificacion optica)
//           -> Receiver -> fichero reconstruido
// con perdida de fotogramas simulada.
//
//   node test/e2e.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeDataFrame } from '../js/protocol.js';
import { encodeSymbol } from '../js/fountain.js';

// Las librerias de vendor/ son UMD pensadas para el navegador; el paquete es
// ESM, asi que se evaluan a mano con un `module` de mentira.
const HERE = path.dirname(fileURLToPath(import.meta.url));
function loadUmd(rel) {
  const code = fs.readFileSync(path.join(HERE, '..', rel), 'utf8');
  const mod = { exports: {} };
  new Function('module', 'exports', code)(mod, mod.exports);
  return mod.exports;
}

const qrcode = loadUmd('vendor/qrcode.js');
const jsQR = loadUmd('vendor/jsQR.js');

globalThis.window = { qrcode }; // qrgen.js espera el global del navegador

const { makeMatrix, qrCapacity } = await import('../js/qrgen.js');
const { Sender } = await import('../js/sender.js');
const { Receiver } = await import('../js/receiver.js');

const SCALE = 4;
const MARGIN = 4;

/** Pinta la matriz como buffer RGBA, igual que veria la camara. */
function rasterize(matrix) {
  const total = matrix.size + MARGIN * 2;
  const w = total * SCALE;
  const data = new Uint8ClampedArray(w * w * 4).fill(255);
  for (let r = 0; r < matrix.size; r++) {
    for (let c = 0; c < matrix.size; c++) {
      if (!matrix.isDark(r, c)) continue;
      for (let y = 0; y < SCALE; y++) {
        for (let x = 0; x < SCALE; x++) {
          const px = ((MARGIN + r) * SCALE + y) * w + (MARGIN + c) * SCALE + x;
          data[px * 4] = data[px * 4 + 1] = data[px * 4 + 2] = 0;
        }
      }
    }
  }
  return { data, w };
}

function makeContent(n) {
  const b = new Uint8Array(n);
  const text = 'Cabecera de prueba con acentos: ñáéíóü — 1234567890\n';
  const enc = new TextEncoder().encode(text);
  for (let i = 0; i < n; i++) b[i] = i < enc.length ? enc[i] : (i * 37 + (i >> 5)) & 0xff;
  return b;
}

async function run({ size, version, ecc, compress, loss }) {
  const content = makeContent(size);
  const file = new File([content], 'informe ñ.txt', { type: 'text/plain' });

  const sender = new Sender({ canvas: null });
  const plan = await sender.prepare(file, { version, ecc, compress });

  let done = null;
  let error = null;
  const receiver = new Receiver({
    onComplete: (r) => { done = r; },
    onError: (e) => { error = e; },
  });

  let frames = 0;
  let read = 0;
  const maxFrames = plan.K * 8 + 60;
  for (let pos = 0; pos < maxFrames && !done && !error; pos++) {
    const isMeta = pos < 2 || pos % 17 === 0;
    const text = isMeta
      ? sender.metaFrame
      : encodeDataFrame(sender.sid, pos, encodeSymbol(sender.blocks, pos));
    frames++;
    if (Math.random() < loss) continue; // la camara se pierde este fotograma

    const matrix = makeMatrix(text, isMeta ? 0 : version, ecc);
    const { data, w } = rasterize(matrix);
    const decoded = jsQR(data, w, w, { inversionAttempts: 'dontInvert' });
    if (!decoded) throw new Error('jsQR no pudo leer un QR generado (v' + version + ' ' + ecc + ')');
    if (decoded.data !== text) throw new Error('el texto leido no coincide con el emitido');
    read++;
    receiver.handleText(decoded.data);
    await new Promise((r) => setImmediate(r)); // deja correr el _finish asincrono
  }

  await new Promise((r) => setTimeout(r, 50));
  if (error) throw error;
  if (!done) throw new Error(`no se completo tras ${frames} fotogramas`);

  const out = new Uint8Array(await done.blob.arrayBuffer());
  if (out.length !== content.length || out.some((v, i) => v !== content[i])) {
    throw new Error('el fichero reconstruido difiere del original');
  }
  if (done.name !== 'informe ñ.txt') throw new Error('el nombre no sobrevivio: ' + done.name);
  return { plan, frames, read };
}

const cases = [
  { size: 12_000, version: 8, ecc: 'L', compress: false, loss: 0 },
  { size: 12_000, version: 12, ecc: 'M', compress: true, loss: 0.35 },
  { size: 40_000, version: 16, ecc: 'L', compress: false, loss: 0.5 },
  { size: 40_000, version: 20, ecc: 'L', compress: true, loss: 0.2 },
  { size: 900, version: 24, ecc: 'Q', compress: false, loss: 0.4 },
];

let failed = 0;
for (const c of cases) {
  const label = `${String(c.size).padStart(6)}B v${String(c.version).padStart(2)} ${c.ecc} ${c.compress ? 'gzip' : '    '} perdida=${(c.loss * 100).toFixed(0).padStart(2)}%`;
  try {
    const { plan, frames, read } = await run(c);
    console.log(`ok    ${label}  ${plan.blockSize}B/codigo  K=${plan.K}  emitidos=${frames} leidos=${read}`);
  } catch (err) {
    failed++;
    console.log(`FALLO ${label}  ${err.message}`);
  }
}

// capacidades por version (informativo)
console.log('');
for (const v of [8, 12, 16, 20, 24]) {
  const caps = ['L', 'M', 'Q'].map((e) => `${e}=${qrCapacity(v, e)}`).join(' ');
  console.log(`  version ${String(v).padStart(2)} (${v * 4 + 17}x${v * 4 + 17}): caracteres alfanumericos  ${caps}`);
}

console.log(failed === 0 ? '\nTODO OK' : `\n${failed} FALLOS`);
process.exit(failed ? 1 : 0);
