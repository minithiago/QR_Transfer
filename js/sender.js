// Lado emisor: trocea el fichero y emite un flujo continuo de codigos QR.

import { crc32 } from './crc32.js';
import { splitBlocks, encodeSymbol } from './fountain.js';
import { encodeDataFrame, encodeMetaFrame, makeSessionId, MAX_HEADER } from './protocol.js';
import { bytesPerChars } from './base45.js';
import { qrCapacity, makeMatrix, drawMatrix } from './qrgen.js';

// Cada cuantos fotogramas se repiten los metadatos. El receptor no puede
// decodificar nada hasta tener el primero, y puede engancharse tarde.
const META_EVERY = 17;

export async function gzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export class Sender {
  /** @param {{canvas: HTMLCanvasElement, onStats?: (s:object)=>void}} opts */
  constructor({ canvas, onStats }) {
    this.canvas = canvas;
    this.onStats = onStats || (() => {});
    this.sid = makeSessionId();
    this.running = false;
    this.timer = null;
    this.wakeLock = null;
    this.fps = 8;
    this.cssSize = 320;
  }

  /**
   * Prepara el fichero: comprime (si conviene), trocea y calcula el plan.
   * @param {File} file
   * @param {{version:number, ecc:string, compress:boolean}} opts
   */
  async prepare(file, { version, ecc, compress }) {
    const raw = new Uint8Array(await file.arrayBuffer());

    let payload = raw;
    let gz = 0;
    if (compress && typeof CompressionStream === 'function' && raw.length > 256) {
      try {
        const packed = await gzip(raw);
        // solo compensa si el ahorro es real (los jpg/mp4/zip ya vienen comprimidos)
        if (packed.length < raw.length * 0.97) {
          payload = packed;
          gz = 1;
        }
      } catch {
        /* si el navegador no puede, se envia sin comprimir */
      }
    }

    const capacity = qrCapacity(version, ecc);
    const payloadChars = capacity - MAX_HEADER;
    if (payloadChars < 30) throw new Error('La version de QR elegida es demasiado pequena');
    const blockSize = bytesPerChars(payloadChars);

    this.version = version;
    this.ecc = ecc;
    this.blocks = splitBlocks(payload, blockSize);
    this.blockSize = blockSize;
    this.K = this.blocks.length;

    this.meta = {
      v: 1,
      n: file.name || 'archivo',
      t: file.type || 'application/octet-stream',
      o: raw.length,          // tamano original
      l: payload.length,      // tamano transmitido
      k: this.K,
      b: blockSize,
      c: crc32(payload),      // crc de lo transmitido
      f: crc32(raw),          // crc del fichero original
      z: gz,
    };
    this.metaFrame = encodeMetaFrame(this.sid, this.meta);

    this.seed = 0;
    this.pos = 0;
    this.dataFrames = 0;
    this.startedAt = 0;

    return {
      K: this.K,
      blockSize,
      originalSize: raw.length,
      sentSize: payload.length,
      compressed: !!gz,
      capacity,
    };
  }

  setSize(cssSize) {
    this.cssSize = cssSize;
    if (!this.running) this._draw(this.lastText || this.metaFrame);
  }

  setFps(fps) {
    this.fps = Math.max(1, Math.min(30, fps));
  }

  start() {
    if (this.running || !this.blocks) return;
    this.running = true;
    if (!this.startedAt) this.startedAt = performance.now();
    this._requestWakeLock();
    const loop = () => {
      if (!this.running) return;
      const t0 = performance.now();
      this._step();
      const delay = Math.max(0, 1000 / this.fps - (performance.now() - t0));
      this.timer = setTimeout(loop, delay);
    };
    loop();
  }

  pause() {
    this.running = false;
    clearTimeout(this.timer);
    this._releaseWakeLock();
  }

  stop() {
    this.pause();
    this.blocks = null;
  }

  _step() {
    const isMeta = this.pos < 2 || this.pos % META_EVERY === 0;
    let text;
    if (isMeta) {
      text = this.metaFrame;
    } else {
      text = encodeDataFrame(this.sid, this.seed, encodeSymbol(this.blocks, this.seed));
      this.seed = (this.seed + 1) % 0x7fffffff;
      this.dataFrames++;
    }
    this.pos++;
    this._draw(text, isMeta);

    const elapsed = (performance.now() - this.startedAt) / 1000;
    this.onStats({
      pass: Math.floor(this.seed / this.K) + 1,
      seed: this.seed,
      K: this.K,
      dataFrames: this.dataFrames,
      elapsed,
      rate: elapsed > 0 ? (this.dataFrames * this.blockSize) / elapsed : 0,
    });
  }

  _draw(text, isMeta) {
    this.lastText = text;
    // Los metadatos son cortos: se dibujan con la version minima que los admita
    // (typeNumber 0 = automatico), asi se leen mucho mas rapido.
    const matrix = makeMatrix(text, isMeta ? 0 : this.version, this.ecc);
    drawMatrix(this.canvas, matrix, this.cssSize);
  }

  async _requestWakeLock() {
    try {
      if ('wakeLock' in navigator) this.wakeLock = await navigator.wakeLock.request('screen');
    } catch {
      /* sin bloqueo de pantalla: el usuario tendra que tocarla de vez en cuando */
    }
  }

  _releaseWakeLock() {
    try {
      this.wakeLock?.release();
    } catch { /* ignorar */ }
    this.wakeLock = null;
  }
}
