/* ══════════════════════════════════════════════════════════════════════════
   FIND IN THE FILES SPACE (G9)
   packages/web2/src/files/FilesFind.tsx

   Owner: "find text in the file in this project: just be in like the file space".
   A field in the Files surface that searches the TEXT of the project through
   `GET /api/search` (the route that already existed and was shown only by a
   separate overlay). Matches are grouped by file with line numbers; Enter on a
   match opens the file at that line with the editor's own find seeded.

   The route answers the search tool's own text (`path:line: snippet` lines in a
   fenced block, header and cut notes outside it). Nothing here re-derives the
   engine's meaning: the fenced lines are split into path / line / snippet, and
   the header's trailing note (a cap, the skipped folders) is shown as said.
   ══════════════════════════════════════════════════════════════════════════ */

import { FOCUS_EVENT, clearPendingFocus, takePendingFocus } from './filesFindFocus';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { S2Icon } from '../shell2/icons';

export interface FindHit {
  line: number;
  text: string;
}
export interface FindGroup {
  path: string;
  hits: FindHit[];
}
export interface FindResult {
  groups: FindGroup[];
  /** The engine's own words about a cap or skipped folders; '' when none. */
  note: string;
}

const HIT_LINE = /^(.+?):(\d+): ?(.*)$/;

/** Split the search tool's text into per-file groups. Only lines inside the fence are hits. */
export function parseSearchText(text: string): FindResult {
  const groups: FindGroup[] = [];
  const byPath = new Map<string, FindGroup>();
  let note = '';
  let fenced = false;
  for (const raw of text.replace(/\r/g, '').split('\n')) {
    if (raw.startsWith('```')) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) {
      const head = /^### search results for ".*" \(\d+\)(.*)$/.exec(raw);
      if (head) note = (head[1] ?? '').trim();
      continue;
    }
    const m = HIT_LINE.exec(raw);
    if (!m) continue;
    const path = m[1]!.replace(/\\/g, '/');
    let group = byPath.get(path);
    if (!group) {
      group = { path, hits: [] };
      byPath.set(path, group);
      groups.push(group);
    }
    group.hits.push({ line: Number(m[2]), text: (m[3] ?? '').replace(/​/g, '') });
  }
  return { groups, note };
}

type Load =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'failed'; message: string }
  | { state: 'ready'; result: FindResult };

export interface FilesFindProps {
  fetchImpl: typeof fetch;
  onOpen: (path: string, line: number, query: string) => void;
}

function Marked({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  /* Searched on the ORIGINAL string: lowercasing first can change its length (an uppercase dotted I). */
  const found = q === '' ? null : new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').exec(text);
  if (!found) return <>{text}</>;
  const at = found.index;
  return (
    <>
      {text.slice(0, at)}
      <mark className="files-find-mark">{text.slice(at, at + found[0].length)}</mark>
      {text.slice(at + found[0].length)}
    </>
  );
}

export function FilesFind({ fetchImpl, onOpen }: FilesFindProps) {
  const input = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('');
  const [load, setLoad] = useState<Load>({ state: 'idle' });
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);

  const focusField = useCallback(() => {
    input.current?.focus();
    input.current?.select();
    setOpen(true);
  }, []);

  /* Mod+Shift+F, and the chat header's icon. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.defaultPrevented && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        focusField();
      }
    };
    const onRequest = () => {
      clearPendingFocus();
      focusField();
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener(FOCUS_EVENT, onRequest);
    if (takePendingFocus()) onRequest();
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener(FOCUS_EVENT, onRequest);
    };
  }, [focusField]);

  /* The search, a beat after typing stops. */
  useEffect(() => {
    const q = query.trim();
    if (q === '') {
      setLoad({ state: 'idle' });
      return;
    }
    const controller = new AbortController();
    setLoad({ state: 'loading' });
    const timer = setTimeout(() => {
      void (async () => {
        let response: Response;
        let body: string;
        try {
          response = await fetchImpl(`/api/search?query=${encodeURIComponent(q)}`, { signal: controller.signal });
          body = await response.text();
        } catch (error) {
          if (controller.signal.aborted) return;
          setLoad({
            state: 'failed',
            message: `nothing answered on this origin: ${error instanceof Error ? error.message : String(error)}`,
          });
          return;
        }
        if (controller.signal.aborted) return;
        type Answer = { ok?: unknown; text?: unknown; evidence?: unknown; error?: unknown };
        let parsed = null as Answer | null;
        try {
          parsed = JSON.parse(body) as Answer | null;
        } catch {
          /* not JSON */
        }
        if (!response.ok || parsed === null || parsed.ok !== true) {
          const said =
            parsed && typeof parsed.error === 'string' && parsed.error !== ''
              ? parsed.error
              : parsed && typeof parsed.evidence === 'string' && parsed.evidence !== ''
                ? parsed.evidence
                : `the engine refused with HTTP ${response.status}`;
          setLoad({ state: 'failed', message: said });
          return;
        }
        const result = parseSearchText(typeof parsed.text === 'string' ? parsed.text : '');
        /* With no hits the engine's cap and skipped-folder note travels only in `evidence`. */
        if (result.groups.length === 0 && result.note === '' && typeof parsed.evidence === 'string') {
          const none = /no matches(.*)$/s.exec(parsed.evidence);
          if (none) result.note = (none[1] ?? '').trim();
        }
        setLoad({ state: 'ready', result });
        setActive(0);
      })();
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, fetchImpl]);

  const flat: { path: string; line: number }[] =
    load.state === 'ready' ? load.result.groups.flatMap((g) => g.hits.map((h) => ({ path: g.path, line: h.line }))) : [];

  const choose = (index: number) => {
    const hit = flat[index];
    if (!hit) return;
    setOpen(false);
    onOpen(hit.path, hit.line, query.trim());
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      if (flat.length) setActive((a) => (a + 1) % flat.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flat.length) setActive((a) => (a - 1 + flat.length) % flat.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (open) setOpen(false);
      else setQuery('');
    }
  };

  useEffect(() => {
    document.querySelector('[data-find-active="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [active, load]);

  let index = -1;
  const showPanel = open && load.state !== 'idle';
  return (
    <div className="files-findbar" data-testid="files-find-root">
      <label className="s2-field files-find-wrap">
        <S2Icon name="search" small />
        <input
          ref={input}
          className="files-find-field"
          type="search"
          value={query}
          placeholder="Find in project"
          aria-label="Find in project files"
          title="Find text in the project (Ctrl+Shift+F)"
          data-testid="files-find-project"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
      </label>
      {showPanel ? (
        <div className="files-find-panel" role="listbox" aria-label="Matches" data-testid="files-find-results">
          {load.state === 'loading' ? (
            <p className="files-find-note" role="status">
              Searching…
            </p>
          ) : load.state === 'failed' ? (
            <p className="files-find-note is-fail" role="alert" data-testid="files-find-error">
              Search failed: {load.message}
            </p>
          ) : load.state === 'ready' && load.result.groups.length === 0 ? (
            <p className="files-find-note" role="status" data-testid="files-find-empty">
              {`No matches for "${query.trim()}".`}
              {load.result.note ? ` ${load.result.note}` : ''}
            </p>
          ) : load.state === 'ready' ? (
            <>
              {load.result.groups.map((g) => (
                <div className="files-find-group" key={g.path} role="group" aria-label={g.path}>
                  <div className="files-find-file" title={g.path}>
                    {g.path}
                  </div>
                  {g.hits.map((h) => {
                    index += 1;
                    const i = index;
                    return (
                      <div
                        key={`${g.path}:${h.line}:${i}`}
                        role="option"
                        aria-selected={i === active}
                        data-find-active={i === active}
                        className={`files-find-hit${i === active ? ' is-active' : ''}`}
                        data-testid="files-find-hit"
                        data-path={g.path}
                        data-line={h.line}
                        onMouseEnter={() => setActive(i)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => choose(i)}
                      >
                        <span className="files-find-ln mono">{h.line}</span>
                        <span className="files-find-text mono">
                          <Marked text={h.text.trim()} query={query} />
                        </span>
                      </div>
                    );
                  })}
                </div>
              ))}
              {load.result.note ? (
                <p className="files-find-note" data-testid="files-find-cap">
                  {load.result.note}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
