// Pegamento de la interfaz.

import { Sender } from './sender.js';
import { Receiver } from './receiver.js';
import { Scanner } from './scanner.js';
import { qrCapacity, makeMatrix, drawMatrix } from './qrgen.js';
import { bytesPerChars } from './base45.js';
import { MAX_HEADER, encodeDataFrame } from './protocol.js';
import { encodeSymbol } from './fountain.js';

const $ = (sel) => document.querySelector(sel);
const screens = document.querySelectorAll('.screen');

let sender = null;
let scanner = null;
let receiver = null;
let currentFile = null;
let plan = null;
let objectUrl = null;

/* ───────────────────────── navegación ───────────────────────── */

function show(name) {
  screens.forEach((s) => s.classList.toggle('active', s.dataset.screen === name));
  $('#backBtn').classList.toggle('hidden', name === 'home');
  window.scrollTo(0, 0);
}

document.querySelectorAll('[data-go]').forEach((btn) => {
  btn.addEventListener('click', () => show(btn.dataset.go));
});

$('#backBtn').addEventListener('click', () => {
  stopEverything();
  show('home');
});

$('#helpBtn').addEventListener('click', () => $('#helpDlg').showModal());

/* ─────────────── compartir la URL con el otro móvil ─────────────── */

const shareUrl = () => location.origin + location.pathname;

$('#shareBtn').addEventListener('click', () => {
  const url = shareUrl();
  $('#shareUrl').textContent = url;
  $('#shareLocal').hidden = !/^(localhost|127\.|\[?::1)/.test(location.hostname);
  $('#shareDlg').showModal();
  // la URL lleva minusculas, asi que va en modo byte (no alfanumerico)
  const size = Math.min(260, window.innerWidth - 90);
  drawMatrix($('#shareCanvas'), makeMatrix(url, 0, 'M', 'Byte'), size, 1);
});

$('#shareClose').addEventListener('click', () => $('#shareDlg').close());

if (navigator.share) {
  const btn = $('#shareNative');
  btn.hidden = false;
  btn.addEventListener('click', () =>
    navigator.share({ title: 'QR Transfer', url: shareUrl() }).catch(() => {}));
}

function stopEverything() {
  sender?.stop();
  sender = null;
  scanner?.stop();
  scanner = null;
  receiver = null;
  $('#sendLive').classList.add('hidden');
  $('#sendSetup').classList.remove('hidden');
  $('#recLive').classList.add('hidden');
  $('#recDone').classList.add('hidden');
  $('#recIdle').classList.remove('hidden');
}

if (!window.isSecureContext) $('#httpsNote').hidden = false;

/* ───────────────────────── utilidades ───────────────────────── */

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(2) + ' MB';
}

function fmtTime(s) {
  if (!Number.isFinite(s)) return '—';
  if (s < 1) return '<1 s';
  s = Math.round(s);
  if (s < 60) return s + ' s';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 5000);
}

function qrCssSize() {
  return Math.min(window.innerWidth - 32, 460, Math.round(window.innerHeight * 0.62));
}

/* ───────────────────────── enviar ───────────────────────── */

const fileInput = $('#fileInput');
const dropzone = $('#dropzone');

fileInput.addEventListener('change', () => {
  if (fileInput.files?.[0]) selectFile(fileInput.files[0]);
});

['dragenter', 'dragover'].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) =>
  dropzone.addEventListener(ev, () => dropzone.classList.remove('over')));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) selectFile(f);
});

['#optVersion', '#optEcc', '#optZip'].forEach((sel) =>
  $(sel).addEventListener('change', () => { updateCapacityHint(); refreshPlan(); }));

$('#optFps').addEventListener('input', (e) => {
  $('#optFpsOut').value = e.target.value;
  renderPlan();
});

function options() {
  return {
    version: +$('#optVersion').value,
    ecc: $('#optEcc').value,
    compress: $('#optZip').checked,
  };
}

function updateCapacityHint() {
  const { version, ecc } = options();
  try {
    const capacity = qrCapacity(version, ecc);
    const perFrame = bytesPerChars(capacity - MAX_HEADER);
    $('#capacityHint').textContent =
      `Cada código lleva ${perFrame} bytes útiles (versión ${version}, ${version * 4 + 17}×${version * 4 + 17} módulos, ECC ${ecc}).`;
  } catch (err) {
    $('#capacityHint').textContent = 'No se pudo calcular la capacidad: ' + err.message;
  }
}

async function selectFile(file) {
  currentFile = file;
  $('#fileCard').classList.remove('hidden');
  $('#fName').textContent = file.name;
  $('#fSize').textContent = fmtBytes(file.size);
  $('#fSent').textContent = 'calculando…';
  await refreshPlan();
}

let planToken = 0;
async function refreshPlan() {
  if (!currentFile) return;
  const token = ++planToken;
  $('#startSend').disabled = true;
  try {
    const s = new Sender({ canvas: $('#qrCanvas') });
    const info = await s.prepare(currentFile, options());
    if (token !== planToken) return; // ha llegado otra petición más nueva
    sender = s;
    plan = info;
    renderPlan();
    $('#startSend').disabled = false;
  } catch (err) {
    if (token === planToken) {
      plan = null;
      toast('No se pudo preparar el archivo: ' + err.message);
    }
  }
}

function renderPlan() {
  if (!plan) return;
  const fps = +$('#optFps').value;
  $('#fSent').textContent = plan.compressed
    ? `${fmtBytes(plan.sentSize)} (comprimido, −${Math.round((1 - plan.sentSize / plan.originalSize) * 100)}%)`
    : fmtBytes(plan.sentSize);
  $('#fChunks').textContent = `${plan.K} × ${plan.blockSize} B`;
  // hace falta leer ~1,3 × K códigos, y en la práctica se pierden bastantes
  $('#fEta').textContent = `${fmtTime((plan.K * 1.3) / fps)} en el mejor caso`;
}

$('#startSend').addEventListener('click', async () => {
  if (!sender || !plan) return;
  $('#sendSetup').classList.add('hidden');
  $('#sendLive').classList.remove('hidden');
  $('#liveFps').value = $('#optFps').value;
  $('#liveFpsOut').value = $('#optFps').value;
  sender.setFps(+$('#optFps').value);
  sender.setSize(qrCssSize());
  sender.onStats = (s) => {
    $('#sPass').textContent = s.pass;
    $('#sFrames').textContent = s.dataFrames;
    $('#sRate').textContent = (s.rate / 1024).toFixed(1);
    $('#sTime').textContent = fmtTime(s.elapsed);
  };
  sender.start();
});

$('#liveFps').addEventListener('input', (e) => {
  $('#liveFpsOut').value = e.target.value;
  sender?.setFps(+e.target.value);
});

$('#pauseSend').addEventListener('click', () => {
  if (!sender) return;
  if (sender.running) {
    sender.pause();
    $('#pauseSend').textContent = 'Reanudar';
  } else {
    sender.start();
    $('#pauseSend').textContent = 'Pausar';
  }
});

$('#stopSend').addEventListener('click', () => {
  sender?.pause();
  sender = null;
  $('#sendLive').classList.add('hidden');
  $('#sendSetup').classList.remove('hidden');
  $('#pauseSend').textContent = 'Pausar';
  refreshPlan();
});

window.addEventListener('resize', () => {
  if (sender && !$('#sendLive').classList.contains('hidden')) sender.setSize(qrCssSize());
});

// si el emisor pasa a segundo plano el navegador congela los temporizadores
document.addEventListener('visibilitychange', () => {
  if (document.hidden && sender?.running) {
    sender.pause();
    $('#pauseSend').textContent = 'Reanudar';
  }
});

/* ───────────────────────── recibir ───────────────────────── */

$('#startCam').addEventListener('click', startReceiving);
$('#stopCam').addEventListener('click', () => {
  scanner?.stop();
  scanner = null;
  $('#recLive').classList.add('hidden');
  $('#recIdle').classList.remove('hidden');
});
$('#againBtn').addEventListener('click', () => {
  $('#recDone').classList.add('hidden');
  startReceiving();
});

function buildReceiver() {
  $('#recIdle').classList.add('hidden');
  $('#recDone').classList.add('hidden');
  $('#recLive').classList.remove('hidden');
  $('#recInfo').hidden = true;
  $('#recBar').style.width = '0%';
  $('#recPct').textContent = '0%';
  $('#recEta').textContent = '';
  $('#recHint').textContent = 'Buscando códigos…';

  return new Receiver({
    onMeta: (meta) => {
      $('#recInfo').hidden = false;
      $('#rName').textContent = meta.n;
      $('#rSize').textContent = fmtBytes(meta.o) + (meta.z ? ' (comprimido)' : '');
      $('#rChunks').textContent = `0 / ${meta.k}`;
      $('#recHint').textContent = 'Recibiendo… no muevas el móvil.';
    },
    onProgress: (p) => {
      const pct = Math.round(p.fraction * 100);
      $('#recBar').style.width = pct + '%';
      $('#recPct').textContent = pct + '%';
      $('#rChunks').textContent = `${p.done} / ${p.K}`;
      $('#rRate').textContent = `${p.rate.toFixed(1)} códigos/s`;
      $('#recEta').textContent = p.done < p.K ? 'faltan ~' + fmtTime(p.eta) : 'ensamblando…';
    },
    onComplete: showResult,
    onError: (err) => {
      toast(err.message);
      $('#recHint').textContent = 'Error: ' + err.message;
    },
  });
}

async function startReceiving() {
  receiver = buildReceiver();
  scanner = new Scanner($('#video'), (text) => receiver?.handleText(text));
  try {
    const info = await scanner.start();
    $('#recHint').textContent = `Buscando códigos… (lector: ${info.engine})`;
  } catch (err) {
    scanner = null;
    $('#recLive').classList.add('hidden');
    $('#recIdle').classList.remove('hidden');
    toast('No se pudo abrir la cámara: ' + err.message);
  }
}

function showResult({ blob, name, meta, elapsed }) {
  scanner?.stop();
  scanner = null;
  $('#recLive').classList.add('hidden');
  $('#recDone').classList.remove('hidden');

  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(blob);

  $('#doneName').textContent = name;
  $('#doneMeta').textContent = `${fmtBytes(blob.size)} · recibido en ${fmtTime(elapsed)} · integridad verificada (CRC-32)`;
  const link = $('#downloadLink');
  link.href = objectUrl;
  link.download = name;

  const prev = $('#preview');
  prev.innerHTML = '';
  const type = meta.t || '';
  if (type.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = objectUrl;
    prev.append(img);
  } else if (type.startsWith('video/')) {
    const v = document.createElement('video');
    v.src = objectUrl;
    v.controls = true;
    prev.append(v);
  } else if (type.startsWith('audio/')) {
    const a = document.createElement('audio');
    a.src = objectUrl;
    a.controls = true;
    prev.append(a);
  } else if (type.startsWith('text/') || type.includes('json') || type.includes('xml')) {
    blob.slice(0, 4000).text().then((t) => {
      const pre = document.createElement('pre');
      pre.textContent = t + (blob.size > 4000 ? '\n…' : '');
      prev.append(pre);
    });
  }
}

/* ───────────────────────── arranque ───────────────────────── */

// Modo de prueba sin camara: añade #autotest a la URL y ejecuta qrtSelfTest()
// en la consola. Genera un archivo, lo emite en memoria perdiendo fotogramas a
// propósito y lo recibe, para comprobar toda la cadena en un ordenador.
if (location.hash === '#autotest') {
  window.qrtSelfTest = async (size = 60000, loss = 0.4) => {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i += 65536) crypto.getRandomValues(bytes.subarray(i, Math.min(i + 65536, size)));
    const s = new Sender({ canvas: $('#qrCanvas') });
    const info = await s.prepare(new File([bytes], 'autotest.bin', { type: 'application/octet-stream' }), options());
    show('receive');
    const r = buildReceiver();
    for (let pos = 0; pos < info.K * 8 + 60; pos++) {
      const text = pos < 2 || pos % 17 === 0
        ? s.metaFrame
        : encodeDataFrame(s.sid, pos, encodeSymbol(s.blocks, pos));
      if (Math.random() >= loss) r.handleText(text);
      if (r.finished) break;
      if (pos % 40 === 0) await new Promise((res) => setTimeout(res, 0));
    }
    return { K: info.K, finished: r.finished };
  };
}

updateCapacityHint();
Scanner.listCameras().then((cams) => {
  if (cams.length > 1) $('#camList').textContent = `${cams.length} cámaras detectadas; se usará la trasera.`;
}).catch(() => {});
