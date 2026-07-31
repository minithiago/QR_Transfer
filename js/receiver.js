// Lado receptor: ensambla el fichero a partir de los fotogramas leidos.

import { parseFrame } from './protocol.js';
import { FountainDecoder } from './fountain.js';
import { crc32 } from './crc32.js';

const MAX_BUFFERED = 600; // simbolos guardados mientras no llegan los metadatos

export async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export class Receiver {
  constructor({ onMeta, onProgress, onComplete, onError } = {}) {
    this.onMeta = onMeta || (() => {});
    this.onProgress = onProgress || (() => {});
    this.onComplete = onComplete || (() => {});
    this.onError = onError || (() => {});
    this.reset();
  }

  reset() {
    this.sid = null;
    this.meta = null;
    this.decoder = null;
    this.buffered = [];
    this.symbols = 0;
    this.startedAt = 0;
    this.finished = false;
  }

  /** Procesa el texto de un QR leido. */
  handleText(text) {
    if (this.finished) return;
    const frame = parseFrame(text);
    if (!frame) return;

    if (frame.sid !== this.sid) {
      if (frame.type !== 'M') return; // datos de otra sesion: se ignoran
      this.reset();
      this.sid = frame.sid;
    }

    if (frame.type === 'M') {
      if (!this.decoder) this._initFromMeta(frame.meta);
      return;
    }

    if (!this.startedAt) this.startedAt = performance.now();

    if (!this.decoder) {
      // aun no han llegado los metadatos: se guardan para procesarlos despues
      if (this.buffered.length < MAX_BUFFERED) this.buffered.push(frame);
      return;
    }
    this._consume(frame);
  }

  _initFromMeta(meta) {
    if (!meta || meta.v !== 1 || !meta.k || !meta.b) return;
    this.meta = meta;
    this.decoder = new FountainDecoder(meta.k, meta.b, meta.l);
    if (!this.startedAt) this.startedAt = performance.now();
    this.onMeta(meta);
    const pending = this.buffered;
    this.buffered = [];
    for (const f of pending) this._consume(f);
    this._emitProgress();
  }

  _consume(frame) {
    if (frame.bytes.length !== this.meta.b) return; // fotograma incompleto
    const before = this.decoder.decodedCount;
    const isNew = !this.decoder.seen.has(frame.seed);
    this.decoder.addSymbol(frame.seed, frame.bytes);
    if (!isNew) return;
    this.symbols++;
    if (this.decoder.decodedCount !== before || this.symbols % 3 === 0) this._emitProgress();
    if (this.decoder.complete) this._finish();
  }

  _emitProgress() {
    const d = this.decoder;
    const elapsed = (performance.now() - this.startedAt) / 1000;
    const done = d.decodedCount;
    const rate = elapsed > 0 ? this.symbols / elapsed : 0;
    // el sobrecoste tipico del codigo fountain ronda x1.3
    const remaining = Math.max(0, Math.ceil((d.K - done) * 1.3));
    this.onProgress({
      done,
      K: d.K,
      symbols: this.symbols,
      bytes: done * d.blockSize,
      total: this.meta.l,
      fraction: d.progress,
      rate,
      eta: rate > 0 ? remaining / rate : Infinity,
    });
  }

  async _finish() {
    this.finished = true;
    try {
      let data = this.decoder.getResult();
      if (crc32(data) !== this.meta.c) throw new Error('Los datos recibidos no cuadran (CRC del payload)');
      if (this.meta.z) {
        if (typeof DecompressionStream !== 'function') {
          throw new Error('El archivo viene comprimido y este navegador no sabe descomprimirlo');
        }
        data = await gunzip(data);
      }
      if (data.length !== this.meta.o || crc32(data) !== this.meta.f) {
        throw new Error('El archivo reconstruido no coincide con el original (CRC)');
      }
      const blob = new Blob([data], { type: this.meta.t || 'application/octet-stream' });
      this.onComplete({ blob, name: this.meta.n, meta: this.meta, elapsed: (performance.now() - this.startedAt) / 1000 });
    } catch (err) {
      this.onError(err);
    }
  }
}
