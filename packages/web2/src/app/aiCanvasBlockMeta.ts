import type { IconName } from '../chat/Icon';

export type AiCanvasBlockType = 'markdown' | 'mermaid' | 'html' | 'react' | 'svg';

const BLOCK_TYPE_LABEL: Record<AiCanvasBlockType, string> = {
  markdown: 'Markdown',
  mermaid: 'Mermaid',
  html: 'HTML',
  react: 'React',
  svg: 'SVG',
};

const BLOCK_TYPE_ICON: Record<AiCanvasBlockType, IconName> = {
  markdown: 'text',
  mermaid: 'flow',
  html: 'code',
  react: 'chart',
  svg: 'frame',
};

/** Ledger header: "Markdown · plan" */
export function canvasBlockHeading(type: AiCanvasBlockType, title?: string): string {
  const kind = BLOCK_TYPE_LABEL[type];
  return title ? `${kind} · ${title}` : kind;
}

export function canvasBlockIcon(type: AiCanvasBlockType): IconName {
  return BLOCK_TYPE_ICON[type];
}

export function canvasBlockStatusLabel(status: 'pending' | 'live' | 'landed'): string {
  if (status === 'pending') return 'drawing…';
  return status;
}

/** Map `canvas.write_*` tool name → block type for pending placeholders. */
export function canvasBlockTypeFromToolName(name: string): AiCanvasBlockType | null {
  const m = /^canvas\.write_(\w+)$/.exec(name);
  if (!m) return null;
  const t = m[1];
  if (t === 'markdown' || t === 'mermaid' || t === 'html' || t === 'react' || t === 'svg') {
    return t;
  }
  return null;
}

export function canvasToolLabel(name: string): string {
  const type = canvasBlockTypeFromToolName(name);
  if (!type) return 'Drawing on AI Canvas';
  return `Drawing ${BLOCK_TYPE_LABEL[type]}`;
}

/**
 * Does this block's own content already say what it is?
 *
 * THE RULE THE CANVAS TURNS ON — `docs/AI-CANVAS-IS-A-DOCUMENT.md` §3, and it is
 * not a new opinion. The chart block already obeys it in `AiCanvas.tsx`, with
 * the reason written in place: "NO BLOCK HEADER, and that is deliberate.
 * `ChartFrame` already draws the chart's own `<figcaption>` with its title and
 * caption." A markdown block opening `# Plan` renders an <h2>Plan</h2> and was
 * then wrapped in a bar reading "Markdown · Plan" — the title drawn twice, the
 * second one chrome.
 *
 * Owner, 2026-09-09: "The AI canvas right now seems to open up little section
 * cards within the canvas."
 *
 * ONLY MARKDOWN CAN ANSWER YES, and the limit is the load-bearing half. An
 * `html`, `react` or `svg` payload can render literally anything; with no label
 * the reader cannot tell what they are looking at, or that a tool wrote it.
 * Dropping the header everywhere would trade "too much chrome" for
 * "unreadable" — a fix that guts the feature is a different kind of failure.
 * `mermaid` is excluded for the same reason: a diagram is not a title.
 *
 * A LEADING HEADING, not a heading anywhere. `#` on line 40 does not name the
 * passage a reader meets at line 1, and `renderMarkdown` only makes a heading
 * from a line that starts with `#` — so this asks exactly what that renderer
 * will draw first, rather than a looser question that happens to correlate.
 *
 * PURE. A block in, a boolean out.
 */
export function blockNamesItself(block: { type: string; payload?: string }): boolean {
  if (block.type !== 'markdown') return false;
  const first = (block.payload ?? '').split('\n').find((line) => line.trim() !== '');
  return first !== undefined && /^#{1,6}\s+\S/.test(first.trim());
}

/**
 * What a block calls itself to a screen reader.
 *
 * THE DEFECT THIS CLOSES, and I caused half of it. Every block renders as an
 * `<article>` with no accessible name, so a canvas of eight blocks announces
 * "article, article, article" and cannot be navigated by landmark at all —
 * Sequence's third gate is human-usability, and a block that cannot be found
 * fails it however well it renders.
 *
 * Dropping the redundant "Markdown · Plan" bar (docs/AI-CANVAS-IS-A-DOCUMENT.md
 * §3) was right for the eye and made this worse for everyone else: it removed
 * the only text naming a self-naming block from outside its content. The fix is
 * not to put the bar back — it is to give the article the name the heading
 * already carries.
 *
 * SO THE NAME COMES FROM THE CONTENT WHERE THE CONTENT HAS ONE. A markdown
 * block opening `# Step one` is "Step one", which is what a reader looking at
 * it would call it. Everything else falls back to the kind heading, because an
 * html or svg payload has no name of its own and "article" is worse than
 * "HTML".
 *
 * PURE. A block in, a string out.
 */
export function blockAccessibleName(block: { type: string; payload?: string; title?: string }): string {
  if (blockNamesItself(block)) {
    const first = (block.payload ?? '').split('\n').find((line) => line.trim() !== '') ?? '';
    const heading = first.trim().replace(/^#{1,6}\s+/, '').trim();
    if (heading !== '') return heading;
  }
  return canvasBlockHeading(block.type as AiCanvasBlockType, block.title);
}

/**
 * What every block on ONE canvas calls itself, told apart.
 *
 * UNIQUENESS IS A PROPERTY OF THE SET, AND `blockAccessibleName` NEVER SEES THE
 * SET — which is the whole defect and why single-block tests could not find it.
 * Every name that function returns is correct alone: "Mermaid" is the right word
 * for a mermaid block. Put two untitled diagrams on one canvas and the landmark
 * list reads "Mermaid, Mermaid", which the legibility gate forbids outright — no
 * two sibling rows may read the same. It is the same defect `blockAccessibleName`
 * was written to close (eight articles announcing "article") surviving one word
 * better, in exactly the block types that most need a name: a diagram, an svg or
 * an html payload has no heading of its own to borrow.
 *
 * ONLY A COLLISION EARNS AN ORDINAL. One diagram is "Mermaid", never "Mermaid 1"
 * — §3 of the design is that content is not labelled twice, and a number added to
 * satisfy a rule is noise. A block with its own heading or title never collides.
 *
 * PURE. A document in, one name per block out, in document order.
 */
export function canvasBlockNames(
  blocks: { type: string; payload?: string; title?: string }[],
): string[] {
  const base = blocks.map((b) => blockAccessibleName(b));
  const total = new Map<string, number>();
  for (const name of base) total.set(name, (total.get(name) ?? 0) + 1);
  const seen = new Map<string, number>();
  return base.map((name) => {
    if ((total.get(name) ?? 0) < 2) return name;
    const n = (seen.get(name) ?? 0) + 1;
    seen.set(name, n);
    return `${name} ${n}`;
  });
}
