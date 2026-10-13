/* ══════════════════════════════════════════════════════════════════════════
   THE CODE EDITOR (round 8, item 9)
   packages/web2/src/files/CodeEditor.tsx

   Jaden asked for better file editing, "a real code editor experience". The
   lockfile has no editor package (no CodeMirror, Monaco, Prism or Shiki), and
   adding one is a download that needs his yes, so this builds on what the
   repository already has: the restrained tokenizer (review/syntax.ts, the
   code view's highlighting) under a plain <textarea>.

   ONE SCROLLER, SO THE GUTTER CANNOT DRIFT. The old field refused a gutter
   because "two independently scrolling boxes ... drift by one line". Here the
   gutter, the highlighted listing and the field sit in ONE scrolling box: the
   field is as tall and as wide as the text (it never scrolls itself), so a
   line number and its line move together by construction.

   What it does: syntax highlighting (the tokenizer's four classes), line
   numbers, the current line lit, Find (Mod+F: Enter for the next match,
   Shift+Enter for the previous, Esc to close), Save (Mod+S, through the
   panel's own Save action), Tab inserts two spaces, and a status row:
   language, line:column, Saved or Unsaved, with Save and Discard. A file over
   HIGHLIGHT_CAP lines is edited without colour (a highlight per keystroke of
   a minified bundle is the stall the code view caps for).
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';

import { highlight, languageOf, type SyntaxLanguage } from '../review/syntax';

import { FILES } from './anchors';
import { FilesIcon } from './FilesIcon';

/** Above this many lines the listing is drawn plain. */
export const HIGHLIGHT_CAP = 4000;

/** The gutter never grows past this many digits; a longer number is clipped, not given more room. */
export const GUTTER_MAX_DIGITS = 4;

/** Digits the gutter is sized for: the line count's, capped. */
export function gutterDigits(lineCount: number): number {
  return Math.min(GUTTER_MAX_DIGITS, String(Math.max(1, lineCount)).length);
}

const LANGUAGE_NAME: Record<SyntaxLanguage, string> = {
  ts: 'TypeScript / JavaScript',
  py: 'Python',
  go: 'Go',
  rs: 'Rust',
  css: 'CSS',
  json: 'JSON',
  sh: 'Shell',
  md: 'Markdown',
  txt: 'Plain text',
};

/** The language the status row names for a path. */
export function languageName(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'html' || ext === 'htm') return 'HTML';
  if (ext === 'yml' || ext === 'yaml') return 'YAML';
  return LANGUAGE_NAME[languageOf(path)];
}

/** 1-based line and column of an offset in `text`. */
export function caretAt(text: string, offset: number): { line: number; col: number } {
  const before = text.slice(0, Math.max(0, offset));
  const nl = before.lastIndexOf('\n');
  return { line: before.split('\n').length, col: before.length - nl };
}

/** Every start offset of `needle` in `text`, case-insensitive. */
export function findAll(text: string, needle: string): number[] {
  if (!needle) return [];
  const hay = text.toLowerCase();
  const n = needle.toLowerCase();
  const out: number[] = [];
  for (let i = hay.indexOf(n); i >= 0; i = hay.indexOf(n, i + Math.max(1, n.length))) out.push(i);
  return out;
}

const isMod = (e: { metaKey: boolean; ctrlKey: boolean }) => e.metaKey || e.ctrlKey;

export interface CodeEditorProps {
  path: string;
  value: string;
  onChange: (text: string) => void;
  dirty: boolean;
  /** Save, when there is one to make; absent hides the button and Mod+S does nothing. */
  onSave?: () => void;
  canSave?: boolean;
  onDiscard?: () => void;
  /** A `file:12` the reader followed from the chat: the caret and the view go to that line. */
  revealLine?: number;
  /** Changes each time the same line is asked for again. */
  revealKey?: number;
  /** A project search the reader followed here: the in-file find opens seeded with it. */
  findSeed?: string;
  /** Changes each time a seed is applied. */
  findKey?: number;
}

export function CodeEditor({ path, value, onChange, dirty, onSave, canSave = true, onDiscard, revealLine, revealKey, findSeed, findKey }: CodeEditorProps) {
  const ta = useRef<HTMLTextAreaElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const findRef = useRef<HTMLInputElement | null>(null);
  const [caret, setCaret] = useState({ line: 1, col: 1 });
  const [finding, setFinding] = useState(false);
  const [needle, setNeedle] = useState('');
  const [hit, setHit] = useState(-1);

  const language = languageOf(path);
  const lines = useMemo(() => value.split('\n'), [value]);
  const widest = useMemo(() => lines.reduce((m, l) => Math.max(m, l.length), 0), [lines]);
  const coloured = lines.length <= HIGHLIGHT_CAP;
  const matches = useMemo(() => findAll(value, needle), [value, needle]);

  const track = () => {
    const el = ta.current;
    if (el) setCaret(caretAt(el.value, el.selectionStart));
  };

  /* Bring a line into the one scroller's view. */
  const reveal = (line: number) => {
    const sc = scroller.current;
    const el = ta.current;
    if (!sc || !el) return;
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 18;
    const top = (line - 1) * lh;
    if (top < sc.scrollTop || top + lh > sc.scrollTop + sc.clientHeight) sc.scrollTop = Math.max(0, top - sc.clientHeight / 3);
  };

  const go = (dir: 1 | -1) => {
    if (matches.length === 0) return;
    const next = hit < 0 ? (dir === 1 ? 0 : matches.length - 1) : (hit + dir + matches.length) % matches.length;
    setHit(next);
    const at = matches[next]!;
    const el = ta.current;
    if (el) {
      el.focus();
      el.setSelectionRange(at, at + needle.length);
      const c = caretAt(value, at);
      setCaret(c);
      reveal(c.line);
    }
  };

  useEffect(() => {
    if (!revealLine) return;
    const el = ta.current;
    if (!el) return;
    const all = el.value.split('\n');
    const at = all.slice(0, Math.min(revealLine, all.length) - 1).reduce((n, l) => n + l.length + 1, 0);
    el.setSelectionRange(at, at);
    setCaret(caretAt(el.value, at));
    reveal(Math.min(revealLine, all.length));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealLine, revealKey, path]);
  useEffect(() => {
    if (!findSeed) return;
    setNeedle(findSeed);
    setFinding(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findSeed, findKey, path]);
  useEffect(() => setHit(-1), [needle]);
  useEffect(() => {
    if (finding) findRef.current?.focus();
  }, [finding]);

  const onKey = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (isMod(e) && !e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      const el = ta.current;
      const picked = el ? el.value.slice(el.selectionStart, el.selectionEnd) : '';
      if (picked && !picked.includes('\n')) setNeedle(picked);
      setFinding(true);
      findRef.current?.select();
      return;
    }
    if (isMod(e) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (onSave && canSave) onSave();
      return;
    }
    if (e.key === 'Escape' && finding) {
      e.preventDefault();
      setFinding(false);
      ta.current?.focus();
    }
  };

  const onFieldKey = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab' && !e.shiftKey && !isMod(e) && !e.altKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const s = el.selectionStart;
      const next = `${el.value.slice(0, s)}  ${el.value.slice(el.selectionEnd)}`;
      onChange(next);
      requestAnimationFrame(() => {
        el.setSelectionRange(s + 2, s + 2);
        track();
      });
    }
    /* Mod+F, Mod+S and Esc bubble to the editor's own handler. */
  };

  return (
    <div className="files-ed" data-testid="files-code-editor" onKeyDown={onKey}>
      {finding ? (
        <div className="files-ed-find" role="search" data-testid="files-find">
          <FilesIcon name="search" size={14} />
          <input
            ref={findRef}
            className="files-ed-find-in"
            type="search"
            value={needle}
            placeholder="Find in file"
            aria-label="Find in file"
            data-testid="files-find-input"
            onChange={(e) => setNeedle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                go(e.shiftKey ? -1 : 1);
              }
            }}
          />
          <span className="files-ed-find-n" data-testid="files-find-count" aria-live="polite">
            {needle ? (matches.length ? `${hit < 0 ? 0 : hit + 1} of ${matches.length}` : 'No match') : ''}
          </span>
          <button type="button" className="files-btn files-ed-ib" aria-label="Previous match" title="Previous match" onClick={() => go(-1)} disabled={!matches.length}>
            <FilesIcon name="chevleft" size={12} />
          </button>
          <button type="button" className="files-btn files-ed-ib" aria-label="Next match" title="Next match" onClick={() => go(1)} disabled={!matches.length}>
            <FilesIcon name="chevright" size={12} />
          </button>
          <button type="button" className="files-btn files-ed-ib" aria-label="Close find" title="Close find" onClick={() => setFinding(false)}>
            <FilesIcon name="x" size={12} />
          </button>
        </div>
      ) : null}
      <div className="files-ed-scroll" ref={scroller}>
        <div className="files-ed-inner" style={
            {
              '--files-ed-gutter': `calc(${gutterDigits(lines.length)}ch + var(--sp-4) + var(--sp-6) + var(--w-hair))`,
              minWidth: `calc(${widest + 2}ch + var(--files-ed-gutter))`,
            } as CSSProperties
          }>
          <div className="files-ed-gutter mono" aria-hidden="true">
            {lines.map((_, i) => (
              <span key={i} className={i + 1 === caret.line ? 'is-cur' : undefined}>
                {i + 1}
              </span>
            ))}
          </div>
          <div className="files-ed-code">
            <div className="files-ed-curline" aria-hidden="true" style={{ top: `calc(${caret.line - 1} * var(--files-ed-lh) + var(--files-ed-pad))` }} />
            <pre className="files-ed-hl mono" aria-hidden="true">
              {lines.map((line, i) => (
                <span key={i}>
                  {coloured
                    ? highlight(line, language).map((span, j) =>
                        span.cls === null ? (
                          <span key={j}>{span.text}</span>
                        ) : (
                          <span key={j} className={`files-t-${span.cls}`}>
                            {span.text}
                          </span>
                        ),
                      )
                    : line}
                  {'\n'}
                </span>
              ))}
            </pre>
            <textarea
              ref={ta}
              className="files-editor files-ed-ta mono"
              data-testid={FILES.editor}
              aria-label={`Edit ${path}`}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              wrap="off"
              value={value}
              rows={lines.length}
              onChange={(e) => {
                onChange(e.target.value);
                track();
              }}
              onKeyDown={onFieldKey}
              onKeyUp={track}
              onClick={track}
              onSelect={track}
            />
          </div>
        </div>
      </div>
      <div className="files-ed-status" data-testid="files-ed-status">
        <span className="files-ed-info" data-testid="files-ed-lang">{languageName(path)}</span>
        <span className="files-ed-info mono" data-testid="files-ed-caret">{`Ln ${caret.line}, Col ${caret.col}`}</span>
        <span className="files-ed-info">{lines.length.toLocaleString('en-US')} lines</span>
        <span className="files-ed-grow" />
        <span className={`files-ed-state${dirty ? ' is-dirty' : ''}`} data-testid="files-ed-state">
          {dirty ? 'Unsaved' : 'Saved'}
        </span>
        {onDiscard ? (
          <button type="button" className="files-btn files-ed-pill" data-testid={FILES.action} data-action="discard" disabled={!dirty} title="Throw away unsaved edits" onClick={onDiscard}>
            Discard
          </button>
        ) : null}
        {onSave ? (
          <button type="button" className="files-btn files-ed-pill is-solid" data-testid={FILES.action} data-action="save" disabled={!canSave} title="Save (Ctrl+S)" onClick={onSave}>
            Save
          </button>
        ) : null}
      </div>
    </div>
  );
}

export default CodeEditor;
