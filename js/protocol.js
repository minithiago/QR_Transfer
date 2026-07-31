// Formato de los fotogramas. Todo el texto usa unicamente el alfabeto
// alfanumerico del QR (0-9 A-Z espacio $ % * + - . / :) para poder emplear el
// modo alfanumerico, que es ~40% mas denso que el modo byte.
//
//   Metadatos:  QT1:M:<SID>:<base45(json)>
//   Datos:      QT1:D:<SID>:<SEMILLA base36>:<base45(bloque)>
//
// El payload base45 puede contener ":", asi que se trocea por posicion y el
// resto de la cadena se toma tal cual.

import { encodeBase45, decodeBase45 } from './base45.js';

export const PROTO = 'QT1';

/** Caracteres de cabecera a reservar como maximo en un fotograma de datos. */
export const MAX_HEADER = PROTO.length + 1 + 1 + 1 + 4 + 1 + 7 + 1; // QT1:D:SID:SEMILLA:

const SID_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function makeSessionId() {
  let s = '';
  for (let i = 0; i < 4; i++) s += SID_CHARS[(Math.random() * SID_CHARS.length) | 0];
  return s;
}

export function encodeMetaFrame(sid, meta) {
  const json = new TextEncoder().encode(JSON.stringify(meta));
  return `${PROTO}:M:${sid}:${encodeBase45(json)}`;
}

export function encodeDataFrame(sid, seed, bytes) {
  return `${PROTO}:D:${sid}:${seed.toString(36).toUpperCase()}:${encodeBase45(bytes)}`;
}

/**
 * @param {string} text
 * @returns {{type:'M', sid:string, meta:object} | {type:'D', sid:string, seed:number, bytes:Uint8Array} | null}
 */
export function parseFrame(text) {
  if (typeof text !== 'string' || !text.startsWith(PROTO + ':')) return null;
  try {
    const type = text[4];
    if (type === 'M') {
      const sid = text.slice(6, 10);
      if (text[10] !== ':') return null;
      const json = new TextDecoder().decode(decodeBase45(text.slice(11)));
      return { type: 'M', sid, meta: JSON.parse(json) };
    }
    if (type === 'D') {
      const sid = text.slice(6, 10);
      if (text[10] !== ':') return null;
      const sep = text.indexOf(':', 11);
      if (sep < 0) return null;
      const seed = parseInt(text.slice(11, sep), 36);
      if (!Number.isFinite(seed) || seed < 0) return null;
      return { type: 'D', sid, seed, bytes: decodeBase45(text.slice(sep + 1)) };
    }
  } catch {
    return null; // fotograma leido a medias o corrupto
  }
  return null;
}
