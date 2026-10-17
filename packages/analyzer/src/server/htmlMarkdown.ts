/**
 * HTML to markdown / plain text for web_fetch. Linear in the input by design:
 *
 *   - the input is capped (HTML_CAP) and a cheap linear pre-scan measures tag
 *     nesting; deeper than MAX_NESTING (512) is not parsed at all (parse5's tree
 *     construction is quadratic in nesting depth: 32k nested <div> took 6s) but
 *     flattened to text by {@link htmlToFlatText};
 *   - each subtree is rendered once into one output buffer; blockquote prefixes
 *     are applied as lines are written, and links, table cells and anything
 *     inside them render "flat" (no nested block structure), so nesting never
 *     multiplies the work;
 *   - content deeper than MAX_WALK_DEPTH is flattened to its text, never dropped.
 *
 * The caller (netFetch.webFetch) additionally runs this in a worker thread with
 * a hard timeout, see htmlMarkdownWorker.ts.
 */

import { parse as parseHtml } from 'parse5';

export const HTML_CAP = 2 * 1024 * 1024;
export const MAX_NESTING = 512;
const MAX_LIST_DEPTH = 8;
const MAX_WALK_DEPTH = 256;

const SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'head', 'iframe', 'object', 'embed', 'canvas', 'title', 'select', 'button', 'audio', 'video']);
const BLOCK = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'form', 'fieldset', 'figure',
  'figcaption', 'address', 'details', 'summary', 'dl', 'dt', 'dd', 'center', 'body', 'html',
]);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

interface HNode {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: HNode[];
}

const attrOf = (n: HNode, name: string): string | undefined => n.attrs?.find((a) => a.name === name)?.value;

/** A link/image target worth keeping: http(s), or relative to the page. Anything else (javascript:, data:, mailto: ...) is dropped. */
function safeTarget(raw: string | undefined, base?: string): string {
  if (!raw) return '';
  const v = raw.replace(/[\x00-\x20\x7f-\x9f]+/g, '');
  if (!v || v.startsWith('#')) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(v) && !/^https?:/i.test(v)) return '';
  /* No base and not absolute: it stays as written. Asking `new URL` just to have it throw cost ~150 us a link (90k links = 14 s of a 5 MB page). */
  if (!base && !/^https?:/i.test(v)) return v;
  try {
    const u = base ? new URL(v, base) : new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : '';
  } catch {
    return base ? '' : v;
  }
}

/** Output buffer with O(1) newline bookkeeping, a line prefix (blockquote) and a flat mode. */
class Out {
  parts: string[] = [];
  tail = '';
  prefix = '';
  /** Flat: block boundaries become a single space (inside links and table cells). */
  flat = false;
  add(s: string): void {
    if (!s) return;
    if (this.prefix && /\S|\n/.test(s)) {
      const segs = s.split('\n');
      let o = '';
      segs.forEach((seg, i) => {
        if (i > 0) o += '\n';
        const lineStart = i > 0 || this.parts.length === 0 || this.tail.endsWith('\n');
        const last = i === segs.length - 1;
        if (lineStart && !(last && seg === '')) o += seg === '' ? this.prefix.trimEnd() : this.prefix + seg;
        else o += seg;
      });
      s = o;
    }
    this.parts.push(s);
    this.tail = s.length >= 2 ? s.slice(-2) : (this.tail + s).slice(-2);
  }
  nl(n: 1 | 2): void {
    if (this.parts.length === 0) return;
    if (this.flat) {
      if (!/\s$/.test(this.tail)) this.add(' ');
      return;
    }
    const have = this.tail.endsWith('\n\n') ? 2 : this.tail.endsWith('\n') ? 1 : 0;
    if (have < n) this.add('\n'.repeat(n - have));
  }
  text(): string {
    return this.parts.join('');
  }
}

interface Ctx {
  md: boolean;
  base?: string;
  pre: boolean;
  lists: { ordered: boolean; n: number }[];
  /** Test seam: counts every node `render` is entered for, so 'each subtree once' can be checked as a count, not a clock. */
  visits?: { count: number };
}

/** Text of a subtree, iteratively (no recursion limit), skipping non-content elements. */
function flattenText(root: HNode): string {
  const out: string[] = [];
  const stack: HNode[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.nodeName === '#text') {
      out.push(n.value ?? '');
      continue;
    }
    if (n.tagName && SKIP.has(n.tagName)) continue;
    const kids = n.childNodes ?? [];
    for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]!);
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/** Render children of `n` into a fresh flat buffer and return the collapsed text. Used for links and cells only. */
function renderFlat(n: HNode, ctx: Ctx, depth: number): string {
  const kids = n.childNodes ?? [];
  /* fast path: a cell or link that is only text */
  if (kids.length === 1 && kids[0]!.nodeName === '#text') return (kids[0]!.value ?? '').replace(/\s+/g, ' ').trim();
  const o = new Out();
  o.flat = true;
  const flatCtx: Ctx = { ...ctx, lists: [] };
  for (const c of kids) render(c, o, flatCtx, depth + 1);
  return o.text().replace(/\s+/g, ' ').trim();
}

function rowsOf(n: HNode, acc: HNode[] = [], depth = 0): HNode[] {
  if (depth > 8) return acc;
  for (const c of n.childNodes ?? []) {
    if (c.tagName === 'tr') acc.push(c);
    else if (c.tagName === 'thead' || c.tagName === 'tbody' || c.tagName === 'tfoot') rowsOf(c, acc, depth + 1);
  }
  return acc;
}

function render(n: HNode, out: Out, ctx: Ctx, depth: number): void {
  const { md } = ctx;
  if (ctx.visits) ctx.visits.count += 1;
  if (n.nodeName === '#text') {
    const raw = n.value ?? '';
    if (ctx.pre) {
      out.add(raw);
      return;
    }
    const t = raw.replace(/\s+/g, ' ');
    if (t === ' ' && (out.tail === '' || /[\s(\[]$/.test(out.tail))) return;
    out.add(out.tail === '' || out.tail.endsWith('\n') ? t.replace(/^ /, '') : t);
    return;
  }
  if (depth > MAX_WALK_DEPTH) {
    const t = flattenText(n);
    if (t) out.add(out.tail === '' || /\s$/.test(out.tail) ? t : ' ' + t);
    return;
  }
  const tag = n.tagName;
  if (!tag) {
    for (const c of n.childNodes ?? []) render(c, out, ctx, depth + 1);
    return;
  }
  if (SKIP.has(tag)) return;
  const kids = (): void => {
    for (const c of n.childNodes ?? []) render(c, out, ctx, depth + 1);
  };
  const flat = out.flat;
  if (/^h[1-6]$/.test(tag)) {
    out.nl(2);
    if (md && !flat) out.add(`${'#'.repeat(Number(tag[1]))} `);
    kids();
    out.nl(2);
  } else if (tag === 'br') {
    out.add(flat ? ' ' : md ? '  \n' : '\n');
  } else if (tag === 'hr') {
    out.nl(2);
    if (md && !flat) out.add('---');
    out.nl(2);
  } else if (tag === 'pre') {
    out.nl(2);
    if (md && !flat) out.add('```\n');
    for (const c of n.childNodes ?? []) render(c, out, { ...ctx, pre: !flat }, depth + 1);
    if (!flat) {
      if (!out.tail.endsWith('\n')) out.add('\n');
      if (md) out.add('```');
    }
    out.nl(2);
  } else if (tag === 'code' && !ctx.pre) {
    if (md) out.add('`');
    kids();
    if (md) out.add('`');
  } else if (tag === 'strong' || tag === 'b') {
    if (md) out.add('**');
    kids();
    if (md) out.add('**');
  } else if (tag === 'em' || tag === 'i') {
    if (md) out.add('_');
    kids();
    if (md) out.add('_');
  } else if (tag === 'a') {
    const href = safeTarget(attrOf(n, 'href'), ctx.base);
    if (md && href) {
      const inner = renderFlat(n, ctx, depth);
      if (inner) out.add(`[${inner}](${href})`);
    } else kids();
  } else if (tag === 'img') {
    const src = safeTarget(attrOf(n, 'src'), ctx.base);
    const alt = attrOf(n, 'alt')?.trim();
    if (md && src) out.add(`![${alt ?? ''}](${src})`);
    else if (!md && alt) out.add(alt);
  } else if (tag === 'ul' || tag === 'ol') {
    out.nl(ctx.lists.length ? 1 : 2);
    const lists = [...ctx.lists, { ordered: tag === 'ol', n: 0 }];
    for (const c of n.childNodes ?? []) render(c, out, { ...ctx, lists }, depth + 1);
    out.nl(ctx.lists.length ? 1 : 2);
  } else if (tag === 'li') {
    out.nl(1);
    const top = ctx.lists[ctx.lists.length - 1];
    if (top) top.n += 1;
    if (!flat) {
      const pad = '  '.repeat(Math.min(MAX_LIST_DEPTH, Math.max(0, ctx.lists.length - 1)));
      out.add(`${pad}${top?.ordered ? `${top.n}. ` : '- '}`);
    }
    kids();
    out.nl(1);
  } else if (tag === 'blockquote') {
    out.nl(2);
    const saved = out.prefix;
    if (md && !flat) out.prefix = saved + '> ';
    kids();
    out.prefix = saved;
    out.nl(2);
  } else if (tag === 'table') {
    out.nl(2);
    if (flat) {
      /* a table inside a cell or link reads as its cells' text, in order */
      kids();
    } else {
      const rows = rowsOf(n);
      rows.forEach((r, i) => {
        const cells = (r.childNodes ?? []).filter((c) => c.tagName === 'td' || c.tagName === 'th');
        const texts = cells.map((c) => renderFlat(c, ctx, depth + 1).replace(/\|/g, '/'));
        out.nl(1);
        out.add(md ? `| ${texts.join(' | ')} |` : texts.join('\t'));
        if (md && i === 0 && cells.some((c) => c.tagName === 'th')) out.add(`\n|${' --- |'.repeat(Math.max(1, cells.length))}`);
      });
    }
    out.nl(2);
  } else if (BLOCK.has(tag)) {
    const k = tag === 'div' || tag === 'dt' || tag === 'dd' ? 1 : 2;
    out.nl(k);
    kids();
    out.nl(k);
  } else {
    kids();
  }
}

function finish(out: Out, md: boolean): string {
  return out
    .text()
    .replace(/[ \t]+\n/g, (s) => (md && s.startsWith('  ') && s.length === 3 ? s : '\n'))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Deepest tag nesting by a linear scan (open tags that are not void or self-closing, minus closes). */
export function maxNesting(html: string): number {
  let depth = 0;
  let max = 0;
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^<>]{0,4000}?(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const name = m[2]!.toLowerCase();
    if (m[1]) depth = Math.max(0, depth - 1);
    else if (!m[3] && !VOID.has(name)) {
      depth += 1;
      if (depth > max) max = depth;
    }
  }
  return max;
}

/** Tags stripped, scripts and styles removed, entities decoded: the linear fallback for pages too deep to parse. */
export function htmlToFlatText(html: string): string {
  return html
    .replace(/<(script|style|noscript|template|svg|head)[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^<>]{0,4000}>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e: string) => {
      const l = e.toLowerCase();
      if (l === 'amp') return '&';
      if (l === 'lt') return '<';
      if (l === 'gt') return '>';
      if (l === 'quot') return '"';
      if (l === 'apos') return "'";
      if (l === 'nbsp') return ' ';
      const code = l[1] === 'x' ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
      try {
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
      } catch {
        return m;
      }
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export const DEEP_NOTE = '[page nesting is deeper than 512 levels; flattened to plain text]\n\n';

/**
 * HTML to markdown (`markup: true`) or plain text (`markup: false`). parse5
 * does HTML5 tree construction (implicit end tags, `<head>` ends at `<body>`,
 * unclosed elements). Skips scripts/styles/svg/iframes; keeps headings,
 * paragraphs, lists (indent capped at depth 8), links, emphasis, code, pre,
 * blockquote, images and simple tables. Links and images are made absolute
 * against `baseUrl`; only http(s) and relative targets survive.
 */
export function htmlToMarkdown(html: string, opts: { baseUrl?: string; markup?: boolean; visits?: { count: number } } = {}): string {
  const md = opts.markup !== false;
  const capped = html.length > HTML_CAP ? html.slice(0, HTML_CAP) : html;
  if (maxNesting(capped) > MAX_NESTING) return DEEP_NOTE + htmlToFlatText(capped);
  const doc = parseHtml(capped) as unknown as HNode;
  const out = new Out();
  render(doc, out, { md, base: opts.baseUrl, pre: false, lists: [], visits: opts.visits }, 0);
  return finish(out, md);
}
