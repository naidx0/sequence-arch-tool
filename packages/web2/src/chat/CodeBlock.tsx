/* ══════════════════════════════════════════════════════════════════════════
   A FENCED CODE BLOCK IN AN ANSWER (round 9)
   packages/web2/src/chat/CodeBlock.tsx

   A header with the language and a Copy button, then the code in the repo's
   own restrained highlighter (review/syntax.ts: ink and weight, no rainbow).
   The highlighter loads with the first code block drawn, not at boot; until
   it has, the code is drawn plain, which is the same text.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useState } from 'react';

import type { SyntaxLanguage, SyntaxSpan } from '../review/syntax';

type Highlight = (line: string, language: SyntaxLanguage) => SyntaxSpan[];
let loaded: Highlight | null = null;
let loading: Promise<Highlight> | null = null;
function loadHighlight(): Promise<Highlight> {
  return (loading ??= import('../review/syntax').then((m) => (loaded = m.highlight)));
}

/** Highlighted lines by language and source text: a block that renders again with the same text is not highlighted again. */
const HIGHLIGHTED_MAX = 200;
const highlighted = new Map<string, SyntaxSpan[][]>();
function highlightLines(hl: Highlight, lang: SyntaxLanguage, text: string): SyntaxSpan[][] {
  const key = `${lang}:${text}`;
  const have = highlighted.get(key);
  if (have) return have;
  const rows = text.split('\n').map((line) => hl(line, lang));
  highlighted.set(key, rows);
  if (highlighted.size > HIGHLIGHTED_MAX) highlighted.delete(highlighted.keys().next().value as string);
  return rows;
}

const FENCE_LANGUAGE: Record<string, SyntaxLanguage> = {
  ts: 'ts', tsx: 'ts', typescript: 'ts', js: 'ts', jsx: 'ts', javascript: 'ts', mjs: 'ts', cjs: 'ts',
  py: 'py', python: 'py', go: 'go', golang: 'go', rs: 'rs', rust: 'rs', css: 'css', scss: 'css',
  json: 'json', jsonc: 'json', sh: 'sh', bash: 'sh', shell: 'sh', zsh: 'sh', console: 'sh', powershell: 'sh', ps1: 'sh',
  md: 'md', markdown: 'md',
};

/** The highlighter's language for a fence's info string; `txt` when it names none we colour. */
export function fenceLanguage(info: string | null): SyntaxLanguage {
  return (info && FENCE_LANGUAGE[info.toLowerCase()]) || 'txt';
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** `open`: the fence is still streaming. It is drawn as plain text and highlighted once, when it closes. */
export function CodeBlock({ text, language, open = false }: { text: string; language: string | null; open?: boolean }) {
  const lang = fenceLanguage(language);
  const [hl, setHl] = useState<Highlight | null>(() => loaded);
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  useEffect(() => {
    if (hl || lang === 'txt' || open) return;
    let live = true;
    void loadHighlight().then((h) => live && setHl(() => h));
    return () => {
      live = false;
    };
  }, [hl, lang, open]);
  useEffect(() => {
    if (copied === 'idle') return undefined;
    const t = setTimeout(() => setCopied('idle'), 1600);
    return () => clearTimeout(t);
  }, [copied]);
  const lines = useMemo(() => text.split('\n'), [text]);
  const rows = useMemo(() => (hl && !open && lang !== 'txt' ? highlightLines(hl, lang, text) : null), [hl, open, lang, text]);
  return (
    <div className="r9-code" data-testid="chat-code-block" data-language={language ?? undefined}>
      <div className="r9-code-hd">
        <span className="r9-code-lang">{language || 'code'}</span>
        <button
          type="button"
          className="r9-code-copy"
          data-testid="chat-code-copy"
          aria-label="Copy code"
          onClick={() => void copyText(text).then((ok) => setCopied(ok ? 'ok' : 'fail'))}
        >
          {copied === 'ok' ? 'Copied' : copied === 'fail' ? 'Copy failed' : 'Copy'}
        </button>
      </div>
      <pre className="prose-code" data-testid="chat-code" data-language={language ?? undefined}>
        <code>
          {lines.map((line, i) => (
            <span key={i} className="r9-code-line">
              {rows
                ? rows[i]!.map((s, j) => (s.cls ? <span key={j} className={`r9-t-${s.cls}`}>{s.text}</span> : s.text))
                : line}
              {i < lines.length - 1 ? '\n' : null}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
