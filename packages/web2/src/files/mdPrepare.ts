/* ══════════════════════════════════════════════════════════════════════════
   WHAT A MARKDOWN FILE NEEDS BEFORE THE PROSE RENDERER SEES IT
   packages/web2/src/files/mdPrepare.ts

   The renderer (chat/ProseMessage) is shared with the chat transcript and is written for what a model
   says, not for what a repo keeps. A decision record (MADR) opens with YAML front-matter, and read as
   prose that block is a rule, three lines of `key: value` run together as one paragraph, and a stray
   `---` (measured in the browser, 2026-10-10). Diagram fences in docs also carry more than the bare
   language: ```mermaid title="x", ```mmd. Both are handled HERE, for the Files preview only, so the
   chat's output does not change by a byte.
   ══════════════════════════════════════════════════════════════════════════ */

export interface FrontMatterEntry {
  key: string;
  value: string;
}

export interface PreparedMarkdown {
  /** The front-matter as read, in file order; empty when the file has none. */
  meta: FrontMatterEntry[];
  /** The text the prose renderer gets: no front-matter, diagram fences reduced to their language. */
  body: string;
}

const KEY_LINE = /^([A-Za-z_][\w .-]*):[ \t]*(.*)$/;
const LIST_LINE = /^[ \t]+-[ \t]+(.*)$/;

const unquote = (v: string): string => {
  const t = v.trim();
  return /^(['"]).*\1$/.test(t) && t.length >= 2 ? t.slice(1, -1) : t;
};

/** Front-matter is `---` on the first line, `key: value` lines (a list under a key allowed), then `---` or `...`. */
export function splitFrontMatter(text: string): { meta: FrontMatterEntry[]; rest: string } {
  const src = text.replace(/^\uFEFF/, '');
  const lines = src.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { meta: [], rest: text };
  let end = -1;
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (t === '---' || t === '...') {
      end = i;
      break;
    }
  }
  if (end < 2) return { meta: [], rest: text };
  const meta: FrontMatterEntry[] = [];
  for (const line of lines.slice(1, end)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const list = LIST_LINE.exec(line);
    if (list && meta.length > 0) {
      const last = meta[meta.length - 1]!;
      last.value = last.value ? `${last.value}, ${unquote(list[1]!)}` : unquote(list[1]!);
      continue;
    }
    const kv = KEY_LINE.exec(line);
    if (!kv) return { meta: [], rest: text };
    const raw = kv[2]!.trim();
    const inline = /^\[(.*)\]$/.exec(raw);
    meta.push({ key: kv[1]!.trim(), value: inline ? inline[1]!.split(',').map(unquote).join(', ') : unquote(raw) });
  }
  return { meta, rest: lines.slice(end + 1).join('\n').replace(/^\n+/, '') };
}

const OPEN = /^(\s*)(`{3,}|~{3,})[ \t]*([A-Za-z0-9+#._-]*)(.*)$/;

/** ```mermaid title="x" and ```mmd become ```mermaid; every other fence, and everything inside any fence, is untouched. */
export function normaliseDiagramFences(text: string): string {
  const lines = text.split('\n');
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (fence === null) {
      const m = OPEN.exec(line.replace(/\r$/, ''));
      if (!m) continue;
      fence = m[2]!;
      const lang = m[3]!.toLowerCase();
      if (lang === 'mmd' || (lang === 'mermaid' && m[4]!.trim() !== '')) lines[i] = `${m[1]}${m[2]}mermaid`;
    } else if (new RegExp(String.raw`^\s*${fence[0] === '`' ? '`' : '~'}{${fence.length},}\s*$`).test(line.replace(/\r$/, ''))) {
      fence = null;
    }
  }
  return lines.join('\n');
}

export function prepareMarkdown(text: string): PreparedMarkdown {
  const { meta, rest } = splitFrontMatter(text);
  return { meta, body: normaliseDiagramFences(rest) };
}
