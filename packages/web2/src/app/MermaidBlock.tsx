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

import { mermaidNode } from '../chat/svgSanitize';

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
  /** The edge and arrow colour: stronger than the muted ink so a line holds against a transparent card (--ink-2). Falls back to inkMuted. */
  line?: string;
}

/** Label size for every Mermaid drawing on the AI Canvas. */
export const MERMAID_FONT_SIZE = '14px';

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
    line: read('--ink-2', fallback.inkMuted),
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
    /* 14px, not 12 (owner, 2026-09-22: "the drawing is a little hard for me to
       read"). The canvas pad is usually zoomed out, so a 12px label arrived at
       well under the type floor. */
    fontSize: MERMAID_FONT_SIZE,
    textColor: t.ink,
    lineColor: t.line ?? t.inkMuted,
    arrowheadColor: t.line ?? t.inkMuted,
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
    actorLineColor: t.line ?? t.inkMuted,
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

/**
 * Edges that read on a transparent card: a 1.5px line (mermaid draws 1) in the line colour, and an arrowhead that
 * is filled in the same colour with no outline of its own. Pure, so the mapping is testable without a browser.
 */
export function graphiteMermaidCss(t: GraphiteTokens): string {
  const line = t.line ?? t.inkMuted;
  return [
    `.flowchart-link,.edge-thickness-normal,.messageLine0,.messageLine1,.relation,.transition{stroke-width:1.5px}`,
    `.marker,.arrowMarkerPath,.arrowheadPath{fill:${line};stroke:${line};stroke-width:1px}`,
    `.edgeLabel,.edgeLabel rect{background-color:${t.surface};fill:${t.surface};opacity:1}`,
  ].join('');
}

/** mermaid's own protected keys; initialize({ secure }) replaces them, so they are repeated. */
const MERMAID_SECURE_DEFAULTS = ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges'];

/** An `img` / `icon` KEY in a node's `@{ … }` data (not text inside a quoted label). */
const EXTERNAL_KEY = /(?:^|[\s,{])["']?(?:img|icon)["']?\s*:/i;

/** Each `@{ … }` body with its quoted strings blanked; a `}` inside a quote does not end the block. */
function shapeBlocks(source: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const at = source.indexOf('@{', from);
    if (at < 0) return out;
    let body = '';
    let quote = '';
    let text = '';
    let i = at + 2;
    for (; i < source.length; i += 1) {
      const c = source[i] as string;
      if (quote) {
        if (c === '\\') i += 1;
        else if (c === quote) {
          quote = '';
          /* A quoted string followed by `:` is a key ("img": …); any other is label text, blanked. */
          body += /^\s*:/.test(source.slice(i + 1)) ? text + c : c;
          text = '';
        } else text += c;
        continue;
      }
      if (c === '}') break;
      if (c === '"' || c === "'") {
        quote = c;
        text = '';
      }
      body += c;
    }
    out.push(body);
    from = i + 1;
  }
}

/** Why this source is not drawn, or null when it may be: a node or icon given as `A@{ img: "https://…" }` is fetched by the browser. */
export function blockedMermaidSource(source: string): string | null {
  return shapeBlocks(source).some((b) => EXTERNAL_KEY.test(b))
    ? 'it asks for an external image or icon (img: / icon:), which is not loaded'
    : null;
}

type MermaidApi = typeof import('mermaid')['default'];

/** Forget the configured mermaid so the next draw re-reads the live Graphite tokens (a light/dark switch). */
export function resetMermaidTheme(): void {
  apiPromise = null;
}

let apiPromise: Promise<MermaidApi> | null = null;
let seq = 0;

async function loadMermaid(): Promise<MermaidApi> {
  if (!apiPromise) {
    apiPromise = import('mermaid').then((m) => {
      const api = m.default;
      api.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        /* An in-source `%%{init}%%` must not reach the stylesheet or the fonts: themeCSS and fontFamily
           are values mermaid writes into the drawing's <style>, and a url() in either is a request.
           htmlLabels is the ROOT key in 11.17 (flowchart.htmlLabels is ignored): labels are svg text,
           never an html fragment that could hold an <img>. */
        secure: [...MERMAID_SECURE_DEFAULTS, 'themeCSS', 'fontFamily', 'altFontFamily', 'themeVariables', 'htmlLabels', 'flowchart', 'theme', 'darkMode'],
        htmlLabels: false,
        theme: 'base',
        themeVariables: graphiteMermaidTheme(readGraphiteTokens()),
        themeCSS: graphiteMermaidCss(readGraphiteTokens()),
        fontFamily: readGraphiteTokens().fontUi,
        /* More room per node for the larger type: spacing and padding grew with
           the font so labels do not crowd their neighbours. */
        flowchart: { htmlLabels: false, curve: 'linear', useMaxWidth: false, nodeSpacing: 44, rankSpacing: 52, padding: 12 },
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
  /** The drawing as markup, serialised from the allowlist-built tree. */
  svg: string;
  /** That tree: what is mounted (never the raw mermaid output). */
  node: SVGElement;
  normalised: boolean;
}

function cleaned(rendered: string, normalised: boolean): DrawnDiagram {
  const node = mermaidNode(rendered);
  if (!node) throw new Error('it drew nothing');
  return { svg: new XMLSerializer().serializeToString(node), node, normalised };
}

/** Render the source; on a parse failure retry with arrows normalised. */
export async function drawMermaid(source: string): Promise<DrawnDiagram> {
  const blocked = blockedMermaidSource(source);
  if (blocked) throw new Error(blocked);
  const api = await loadMermaid();
  const id = `seq-mermaid-${(seq += 1)}`;
  try {
    const { svg } = await api.render(id, source);
    return cleaned(svg, false);
  } catch (first) {
    const fixed = normalizeMermaidArrows(source);
    if (fixed === source) throw first;
    const { svg } = await api.render(`${id}-n`, fixed);
    return cleaned(svg, true);
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

  useLayoutEffect(() => {
    if (drawn && svgHost.current) svgHost.current.replaceChildren(drawn.node);
  }, [drawn]);

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
          /* The allowlist-built tree (svgSanitize.mermaidNode), mounted as a node: never mermaid's raw markup. */
          <div ref={svgHost} className="ai-canvas-mermaid-svg" data-testid="ai-canvas-mermaid-svg" />
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
