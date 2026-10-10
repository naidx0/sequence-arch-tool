/* ══════════════════════════════════════════════════════════════════════════
   A CROP OF THE BOARD AROUND WHAT WAS POINTED AT
   packages/web2/src/askInPlace/snapshot.ts

   "Either that code block gets sent to the agent or a little screenshot gets
   made of the board where the user clicked, so they can pinpoint the whole
   context." (owner) Both go: the structured block says WHICH items, the crop
   shows how they LOOK and what surrounds them.

   The geometry is pure (`regionAround`, `fitWidth`) and carries the tests; the
   two renderers are the thin browser halves:

     whiteboard    the board is one <svg>: its region is the svg's own viewBox,
                   serialised with the computed paint inlined (a serialised svg
                   loses the stylesheet) and drawn to a canvas.
     architecture  the board is HTML under a transform: html-to-image renders
                   the same viewport element the board's PNG export renders,
                   translated so the region lands at the origin.

   The long edge is capped (`SNAPSHOT_MAX_W`), because the chat's attachment
   pipeline (chat/imageAttach.ts) would scale anything bigger anyway and the
   upload is the cost.
   ══════════════════════════════════════════════════════════════════════════ */

import { SNAPSHOT_MAX_W, SNAPSHOT_TIMEOUT_MS, outputSize, type Box } from './snapshotGeometry';

export * from './snapshotGeometry';

/* ── whiteboard: the svg itself ───────────────────────────────────────────── */

const PAINT = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'text-anchor',
  'dominant-baseline',
  'letter-spacing',
] as const;

/**
 * The svg as a standalone string showing `region` (in the svg's own pixels).
 * A serialised svg carries no stylesheet, so each element's COMPUTED paint is
 * written onto it; the host's ground colour fills behind it. Interactive
 * furniture (halos, hit areas, the marquee) is dropped.
 */
export function svgForRegion(
  svg: SVGSVGElement,
  region: Box,
  background: string,
  /** The selection, in the svg's pixels, drawn as a halo so the crop says WHICH marks were pointed at. */
  marker?: { box: Box; color: string },
): { markup: string; width: number; height: number } {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const live = [svg, ...Array.from(svg.querySelectorAll('*'))];
  const copy = [clone, ...Array.from(clone.querySelectorAll('*'))];
  const view = svg.ownerDocument.defaultView;
  live.forEach((el, i) => {
    const target = copy[i] as SVGElement | undefined;
    if (!target || !view) return;
    const cs = view.getComputedStyle(el);
    const style = PAINT.map((prop) => {
      const v = cs.getPropertyValue(prop);
      return v ? `${prop}:${v}` : '';
    })
      .filter(Boolean)
      .join(';');
    if (style) target.setAttribute('style', style);
    target.removeAttribute('class');
  });
  clone
    .querySelectorAll('.wb-sel-halo,[data-testid="wb-sel-halo"],.wb-hit,[data-testid="wb-marquee"],[data-testid="wb-intent-ghost"]')
    .forEach((n) => n.remove());
  const { width, height } = outputSize(region.w, region.h);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('viewBox', `${region.x} ${region.y} ${region.w} ${region.h}`);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.removeAttribute('style');
  clone.removeAttribute('data-testid');
  const ground = clone.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'rect');
  ground.setAttribute('x', String(region.x));
  ground.setAttribute('y', String(region.y));
  ground.setAttribute('width', String(region.w));
  ground.setAttribute('height', String(region.h));
  ground.setAttribute('fill', background);
  clone.insertBefore(ground, clone.firstChild);
  if (marker) {
    const halo = clone.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const pad = 6;
    halo.setAttribute('x', String(marker.box.x - pad));
    halo.setAttribute('y', String(marker.box.y - pad));
    halo.setAttribute('width', String(marker.box.w + pad * 2));
    halo.setAttribute('height', String(marker.box.h + pad * 2));
    halo.setAttribute('rx', '8');
    halo.setAttribute('fill', 'none');
    halo.setAttribute('stroke', marker.color);
    halo.setAttribute('stroke-width', '2');
    halo.setAttribute('stroke-dasharray', '6 4');
    halo.setAttribute('data-ask-halo', 'true');
    clone.appendChild(halo);
  }
  return { markup: new XMLSerializer().serializeToString(clone), width, height };
}

/** Draw the svg's `region` to a PNG. Null when this browser cannot (never throws). */
export async function snapshotSvgRegion(svg: SVGSVGElement, region: Box, background: string, marker?: { box: Box; color: string }): Promise<Blob | null> {
  try {
    const { markup, width, height } = svgForRegion(svg, region, background, marker);
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      /* A browser that never answers must not hold the message back. */
      const giveUp = setTimeout(() => reject(new Error('the board crop timed out')), SNAPSHOT_TIMEOUT_MS);
      img.onload = () => {
        clearTimeout(giveUp);
        resolve();
      };
      img.onerror = () => {
        clearTimeout(giveUp);
        reject(new Error('the board crop could not be drawn'));
      };
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width, height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  } catch {
    return null;
  }
}

/** `work`, or null when it has not answered in time. */
function withTimeout<T>(work: Promise<T>): Promise<T | null> {
  return Promise.race([work, new Promise<null>((resolve) => setTimeout(() => resolve(null), SNAPSHOT_TIMEOUT_MS))]);
}

/* ── architecture: the viewport element ───────────────────────────────────── */

/**
 * Render `region` (in the viewport element's own coordinates, i.e. flow
 * coordinates) with html-to-image, at the same transform trick the board's PNG
 * export uses. Loaded on demand so it costs the boot nothing.
 */
export async function snapshotHtmlRegion(host: HTMLElement, region: Box, background: string | undefined): Promise<Blob | null> {
  try {
    const { toBlob } = await import('html-to-image');
    const blob = await withTimeout(toBlob(host, {
      width: region.w,
      height: region.h,
      /* 2x for a sharp small crop, never past the width cap. */
      pixelRatio: Math.min(2, SNAPSHOT_MAX_W / region.w),
      ...(background ? { backgroundColor: background } : {}),
      style: {
        width: `${region.w}px`,
        height: `${region.h}px`,
        transform: `translate(${-region.x}px, ${-region.y}px) scale(1)`,
      },
    }));
    return blob;
  } catch {
    return null;
  }
}
