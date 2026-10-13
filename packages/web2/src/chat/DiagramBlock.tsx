/* ══════════════════════════════════════════════════════════════════════════
   A DIAGRAM IN AN ANSWER, DRAWN AS IT STREAMS (R10, C5)
   packages/web2/src/chat/DiagramBlock.tsx

   ```mermaid and ```svg fences (and a raw <svg> block) are drawn, not
   printed: plans get their picture the moment the agent writes it.

     - Re-drawn at most every 250 ms while the answer streams (a throttle:
       the first at once, then the latest text every 250 ms), and again when
       the theme switches between dark and light.
     - The last good drawing stays up while the fence is still open (half a
       diagram is a parse error that is about to stop being one).
     - A failure on a finished block shows the code and a small note.
     - "View source" flips between the drawing and its code.
   Mermaid loads on first use (app/MermaidBlock.tsx); SVG is sanitised
   (svgSanitize.ts) before it is put in the page.
   ══════════════════════════════════════════════════════════════════════════ */

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { CodeBlock } from './CodeBlock';
import { stripEmoji, stripEmojiIn, withEmojiFallback } from './drawingEmoji';
import { fitSvgText } from './svgFit';
import { sanitizeSvg } from './svgSanitize';
import { themeSvg } from './svgTheme';
import { useSavedDrawing, type SavedDrawing } from './drawingContext';
import { CardAction, VisualActions } from './VisualActions';
import { VisualCard } from './VisualCard';
import { kb, overVisualCap, VISUAL_MAX_CHARS } from './visualDoc';

import './diagramBlock.css';

/** The variables a kit drawing colours itself with (schema/visual/util.ts names them, with a light fallback): the app's tokens, so one set of bytes is right in light and dark. Set inline so they follow the theme with no sheet of their own. */
const KIT_VARS = {
  '--seq-bg': 'var(--bg-base)',
  '--seq-accent': 'var(--accent)',
  '--seq-fg': 'var(--b-ink1)',
  '--seq-muted': 'var(--b-ink3)',
  '--seq-edge': 'var(--edge-strong)',
  '--seq-surface': 'var(--surface-2)',
  '--seq-ok': 'var(--fits)',
  '--seq-warn': 'var(--spills)',
  '--seq-bad': 'var(--wont)',
  '--seq-s1': 'var(--viz-1)',
  '--seq-s2': 'var(--viz-2)',
  '--seq-s3': 'var(--viz-3)',
  '--seq-s4': 'var(--viz-4)',
  '--seq-s5': 'var(--viz-5)',
  '--seq-s6': 'var(--viz-6)',
} as React.CSSProperties;

/** True while the message holding the block is still streaming. */
export const StreamingContext = createContext(false);

export const DIAGRAM_THROTTLE_MS = 250;

/** A mermaid drawing shrinks to fit the column. There is no floor above this sliver: a wide drawing never scrolls sideways, it gets smaller (a drag on the bottom bar or Open shows it larger). */
export const DIAGRAM_MIN_SCALE = 0.05;

/** The tallest a scaled drawing stands in the chat (px): past it the drawing is scaled down to fit, never given a scroll area. */
export const DIAGRAM_MAX_H = 960;

/** The scale that fits `natural` into `room`: 1 when it already fits, else `room / natural` down to `floor`. */
export function fitDiagramScale(natural: number, room: number, floor = DIAGRAM_MIN_SCALE): number {
  if (!(natural > 0) || !(room > 0) || natural <= room) return 1;
  return Math.max(floor, room / natural);
}

/** A token-sized length in px (`--sp-6` is 6px), with a fallback when the page has no tokens (a bare test tree). */
function tokenPx(host: HTMLElement, name: string, fallback: number): number {
  const n = parseFloat(getComputedStyle(host).getPropertyValue(name));
  return n > 0 ? n : fallback;
}

/** Crop the empty margin mermaid leaves around its content, keep a token-sized pad on every side, then size the svg to the room. */
function fitMermaid(host: HTMLElement): void {
  const svg = host.querySelector('svg');
  if (!svg) return;
  try {
    /* A sequence's lifelines run on past the last message (mermaid's box clips them): measure the content
       without them, then end each one a pad below it, so nothing touches the frame. */
    const lifelines = Array.from(svg.querySelectorAll<SVGLineElement>('line.actor-line'));
    const was = lifelines.map((l) => l.style.display);
    for (const l of lifelines) l.style.display = 'none';
    const measured = (svg as unknown as SVGGraphicsElement).getBBox();
    lifelines.forEach((l, i) => {
      l.style.display = was[i] ?? '';
    });
    const b = lifelines.length > 0 ? measured : (svg as unknown as SVGGraphicsElement).getBBox();
    /* Mermaid's own box, kept from the first fit so a refit crops the same drawing, not a cropped one. */
    if (!svg.hasAttribute('data-natural-viewbox')) svg.setAttribute('data-natural-viewbox', svg.getAttribute('viewBox') ?? '');
    const nat = (svg.getAttribute('data-natural-viewbox') ?? '').trim().split(/[\s,]+/).map(Number);
    const v = nat.length === 4 && nat.every(Number.isFinite) ? { x: nat[0]!, y: nat[1]!, width: nat[2]!, height: nat[3]! } : null;
    if (b.width > 0 && b.height > 0 && v && v.width > 0 && v.height > 0) {
      const pad = tokenPx(host, '--sp-8', 8);
      /* A sequence lifeline runs far past mermaid's own box and is clipped by it on purpose, so the content's
         bottom is the lower of the two; the pad is then added on all four sides, beyond mermaid's box if need be. */
      for (const l of lifelines) {
        if (!l.hasAttribute('data-natural-y2')) l.setAttribute('data-natural-y2', l.getAttribute('y2') ?? '');
        const y2 = Number(l.getAttribute('data-natural-y2'));
        if (Number.isFinite(y2)) l.setAttribute('y2', String(Math.min(y2, b.y + b.height + pad)));
      }
      const x0 = Math.max(v.x, b.x) - pad;
      const y0 = Math.max(v.y, b.y) - pad;
      const x1 = Math.min(v.x + v.width, b.x + b.width) + pad;
      const y1 = lifelines.length > 0 ? b.y + b.height + 2 * pad : Math.min(v.y + v.height, b.y + b.height) + pad;
      if (x1 > x0 && y1 > y0) svg.setAttribute('viewBox', `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
    }
  } catch {
    /* No layout (a hidden or detached tree): keep mermaid's own viewBox. */
  }
  const vb = svg.viewBox?.baseVal;
  const w = vb && vb.width > 0 ? vb.width : 0;
  const h = vb && vb.height > 0 ? vb.height : 0;
  if (!(w > 0) || !(h > 0)) return;
  const cs = getComputedStyle(host);
  const room = host.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  const scale = Math.min(fitDiagramScale(w, room), h > DIAGRAM_MAX_H ? DIAGRAM_MAX_H / h : 1);
  svg.style.width = `${Math.round(w * scale)}px`;
  svg.style.height = `${Math.round(h * scale)}px`;
  svg.style.maxWidth = 'none';
  svg.setAttribute('data-fit-scale', scale.toFixed(2));
}

/** A wide mermaid flow is turned top down: the chat column is narrow and tall, and a left-to-right chain of four or more boxes is read at half size. */
export function verticalMermaid(source: string): string {
  const m = /^(\s*(?:---[\s\S]*?---\s*)?(?:%%[^\n]*\n\s*)*)(flowchart|graph)\s+(LR|RL)\b/.exec(source);
  if (!m) return source;
  const links = (source.match(/--[->.]|==>|-\.->|---/g) ?? []).length;
  if (links < 3) return source;
  return `${m[1]}${m[2]} ${m[3] === 'RL' ? 'BT' : 'TB'}${source.slice(m[0].length)}`;
}

/** The kit draws a 14px bold heading at the top (22px tall). In the chat the card header says it, centred, so the drawing's own copy is removed and its top cropped; returns whether it did. */
export function stripDrawnTitle(host: Element, ...titles: (string | undefined)[]): boolean {
  const svg = host.querySelector('svg');
  if (!svg || !drawsTitle(host, ...titles)) return false;
  const first = Array.from(svg.querySelectorAll('text')).find((t) => (t.textContent ?? '').trim() !== '');
  if (!first || first.getAttribute('font-size') !== '14' || first.getAttribute('font-weight') !== '600' || first.getAttribute('y') !== '14') return false;
  const vb = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  if (vb.length !== 4 || !vb.every(Number.isFinite) || vb[3]! <= KIT_TITLE_H + 8) return false;
  first.remove();
  svg.setAttribute('viewBox', `${vb[0]} ${vb[1]! + KIT_TITLE_H} ${vb[2]} ${vb[3]! - KIT_TITLE_H}`);
  const h = parseFloat(svg.getAttribute('height') ?? '');
  if (Number.isFinite(h) && h > KIT_TITLE_H) svg.setAttribute('height', String(h - KIT_TITLE_H));
  return true;
}
const KIT_TITLE_H = 22;

/** The title a drawing carries: an svg's <title>, a mermaid `title:` (front matter) or `title X` line. Empty when it has none. */
export function drawingTitle(kind: 'mermaid' | 'svg', source: string): string {
  const m = kind === 'svg' ? /<title[^>]*>([^<]*)<\/title>/i.exec(source) : /^---[\s\S]*?\n\s*title:\s*(.+)|^\s*title\s+(.+)$/im.exec(source);
  return (m?.[1] ?? m?.[2] ?? '').replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').trim();
}

const norm = (t: string): string => t.toLowerCase().replace(/[….\s]+$/u, '').replace(/\s+/g, ' ').trim();

/** True when the first piece of text the drawing paints is its title (the kit's heading): then the card header need not say it again. */
export function drawsTitle(host: Element, ...titles: (string | undefined)[]): boolean {
  const first = Array.from(host.querySelectorAll('svg text')).map((t) => norm(t.textContent ?? '')).find((t) => t !== '');
  return !!first && first.length >= 3 && titles.some((t) => !!t && (norm(t) === first || norm(t).startsWith(first)));
}

export function isDiagramLanguage(language: string | null): language is 'mermaid' | 'svg' {
  return language === 'mermaid' || language === 'svg';
}

type Drawn = { node: Element };

async function draw(kind: 'mermaid' | 'svg', source: string): Promise<Drawn | 'unsupported'> {
  if (kind === 'svg') {
    const r = sanitizeSvg(source);
    if (!r.ok) throw new Error(r.reason);
    stripEmojiIn(r.node, false); // the drawn copy's text nodes only: the saved source keeps what the agent wrote
    if (!source.includes('<!--visual ')) themeSvg(r.node); // the app's font, colours and buttons (INLINE-ART-RULES.md); the kit already draws in them
    return { node: r.node };
  }
  const m = await import('../app/MermaidBlock');
  if (!m.canDrawDiagrams()) return 'unsupported';
  const d = await withEmojiFallback(source, (src) => m.drawMermaid(verticalMermaid(src))); // already rebuilt from the allowlist
  stripEmojiIn(d.node, false); // the fallback draws the original: strip the drawn text either way
  return { node: d.node };
}

function reasonOf(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  return raw.split(/\r?\n/)[0]?.trim().slice(0, 160) || 'it could not be parsed';
}

/** `label`, `codeText` and `fixedSaved` are for the visual kit (VisualKitBlock): its card reads "Visual", View source shows the JSON the agent wrote, and a drawing that is already saved shows its handle instead of being saved again. */
export function DiagramBlock({ kind, source, open = false, drawingId, label: labelOverride, codeText, fixedSaved }: { kind: 'mermaid' | 'svg'; source: string; open?: boolean; drawingId?: string; label?: string; codeText?: string; fixedSaved?: SavedDrawing | null }) {
  const streaming = useContext(StreamingContext);
  const incomplete = streaming && open;
  const [good, setGood] = useState<Element | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asSource, setAsSource] = useState(false);
  const [theme, setTheme] = useState(0);
  const lastRun = useRef(0);
  const started = useRef(0);
  const artRef = useRef<HTMLDivElement | null>(null);

  /* A light/dark switch re-themes a mermaid drawing: its colours were read from the tokens when it was drawn. */
  useEffect(() => {
    if (kind !== 'mermaid' || typeof MutationObserver === 'undefined' || typeof document === 'undefined') return undefined;
    const mo = new MutationObserver(() => {
      void import('../app/MermaidBlock').then((m) => {
        m.resetMermaidTheme();
        setTheme((n) => n + 1);
      });
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, [kind]);

  /* Throttled, not debounced: leading edge at once, then at most every 250 ms
     with the latest text, so a steadily streaming fence keeps redrawing. */
  /* SVG is drawn once its fence is closed (T3 gap, lane visual): half a drawing is a flicker of
     nonsense. Mermaid keeps drawing as it streams (it holds the last good drawing). Over the size cap
     nothing is drawn at all; the code and Open are offered. */
  const tooBig = kind === 'svg' && overVisualCap(source);
  const waiting = kind === 'svg' && incomplete;
  const savedHere = useSavedDrawing('svg', source, kind === 'svg' && !incomplete && !tooBig && source.trim() !== '' && !fixedSaved, drawingId);
  const saved = fixedSaved ?? savedHere;
  useEffect(() => {
    if (source.trim() === '' || tooBig || waiting) return undefined;
    const run = (): void => {
      lastRun.current = Date.now();
      started.current += 1;
      const mine = started.current;
      draw(kind, source).then(
        (d) => {
          if (mine !== started.current || d === 'unsupported') return;
          setGood(d.node);
          setError(null);
        },
        (e: unknown) => {
          if (mine === started.current) setError(reasonOf(e));
        },
      );
    };
    const wait = Math.max(0, lastRun.current + DIAGRAM_THROTTLE_MS - Date.now());
    const t = setTimeout(run, wait);
    return () => clearTimeout(t);
  }, [kind, source, theme, tooBig, waiting]);

  const titleHint = useMemo(() => stripEmoji(drawingTitle(kind, source)), [kind, source]);
  const showArt = !(asSource || good === null);
  useLayoutEffect(() => {
    const host = artRef.current;
    if (!host || !showArt || !good) return undefined;
    host.replaceChildren(document.importNode(good, true));
    if (kind === 'svg') {
      const svg = host.querySelector('svg');
      if (svg && !source.includes('<!--visual ')) fitSvgText(svg as unknown as SVGSVGElement); // an agent's hand-placed text: fit it to its box, keep labels off borders
      stripDrawnTitle(host, saved?.title, titleHint);
    }
    if (kind !== 'mermaid') return undefined;
    fitMermaid(host);
    if (typeof ResizeObserver === 'undefined') return undefined;
    /* The column resizes (a panel opens, the window changes): fit again. */
    let last = host.clientWidth;
    const ro = new ResizeObserver(() => {
      if (host.clientWidth === last) return;
      last = host.clientWidth;
      fitMermaid(host);
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, [good, showArt, kind, source, saved?.title, titleHint]);

  const label = labelOverride ?? (kind === 'mermaid' ? 'Diagram' : 'Drawing');
  const failed = error !== null && !incomplete;
  const showCode = tooBig || asSource || (good === null && !waiting) || (failed && good === null);
  return (
    <VisualCard
      kind={kind}
      state={tooBig ? 'capped' : good === null ? (failed ? 'failed' : 'pending') : failed ? 'stale' : 'drawn'}
      label={label}
      saved={saved}
      source={source}
      resizable={!tooBig && good !== null && !asSource}
      titleHint={titleHint}
      scaled
      actions={
        <>
          {!tooBig && (good !== null || failed) ? (
            <CardAction icon={asSource ? 'eye' : 'code'} testId="chat-diagram-toggle" tip={asSource ? 'View drawing' : 'View source'} onClick={() => setAsSource((v) => !v)} />
          ) : null}
          {kind === 'svg' && !waiting && source.trim() !== '' ? <VisualActions kind="svg" source={source} saved={saved} /> : null}
        </>
      }
    >
      {waiting && good === null ? (
        <p className="dgm-note" role="status" data-testid="chat-visual-pending">
          Drawing…
        </p>
      ) : showCode ? (
        <CodeBlock text={codeText ?? source} language={codeText !== undefined ? 'json' : kind} />
      ) : (
        <div className="dgm-art" data-testid="chat-diagram-art" ref={artRef} style={kind === 'svg' ? KIT_VARS : undefined} />
      )}
      {tooBig ? (
        <p className="dgm-note" role="status" data-testid="chat-visual-capped">
          Too large to draw in the chat ({kb(source.length)}; the limit is {kb(VISUAL_MAX_CHARS)}). Use Open to see it.
        </p>
      ) : null}
      {failed && !tooBig ? (
        <p className="dgm-note" role="status" data-testid="chat-diagram-note">
          Diagram didn't parse{error ? `: ${error}` : ''}.{good !== null && !asSource ? ' Showing the last drawing that worked.' : ''}
        </p>
      ) : null}
    </VisualCard>
  );
}
