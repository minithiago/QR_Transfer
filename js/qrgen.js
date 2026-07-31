// Generacion y pintado de los codigos QR (envuelve a vendor/qrcode.js).

const capacityCache = new Map();

/** Numero maximo de caracteres alfanumericos que caben en una version+ECC. */
export function qrCapacity(version, ecc) {
  const key = version + ecc;
  const hit = capacityCache.get(key);
  if (hit !== undefined) return hit;

  const fits = (n) => {
    try {
      const q = window.qrcode(version, ecc);
      q.addData('A'.repeat(n), 'Alphanumeric');
      q.make();
      return true;
    } catch {
      return false;
    }
  };

  let lo = 1;
  let hi = 4300;
  if (!fits(1)) throw new Error('Version QR no valida: ' + version);
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (fits(mid)) lo = mid; else hi = mid - 1;
  }
  capacityCache.set(key, lo);
  return lo;
}

/**
 * Crea la matriz del QR. Lanza excepcion si el texto no cabe.
 * `version` 0 = elegir la mas pequena que valga.
 */
export function makeMatrix(text, version, ecc, mode = 'Alphanumeric') {
  const q = window.qrcode(version, ecc);
  q.addData(text, mode);
  q.make();
  const n = q.getModuleCount();
  return { size: n, isDark: (r, c) => q.isDark(r, c) };
}

/**
 * Pinta la matriz en el canvas ajustando el tamano de modulo a un numero
 * entero de pixeles fisicos: si no, el reescalado emborrona los bordes y la
 * camara del otro telefono falla mucho mas.
 */
export function drawMatrix(canvas, matrix, cssSize, margin = 3) {
  const dpr = window.devicePixelRatio || 1;
  const total = matrix.size + margin * 2;
  const module = Math.max(1, Math.floor((cssSize * dpr) / total));
  const px = module * total;

  if (canvas.width !== px || canvas.height !== px) {
    canvas.width = px;
    canvas.height = px;
  }
  canvas.style.width = px / dpr + 'px';
  canvas.style.height = px / dpr + 'px';

  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = '#000000';
  const off = margin * module;
  for (let r = 0; r < matrix.size; r++) {
    for (let c = 0; c < matrix.size; c++) {
      if (matrix.isDark(r, c)) ctx.fillRect(off + c * module, off + r * module, module, module);
    }
  }
}
