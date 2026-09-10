#!/usr/bin/env node
/**
 * THE APP ICON, RASTERISED FROM THE SEQUENCE MARK — no new dependency.
 *
 *   node packages/desktop/scripts/make-icon.mjs
 *
 * Writes `packages/desktop/build/icon.png` at 1024x1024. `directories.buildResources`
 * is `build`, so electron-builder finds it there by name and derives the `.ico`
 * and `.icns` each target needs. Without it the packer prints
 *
 *     default Electron icon is used
 *
 * and ships an installer wearing Electron's own logo — an app that looks like
 * somebody else's the moment it reaches a taskbar.
 *
 * ── WHY A RASTERISER AND NOT A LIBRARY ────────────────────────────────────
 *
 * `sharp` and `png-to-ico` are both absent here, and adding a dependency to
 * turn four rectangles into a bitmap is not a decision worth making for four
 * rectangles. The mark IS four rounded rectangles (`site/favicon.svg`), so it
 * is drawn directly: coverage-sampled rounded-rect fills composited in order,
 * then a PNG written with `node:zlib`, which is already in the runtime.
 *
 * ── THE GEOMETRY IS THE SVG'S, IN THE SVG'S UNITS ─────────────────────────
 *
 * Every number below is lifted from `site/favicon.svg` on its own 24x24
 * viewBox and scaled here, rather than re-expressed in pixels. If the mark
 * changes, the diff between the two files is readable; a table of pixel values
 * would have to be recomputed by hand and would quietly drift.
 *
 * 16x supersampling per axis. The mark is flat colour with curved corners, so
 * the only thing that reads as quality is the smoothness of those corners.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'build', 'icon.png');

const SIZE = 1024;
const VIEWBOX = 24;
const SAMPLES = 16;

/** The mark, in the SVG's own 24x24 units, painted in this order. */
const SHAPES = [
  { x: 0, y: 0, w: 24, h: 24, r: 5, fill: [0x08, 0x08, 0x0a], alpha: 1 },
  { x: 3, y: 4.5, w: 18, h: 4, r: 1, fill: [0xf5, 0xf5, 0xf7], alpha: 0.9 },
  { x: 3, y: 10, w: 12, h: 4, r: 1, fill: [0xf5, 0xf5, 0xf7], alpha: 0.55 },
  { x: 3, y: 15.5, w: 15, h: 4, r: 1, fill: [0x8e, 0x8a, 0xf2], alpha: 1 },
];

/** Is (px, py) inside a rounded rectangle? Corner circles, straight middle. */
function insideRoundedRect(px, py, { x, y, w, h, r }) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const radius = Math.min(r, w / 2, h / 2);
  /* The cross made by the two inner rectangles covers everything but the four
     corner squares, so only a point in a corner square needs the circle test. */
  const cx = px < x + radius ? x + radius : px > x + w - radius ? x + w - radius : null;
  const cy = py < y + radius ? y + radius : py > y + h - radius ? y + h - radius : null;
  if (cx === null || cy === null) return true;
  return (px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2;
}

/* ── raster ──────────────────────────────────────────────────────────────── */

const rgba = Buffer.alloc(SIZE * SIZE * 4);
const scale = VIEWBOX / SIZE;
const step = 1 / SAMPLES;

for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    /* Straight (non-premultiplied) accumulation, compositing shape by shape. */
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;

    for (const shape of SHAPES) {
      /* Coverage: what fraction of this pixel the shape covers. */
      let hits = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        const uy = (py + (sy + 0.5) * step) * scale;
        for (let sx = 0; sx < SAMPLES; sx++) {
          const ux = (px + (sx + 0.5) * step) * scale;
          if (insideRoundedRect(ux, uy, shape)) hits++;
        }
      }
      if (hits === 0) continue;
      const sa = (hits / (SAMPLES * SAMPLES)) * shape.alpha;

      /* source-over */
      const outA = sa + a * (1 - sa);
      if (outA === 0) continue;
      r = (shape.fill[0] * sa + r * a * (1 - sa)) / outA;
      g = (shape.fill[1] * sa + g * a * (1 - sa)) / outA;
      b = (shape.fill[2] * sa + b * a * (1 - sa)) / outA;
      a = outA;
    }

    const i = (py * SIZE + px) * 4;
    rgba[i] = Math.round(r);
    rgba[i + 1] = Math.round(g);
    rgba[i + 2] = Math.round(b);
    rgba[i + 3] = Math.round(a * 255);
  }
}

/* ── PNG ─────────────────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; /* bit depth */
ihdr[9] = 6; /* colour type: RGBA */

/* Filter byte 0 (None) per scanline: the mark is flat colour, so the filters
   that help photographs would only cost time here. */
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  rgba.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, png);
console.log(`wrote ${OUT} — ${SIZE}x${SIZE}, ${png.length} bytes`);
