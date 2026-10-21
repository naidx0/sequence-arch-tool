import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FARTHER_LOD_ZOOM, FAR_LOD_ZOOM, farLodClass } from './farLod';

/* S4 review, item 3: the far-zoom classes flip once per crossing, never per frame. */

/** A wheel sweep: one zoom per frame from `a` to `b`. */
const sweep = (a: number, b: number, frames: number) => Array.from({ length: frames + 1 }, (_, i) => a + ((b - a) * i) / frames);
const flips = (zooms: number[]) => zooms.reduce((n, z, i) => (i > 0 && farLodClass(z) !== farLodClass(zooms[i - 1]!) ? n + 1 : n), 0);

describe('far LOD classes', () => {
  it('a zoom-out from 1 to the floor flips exactly twice over 600 frames, and back twice', () => {
    expect(flips(sweep(1, 0.25, 600))).toBe(2);
    expect(flips(sweep(0.25, 1, 600))).toBe(2);
  });

  it('frames that do not cross a threshold never change the class', () => {
    expect(flips(sweep(0.99, 0.51, 600))).toBe(0);
    expect(flips(sweep(0.49, 0.31, 600))).toBe(0);
    expect(flips(sweep(0.29, 0.25, 600))).toBe(0);
  });

  it('names the tiers at the thresholds', () => {
    expect(farLodClass(FAR_LOD_ZOOM)).toBe('');
    expect(farLodClass(FAR_LOD_ZOOM - 0.001)).toBe('lod-far');
    expect(farLodClass(FARTHER_LOD_ZOOM - 0.001)).toBe('lod-far lod-farther');
  });

  it('board.css gives each tier a rim of at least one device pixel at its lowest zoom, and no per-frame width', () => {
    const css = fs.readFileSync(path.resolve(__dirname, 'board.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const width = (cls: string): number => {
      const m = new RegExp(`\\.board-scope\\.${cls} \\.node \\{[^}]*--arch-weight:\\s*([\\d.]+)px`).exec(css);
      return m ? Number(m[1]) : Number.NaN;
    };
    /* lod-far holds down to FARTHER_LOD_ZOOM, lod-farther down to the camera floor. */
    expect(width('lod-far') * FARTHER_LOD_ZOOM).toBeGreaterThanOrEqual(1);
    expect(width('lod-farther') * 0.25).toBeGreaterThanOrEqual(1);
    /* No border width read from the per-frame camera variable. */
    expect(css).not.toMatch(/(--arch-weight|border-width)\s*:[^;]*--board-cam-z/);
  });
});
