// Base45 (RFC 9285). Su alfabeto coincide exactamente con el modo alfanumerico
// de los codigos QR, asi que 2 bytes ocupan 3 caracteres (~3% de sobrecoste)
// frente al 33% que costaria Base64.

const CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

const DECODE_TABLE = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < CHARSET.length; i++) t[CHARSET.charCodeAt(i)] = i;
  return t;
})();

/** @param {Uint8Array} bytes @returns {string} */
export function encodeBase45(bytes) {
  const out = [];
  let i = 0;
  for (; i + 1 < bytes.length; i += 2) {
    let n = bytes[i] * 256 + bytes[i + 1];
    const c = n % 45; n = (n - c) / 45;
    const d = n % 45; n = (n - d) / 45;
    out.push(CHARSET[c], CHARSET[d], CHARSET[n]);
  }
  if (i < bytes.length) {
    let n = bytes[i];
    const c = n % 45; n = (n - c) / 45;
    out.push(CHARSET[c], CHARSET[n]);
  }
  return out.join('');
}

/** @param {string} str @returns {Uint8Array} */
export function decodeBase45(str) {
  const len = str.length;
  const rem = len % 3;
  if (rem === 1) throw new Error('Base45: longitud invalida');
  const out = new Uint8Array(Math.floor(len / 3) * 2 + (rem === 2 ? 1 : 0));
  let o = 0;
  let i = 0;
  for (; i + 2 < len; i += 3) {
    const n = val(str, i) + val(str, i + 1) * 45 + val(str, i + 2) * 45 * 45;
    if (n > 0xffff) throw new Error('Base45: grupo fuera de rango');
    out[o++] = n >> 8;
    out[o++] = n & 0xff;
  }
  if (rem === 2) {
    const n = val(str, i) + val(str, i + 1) * 45;
    if (n > 0xff) throw new Error('Base45: grupo final fuera de rango');
    out[o++] = n;
  }
  return out;
}

function val(str, i) {
  const code = str.charCodeAt(i);
  const v = code < 128 ? DECODE_TABLE[code] : -1;
  if (v < 0) throw new Error('Base45: caracter invalido ' + JSON.stringify(str[i]));
  return v;
}

/** Numero de bytes que caben en `chars` caracteres base45. */
export function bytesPerChars(chars) {
  return Math.floor(chars / 3) * 2;
}
