# QR Transfer

Transfer a file from one phone to another **without Bluetooth, without cables, without an account, and without a shared network**: the sending phone turns the file into a continuous stream of QR codes, and the receiving phone reconstructs it using its camera.

Everything happens in the browser. The file never leaves the two devices: there is no server, no upload, and nothing that can be intercepted over the network.

---

## Usage

1. Both phones open the same webpage (once loaded, no network connection is needed).
2. The device that has the file → **Send a file** → select it → **Start broadcasting**.
3. The other device → **Receive a file** → **Open camera** and point it at the screen.
4. When it reaches 100%, the download button appears. A CRC-32 check is performed, so either the file arrives perfectly intact or an error is reported.

Tips: set the sender's screen brightness to maximum, keep the phones about 15–25 cm apart, make sure the entire QR code is visible in the frame, and keep the phone steady. If progress stalls, reduce the **density** or **speed** in the sender settings.

---

## Serving the Page

The camera only works in a **secure context**: `localhost` or **HTTPS**. This is a browser restriction, not a limitation of this application.

**Option A — GitHub Pages (recommended).** See the next section. It provides free HTTPS, which is exactly what the camera requires.

**Option B — Local server.**

```bash
node server.mjs
```

Serves the application at `http://localhost:8080` and also displays your local network IP addresses.

**Option C — Local server with HTTPS.** Generate a self-signed certificate in the project folder (replace the IP with your own), then start `server.mjs` again.

```bash
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=qrtransfer" -addext "subjectAltName=IP:192.168.1.50"
```

---

## Deploying to GitHub Pages

1. Create an empty repository on GitHub.
2. Connect it and push your branch.
3. Go to **Settings → Pages → Source: GitHub Actions**.
4. Wait for deployment to finish.

---

## How It Works

**Encoding.** Data is encoded using QR alphanumeric mode and **Base45** (RFC 9285).

**Fountain codes.** The file is transmitted using an **LT (Luby Transform) code**. Each QR code contains the XOR of a pseudo-random subset of blocks.

**Frame format**:

```text
QT1:M:<SID>:<base45(metadata json)>
QT1:D:<SID>:<base36_seed>:<base45(XOR)>
```

---

## Performance

| Density | Bytes per QR | At 8 QR/s (raw) |
|----------|--------------|----------------|
| v8 · 49×49 | 172 B | ~1.3 KB/s |
| v12 · 65×65 | 344 B | ~2.7 KB/s |
| v16 · 81×81 (default) | 556 B | ~4.3 KB/s |
| v20 · 97×97 | 820 B | ~6.4 KB/s |
| v24 · 113×113 | 1124 B | ~8.8 KB/s |

---

## Project Structure

```text
index.html
styles.css
js/base45.js
js/crc32.js
js/fountain.js
js/protocol.js
js/qrgen.js
js/sender.js
js/scanner.js
js/receiver.js
js/app.js
vendor/qrcode.js
vendor/jsQR.js
server.mjs
build.mjs
.github/workflows/pages.yml
test/sim.mjs
test/e2e.mjs
```

## Tests

```bash
node test/sim.mjs
node test/e2e.mjs
```

`e2e.mjs` runs through the entire pipeline without a browser and verifies that the reconstructed file is byte-for-byte identical to the original.
