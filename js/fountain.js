// Codigo fuente "fountain" (LT / Luby Transform) con arranque sistematico.
//
// El canal QR->camara es unidireccional y pierde muchos fotogramas: el receptor
// no puede pedir "reenviame el trozo 37". Con un codigo fountain da igual QUE
// fotogramas se pierdan: en cuanto se capturan ~K*1.05 simbolos cualesquiera se
// reconstruye el fichero entero.
//
// - Los primeros K simbolos (seed 0..K-1) son los bloques originales tal cual,
//   asi que en condiciones buenas el fichero pasa en una sola vuelta.
// - A partir de ahi cada simbolo es el XOR de un subconjunto pseudoaleatorio de
//   bloques, elegido con una distribucion Robust Soliton a partir de la semilla.
//   Emisor y receptor derivan el mismo subconjunto de la misma semilla, asi que
//   no hace falta transmitir la lista de indices.

/** PRNG determinista de 32 bits (mulberry32). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ajustados con test/sim.mjs: dan el menor sobrecoste medio (~x1.3) en el
// rango de K que se usa aqui (decenas a miles de bloques).
const C = 0.1;
const DELTA = 0.05;

const cdfCache = new Map();

/** Distribucion Robust Soliton acumulada para K bloques. */
export function robustSolitonCdf(K) {
  const cached = cdfCache.get(K);
  if (cached) return cached;

  const rho = new Float64Array(K + 1);
  rho[1] = 1 / K;
  for (let d = 2; d <= K; d++) rho[d] = 1 / (d * (d - 1));

  const R = C * Math.log(K / DELTA) * Math.sqrt(K);
  const tau = new Float64Array(K + 1);
  const pivot = Math.floor(K / R);
  for (let d = 1; d < pivot && d <= K; d++) tau[d] = R / (d * K);
  if (pivot >= 1 && pivot <= K) tau[pivot] = (R * Math.log(R / DELTA)) / K;

  let Z = 0;
  for (let d = 1; d <= K; d++) Z += rho[d] + tau[d];

  const cdf = new Float64Array(K + 1);
  let acc = 0;
  for (let d = 1; d <= K; d++) {
    acc += (rho[d] + tau[d]) / Z;
    cdf[d] = acc;
  }
  cdf[K] = 1;

  cdfCache.set(K, cdf);
  return cdf;
}

function sampleDegree(cdf, K, r) {
  // busqueda binaria sobre la acumulada
  let lo = 1;
  let hi = K;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (r <= cdf[mid]) hi = mid; else lo = mid + 1;
  }
  return lo;
}

/**
 * Indices de bloque que componen el simbolo `seed`.
 * Debe dar exactamente el mismo resultado en emisor y receptor.
 * @returns {number[]}
 */
export function symbolIndices(seed, K) {
  if (seed < K) return [seed]; // fase sistematica: bloque original
  const rng = mulberry32(Math.imul(seed + 1, 0x9e3779b1) ^ Math.imul(K, 0x85ebca6b));
  // se descartan un par de valores para despegar el estado del PRNG
  rng(); rng();
  const cdf = robustSolitonCdf(K);
  let d = sampleDegree(cdf, K, rng());
  if (d > K) d = K;
  if (d === K) return Array.from({ length: K }, (_, i) => i);
  const picked = new Set();
  let guard = 0;
  while (picked.size < d && guard++ < d * 40) picked.add(Math.floor(rng() * K) % K);
  // salvaguarda por si el PRNG repite demasiado
  for (let i = 0; picked.size < d; i++) picked.add(i);
  return Array.from(picked);
}

/** Trocea los datos en K bloques de `blockSize` bytes (el ultimo con relleno). */
export function splitBlocks(data, blockSize) {
  const K = Math.max(1, Math.ceil(data.length / blockSize));
  const blocks = [];
  for (let i = 0; i < K; i++) {
    const b = new Uint8Array(blockSize);
    b.set(data.subarray(i * blockSize, Math.min((i + 1) * blockSize, data.length)));
    blocks.push(b);
  }
  return blocks;
}

/** XOR de los bloques que forman el simbolo `seed`. */
export function encodeSymbol(blocks, seed) {
  const ids = symbolIndices(seed, blocks.length);
  const out = new Uint8Array(blocks[0].length);
  out.set(blocks[ids[0]]);
  for (let i = 1; i < ids.length; i++) {
    const src = blocks[ids[i]];
    for (let j = 0; j < out.length; j++) out[j] ^= src[j];
  }
  return out;
}

/** Decodificador por "peeling": resuelve simbolos de grado 1 en cascada. */
export class FountainDecoder {
  constructor(K, blockSize, totalLength) {
    this.K = K;
    this.blockSize = blockSize;
    this.totalLength = totalLength;
    this.decoded = new Array(K).fill(null);
    this.decodedCount = 0;
    this.pending = new Set(); // simbolos aun no resueltos
    this.byBlock = new Map(); // idBloque -> Set<simbolo>
    this.seen = new Set();    // semillas ya procesadas
  }

  get complete() {
    return this.decodedCount === this.K;
  }

  get progress() {
    return this.decodedCount / this.K;
  }

  /**
   * Incorpora un simbolo recibido.
   * @returns {boolean} true si el simbolo aportaba informacion nueva
   */
  addSymbol(seed, data) {
    if (this.seen.has(seed) || this.complete) return false;
    this.seen.add(seed);

    const ids = new Set(symbolIndices(seed, this.K));
    const payload = data.slice(0, this.blockSize);

    const before = this.decodedCount;
    this._reduce({ ids, data: payload });
    return this.decodedCount > before;
  }

  _reduce(symbol) {
    // quita de la combinacion los bloques ya conocidos
    for (const id of Array.from(symbol.ids)) {
      const known = this.decoded[id];
      if (known) {
        xorInto(symbol.data, known);
        symbol.ids.delete(id);
      }
    }
    if (symbol.ids.size === 0) return; // redundante

    if (symbol.ids.size > 1) {
      this.pending.add(symbol);
      for (const id of symbol.ids) {
        let set = this.byBlock.get(id);
        if (!set) this.byBlock.set(id, (set = new Set()));
        set.add(symbol);
      }
      return;
    }

    // grado 1: resuelve y propaga
    const queue = [symbol];
    while (queue.length) {
      const s = queue.pop();
      const id = s.ids.values().next().value;
      if (this.decoded[id]) continue;
      this.decoded[id] = s.data;
      this.decodedCount++;

      const dependents = this.byBlock.get(id);
      if (!dependents) continue;
      this.byBlock.delete(id);
      for (const dep of dependents) {
        if (!dep.ids.has(id)) continue;
        xorInto(dep.data, s.data);
        dep.ids.delete(id);
        if (dep.ids.size === 1) {
          this.pending.delete(dep);
          const remaining = dep.ids.values().next().value;
          const set = this.byBlock.get(remaining);
          if (set) set.delete(dep);
          queue.push(dep);
        } else if (dep.ids.size === 0) {
          this.pending.delete(dep);
        }
      }
    }
  }

  /** Datos reconstruidos (solo valido cuando `complete`). */
  getResult() {
    const out = new Uint8Array(this.totalLength);
    for (let i = 0; i < this.K; i++) {
      const block = this.decoded[i];
      if (!block) throw new Error('Decodificacion incompleta');
      const offset = i * this.blockSize;
      const len = Math.min(this.blockSize, this.totalLength - offset);
      if (len <= 0) break;
      out.set(block.subarray(0, len), offset);
    }
    return out;
  }
}

function xorInto(target, src) {
  for (let i = 0; i < target.length; i++) target[i] ^= src[i];
}
