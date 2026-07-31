// Lectura de QR desde la camara.
// Usa BarcodeDetector (nativo, muy rapido) cuando existe -Chrome/Android- y
// cae a jsQR sobre canvas en el resto -Safari/iOS, Firefox-.

const MAX_SCAN_WIDTH = 960; // suficiente para leer QR densos sin frenar el bucle

export class Scanner {
  /**
   * @param {HTMLVideoElement} video
   * @param {(text:string)=>void} onText
   */
  constructor(video, onText) {
    this.video = video;
    this.onText = onText;
    this.running = false;
    this.stream = null;
    this.detector = null;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.framesScanned = 0;
    this.engine = 'jsQR';
  }

  static async listCameras() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput');
  }

  async start(deviceId) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Este navegador no da acceso a la camara. Hace falta HTTPS (o localhost).');
    }
    const constraints = {
      audio: false,
      video: deviceId
        ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
        : { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    };
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', '');
    await this.video.play();

    // enfoque continuo si el dispositivo lo permite
    const track = this.stream.getVideoTracks()[0];
    try {
      const caps = track.getCapabilities?.() || {};
      if (caps.focusMode?.includes('continuous')) {
        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
      }
    } catch { /* opcional */ }

    if ('BarcodeDetector' in window) {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        if (formats.includes('qr_code')) {
          this.detector = new window.BarcodeDetector({ formats: ['qr_code'] });
          this.engine = 'BarcodeDetector';
        }
      } catch { /* se queda con jsQR */ }
    }

    this.running = true;
    this._loop();
    return { engine: this.engine, label: track.label };
  }

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  async _loop() {
    while (this.running) {
      try {
        await this._scanOnce();
      } catch {
        /* un fotograma ilegible no debe romper el bucle */
      }
      await nextFrame(this.video);
    }
  }

  async _scanOnce() {
    const v = this.video;
    if (!v.videoWidth) return;
    this.framesScanned++;

    if (this.detector) {
      const codes = await this.detector.detect(v);
      for (const c of codes) if (c.rawValue) this.onText(c.rawValue);
      return;
    }

    const scale = Math.min(1, MAX_SCAN_WIDTH / v.videoWidth);
    const w = Math.round(v.videoWidth * scale);
    const h = Math.round(v.videoHeight * scale);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx.drawImage(v, 0, 0, w, h);
    const img = this.ctx.getImageData(0, 0, w, h);
    const res = window.jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
    if (res?.data) this.onText(res.data);
  }
}

function nextFrame(video) {
  return new Promise((resolve) => {
    if (typeof video.requestVideoFrameCallback === 'function') {
      video.requestVideoFrameCallback(() => resolve());
    } else {
      requestAnimationFrame(() => resolve());
    }
  });
}
