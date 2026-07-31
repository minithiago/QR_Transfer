// Simulacion: codifica datos aleatorios, tira fotogramas al azar y comprueba
// que el decodificador reconstruye el fichero byte a byte.
//   node test/sim.mjs
import { splitBlocks, encodeSymbol, FountainDecoder } from '../js/fountain.js';
import { encodeBase45, decodeBase45 } from '../js/base45.js';
import { crc32 } from '../js/crc32.js';

function randomBytes(n) {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (Math.random() * 256) | 0;
  return b;
}

function run(size, blockSize, lossRate) {
  const data = randomBytes(size);
  const blocks = splitBlocks(data, blockSize);
  const K = blocks.length;
  const dec = new FountainDecoder(K, blockSize, size);

  let sent = 0;
  let received = 0;
  for (let seed = 0; seed < K * 60 + 500 && !dec.complete; seed++) {
    sent++;
    if (Math.random() < lossRate) continue; // fotograma perdido por la camara
    received++;
    // ida y vuelta por base45, como en el canal real
    const sym = decodeBase45(encodeBase45(encodeSymbol(blocks, seed)));
    dec.addSymbol(seed, sym);
  }

  if (!dec.complete) return { ok: false, K, sent, received, reason: 'no completo' };
  const out = dec.getResult();
  const ok = out.length === data.length && crc32(out) === crc32(data);
  return { ok, K, sent, received, overhead: received / K };
}

const cases = [
  { size: 1, blockSize: 400 },
  { size: 399, blockSize: 400 },
  { size: 800, blockSize: 400 },
  { size: 4096, blockSize: 400 },
  { size: 250_000, blockSize: 800 },
  { size: 1_200_000, blockSize: 830 },
];
const losses = [0, 0.3, 0.6, 0.85];

let failures = 0;
for (const c of cases) {
  for (const loss of losses) {
    const r = run(c.size, c.blockSize, loss);
    const tag = `${String(c.size).padStart(9)}B blk=${c.blockSize} perdida=${(loss * 100).toFixed(0).padStart(2)}%`;
    if (!r.ok) {
      failures++;
      console.log(`FALLO  ${tag}  K=${r.K} recibidos=${r.received} ${r.reason ?? 'crc distinto'}`);
    } else {
      console.log(`ok     ${tag}  K=${String(r.K).padStart(5)} simbolos=${String(r.received).padStart(5)} sobrecoste=x${r.overhead.toFixed(2)}`);
    }
  }
}

// base45 exacto para todas las longitudes cortas
for (let n = 0; n < 200; n++) {
  const b = randomBytes(n);
  const rt = decodeBase45(encodeBase45(b));
  if (rt.length !== n || rt.some((v, i) => v !== b[i])) {
    failures++;
    console.log(`FALLO base45 con n=${n}`);
  }
}

console.log(failures === 0 ? '\nTODO OK' : `\n${failures} FALLOS`);
process.exit(failures === 0 ? 0 : 1);
