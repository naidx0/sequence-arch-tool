/*
 * EXPLANATORY VISUALS — the pictures a box-and-arrow chart cannot draw.
 * packages/analyzer/src/server/visuals.ts
 *
 * Owner, 2026-09-13, on a teach turn that drew three boxes for "how does an LLM
 * work": "is that how an LLM works? … the drawings are horrible, and we need to
 * rework it all from that." He supplied six references. Five of them are not
 * nodes-and-edges at all, and that is the finding this file exists for
 * (`docs/research/agent-drawing-and-teaching-visuals.md`, stage 2):
 *
 *   OUR CHARTS CARRY LABELS. HIS REFERENCES CARRY DATA.
 *
 * A `data-flow` chart can say "Self-attention" in a box. It cannot show the
 * attention matrix — six rows of numbers under a colour scale, masked above the
 * diagonal — and the matrix IS the explanation. Same for a token strip: the
 * teaching happens in the mapping from "Data" to 15496, not in a box labelled
 * "Tokeniser".
 *
 * ── WHY THE PRODUCT DRAWS THESE AND NOT THE MODEL ─────────────────────────
 *
 * Already settled here and already measured: "The model does not call the tool
 * — 5 calls in 296 teach turns on the bench … If the product wants a picture it
 * has to draw one" (`teach-draws-general-knowledge.test.ts`). So the division
 * of labour is the one this tree already uses for charts: THE MODEL SUPPLIES
 * THE DATA, THIS FILE DRAWS THE PIXELS. A model that can write a JSON array can
 * produce an attention matrix; none of them can reliably produce good SVG.
 *
 * ── WHY SVG, AND WHY IT IS THEME-NATIVE ───────────────────────────────────
 *
 * `AiCanvasBlockBody` renders an SVG payload INLINE (`ai-canvas-svg-inline`),
 * not in an iframe — so CSS custom properties cascade into it. Every colour
 * below is therefore a Graphite token, never a literal, and these pictures
 * change with the theme like every other surface. That is also why they need no
 * sandbox change: SVG is inert markup, and the interactivity question
 * (stage 4) is a separate decision on a separate boundary.
 *
 * ── WHAT IS REFUSED ───────────────────────────────────────────────────────
 *
 * Every builder returns `null` for a spec it cannot draw HONESTLY, and never a
 * half-picture. A matrix whose rows disagree with its column count, a strip
 * with no cells, a stack with no layers: those are the model having failed to
 * answer, and a drawing that quietly padded them would be this product
 * inventing data. `null` lets the caller fall back to the chart it already has.
 *
 * PURE. Specs in, SVG strings out. No IO, no React, no DOM.
 */

/* ── the shared geometry, named once ─────────────────────────────────────── */

/** Padding inside the viewBox, so a stroke on the edge is never clipped. */
const PAD = 12;
/** The type sizes, matching Graphite's ladder at the sizes SVG text needs. */
const T_LABEL = 11;
const T_SMALL = 9;
const T_TITLE = 13;

/**
 * How wide a title needs the viewBox to be.
 *
 * MEASURED BY THE SAME RULE THE COMPOSER USES: the sans face at 13px runs about
 * 0.56em per character. Every builder below sized its viewBox from its CONTENT
 * — the grid, the strip, the stack — and the first render clipped
 * "Self-attention: each token looks only at the ones before it" mid-sentence,
 * because a six-column matrix is narrower than its own heading. Nothing may
 * overflow its box is a legibility law in this repo, and an SVG viewBox clips
 * silently rather than scrolling, so it has to be paid for in the width.
 */
function titleWidth(title: string): number {
  return Math.ceil(title.length * 7.3) + PAD * 2;
}

/** XML-escape. Every label below is model-supplied text going into markup. */
export function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function svg(width: number, height: number, body: string, title: string): string {
  /*
   * `role="img"` plus a `<title>` is what a screen reader reads. A picture that
   * is the whole explanation cannot be invisible to somebody who cannot see it,
   * and the title is the one sentence that says what it claims.
   */
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" ` +
    `width="100%" role="img" aria-label="${esc(title)}" ` +
    `style="max-width:${width}px;font-family:var(--font-sans,system-ui)">` +
    `<title>${esc(title)}</title>${body}</svg>`
  );
}

function text(
  x: number,
  y: number,
  content: string,
  opts: { size?: number; fill?: string; anchor?: string; weight?: number; mono?: boolean } = {},
): string {
  const family = opts.mono === true ? 'var(--font-mono,ui-monospace)' : 'inherit';
  return (
    `<text x="${x}" y="${y}" font-size="${opts.size ?? T_LABEL}" ` +
    `font-family="${family}" ` +
    `fill="${opts.fill ?? 'var(--ink-2)'}" ` +
    `text-anchor="${opts.anchor ?? 'start'}" ` +
    `font-weight="${opts.weight ?? 400}" ` +
    `dominant-baseline="middle">${esc(content)}</text>`
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   1. TOKEN STRIP — a sequence in reading order, each cell with its index.

   His reference: the `token | index` table on bbycroft.net/llm, where the whole
   point is that "Data" becomes a NUMBER. A box labelled "Tokeniser" teaches
   none of that.
   ══════════════════════════════════════════════════════════════════════════ */

export interface TokenStripSpec {
  title: string;
  /** The pieces, in order. `id` is what the model calls the index. */
  tokens: { label: string; id?: number | string }[];
  /** One sentence: what this strip is claiming. */
  caption?: string;
}

const STRIP_MAX = 24;

export function tokenStrip(spec: TokenStripSpec): string | null {
  const tokens = Array.isArray(spec.tokens) ? spec.tokens.filter((t) => t && typeof t.label === 'string') : [];
  if (tokens.length === 0) return null;
  /*
   * CUT, AND SAY SO. A 400-token strip is unreadable at any width, and silently
   * drawing the first 24 would be a picture claiming the sequence ended there.
   * The cut is drawn as a cell of its own.
   */
  const shown = tokens.slice(0, STRIP_MAX);
  const cut = tokens.length - shown.length;

  const cellH = 30;
  const gap = 4;
  /* Width per cell follows the longest label, so nothing is clipped: monospace
     at 11px is ~6.6px per character, and the cell needs 8px of padding a side. */
  const cellW = Math.max(
    34,
    ...shown.map((t) => Math.ceil(t.label.length * 6.6) + 16),
  );
  const perRow = Math.max(1, Math.min(shown.length, Math.floor(760 / (cellW + gap))));
  const rows = Math.ceil(shown.length / perRow);

  const width = Math.max(PAD * 2 + perRow * (cellW + gap) - gap, titleWidth(spec.title));
  const indexH = 14;
  const height = PAD * 2 + T_TITLE + 8 + rows * (cellH + indexH + gap) + (cut > 0 ? 18 : 0);

  const parts: string[] = [];
  parts.push(text(PAD, PAD + T_TITLE / 2, spec.title, { size: T_TITLE, fill: 'var(--ink-1)', weight: 600 }));

  const top0 = PAD + T_TITLE + 8;
  shown.forEach((token, i) => {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    const x = PAD + col * (cellW + gap);
    const y = top0 + row * (cellH + indexH + gap);
    parts.push(
      `<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="4" ` +
        `fill="var(--surface-2)" stroke="var(--edge)" stroke-width="1"/>`,
    );
    parts.push(
      text(x + cellW / 2, y + cellH / 2, token.label, {
        anchor: 'middle',
        fill: 'var(--ink-1)',
        mono: true,
      }),
    );
    /* The index UNDER the cell: the mapping is the lesson, so it is drawn as a
       relationship between two rows and not as a second table elsewhere. */
    if (token.id !== undefined) {
      parts.push(
        text(x + cellW / 2, y + cellH + indexH / 2, String(token.id), {
          anchor: 'middle',
          size: T_SMALL,
          fill: 'var(--accent)',
          mono: true,
        }),
      );
    }
  });

  if (cut > 0) {
    parts.push(
      text(PAD, height - PAD, `…${cut} more token${cut === 1 ? '' : 's'} not drawn`, {
        size: T_SMALL,
        fill: 'var(--ink-3)',
      }),
    );
  }

  return svg(width, height, parts.join(''), spec.caption ?? spec.title);
}

/* ══════════════════════════════════════════════════════════════════════════
   2. MATRIX — a grid of real numbers under a colour scale, with its legend.

   His reference: the attention diagram. Query down the side, Key across the
   top, a cell per pair, and the mask visible as the empty upper triangle. The
   numbers are the explanation.
   ══════════════════════════════════════════════════════════════════════════ */

export interface MatrixSpec {
  title: string;
  /** Row labels, top to bottom. */
  rows: string[];
  /** Column labels, left to right. */
  cols: string[];
  /** `values[r][c]`. A null cell is drawn as MASKED, not as zero. */
  values: (number | null)[][];
  caption?: string;
  /** What the two axes are, e.g. `{ rows: 'Query', cols: 'Key' }`. */
  axes?: { rows?: string; cols?: string };
}

/**
 * A cell's fill: the accent at an opacity derived from where the value sits
 * between the observed min and max.
 *
 * DERIVED FROM THE DATA, NEVER FROM A FIXED RANGE. A matrix of logits runs
 * -25..7 and a matrix of probabilities 0..1; a fixed scale would render one of
 * them as a single flat colour and hide the very structure being taught. The
 * legend prints the real endpoints, so the reader is never guessing what the
 * shade means.
 */
function cellFill(value: number, min: number, max: number): string {
  if (max === min) return 'color-mix(in srgb, var(--accent) 40%, transparent)';
  const t = (value - min) / (max - min);
  /* A floor of 6%: a cell at the minimum must still read as a CELL and not as a
     hole in the grid, which is what `null` means here. */
  const pct = Math.round(6 + t * 88);
  return `color-mix(in srgb, var(--accent) ${pct}%, transparent)`;
}

const MATRIX_MAX = 12;

export function matrix(spec: MatrixSpec): string | null {
  const rows = Array.isArray(spec.rows) ? spec.rows.filter((r) => typeof r === 'string') : [];
  const cols = Array.isArray(spec.cols) ? spec.cols.filter((c) => typeof c === 'string') : [];
  if (rows.length === 0 || cols.length === 0) return null;
  if (rows.length > MATRIX_MAX || cols.length > MATRIX_MAX) return null;
  if (!Array.isArray(spec.values) || spec.values.length !== rows.length) return null;
  /*
   * EVERY ROW MUST MATCH THE COLUMN COUNT. A ragged matrix is the model having
   * failed to answer, and padding it would draw cells nobody supplied — this
   * product's first law, in picture form.
   */
  for (const row of spec.values) {
    if (!Array.isArray(row) || row.length !== cols.length) return null;
  }

  const flat = spec.values.flat().filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (flat.length === 0) return null;
  const min = Math.min(...flat);
  const max = Math.max(...flat);

  const cell = 34;
  const gap = 3;
  const rowLabelW = Math.max(46, ...rows.map((r) => Math.ceil(r.length * 6.2) + 10));
  const colLabelH = 34;
  const legendH = 30;

  const gridW = cols.length * (cell + gap) - gap;
  const gridH = rows.length * (cell + gap) - gap;
  const width = Math.max(PAD * 2 + rowLabelW + gridW, titleWidth(spec.title));
  const height = PAD * 2 + T_TITLE + 8 + colLabelH + gridH + legendH;

  const parts: string[] = [];
  parts.push(text(PAD, PAD + T_TITLE / 2, spec.title, { size: T_TITLE, fill: 'var(--ink-1)', weight: 600 }));

  const gridX = PAD + rowLabelW;
  const gridY = PAD + T_TITLE + 8 + colLabelH;

  /* Column labels, rotated so a long one does not force the cell wide. */
  cols.forEach((col, c) => {
    const cx = gridX + c * (cell + gap) + cell / 2;
    parts.push(
      `<g transform="translate(${cx},${gridY - 8}) rotate(-45)">` +
        text(0, 0, col, { anchor: 'start', size: T_SMALL, fill: 'var(--ink-3)', mono: true }) +
        `</g>`,
    );
  });
  if (spec.axes?.cols) {
    parts.push(
      text(gridX, PAD + T_TITLE + 8 + 8, spec.axes.cols, {
        size: T_SMALL,
        fill: 'var(--accent)',
        weight: 600,
      }),
    );
  }

  rows.forEach((row, r) => {
    const cy = gridY + r * (cell + gap) + cell / 2;
    parts.push(
      text(gridX - 8, cy, row, { anchor: 'end', size: T_SMALL, fill: 'var(--ink-3)', mono: true }),
    );
    spec.values[r]!.forEach((value, c) => {
      const x = gridX + c * (cell + gap);
      const y = gridY + r * (cell + gap);
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        /* MASKED, and drawn as absent rather than as zero — in an attention
           matrix the mask IS half the lesson. A dashed outline with no fill. */
        parts.push(
          `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" fill="none" ` +
            `stroke="var(--edge)" stroke-width="1" stroke-dasharray="2 2"/>`,
        );
        return;
      }
      parts.push(
        `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="3" ` +
          `fill="${cellFill(value, min, max)}" stroke="var(--edge-faint)" stroke-width="1"/>`,
      );
      parts.push(
        text(x + cell / 2, y + cell / 2, formatCell(value), {
          anchor: 'middle',
          size: T_SMALL,
          fill: 'var(--ink-1)',
          mono: true,
        }),
      );
    });
  });

  /* The legend prints the REAL endpoints of the data it scaled to. */
  const legendY = gridY + gridH + 16;
  const legendW = Math.min(160, gridW);
  parts.push(
    `<defs><linearGradient id="seq-mx" x1="0" x2="1">` +
      `<stop offset="0" stop-color="${cellFill(min, min, max)}"/>` +
      `<stop offset="1" stop-color="${cellFill(max, min, max)}"/>` +
      `</linearGradient></defs>` +
      `<rect x="${gridX}" y="${legendY}" width="${legendW}" height="8" rx="2" fill="url(#seq-mx)" ` +
      `stroke="var(--edge)" stroke-width="1"/>`,
  );
  parts.push(text(gridX - 8, legendY + 4, formatCell(min), { anchor: 'end', size: T_SMALL, fill: 'var(--ink-3)', mono: true }));
  parts.push(text(gridX + legendW + 8, legendY + 4, formatCell(max), { size: T_SMALL, fill: 'var(--ink-3)', mono: true }));

  return svg(width, height, parts.join(''), spec.caption ?? spec.title);
}

/** Short enough for a 34px cell, and never scientific notation. */
export function formatCell(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 10000) return String(value);
  const abs = Math.abs(value);
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

/* ══════════════════════════════════════════════════════════════════════════
   3. LAYERED STACK — repeated blocks with one value threaded through them.

   His reference: the transformer stack, where the teaching is that the SAME
   block runs N times and something flows down it. A flow chart draws N
   different boxes and loses exactly that.
   ══════════════════════════════════════════════════════════════════════════ */

export interface LayeredStackSpec {
  title: string;
  layers: { label: string; detail?: string }[];
  caption?: string;
  /** e.g. "× 12" on the repeated middle — the model says how many. */
  repeat?: { fromIndex: number; toIndex: number; times: number | string };
  /** What travels down the stack, named once at the top. */
  carries?: string;
}

export function layeredStack(spec: LayeredStackSpec): string | null {
  const layers = Array.isArray(spec.layers)
    ? spec.layers.filter((l) => l && typeof l.label === 'string')
    : [];
  if (layers.length === 0) return null;
  if (layers.length > 16) return null;

  const boxW = 260;
  const boxH = 40;
  const gap = 12;
  const railW = 44;
  const width = Math.max(PAD * 2 + railW + boxW + 70, titleWidth(spec.title));
  const height = PAD * 2 + T_TITLE + 10 + layers.length * (boxH + gap);

  const parts: string[] = [];
  parts.push(text(PAD, PAD + T_TITLE / 2, spec.title, { size: T_TITLE, fill: 'var(--ink-1)', weight: 600 }));

  const x = PAD + railW;
  const top0 = PAD + T_TITLE + 10;

  /* The thread: one line down the left of every block, which is what makes
     this a STACK rather than a list of boxes. */
  const threadX = PAD + railW / 2;
  parts.push(
    `<line x1="${threadX}" y1="${top0}" x2="${threadX}" y2="${top0 + layers.length * (boxH + gap) - gap}" ` +
      `stroke="var(--accent)" stroke-width="2" opacity="0.55"/>`,
  );
  if (spec.carries) {
    parts.push(
      `<g transform="translate(${threadX - 6},${top0 + 20}) rotate(-90)">` +
        text(0, 0, spec.carries, { anchor: 'end', size: T_SMALL, fill: 'var(--accent)', weight: 600 }) +
        `</g>`,
    );
  }

  layers.forEach((layer, i) => {
    const y = top0 + i * (boxH + gap);
    parts.push(
      `<rect x="${x}" y="${y}" width="${boxW}" height="${boxH}" rx="6" ` +
        `fill="var(--surface-2)" stroke="var(--edge)" stroke-width="1"/>`,
    );
    parts.push(
      `<circle cx="${threadX}" cy="${y + boxH / 2}" r="4" fill="var(--accent)"/>`,
    );
    parts.push(
      `<line x1="${threadX + 4}" y1="${y + boxH / 2}" x2="${x}" y2="${y + boxH / 2}" ` +
        `stroke="var(--accent)" stroke-width="1.5" opacity="0.55"/>`,
    );
    parts.push(
      text(x + 12, y + (layer.detail ? boxH / 2 - 7 : boxH / 2), layer.label, {
        fill: 'var(--ink-1)',
        weight: 600,
      }),
    );
    if (layer.detail) {
      parts.push(text(x + 12, y + boxH / 2 + 8, layer.detail, { size: T_SMALL, fill: 'var(--ink-3)' }));
    }
  });

  /* The repeat bracket: the one mark that says "this block runs N times". */
  const rep = spec.repeat;
  if (
    rep &&
    Number.isInteger(rep.fromIndex) &&
    Number.isInteger(rep.toIndex) &&
    rep.fromIndex >= 0 &&
    rep.toIndex < layers.length &&
    rep.fromIndex <= rep.toIndex
  ) {
    const y1 = top0 + rep.fromIndex * (boxH + gap);
    const y2 = top0 + rep.toIndex * (boxH + gap) + boxH;
    const bx = x + boxW + 10;
    parts.push(
      `<path d="M${bx} ${y1} h8 v${y2 - y1} h-8" fill="none" stroke="var(--accent)" ` +
        `stroke-width="1.5" opacity="0.8"/>`,
    );
    parts.push(
      text(bx + 14, (y1 + y2) / 2, `× ${rep.times}`, {
        size: T_SMALL,
        fill: 'var(--accent)',
        weight: 600,
        mono: true,
      }),
    );
  }

  return svg(width, height, parts.join(''), spec.caption ?? spec.title);
}

/* ── the closed set, named for the belt and the floor ────────────────────── */

/* ══════════════════════════════════════════════════════════════════════════
   4. ANNOTATED FLOW — a flow whose EDGES carry values, not just labels.

   The fourth shape `docs/research/agent-drawing-and-teaching-visuals.md` §4
   names for stage 2, and the last one outstanding. Its argument, verbatim:
   every one of the eight chart families "is nodes, edges, bars or cards", and
   what the owner's references have in common is that "the picture carries DATA
   — a matrix of numbers, a sequence of tokens, a value flowing — where our
   chart carries only labels."

   `data-flow` can already draw A → B. What it cannot draw is what is ON the
   wire: the shape of the tensor, the size of the batch, the status code. And
   that is usually the entire lesson — "the request leaves as JSON and arrives
   as 1,024 floats" is a fact about the ARROW, and there was nowhere to put it.

   SO THE EDGE IS THE SUBJECT HERE, which is what separates this from the other
   three and from the chart families. Each step carries `carries` — the thing
   travelling — and optionally `shape`, its size or type, set in mono because it
   is a literal value. A step with neither is refused rather than drawn as a
   bare arrow: a bare arrow is `data-flow`, and this builder exists precisely
   for the case that is not.
   ══════════════════════════════════════════════════════════════════════════ */

export interface AnnotatedFlowSpec {
  title: string;
  /** The stages, in the order the value moves through them. */
  stages: { label: string; note?: string }[];
  /**
   * What travels along each arrow. `stages.length - 1` of them: an edge sits
   * BETWEEN two stages, and a flow of N stages has N-1 of them.
   */
  edges: { carries: string; shape?: string }[];
  caption?: string;
}

const FLOW_MAX_STAGES = 8;

export function annotatedFlow(spec: AnnotatedFlowSpec): string | null {
  const stages = Array.isArray(spec.stages)
    ? spec.stages.filter((v) => v && typeof v.label === 'string' && v.label.trim() !== '')
    : [];
  const edges = Array.isArray(spec.edges) ? spec.edges : [];
  if (stages.length < 2 || stages.length > FLOW_MAX_STAGES) return null;
  /*
   * THE COUNT MUST BE EXACT. One edge short and the last arrow is unlabelled —
   * a picture asserting a step nobody described. One too many and an edge
   * describes a hop that is not drawn. Either way the drawing would claim
   * something the model did not say, so it is refused whole, the way `matrix`
   * refuses a row that disagrees with its column count.
   */
  if (edges.length !== stages.length - 1) return null;
  if (!edges.every((e) => e && typeof e.carries === 'string' && e.carries.trim() !== '')) {
    return null;
  }

  const boxW = 150;
  const boxH = 46;
  /* The arrow has to hold two lines of text, so it is wider than the box. */
  const armW = 132;
  const rowH = Math.max(boxH, 64);
  const width = Math.max(
    PAD * 2 + stages.length * boxW + (stages.length - 1) * armW,
    titleWidth(spec.title),
  );
  const height = PAD * 2 + T_TITLE + 14 + rowH + (spec.caption ? 22 : 0);

  const parts: string[] = [];
  parts.push(
    text(PAD, PAD + T_TITLE / 2, spec.title, { size: T_TITLE, fill: 'var(--ink-1)', weight: 600 }),
  );

  const top = PAD + T_TITLE + 14;
  const midY = top + rowH / 2;

  parts.push(
    '<defs><marker id="afArrow" viewBox="0 0 10 10" refX="9" refY="5" ' +
      'markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
      '<path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ink-4)"/></marker></defs>',
  );

  stages.forEach((stage, i) => {
    const x = PAD + i * (boxW + armW);
    parts.push(
      `<rect x="${x}" y="${midY - boxH / 2}" width="${boxW}" height="${boxH}" rx="8" ` +
        'fill="var(--surface-3)" stroke="var(--edge)" stroke-width="1"/>',
    );
    const hasNote = typeof stage.note === 'string' && stage.note.trim() !== '';
    parts.push(
      text(x + boxW / 2, midY + (hasNote ? -7 : 0), stage.label, {
        anchor: 'middle',
        fill: 'var(--ink-1)',
        weight: 600,
      }),
    );
    if (hasNote) {
      parts.push(
        text(x + boxW / 2, midY + 9, stage.note as string, {
          anchor: 'middle',
          size: T_SMALL,
          fill: 'var(--ink-4)',
        }),
      );
    }

    const edge = edges[i];
    if (edge === undefined) return;
    const x1 = x + boxW + 6;
    const x2 = x + boxW + armW - 6;
    parts.push(
      `<line x1="${x1}" y1="${midY}" x2="${x2}" y2="${midY}" stroke="var(--ink-4)" ` +
        'stroke-width="1.5" marker-end="url(#afArrow)"/>',
    );
    /* THE PAYLOAD SITS ON THE ARROW, above the line, because that is the thing
       this builder exists to show. The shape goes below it in mono — it is a
       literal, and a literal that reflows is the thing mono prevents. */
    const cx = (x1 + x2) / 2;
    parts.push(
      text(cx, midY - 14, edge.carries, {
        anchor: 'middle',
        size: T_LABEL,
        fill: 'var(--ink-2)',
      }),
    );
    if (typeof edge.shape === 'string' && edge.shape.trim() !== '') {
      parts.push(
        text(cx, midY + 15, edge.shape, {
          anchor: 'middle',
          size: T_SMALL,
          fill: 'var(--accent)',
          mono: true,
        }),
      );
    }
  });

  if (spec.caption) {
    parts.push(
      text(PAD, height - PAD, spec.caption, { size: T_SMALL, fill: 'var(--ink-4)' }),
    );
  }

  return svg(width, height, parts.join(''), spec.title);
}

export const VISUAL_KINDS = ['token-strip', 'matrix', 'layered-stack', 'annotated-flow'] as const;
export type VisualKind = (typeof VISUAL_KINDS)[number];

export interface VisualSpec {
  kind: VisualKind;
  [key: string]: unknown;
}

/**
 * Draw one spec, or return null when it cannot be drawn honestly.
 *
 * ONE DOOR, so a caller never has to know which builder a kind belongs to and
 * a new kind cannot be added without appearing in `VISUAL_KINDS`.
 */
export function drawVisual(spec: VisualSpec): string | null {
  if (spec === null || typeof spec !== 'object') return null;
  switch (spec.kind) {
    case 'token-strip':
      return tokenStrip(spec as unknown as TokenStripSpec);
    case 'matrix':
      return matrix(spec as unknown as MatrixSpec);
    case 'layered-stack':
      return layeredStack(spec as unknown as LayeredStackSpec);
    case 'annotated-flow':
      return annotatedFlow(spec as unknown as AnnotatedFlowSpec);
    default:
      return null;
  }
}
