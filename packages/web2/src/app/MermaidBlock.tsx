/* ══════════════════════════════════════════════════════════════════════════
   A MERMAID BLOCK IS DRAWN, NOT PRINTED
   packages/web2/src/app/MermaidBlock.tsx

   Until 2026-09-18 a `mermaid` canvas block rendered as its own source: a
   `<pre>` of `sequenceDiagram / participant User as User / …`. The block type
   existed, the agent used it (the walk's "explain how a language model turns
   a prompt into the next token" turn produced one), and the reader got text
   where the tool had promised a diagram. The canvas moat audit named it:
   "the agent's best drawing tool prints its own source."

   ── DRAWN WHERE THE BROWSER CAN MEASURE TEXT, SOURCE EVERYWHERE ELSE ─────

   Mermaid lays out by measuring rendered text (`getBBox`). jsdom has no
   layout, so under vitest the module would import three megabytes and throw.
   `canDrawDiagrams()` is the gate: when the SVG DOM cannot measure, the block
   keeps the source it always had, and the tests that read the box keep
   reading it. That is also the honest state for any browser without SVG
   geometry — source, not a broken drawing.

   ── THE COMPILER LOADS ON FIRST USE, NOT AT BOOT ─────────────────────────

   Same reason as `ReactCanvasMount.tsx`: a static import would put mermaid's
   parsers and layout engines in the entry chunk every cold open downloads.
   `await import('mermaid')` makes it its own chunk that loads the first time
   a diagram is actually on screen.

   ── ONE THEME, THE GRAPHITE TOKENS ───────────────────────────────────────

   Mermaid ships its own palettes (a blue "default", a "dark" with purple
   actors). Both add hues the canvas never earned — Graphite law 1: never more
   hues than claims. `graphiteMermaidTheme` reads the live tokens off the
   document and hands mermaid ONE ink, ONE surface, ONE edge and the accent,
   so a diagram sits on the plane in the same palette as the prose beside it,
   in light and dark alike.

   ── A SLIP IN AN ARROW IS NOT A REASON TO SHOW NOTHING ───────────────────

   Small models write `User—»Input` for `User->>Input` (the walk's 2B model
   did, every arrow). Mermaid refuses the whole diagram for one glyph. The
   render tries the source as written FIRST; only if that fails does it try
   `normalizeMermaidArrows`, which maps the unicode dash and chevron glyphs
   to their ASCII arrows and nothing else. The block records which one drew
   (`data-mermaid-normalised`) so the fact is on the surface, and the payload
   the reader can copy is never rewritten.

   When neither parses the source stays, with mermaid's own one-line reason
   under it — the reader sees what the agent wrote and why it did not draw.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Can this DOM measure SVG text? False under jsdom, true in every browser.
 *
 * `getBBox` lives on SVGGraphicsElement, not SVGElement: the first draft read
 * `SVGElement.prototype.getBBox`, which is undefined in Chromium too, so the
 * gate said "no" everywhere and the block never drew — a check that passes
 * in the test DOM for the wrong reason. The name below is the one the spec
 * puts the method on.
 */
export function canDrawDiagrams(): boolean {
  if (typeof window === 'undefined' || typeof SVGGraphicsElement === 'undefined') return false;
  return typeof (SVGGraphicsElement.prototype as { getBBox?: unknown }).getBBox === 'function';
}

/**
 * The unicode glyphs models substitute for mermaid's ASCII arrows, mapped
 * back. Order matters: the two-glyph forms go first so `—»` becomes `-->>`
 * (one mapping) rather than `--` + `>>` twice over.
 *
 * Nothing else is touched — not labels, not identifiers, not quotes — so a
 * diagram that already parses is byte-identical after this.
 */
export function normalizeMermaidArrows(source: string): string {
  return source
    .replace(/[—–─]»/g, '-->>')
    .replace(/[—–─]>/g, '-->')
    .replace(/[—–─]/g, '--')
    .replace(/»/g, '>>')
    .replace(/→/g, '-->')
    .replace(/►/g, '>');
}

export interface GraphiteTokens {
  surface: string;
  surfaceRaised: string;
  ink: string;
  inkMuted: string;
  edge: string;
  accent: string;
  fontUi: string;
  fontMono: string;
}

/** The tokens the theme is built from, read once per render off `:root`. */
export function readGraphiteTokens(): GraphiteTokens {
  const fallback: GraphiteTokens = {
    surface: '#1E2028',
    surfaceRaised: '#272930',
    ink: '#F6F7FA',
    inkMuted: '#9A9CA6',
    edge: 'rgba(255,255,255,.12)',
    /* The LAST-RESORT fallback, used only where there is no document to read
       tokens from. It follows the shipping accent, which is white as of
       Decision 30 — a gold literal here would be the one gold left in a white
       app the first time this ran headless. */
    accent: '#F6F7FA',
    fontUi: 'Inter, sans-serif',
    fontMono: 'JetBrains Mono, monospace',
  };
  if (typeof document === 'undefined') return fallback;
  const cs = getComputedStyle(document.documentElement);
  const read = (name: string, dflt: string) => cs.getPropertyValue(name).trim() || dflt;
  return {
    surface: read('--surface-1', fallback.surface),
    surfaceRaised: read('--surface-3', fallback.surfaceRaised),
    ink: read('--ink-1', fallback.ink),
    inkMuted: read('--ink-3', fallback.inkMuted),
    edge: read('--edge-strong', fallback.edge),
    accent: read('--accent', fallback.accent),
    fontUi: read('--font-ui', fallback.fontUi),
    fontMono: read('--font-mono', fallback.fontMono),
  };
}

/**
 * Mermaid's `themeVariables` from the Graphite tokens — pure, so the mapping
 * is testable without a browser. One ink, one surface, one edge, the accent:
 * every named variable below is one of those four or a font.
 */
export function graphiteMermaidTheme(t: GraphiteTokens): Record<string, string> {
  return {
    background: 'transparent',
    fontFamily: t.fontUi,
    fontSize: '12px',
    textColor: t.ink,
    lineColor: t.inkMuted,
    primaryColor: t.surfaceRaised,
    primaryTextColor: t.ink,
    primaryBorderColor: t.edge,
    secondaryColor: t.surface,
    secondaryTextColor: t.ink,
    secondaryBorderColor: t.edge,
    tertiaryColor: t.surface,
    tertiaryTextColor: t.ink,
    tertiaryBorderColor: t.edge,
    noteBkgColor: t.surface,
    noteTextColor: t.ink,
    noteBorderColor: t.edge,
    /* Sequence diagrams. */
    actorBkg: t.surfaceRaised,
    actorBorder: t.edge,
    actorTextColor: t.ink,
    actorLineColor: t.inkMuted,
    signalColor: t.ink,
    signalTextColor: t.ink,
    labelBoxBkgColor: t.surface,
    labelBoxBorderColor: t.edge,
    labelTextColor: t.ink,
    loopTextColor: t.ink,
    activationBkgColor: t.surface,
    activationBorderColor: t.accent,
    sequenceNumberColor: t.surface,
    /* Flowcharts. */
    nodeBorder: t.edge,
    nodeTextColor: t.ink,
    mainBkg: t.surfaceRaised,
    clusterBkg: t.surface,
    clusterBorder: t.edge,
    edgeLabelBackground: t.surface,
    titleColor: t.ink,
    /* State / class / er. */
    classText: t.ink,
    attributeBackgroundColorOdd: t.surface,
    attributeBackgroundColorEven: t.surfaceRaised,
    /* Pie / git: the accent and its neighbours in depth, not hue. */
    pie1: t.accent,
    pie2: t.surfaceRaised,
    pie3: t.inkMuted,
    pie4: t.surface,
    git0: t.accent,
    git1: t.inkMuted,
    git2: t.surfaceRaised,
    git3: t.surface,
  };
}

type MermaidApi = typeof import('mermaid')['default'];

let apiPromise: Promise<MermaidApi> | null = null;
let seq = 0;

async function loadMermaid(): Promise<MermaidApi> {
  if (!apiPromise) {
    apiPromise = import('mermaid').then((m) => {
      const api = m.default;
      api.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        themeVariables: graphiteMermaidTheme(readGraphiteTokens()),
        fontFamily: readGraphiteTokens().fontUi,
        flowchart: { htmlLabels: false, curve: 'basis', useMaxWidth: false, nodeSpacing: 32, rankSpacing: 40, padding: 8 },
        /* Natural size, never shrunk to the column: a nine-participant
           sequence squeezed into 464px drew 6px labels. The box scrolls
           sideways instead (aiCanvas.css), which is legible and never clips. */
        sequence: {
          mirrorActors: false,
          useMaxWidth: false,
          width: 112,
          height: 40,
          actorMargin: 24,
          boxMargin: 6,
          boxTextMargin: 4,
          messageMargin: 28,
          diagramMarginX: 8,
          diagramMarginY: 8,
          actorFontSize: 13,
          messageFontSize: 12,
          noteFontSize: 12,
        },
        gantt: { useMaxWidth: false },
        er: { useMaxWidth: false },
        pie: { useMaxWidth: false },
        state: { useMaxWidth: false },
        class: { useMaxWidth: false },
      });
      return api;
    });
  }
  return apiPromise;
}

/**
 * How much to shrink a drawing that is wider than the column.
 *
 * Natural size up to `maxWidth`; past it the drawing scales down to fit, but
 * never below `floor` of natural size: a 12px label at 0.7 is 8.4px, which
 * is the last size a reader can still make out, and past that the box
 * scrolls sideways instead. The plane's own zoom takes it from there.
 */
export function fitScale(naturalWidth: number, maxWidth: number, floor = 0.7): number {
  if (!(naturalWidth > 0) || !(maxWidth > 0)) return 1;
  if (naturalWidth <= maxWidth) return 1;
  return Math.max(floor, maxWidth / naturalWidth);
}

/** The widest a diagram draws at natural size before it is fitted. */
export const DIAGRAM_MAX_WIDTH = 960;

export interface DrawnDiagram {
  svg: string;
  normalised: boolean;
}

/** Render the source; on a parse failure retry with arrows normalised. */
export async function drawMermaid(source: string): Promise<DrawnDiagram> {
  const api = await loadMermaid();
  const id = `seq-mermaid-${(seq += 1)}`;
  try {
    const { svg } = await api.render(id, source);
    return { svg, normalised: false };
  } catch (first) {
    const fixed = normalizeMermaidArrows(source);
    if (fixed === source) throw first;
    const { svg } = await api.render(`${id}-n`, fixed);
    return { svg, normalised: true };
  }
}

function reasonOf(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  /* Mermaid's parse errors carry the whole expected-token list; the first
     line names the line and the glyph, which is what a reader can act on. */
  return raw.split(/\r?\n/)[0]?.trim() || 'the diagram did not parse';
}

export function MermaidBlock({ payload }: { payload: string }) {
  const [drawn, setDrawn] = useState<DrawnDiagram | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const svgHost = useRef<HTMLDivElement | null>(null);

  /* Size the mounted svg from its own viewBox: natural up to the cap, then
     fitted, never below the floor. Layout effect so the first paint is
     already the fitted size and nothing jumps. */
  useLayoutEffect(() => {
    const svg = svgHost.current?.querySelector('svg');
    if (!svg) return;
    const vb = svg.viewBox?.baseVal;
    const w = vb && vb.width > 0 ? vb.width : Number(svg.getAttribute('width')) || 0;
    const h = vb && vb.height > 0 ? vb.height : Number(svg.getAttribute('height')) || 0;
    if (!(w > 0) || !(h > 0)) return;
    const scale = fitScale(w, DIAGRAM_MAX_WIDTH);
    svg.style.width = `${Math.round(w * scale)}px`;
    svg.style.height = `${Math.round(h * scale)}px`;
    svg.style.maxWidth = 'none';
    svg.setAttribute('data-fit-scale', scale.toFixed(2));
  }, [drawn]);

  useEffect(() => {
    if (!canDrawDiagrams()) return undefined;
    let alive = true;
    setDrawn(null);
    setFailure(null);
    drawMermaid(payload).then(
      (d) => {
        if (alive) setDrawn(d);
      },
      (err: unknown) => {
        if (alive) setFailure(reasonOf(err));
      },
    );
    return () => {
      alive = false;
    };
  }, [payload]);

  const state = drawn ? 'drawn' : failure ? 'failed' : 'source';
  return (
    <div
      className="ai-canvas-mermaid"
      data-testid="ai-canvas-mermaid"
      data-mermaid-state={state}
      data-mermaid-normalised={drawn?.normalised ? 'true' : undefined}
    >
      <div className="ai-canvas-mermaid-box">
        {drawn ? (
          <div
            ref={svgHost}
            className="ai-canvas-mermaid-svg"
            data-testid="ai-canvas-mermaid-svg"
            // Mermaid's own output under securityLevel 'strict': no script, no
            // click handlers, labels escaped.
            dangerouslySetInnerHTML={{ __html: drawn.svg }}
          />
        ) : (
          <pre className="ai-canvas-mermaid-src">{payload}</pre>
        )}
        {failure ? (
          <p className="ai-canvas-mermaid-why" data-testid="ai-canvas-mermaid-why">
            Not drawn: {failure}
          </p>
        ) : null}
      </div>
    </div>
  );
}
