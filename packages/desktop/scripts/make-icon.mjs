#!/usr/bin/env node
/**
 * Rasterise Sequence app icon — AAA Windows / macOS taskbar plate.
 *
 * Glyph SoT: docs/brand/marks/sequence-mark.svg (64 grid, Decision 26 for the
 * colour law, Decision 28 for the geometry). The glyph is THREE SERVICE NODES
 * ON ONE ELBOW ROUTE — the product's own edge style, read top-left to
 * bottom-right as a sequence. It replaced the fused ring, which at taskbar
 * size read as a gear (owner, 2026-09-17: "the icon is a little bit flawed …
 * rendering very poorly on desktop and in the toolbars").
 *
 * App plate SoT written here + docs/brand/marks/sequence-app-icon.svg
 * (owner walk 2026-09-16: white squircle + black mark, light Cursor-weight
 * contact shadow — crisp edges, no group blur that mushs the silhouette).
 *
 * Every shape is a rounded rectangle, so the coverage test below is one
 * function and the SVG it writes is the same numbers. Integer plate
 * geometry. Shadow is UNDER the plate only (never a filter on the glyph).
 * 24× supersample for edges.
 *
 * ── PER-SIZE FRAMES (Decision 28 addendum, 2026-09-17) ────────────────────
 *
 * Owner, looking at the installed app: the taskbar icon "reads as a soft blob"
 * and the 16px title-bar mark is too fine. Cause: every small frame was a
 * LANCZOS DOWNSCALE of the shaded 1024 master. At 16–32px a 6-unit route is
 * 0.9 of a pixel, so it resolves as a grey smear, and the two cast shadows
 * plus the hairline rim resolve as a halo around a white lozenge.
 *
 * So `render(size, tuning)` rasterises FROM THE VECTOR at the target pixel
 * size. Geometry is still expressed in VIEW = 1024 units and the sampler
 * divides by `scale = VIEW / size`, so one set of numbers serves every frame.
 * At <= 36px the small tuning applies: the SMALL VARIANT of the same seven
 * rects (route 8, node radius 5, glyph at 0.80 of the plate — one table, so
 * nothing drifts), flat #0B0C0E ink, no gradients, no rim, no cast shadow.
 * 48 keeps the full geometry and the contact shadow only. 64/128/256 are still
 * Lanczos from the 1024 master, where a shaded master is exactly right.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(HERE, '..', 'build');
const REPO = path.join(HERE, '..', '..', '..');
const BRAND = path.join(REPO, 'docs', 'brand', 'marks');
const SITE_PUBLIC = path.join(REPO, 'site', 'public');
const OUT = path.join(BUILD, 'icon.png');
const SVG_OUT = path.join(BUILD, 'icon.svg');
const BRAND_APP = path.join(BRAND, 'sequence-app-icon.svg');
const BRAND_SMALL = path.join(BRAND, 'sequence-mark-small.svg');
const SITE_SMALL = path.join(SITE_PUBLIC, 'sequence-mark-small.svg');

const SIZE = 1024;
const NL = String.fromCharCode(10);
/** Work in the same units as the 1024 master so radii land on whole pixels. */
const VIEW = 1024;
const SAMPLES = 24;

/** The frames rasterised straight from the vector (see the header). */
const DIRECT_FRAMES = [16, 20, 24, 30, 32, 36, 48];

/* Clear margin ~9.5% — Windows taskbar crops tight; too little = soft edge. */
const PLATE = {
  x: 96,
  y: 88,
  w: 832,
  h: 832,
  r: 186, /* ≈ 22.3% of side — Apple / Cursor squircle weight */
  fill: [0xff, 0xff, 0xff],
};

const INK = [0x0b, 0x0c, 0x0e];

/*
 * THE MARK, IN 64-GRID UNITS — the same numbers `sequence-mark.svg` carries.
 *
 *   nodes   three squares, rx 3.5, centred on the diagonal at
 *           (14,14) (32,32) (50,50) — top-left, middle, bottom-right
 *   route   elbow edges, rounded ends: from each node go RIGHT to
 *           the next node's column, then DOWN into it. Right-then-down is the
 *           reading direction, so the whole mark reads as a sequence.
 *
 * Centred at (32,32), 180° rotationally symmetric, and every element is a
 * rounded rectangle.
 *
 * TWO VARIANTS, ONE TABLE. `full` is the mark as Decision 28 set it: nodes 18,
 * route 6, bounds 5→59. `small` is the SAME seven rects on the SAME centres,
 * retuned for 16–36px: route 8 (from 6), node corner radius 5 (from 3.5), and
 * the glyph set at 0.80 of the plate rather than 0.721. Both come out of
 * `markRects()`, so a change to the centres or the ordering can only ever move
 * both.
 *
 * THE NODE SIZE DOES NOT CHANGE, AND THAT IS LOAD-BEARING. The centres are 18
 * apart on each axis, so an 18-unit square is exactly as wide as the gap
 * between two centres and the three squares meet corner-to-corner. Anything
 * LARGER makes them physically overlap, and the mark stops being three nodes
 * on a route and becomes one diagonal bar — measured at 16/20/24 with a
 * 21-unit node, which fused all three. What does open the diagonal gap is the
 * CORNER RADIUS: the two facing corner arcs are 2·r·√2 apart with a combined
 * radius of 2·r, so the clear gap is 0.83·r units — 2.9 at r 3.5, 4.2 at r 5.
 * That is a third of a pixel more daylight at 16px and a full pixel at 32,
 * bought without touching the silhouette anyone recognises.
 */
const CENTRES = [
  [14, 14],
  [32, 32],
  [50, 50],
];

export const VARIANTS = {
  full: { node: 18, nodeR: 3.5, edge: 6, glyphFrac: 600 / PLATE.w },
  small: { node: 18, nodeR: 5, edge: 8, glyphFrac: 0.8 },
};

/** Rounded rectangles in glyph units: `[x, y, w, h, r]`. Edges first, nodes on top. */
export function markRects(variant = 'full') {
  const v = VARIANTS[variant];
  if (!v) throw new Error(`unknown mark variant: ${variant}`);
  const rects = [];
  const half = v.edge / 2;
  for (let i = 0; i + 1 < CENTRES.length; i++) {
    const [ax, ay] = CENTRES[i];
    const [bx, by] = CENTRES[i + 1];
    /* right: from A's centre to B's column */
    rects.push([ax - half, ay - half, bx - ax + v.edge, v.edge, half]);
    /* down: from A's row to B's centre */
    rects.push([bx - half, ay - half, v.edge, by - ay + v.edge, half]);
  }
  for (const [cx, cy] of CENTRES) {
    rects.push([cx - v.node / 2, cy - v.node / 2, v.node, v.node, v.nodeR]);
  }
  return rects;
}

/** Where the glyph sits on the plate, in VIEW units. */
function placement(variant) {
  const v = VARIANTS[variant];
  const glyph = PLATE.w * v.glyphFrac;
  return {
    gs: glyph / 64,
    x0: PLATE.x + (PLATE.w - glyph) / 2,
    y0: PLATE.y + (PLATE.h - glyph) / 2,
  };
}

/** The mark's rects lifted into VIEW units on the plate. */
function viewRects(variant) {
  const { gs, x0, y0 } = placement(variant);
  return markRects(variant).map(([x, y, w, h, r]) => ({
    x: x0 + x * gs,
    y: y0 + y * gs,
    w: w * gs,
    h: h * gs,
    r: r * gs,
  }));
}

function insideRoundedRect(px, py, { x, y, w, h, r }) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const radius = Math.min(r, w / 2, h / 2);
  const cx = px < x + radius ? x + radius : px > x + w - radius ? x + w - radius : null;
  const cy = py < y + radius ? y + radius : py > y + h - radius ? y + h - radius : null;
  if (cx === null || cy === null) return true;
  return (px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2;
}

function composite(r, g, b, a, sa, c0, c1, c2) {
  if (sa <= 0) return { r, g, b, a };
  const outA = sa + a * (1 - sa);
  if (!outA) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (c0 * sa + r * a * (1 - sa)) / outA,
    g: (c1 * sa + g * a * (1 - sa)) / outA,
    b: (c2 * sa + b * a * (1 - sa)) / outA,
    a: outA,
  };
}

/* ── DEPTH — where the personality lives ──────────────────────────────────
 *
 * Owner, 2026-09-17: "I like the 3-node icon … how can we add some pizzazz,
 * shadowing, depth, anything that gives it a little more personality."
 *
 * Still one ink (Decision 26) — every colour below is a tint of the same
 * near-black on the same white — but three things now sit at three depths:
 *
 *   plate   white, lit from the top (sheen) with a hairline rim
 *   route   GRAPHITE, set back — the edge is the quiet part of a graph
 *   nodes   INK CARDS on top of the route: a vertical gradient (lit top),
 *           a hairline top bevel, and a soft cast shadow onto the plate
 *
 * Depth belongs to the LARGE frames. Every one of these features is a fraction
 * of a pixel at 16–32px, and a fraction of a pixel of dark next to a white
 * plate is the halo the owner saw. So `tuningFor()` switches them all off
 * below 36px and the small frames are a flat two-tone silhouette.
 */
const ROUTE_INK = [0x2c, 0x2e, 0x34];        /* graphite — the route sits back */
const NODE_TOP = [0x1c, 0x1d, 0x22];         /* lit top of each node card */
const NODE_BOTTOM = INK;                     /* #0B0C0E at the base */
/*
 * THE HIGHLIGHT IS A LINE, NOT A LID. The first cut filled a rounded pill
 * across the top of each node and, zoomed, it read as a grey cap sitting on
 * the card (owner, 2026-09-17: "elementary issues if zoomed in"). A lit edge
 * on a real object is a hairline that follows the outline and fades as the
 * surface turns away from the light — so it is drawn as an INNER STROKE along
 * the node's own rounded path, masked by a vertical fade over the top third.
 */
const BEVEL = { rgb: [0x6a, 0x6d, 0x76], alpha: 0.75, width: 2.6, fade: 0.34 }; /* px at 1024; fade = fraction of node height */
/*
 * TWO SHADOWS, as every AAA plate does it (Apple HIG, Material, Cursor):
 * a wide, faint AMBIENT shadow that says "there is a card above the plate",
 * and a tight, darker CONTACT shadow that says "and it touches here". One
 * medium blur reads as a smudge; the pair reads as an object.
 */
const AMBIENT = { dy: 14, sigma: 22, alpha: 0.2, rgb: [0x08, 0x09, 0x0c] };
const CONTACT = { dy: 3, sigma: 4, alpha: 0.3, rgb: [0x08, 0x09, 0x0c] };
/* The route gets the same hairline, fainter — it is the same material, set back. */
const ROUTE_BEVEL = { rgb: [0x55, 0x58, 0x61], alpha: 0.45, width: 2.0 };

/**
 * WHAT EACH FRAME IS ALLOWED TO DRAW.
 *
 * One switch, read by `render()`, so "what changes at 16px" is a table rather
 * than a scatter of `if (size < 32)` inside the pixel loop.
 */
export function tuningFor(size) {
  /* 36 is with the small frames, not the large ones: at 36px every depth
     feature below is under a fifth of a pixel, and the full mark's 6-unit
     route resolves to 2.0px against the small variant's 2.9px. */
  if (size <= 36) {
    return {
      variant: 'small',
      sheen: false,
      plateShadow: false,
      rim: false,
      nodeGradient: false,
      bevel: false,
      ambient: false,
      contact: false,
    };
  }
  if (size <= 64) {
    /* 48: the full mark, the plate lit, and the CONTACT shadow only —
       the ambient one is 22 units of blur, i.e. 1px at 48, which is a halo. */
    return {
      variant: 'full',
      sheen: true,
      plateShadow: false,
      rim: true,
      nodeGradient: true,
      bevel: true,
      ambient: false,
      contact: true,
    };
  }
  return {
    variant: 'full',
    sheen: true,
    plateShadow: true,
    rim: true,
    nodeGradient: true,
    bevel: true,
    ambient: true,
    contact: true,
  };
}

/* ── the rasteriser ──────────────────────────────────────────────────────── */

/** Separable gaussian blur — three box passes approximate it closely. */
function blur(mask, sigma, size) {
  if (!(sigma > 0.05)) return mask;
  const boxes = boxesForGauss(sigma, 3);
  let src = mask;
  for (const r of boxes) {
    if (r < 1) continue;
    src = boxBlurH(src, r, size);
    src = boxBlurV(src, r, size);
  }
  return src;
}
function boxesForGauss(sigma, n) {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const out = [];
  for (let i = 0; i < n; i++) out.push(((i < m ? wl : wu) - 1) / 2);
  return out;
}
function boxBlurH(src, r, size) {
  const out = new Float32Array(size * size);
  const iarr = 1 / (r + r + 1);
  for (let y = 0; y < size; y++) {
    const row = y * size;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(size - 1, Math.max(0, x))];
    for (let x = 0; x < size; x++) {
      out[row + x] = acc * iarr;
      const add = src[row + Math.min(size - 1, x + r + 1)];
      const sub = src[row + Math.max(0, x - r)];
      acc += add - sub;
    }
  }
  return out;
}
function boxBlurV(src, r, size) {
  const out = new Float32Array(size * size);
  const iarr = 1 / (r + r + 1);
  for (let x = 0; x < size; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += src[Math.min(size - 1, Math.max(0, y)) * size + x];
    for (let y = 0; y < size; y++) {
      out[y * size + x] = acc * iarr;
      const add = src[Math.min(size - 1, y + r + 1) * size + x];
      const sub = src[Math.max(0, y - r) * size + x];
      acc += add - sub;
    }
  }
  return out;
}
/**
 * Push a mask down by `dy` PIXELS, which is fractional once the frame is
 * smaller than the master — a 3-unit offset is 0.14px at 48. Rounding it to
 * a whole pixel is how a contact shadow becomes a drop shadow on a small
 * frame, so the two source rows are blended instead.
 */
function shiftDown(mask, dy, size) {
  if (!(dy > 0)) return mask;
  const whole = Math.floor(dy);
  const f = dy - whole;
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const ra = y - whole;
    const rb = ra - 1;
    for (let x = 0; x < size; x++) {
      const a = ra >= 0 ? mask[ra * size + x] : 0;
      const b = rb >= 0 ? mask[rb * size + x] : 0;
      out[y * size + x] = a * (1 - f) + b * f;
    }
  }
  return out;
}

/**
 * Rasterise ONE frame straight from the vector.
 *
 * `size` is the pixel side; the geometry above is in VIEW units and every
 * sample divides by `scale = VIEW / size`. That is the whole trick: the 16px
 * frame is the same seven rects the 1024 master is, sampled 24× per pixel at
 * 16px, not a resample of a picture of them.
 *
 * Returns the raw RGBA buffer (`size * size * 4`).
 */
export function render(size, tuning = tuningFor(size)) {
  const scale = VIEW / size;
  const step = 1 / SAMPLES;
  const rects = viewRects(tuning.variant);
  const routeRects = rects.slice(0, rects.length - CENTRES.length);
  const nodeRects = rects.slice(rects.length - CENTRES.length);

  function sampleCoverage(px, py, test) {
    let hits = 0;
    for (let sy = 0; sy < SAMPLES; sy++) {
      const uy = (py + (sy + 0.5) * step) * scale;
      for (let sx = 0; sx < SAMPLES; sx++) {
        const ux = (px + (sx + 0.5) * step) * scale;
        if (test(ux, uy)) hits++;
      }
    }
    return hits / (SAMPLES * SAMPLES);
  }

  /**
   * Light contact shadow under the plate only (Cursor weight).
   * Soft band just outside the rim — peak at the edge, never on the glyph.
   */
  function sampleContactShadow(px, py) {
    const ux = (px + 0.5) * scale;
    const uy = (py + 0.5) * scale;
    if (insideRoundedRect(ux, uy, PLATE)) return 0;

    const { x, y, w, h, r } = PLATE;
    const radius = Math.min(r, w / 2, h / 2);
    /* Closest point on the rounded-rect's outer path. */
    const ix = Math.min(Math.max(ux, x + radius), x + w - radius);
    const iy = Math.min(Math.max(uy, y + radius), y + h - radius);
    let dist;
    if (ux >= x + radius && ux <= x + w - radius && uy >= y + radius && uy <= y + h - radius) {
      /* Outside the round corners but inside AABB — use axis distance past edge. */
      dist = Math.min(Math.abs(ux - x), Math.abs(ux - (x + w)), Math.abs(uy - y), Math.abs(uy - (y + h)));
    } else if (ux >= x + radius && ux <= x + w - radius) {
      dist = uy < y ? y - uy : uy - (y + h);
    } else if (uy >= y + radius && uy <= y + h - radius) {
      dist = ux < x ? x - ux : ux - (x + w);
    } else {
      dist = Math.hypot(ux - ix, uy - iy) - radius;
    }
    if (dist <= 0 || dist >= 52) return 0;

    const bottomBias = uy > y + h * 0.55 ? 1.2 : uy < y + h * 0.25 ? 0.4 : 0.7;
    const t = 1 - dist / 52;
    return t * t * 0.32 * bottomBias;
  }

  /* Coverage masks, sampled only inside each shape's bounding box. */
  function coverageMask(shapes) {
    const mask = new Float32Array(size * size);
    for (const rect of shapes) {
      const x0 = Math.max(0, Math.floor(rect.x / scale) - 1);
      const x1 = Math.min(size - 1, Math.ceil((rect.x + rect.w) / scale) + 1);
      const y0 = Math.max(0, Math.floor(rect.y / scale) - 1);
      const y1 = Math.min(size - 1, Math.ceil((rect.y + rect.h) / scale) + 1);
      for (let py = y0; py <= y1; py++) {
        for (let px = x0; px <= x1; px++) {
          const a = sampleCoverage(px, py, (ux, uy) => insideRoundedRect(ux, uy, rect));
          if (a > 0) {
            const i = py * size + px;
            mask[i] = mask[i] + a - mask[i] * a; /* union */
          }
        }
      }
    }
    return mask;
  }

  const routeMask = coverageMask(routeRects);
  const nodeMask = coverageMask(nodeRects);
  /*
   * Inner stroke along the top edge: the node minus itself eroded by the stroke
   * width, keeping only the part whose outward normal points up. Approximated
   * as (mask − mask shifted down by the width), which is exactly the top rim
   * including the corner arcs, then multiplied by a per-node vertical fade so
   * it dies out a third of the way down the side.
   */
  const zero = new Float32Array(size * size);
  const nodeRim = tuning.bevel
    ? (() => {
        const down = shiftDown(nodeMask, BEVEL.width / scale, size);
        const out = new Float32Array(size * size);
        for (let i = 0; i < out.length; i++) out[i] = Math.max(0, nodeMask[i] - down[i]);
        return out;
      })()
    : zero;
  const routeRim = tuning.bevel
    ? (() => {
        const down = shiftDown(routeMask, ROUTE_BEVEL.width / scale, size);
        const out = new Float32Array(size * size);
        for (let i = 0; i < out.length; i++) out[i] = Math.max(0, routeMask[i] - down[i]) * (1 - nodeMask[i]);
        return out;
      })()
    : zero;
  const ambientMask = tuning.ambient
    ? blur(shiftDown(nodeMask, AMBIENT.dy / scale, size), AMBIENT.sigma / scale, size)
    : zero;
  const contactMask = tuning.contact
    ? blur(shiftDown(nodeMask, CONTACT.dy / scale, size), CONTACT.sigma / scale, size)
    : zero;

  /* 1px plate rim at working size — snaps silhouette on dark taskbars. */
  const edgeInset = {
    x: PLATE.x + 1.25,
    y: PLATE.y + 1.25,
    w: PLATE.w - 2.5,
    h: PLATE.h - 2.5,
    r: Math.max(0, PLATE.r - 1.25),
  };

  const rgba = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      const i1 = py * size + px;

      if (tuning.plateShadow) {
        const shadow = sampleContactShadow(px, py);
        if (shadow) ({ r, g, b, a } = composite(r, g, b, a, shadow, 0x08, 0x09, 0x0c));
      }

      const plateA = sampleCoverage(px, py, (ux, uy) => insideRoundedRect(ux, uy, PLATE));
      if (plateA) {
        if (tuning.sheen) {
          const uy = (py + 0.5) * scale;
          /* Top sheen, a touch stronger than before so the plate reads as lit. */
          const t = Math.min(1, Math.max(0, (uy - PLATE.y) / PLATE.h));
          const sheen = Math.max(0, 1 - (uy - PLATE.y) / (PLATE.r * 1.1));
          const lift = 1 + sheen * sheen * 0.03;
          const base = 255 - t * 19; /* #FFFFFF at the top → ~#ECEDF0 at the base */
          ({ r, g, b, a } = composite(
            r, g, b, a, plateA,
            Math.min(255, base * lift),
            Math.min(255, base * lift),
            Math.min(255, (base + 2) * lift),
          ));
        } else {
          /* Flat white: a 19-step vertical ramp across 16 pixels is banding,
             and its darkest row sits exactly where the silhouette needs to be
             brightest against a dark taskbar. */
          ({ r, g, b, a } = composite(r, g, b, a, plateA, PLATE.fill[0], PLATE.fill[1], PLATE.fill[2]));
        }
      }

      if (tuning.rim) {
        const edgeA = sampleCoverage(
          px, py,
          (ux, uy) => insideRoundedRect(ux, uy, PLATE) && !insideRoundedRect(ux, uy, edgeInset),
        );
        if (edgeA) ({ r, g, b, a } = composite(r, g, b, a, edgeA * 0.12, 0xc0, 0xc1, 0xc8));
      }

      /* Route first — it sits back. */
      const routeA = routeMask[i1];
      if (routeA) {
        const ink = tuning.nodeGradient ? ROUTE_INK : INK;
        ({ r, g, b, a } = composite(r, g, b, a, routeA, ink[0], ink[1], ink[2]));
      }

      /* Cast shadow, on the plate only, never outside it. */
      if (tuning.ambient) {
        const ambA = ambientMask[i1] * AMBIENT.alpha * plateA;
        if (ambA > 0.002) ({ r, g, b, a } = composite(r, g, b, a, ambA, AMBIENT.rgb[0], AMBIENT.rgb[1], AMBIENT.rgb[2]));
      }
      if (tuning.contact) {
        const conA = contactMask[i1] * CONTACT.alpha * plateA;
        if (conA > 0.002) ({ r, g, b, a } = composite(r, g, b, a, conA, CONTACT.rgb[0], CONTACT.rgb[1], CONTACT.rgb[2]));
      }
      /* The route's own lit edge, under the nodes. */
      if (tuning.bevel) {
        const rrA = routeRim[i1] * ROUTE_BEVEL.alpha;
        if (rrA > 0.002) ({ r, g, b, a } = composite(r, g, b, a, rrA, ROUTE_BEVEL.rgb[0], ROUTE_BEVEL.rgb[1], ROUTE_BEVEL.rgb[2]));
      }

      /* Node cards: lit at the top, ink at the base. */
      const nodeA = nodeMask[i1];
      if (nodeA) {
        let t = 0.5;
        if (tuning.nodeGradient || tuning.bevel) {
          const uy = (py + 0.5) * scale;
          const ux = (px + 0.5) * scale;
          /* Position within THIS node's height, for the gradient. */
          for (const n of nodeRects) {
            if (uy >= n.y && uy <= n.y + n.h && ux >= n.x && ux <= n.x + n.w) {
              t = (uy - n.y) / n.h;
              break;
            }
          }
        }
        const c = tuning.nodeGradient
          ? [0, 1, 2].map((k) => NODE_TOP[k] + (NODE_BOTTOM[k] - NODE_TOP[k]) * t)
          : INK;
        ({ r, g, b, a } = composite(r, g, b, a, nodeA, c[0], c[1], c[2]));
        /* Lit edge: the rim, fading to nothing `BEVEL.fade` of the way down. */
        if (tuning.bevel) {
          const fade = Math.max(0, 1 - t / BEVEL.fade);
          const bevelA = nodeRim[i1] * BEVEL.alpha * fade;
          if (bevelA > 0.002) ({ r, g, b, a } = composite(r, g, b, a, bevelA, BEVEL.rgb[0], BEVEL.rgb[1], BEVEL.rgb[2]));
        }
      }

      const i = i1 * 4;
      rgba[i] = Math.round(r);
      rgba[i + 1] = Math.round(g);
      rgba[i + 2] = Math.round(b);
      rgba[i + 3] = Math.round(a * 255);
    }
  }
  return rgba;
}

/* ── PNG encoding ────────────────────────────────────────────────────────── */

const CRC = (() => {
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
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
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
export function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── SVG sources of truth ────────────────────────────────────────────────── */

const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
const rectSvg = ([x, y, w, h, r], indent) => `${indent}<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`;

/**
 * The small variant as a flat `currentColor` glyph — what the 16px title-bar
 * mark and the site nav draw. Generated here, from the same table the small
 * ICO frames use, so the chrome and the taskbar can never disagree.
 */
export function smallMarkSvg() {
  const rects = markRects('small');
  const route = rects.slice(0, rects.length - CENTRES.length).map((q) => rectSvg(q, '    ')).join(NL);
  const nodes = rects.slice(rects.length - CENTRES.length).map((q) => rectSvg(q, '    ')).join(NL);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- GENERATED by packages/desktop/scripts/make-icon.mjs — do not edit by hand.',
    '     Decision 28 addendum: the SMALL variant of the mark (route 8, node radius 5,',
    '     same nodes on the same centres) for chrome at 20px and below, where the',
    '     full 6-unit route resolves to under a pixel and reads as a smear. -->',
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64" fill="currentColor" shape-rendering="geometricPrecision" role="img" aria-label="Sequence">',
    '  <title>Sequence</title>',
    '  <g fill="currentColor">',
    route,
    nodes,
    '  </g>',
    '</svg>',
    '',
  ].join(NL);
}

function appIconSvg() {
  const rects = markRects('full');
  const { gs, x0, y0 } = placement('full');
  const NODE_TOP_HEX = hex(NODE_TOP);
  const ROUTE_HEX = hex(ROUTE_INK);
  const BEVEL_HEX = hex(BEVEL.rgb);
  const ROUTE_BEVEL_HEX = hex(ROUTE_BEVEL.rgb);
  const routeSvg = rects.slice(0, rects.length - CENTRES.length).map((q) => rectSvg(q, '      ')).join(NL);
  const nodeSvg = rects.slice(rects.length - CENTRES.length).map((q) => rectSvg(q, '      ')).join(NL);
  /* Stroke widths in glyph units — the SVG is drawn inside the scaled group. */
  const BEVEL_W = +(BEVEL.width * 2 / gs).toFixed(3); /* doubled: half of a stroke lies inside the clip */
  const ROUTE_BEVEL_W = +(ROUTE_BEVEL.width * 2 / gs).toFixed(3);

  /* SVG SoT — shadow as a separate soft ellipse UNDER the plate, never a
     feGaussianBlur on the mark (that is what made the taskbar icon mushy). */
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024" role="img" aria-label="Sequence">
  <title>Sequence</title>
  <defs>
    <linearGradient id="plateSheen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="1" stop-color="#ECEDF0"/>
    </linearGradient>
    <linearGradient id="nodeInk" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${NODE_TOP_HEX}"/>
      <stop offset="1" stop-color="#0B0C0E"/>
    </linearGradient>
    <!-- The lit edge dies out a third of the way down each card (per-element
         bounding box, so one gradient serves all three). -->
    <linearGradient id="rimFade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/>
      <stop offset="${BEVEL.fade}" stop-color="#000000"/>
    </linearGradient>
    <!-- Two cast shadows, ambient + contact, on the plate only (Decision 28).
         Depth lives in the master; 64/128/256 are Lanczos-downscaled from it
         and 16-48 are rasterised straight from these numbers (make-ico.py). -->
    <filter id="cardShadow" x="-40%" y="-40%" width="180%" height="200%" color-interpolation-filters="sRGB">
      <feDropShadow in="SourceAlpha" dx="0" dy="${AMBIENT.dy}" stdDeviation="${AMBIENT.sigma}" flood-color="#08090C" flood-opacity="${AMBIENT.alpha}" result="ambient"/>
      <feDropShadow in="SourceAlpha" dx="0" dy="${CONTACT.dy}" stdDeviation="${CONTACT.sigma}" flood-color="#08090C" flood-opacity="${CONTACT.alpha}" result="contact"/>
      <feMerge><feMergeNode in="ambient"/><feMergeNode in="contact"/></feMerge>
    </filter>
    <clipPath id="plateClip">
      <rect x="96" y="88" width="832" height="832" rx="186" ry="186"/>
    </clipPath>
    <clipPath id="nodeClip">
${nodeSvg}
    </clipPath>
    <clipPath id="routeClip">
${routeSvg}
    </clipPath>
    <mask id="rimMask" maskUnits="userSpaceOnUse">
      <g fill="url(#rimFade)">
${nodeSvg}
      </g>
    </mask>
  </defs>
  <!-- Contact shadow — soft band UNDER plate only -->
  <ellipse cx="512" cy="900" rx="380" ry="48" fill="#08090C" opacity="0.22"/>
  <ellipse cx="512" cy="888" rx="400" ry="64" fill="#08090C" opacity="0.10"/>
  <ellipse cx="160" cy="512" rx="36" ry="340" fill="#08090C" opacity="0.06"/>
  <ellipse cx="864" cy="512" rx="36" ry="340" fill="#08090C" opacity="0.06"/>
  <rect x="96" y="88" width="832" height="832" rx="186" ry="186" fill="url(#plateSheen)"/>
  <rect x="97.5" y="89.5" width="829" height="829" rx="184.5" ry="184.5" fill="none" stroke="#C0C1C8" stroke-width="1.5" opacity="0.6"/>
  <!-- node cards' cast shadows, clipped to the plate (plate units) -->
  <g clip-path="url(#plateClip)">
    <g transform="translate(${x0.toFixed(3)} ${y0.toFixed(3)}) scale(${gs})" fill="#0B0C0E" filter="url(#cardShadow)">
${nodeSvg}
    </g>
  </g>
  <g transform="translate(${x0.toFixed(3)} ${y0.toFixed(3)}) scale(${gs})">
    <!-- route: graphite, set back, with its own faint lit edge -->
    <g fill="${ROUTE_HEX}">
${routeSvg}
    </g>
    <g clip-path="url(#routeClip)" fill="none" stroke="${ROUTE_BEVEL_HEX}" stroke-opacity="${ROUTE_BEVEL.alpha}" stroke-width="${ROUTE_BEVEL_W}" mask="url(#rimMask)">
${routeSvg}
    </g>
    <!-- node cards: ink gradient, then the lit edge as an INNER stroke along
         the card's own outline, fading down the side -->
    <g fill="url(#nodeInk)">
${nodeSvg}
    </g>
    <g clip-path="url(#nodeClip)" mask="url(#rimMask)" fill="none" stroke="${BEVEL_HEX}" stroke-opacity="${BEVEL.alpha}" stroke-width="${BEVEL_W}">
${nodeSvg}
    </g>
  </g>
</svg>
`;
}

/* ── main ────────────────────────────────────────────────────────────────── */

function main() {
  fs.mkdirSync(BUILD, { recursive: true });

  const master = encodePng(render(SIZE), SIZE);
  fs.writeFileSync(OUT, master);
  console.log(`wrote ${OUT} — ${SIZE}×${SIZE}, ${master.length} bytes`);

  for (const s of DIRECT_FRAMES) {
    const file = path.join(BUILD, `icon-${s}.png`);
    const png = encodePng(render(s), s);
    fs.writeFileSync(file, png);
    console.log(`wrote ${file} — ${s}×${s} (${tuningFor(s).variant} variant), ${png.length} bytes`);
  }

  const svg = appIconSvg();
  fs.writeFileSync(SVG_OUT, svg);
  fs.mkdirSync(BRAND, { recursive: true });
  fs.writeFileSync(BRAND_APP, svg);
  console.log(`wrote ${SVG_OUT}`);
  console.log(`wrote ${BRAND_APP} (SoT)`);

  const small = smallMarkSvg();
  fs.writeFileSync(BRAND_SMALL, small);
  console.log(`wrote ${BRAND_SMALL} (SoT, small variant)`);
  if (fs.existsSync(SITE_PUBLIC)) {
    fs.writeFileSync(SITE_SMALL, small);
    console.log(`wrote ${SITE_SMALL} (sync copy)`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
