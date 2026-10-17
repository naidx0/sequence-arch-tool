import { describe, expect, it } from 'vitest';

import { SNAPSHOT_MAX_W, SNAPSHOT_MIN, SNAPSHOT_PAD, fitWidth, outputSize, regionAround, svgForRegion, unionBox } from './snapshot';

describe('the crop around a selection', () => {
  it('grows the selection by the padding on every side', () => {
    const r = regionAround({ x: 400, y: 300, w: 200, h: 200 }, null);
    expect(r).toEqual({ x: 400 - SNAPSHOT_PAD, y: 300 - SNAPSHOT_PAD, w: 200 + 2 * SNAPSHOT_PAD, h: 200 + 2 * SNAPSHOT_PAD });
  });

  it('never goes smaller than the minimum, kept centred on the selection', () => {
    const r = regionAround({ x: 500, y: 500, w: 10, h: 10 }, null);
    expect(r.w).toBe(SNAPSHOT_MIN);
    expect(r.h).toBe(SNAPSHOT_MIN);
    expect(r.x + r.w / 2).toBe(505);
    expect(r.y + r.h / 2).toBe(505);
  });

  it('slides back inside the visible bounds when the selection is at an edge', () => {
    const bounds = { x: 0, y: 0, w: 1000, h: 800 };
    const r = regionAround({ x: 2, y: 4, w: 100, h: 60 }, bounds);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    const far = regionAround({ x: 950, y: 790, w: 40, h: 8 }, bounds);
    expect(far.x + far.w).toBeLessThanOrEqual(1000);
    expect(far.y + far.h).toBeLessThanOrEqual(800);
  });

  it('is clipped to bounds smaller than the crop', () => {
    const r = regionAround({ x: 10, y: 10, w: 100, h: 100 }, { x: 0, y: 0, w: 150, h: 120 });
    expect(r).toEqual({ x: 0, y: 0, w: 150, h: 120 });
  });

  it('unions boxes and is null for none', () => {
    expect(unionBox([])).toBeNull();
    expect(
      unionBox([
        { x: 10, y: 10, w: 20, h: 20 },
        { x: 50, y: 0, w: 10, h: 5 },
      ]),
    ).toEqual({ x: 10, y: 0, w: 50, h: 30 });
  });
});

describe('the crop is capped to 800px wide', () => {
  it('leaves a small crop alone', () => {
    expect(fitWidth(400, 300)).toEqual({ width: 400, height: 300, scale: 1 });
  });
  it('scales a wide crop to the cap, keeping the aspect', () => {
    const f = fitWidth(1600, 900);
    expect(f.width).toBe(SNAPSHOT_MAX_W);
    expect(f.height).toBe(450);
    expect(f.scale).toBe(0.5);
  });
});

describe('the crop is drawn at 2x, capped at 800px wide', () => {
  it('doubles a small crop', () => {
    expect(outputSize(300, 200)).toEqual({ width: 600, height: 400 });
  });
  it('stops at the cap for a wide one', () => {
    expect(outputSize(500, 250)).toEqual({ width: 800, height: 400 });
    expect(outputSize(1600, 900)).toEqual({ width: 800, height: 450 });
  });
});

describe('the svg that is drawn to the canvas', () => {
  it('draws a dashed halo round the selection when asked, and none otherwise', () => {
    document.body.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg"><rect data-testid="wb-item" x="1" y="1" width="30" height="20"></rect></svg>';
    const svg = document.querySelector('svg') as unknown as SVGSVGElement;
    const plain = svgForRegion(svg, { x: 0, y: 0, w: 300, h: 200 }, 'rgb(9, 9, 9)');
    expect(plain.markup).not.toContain('data-ask-halo');
    const marked = svgForRegion(svg, { x: 0, y: 0, w: 300, h: 200 }, 'rgb(9, 9, 9)', { box: { x: 10, y: 20, w: 100, h: 50 }, color: 'rgb(1, 2, 3)' });
    expect(marked.markup).toContain('data-ask-halo="true"');
    expect(marked.markup).toContain('stroke="rgb(1, 2, 3)"');
    expect(marked.markup).toContain('x="4"');
    expect(marked.width).toBe(600);
  });

  it('shows the region, drops the selection furniture and fills the ground behind', () => {
    document.body.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" data-testid="wb-canvas" class="wb-canvas">
        <g transform="translate(10,20) scale(2)">
          <rect class="wb-sel-halo" data-testid="wb-sel-halo" x="0" y="0" width="5" height="5"></rect>
          <rect class="wb-hit" x="0" y="0" width="5" height="5"></rect>
          <rect class="wb-ink" data-testid="wb-item" x="1" y="1" width="30" height="20"></rect>
        </g>
      </svg>`;
    const svg = document.querySelector('svg')!;
    const out = svgForRegion(svg as unknown as SVGSVGElement, { x: 40, y: 30, w: 1600, h: 900 }, 'rgb(9, 9, 9)');
    expect(out.width).toBe(SNAPSHOT_MAX_W);
    expect(out.height).toBe(450);
    expect(out.markup).toContain('viewBox="40 30 1600 900"');
    expect(out.markup).toContain('fill="rgb(9, 9, 9)"');
    expect(out.markup).not.toContain('wb-sel-halo');
    expect(out.markup).not.toContain('wb-hit');
    expect(out.markup).toContain('data-testid="wb-item"');
    // the live svg is untouched
    expect(svg.querySelector('.wb-sel-halo')).not.toBeNull();
  });
});
