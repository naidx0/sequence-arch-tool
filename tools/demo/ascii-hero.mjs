#!/usr/bin/env node
/*
 * HERO IMAGES: a real, full-size screenshot of the app laid over an ASCII and dither field.
 *
 *   node tools/demo/ascii-hero.mjs --in <still.png> --out <hero.png> [--theme dark|light] [--w 3840 --h 2160] [--seed 7]
 *
 * The screenshot stays crisp and untouched. Behind it is the Bastion hero treatment the app's own backdrop uses
 * (packages/web2/src/shell2/backdrop/AsciiStage.tsx, ported from the Bastion site): the room's photograph sampled into a character
 * mosaic, each cell filled with its own colour and overlaid with a glyph by brightness, crisp at the focal point and dissolving toward
 * the edges. It is taken to grey and dimmed so the product leads (Graphite: never more hues than claims). Over that, a field of glyphs
 * from the board's ramp (' .,:-=+*#%@') grows denser toward the edges, an ordered (Bayer) dither deciding which cells draw.
 * The same field is laid very faintly over the screenshot's flat ground, so the image and its surround read as one surface.
 * Writes <hero>.png, <hero>.webp (quality 85) and <hero>-1080.webp, <hero>-og.png (1200x630, the share card crop).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const require = createRequire(path.join(ROOT, 'packages', 'web2', 'package.json'));
const { chromium } = require('playwright-core');
const { findChromium, launchOptions } = await import(url.pathToFileURL(path.join(ROOT, 'packages', 'web2', 'e2e', 'lib', 'chromium.mjs')).href);

const argv = process.argv.slice(2);
const arg = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const IN = path.resolve(arg('--in', ''));
const OUT = path.resolve(arg('--out', ''));
const THEME = arg('--theme', 'dark');
const W = Number(arg('--w', '3840'));
const H = Number(arg('--h', '2160'));
const SEED = Number(arg('--seed', '7'));
const PHOTO = path.resolve(arg('--photo', path.join(ROOT, 'packages', 'web2', 'src', 'shell2', 'backdrop', THEME === 'dark' ? 'hero-night.jpg' : 'hero-day.jpg')));
if (!fs.existsSync(IN) || !arg('--out', '')) { console.error('usage: --in <still.png> --out <hero.png> [--theme dark|light]'); process.exit(2); }

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ascii-hero-'));
/* Data URLs, not files: a file:// image taints the canvas and getImageData then throws. */
const shotUrl = `data:image/png;base64,${fs.readFileSync(IN).toString('base64')}`;
const photoUrl = `data:image/jpeg;base64,${fs.readFileSync(PHOTO).toString('base64')}`;
const fontUrl = `data:font/woff2;base64,${fs.readFileSync(path.join(ROOT, 'site', 'public', 'fonts', 'jetbrains-mono-latin-400-normal.woff2')).toString('base64')}`;
fs.writeFileSync(path.join(work, 'index.html'), `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: M; src: url(${fontUrl}); }
html, body { margin: 0; background: #000; }
canvas { display: block; }
</style><canvas id="c" width="${W}" height="${H}"></canvas><script>
const THEME = ${JSON.stringify(THEME)}, SEED = ${SEED};
const RAMP = ' .,:-=+*#%@';
const GROUND = THEME === 'dark' ? '#101113' : '#f1ebdd';
const INK = THEME === 'dark' ? [208, 212, 220] : [58, 54, 46];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const hash = (x, y) => { let h = (x * 374761393 + y * 668265263 + SEED * 1442695041) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
async function main() {
  document.title = 'fonts'; await document.fonts.load('20px M'); document.title = 'img';
  const img = new Image(); img.src = ${JSON.stringify(shotUrl)}; await img.decode();
  document.title = 'decoded'; const c = document.getElementById('c'), g = c.getContext('2d');
  g.fillStyle = GROUND; g.fillRect(0, 0, ${W}, ${H});
  /* the screenshot: 76% of the width, centred, a little above centre */
  const sw = Math.round(${W} * 0.76), sh = Math.round(sw * img.height / img.width);
  const sx = Math.round((${W} - sw) / 2), sy = Math.round((${H} - sh) / 2 - ${H} * 0.015), rad = 26;
  const CW = 16, CH = 28;
  /* The Bastion mosaic (AsciiStage.tsx mosaicSteps, 2x cells), then taken to grey and dimmed. */
  const photo = new Image(); photo.src = ${JSON.stringify(photoUrl)}; await photo.decode();
  const HEX = '0123456789abcdef';
  const FOCUS = THEME === 'dark' ? { x: 0.62, y: 0.85, S: 1 } : { x: 0.72, y: 0.5, S: 0.5 };
  const mosaic = () => {
    const cw = 12, ch = 19, cols = Math.ceil(${W} / cw), rows = Math.ceil(${H} / ch);
    const s = Math.max(${W} / photo.naturalWidth, ${H} / photo.naturalHeight), dw = photo.naturalWidth * s, dh = photo.naturalHeight * s;
    const dx = (${W} - dw) * FOCUS.x, dy = (${H} - dh) * FOCUS.y;
    const gc = document.createElement('canvas'); gc.width = cols; gc.height = rows;
    const gx = gc.getContext('2d', { willReadFrequently: true }); gx.imageSmoothingQuality = 'high';
    gx.drawImage(photo, (0 - dx) / s, (0 - dy) / s, (cols * cw) / s, (rows * ch) / s, 0, 0, cols, rows);
    const col = gx.getImageData(0, 0, cols, rows).data;
    const layer = document.createElement('canvas'); layer.width = ${W}; layer.height = ${H};
    const b = layer.getContext('2d'); b.drawImage(photo, dx, dy, dw, dh);
    b.font = Math.round(ch * 0.92) + 'px M, monospace'; b.textBaseline = 'top';
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4, R = col[i], G = col[i + 1], B = col[i + 2];
      const lum = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255, k = Math.min(RAMP.length - 1, Math.floor(lum * RAMP.length));
      const ddx = (x / cols - FOCUS.x) * 1.3, ddy = (y / rows - FOCUS.y);
      const edge = Math.min(1, Math.max(0, (Math.hypot(ddx, ddy) - 0.14) / 0.45));
      const wgt = Math.min(1, (0.3 + 0.7 * edge * edge) * (0.5 + FOCUS.S));
      b.fillStyle = 'rgba(' + R + ',' + G + ',' + B + ',' + (0.1 + 0.85 * wgt) + ')'; b.fillRect(x * cw, y * ch, cw, ch);
      const lift = lum < 0.5 ? 60 + 70 * FOCUS.S : -(40 + 30 * FOCUS.S);
      const cl = (v) => Math.max(0, Math.min(255, v));
      const glyph = lum > 0.12 && hash(x, y) < 0.18 + 0.3 * FOCUS.S ? HEX[Math.floor(hash(y, x) * 16)] : RAMP[Math.max(1, k)];
      b.globalAlpha = Math.min(1, 0.25 + 0.75 * wgt); b.fillStyle = 'rgb(' + cl(R + lift) + ',' + cl(G + lift) + ',' + cl(B + lift * 1.1) + ')'; b.fillText(glyph, x * cw + 1, y * ch); b.globalAlpha = 1;
    }
    g.save(); g.filter = THEME === 'dark' ? 'grayscale(1) brightness(0.5) contrast(1.05)' : 'grayscale(1) brightness(1.04) contrast(0.9)'; g.globalAlpha = THEME === 'dark' ? 0.9 : 0.55; g.drawImage(layer, 0, 0); g.restore();
  };
  const field = (x0, y0, x1, y1, boost, mask) => {
    g.font = (CH - 6) + 'px M'; g.textBaseline = 'middle'; g.textAlign = 'center';
    for (let cy = Math.floor(y0 / CH); cy * CH < y1; cy++) for (let cx = Math.floor(x0 / CW); cx * CW < x1; cx++) {
      const px = cx * CW + CW / 2, py = cy * CH + CH / 2;
      if (mask && !mask(px, py)) continue;
      /* density: low at the middle, high at the edges and toward the bottom (the board's ramp grows the same way) */
      const nx = (px / ${W} - 0.5) * 2, ny = (py / ${H} - 0.5) * 2;
      const edge = Math.min(1, Math.hypot(nx * 0.95, ny * 0.9));
      const d = Math.min(1, (Math.pow(edge, 1.7) * 0.85 + Math.max(0, ny) * 0.28) * boost);
      /* ordered dither decides whether this cell draws at all; a hash picks a glyph from the ramp up to its density */
      const bayer = BAYER[(cy & 3) * 4 + (cx & 3)] / 16;
      if (d < bayer * 0.9 + hash(cx, cy) * 0.1) continue;
      const k = 1 + Math.floor(hash(cy, cx) * Math.min(RAMP.length - 1, 2 + d * (RAMP.length - 2)));
      const a = Math.min(0.62, 0.10 + d * 0.5) * (mask ? 0.35 : 1);
      g.fillStyle = 'rgba(' + INK[0] + ',' + INK[1] + ',' + INK[2] + ',' + a.toFixed(3) + ')';
      g.fillText(RAMP[k], px, py);
    }
  };
  document.title = 'field1'; mosaic(); field(0, 0, ${W}, ${H}, 0.8, null); document.title = 'shadow';
  /* a soft shadow, then the screenshot with rounded corners */
  g.save(); g.shadowColor = THEME === 'dark' ? 'rgba(0,0,0,0.75)' : 'rgba(40,32,18,0.35)'; g.shadowBlur = 90; g.shadowOffsetY = 36;
  g.fillStyle = GROUND; g.beginPath(); g.roundRect(sx, sy, sw, sh, rad); g.fill(); g.restore();
  g.save(); g.beginPath(); g.roundRect(sx, sy, sw, sh, rad); g.clip(); g.drawImage(img, sx, sy, sw, sh); g.restore();
  g.lineWidth = 2; g.strokeStyle = THEME === 'dark' ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.12)'; g.beginPath(); g.roundRect(sx, sy, sw, sh, rad); g.stroke();
  /* the same field, very faint, over the screenshot's own flat ground (cells whose pixels are all close to the ground colour) */
  const probe = document.createElement('canvas'); probe.width = ${W}; probe.height = ${H}; const pg = probe.getContext('2d', { willReadFrequently: true });
  pg.drawImage(c, 0, 0);
  const flat = (px, py) => {
    if (px < sx + 8 || px > sx + sw - 8 || py < sy + 8 || py > sy + sh - 8) return false;
    const d = pg.getImageData(px - CW / 2, py - CH / 2, CW, CH).data; let lo = 255, hi = 0;
    for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; if (l < lo) lo = l; if (l > hi) hi = l; }
    return hi - lo < 9;
  };
  document.title = 'flat'; field(sx, sy, sx + sw, sy + sh, 1.0, flat);
  document.title = 'done';
}
main();
</script>`);

const browser = await chromium.launch(launchOptions(findChromium()));
const page = await (await browser.newContext({ viewport: { width: 800, height: 450 } })).newPage();
page.on('pageerror', (e) => console.error('page error:', String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') console.error('console:', m.text().slice(0, 300)); });
await page.goto(url.pathToFileURL(path.join(work, 'index.html')).href);
const t0 = Date.now();
while ((await page.title()) !== 'done') { if (Date.now() - t0 > 90000) throw new Error('stuck at ' + (await page.title())); await new Promise((r) => setTimeout(r, 1000)); }
const data = await page.evaluate(() => document.getElementById('c').toDataURL('image/png'));
await browser.close();
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.from(data.split(',')[1], 'base64'));
const ff = (args) => spawnSync(process.env.FFMPEG ?? 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const base = OUT.replace(/\.png$/, '');
ff(['-i', OUT, '-c:v', 'libwebp', '-quality', '85', `${base}.webp`]);
ff(['-i', OUT, '-vf', 'scale=1920:-1:flags=lanczos', '-c:v', 'libwebp', '-quality', '85', `${base}-1080.webp`]);
ff(['-i', OUT, '-vf', 'scale=1200:-1:flags=lanczos,crop=1200:630:0:(ih-630)/2', `${base}-og.png`]);
fs.rmSync(work, { recursive: true, force: true });
console.log('wrote', path.basename(OUT), 'and .webp, -1080.webp, -og.png');
