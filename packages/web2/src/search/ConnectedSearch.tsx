import { useCallback, useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import { isSameOriginPath, type WireResult } from '../boot';
import { useStoreIfAny } from '../state/connect';

/* ══════════════════════════════════════════════════════════════════════════
   SEARCHING THE REPOSITORY — the route nobody could reach
   packages/web2/src/search/ConnectedSearch.tsx

   `GET /api/search` is correct, security-gated, and was fetched by NOTHING
   until this surface was written: a person can reach the repo-wide search
   WITHOUT spending an assistant turn.

   ── IT RENDERS ROWS, NOT THE AGENT'S TEXT ────────────────────────────────

   The route answers `{ ok, text, evidence, hits, stoppedAt, partial }`. `text`
   is the search tool's output for the ASSISTANT (prompt-safety framing, fences,
   a sentence about read_file) and is never shown to a person. `hits` are the
   same matches as rows (path, line, snippet), built from the search itself.
   Each row opens that file at that line in Files.

   ── EMPTY, NO MATCH AND REFUSED ARE THREE DIFFERENT THINGS ──────────────

   The activity lane's rule, applied here: "the engine has not answered" is not
   "the engine answered with nothing", and neither is "the engine refused". A
   surface that draws one blank for all three tells the reader nothing about
   which of the three happened.
   ══════════════════════════════════════════════════════════════════════════ */

export const SEARCH_ROUTE = '/api/search';

export interface SearchHit {
  path: string;
  /** Null for a file-name (glob) match, which has no line. */
  line: number | null;
  snippet: string;
}

export interface SearchAnswer {
  ok: boolean;
  /** The assistant-facing text. Kept on the wire for other callers; never drawn here. */
  text?: string;
  evidence?: string;
  hits?: SearchHit[];
  /** The result cap, when it cut the list. */
  stoppedAt?: number | null;
  /** The walk ended at a file bound, so "no matches" is about the search, not the project. */
  partial?: boolean;
}

/** Identity is a testid; state is a named `data-*`. The package's contract. */
export const SEARCH = {
  root: 'search',
  query: 'search-query',
  glob: 'search-glob',
  submit: 'search-submit',
  /** The engine has not been asked yet. */
  idle: 'search-idle',
  running: 'search-running',
  /** The engine answered with matches: a list of rows. */
  result: 'search-result',
  hit: 'search-hit',
  /** The count line: `3 matches` or `No matches`. */
  evidence: 'search-evidence',
  /** `Stopped after 20 matches`, only when the cap cut the list. */
  stopped: 'search-stopped',
  /** It refused, or nothing answered — in its own words. */
  failure: 'search-failure',
} as const;

async function ask(
  fetchImpl: typeof fetch,
  query: string,
  glob: string,
  signal?: AbortSignal,
): Promise<WireResult<SearchAnswer>> {
  const params = new URLSearchParams();
  if (query.trim() !== '') params.set('query', query.trim());
  if (glob.trim() !== '') params.set('glob', glob.trim());
  const path = `${SEARCH_ROUTE}?${params.toString()}`;

  /* Same-origin is enforced, not documented — the boot lane's own predicate,
     which already knows `//host/x` and `/\host/x` are absolute at run time. */
  if (!isSameOriginPath(SEARCH_ROUTE)) {
    throw new Error('search may only request same-origin paths');
  }

  let response: Response;
  try {
    response = await fetchImpl(path, { method: 'GET', signal });
  } catch (error) {
    return { outcome: 'unreachable', message: (error as Error).message };
  }

  const status = response.status;
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    return { outcome: 'unreachable', message: (error as Error).message };
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    /* JSON is decided by PARSING, not by a content-type header: a static host
       answers every unknown path with index.html and a 200. */
    return { outcome: 'not-json', status };
  }
  return response.ok
    ? { outcome: 'ok', status, body: body as SearchAnswer }
    : { outcome: 'error', status, body };
}

/** The engine's refusal sentence, or an honest account of the transport. */
function said(result: WireResult<unknown>): string {
  switch (result.outcome) {
    case 'ok':
      return '';
    case 'error': {
      const body = result.body as { error?: unknown } | null;
      return typeof body?.error === 'string'
        ? body.error
        : `the engine refused with HTTP ${result.status}`;
    }
    case 'not-json':
      return `this origin answered HTTP ${result.status} with something that is not JSON`;
    case 'unreachable':
      return `nothing answered on this origin — ${result.message}`;
  }
}

export function ConnectedSearch({ fetchImpl }: { fetchImpl?: typeof fetch } = {}) {
  const store = useStoreIfAny();
  const [query, setQuery] = useState('');
  const [glob, setGlob] = useState('');
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  /* Whether the engine has been asked AT ALL. Distinct from "answered with
     nothing", which is a measurement. */
  const [asked, setAsked] = useState(false);
  /* The row the arrow keys are on, and whether they have been used since the last edit or search:
     Enter submits the form until a row has been chosen with the arrows. */
  const [active, setActive] = useState(0);
  const [navigated, setNavigated] = useState(false);

  const hits = useMemo(() => answer?.hits ?? [], [answer]);
  const groups = useMemo(() => {
    const out: { path: string; rows: { hit: SearchHit; index: number }[] }[] = [];
    hits.forEach((hit, index) => {
      const last = out[out.length - 1];
      if (last && last.path === hit.path) last.rows.push({ hit, index });
      else out.push({ path: hit.path, rows: [{ hit, index }] });
    });
    return out;
  }, [hits]);

  const run = useCallback(() => {
    /*
     * `query || glob` IS THE ROUTE'S CONTRACT, and it refuses with 400 when
     * neither is present rather than serving the whole repository to a caller
     * that lost its argument. Refusing here as well means the reader is not
     * sent to the engine to be told what the form already knows.
     */
    if (query.trim() === '' && glob.trim() === '') return;
    setRunning(true);
    setFailure(null);
    setNavigated(false);
    void (async () => {
      const result = await ask(fetchImpl ?? globalThis.fetch, query, glob);
      setRunning(false);
      setAsked(true);
      if (result.outcome === 'ok') {
        setAnswer(result.body);
        setActive(0);
        return;
      }
      setAnswer(null);
      setFailure(said(result));
    })();
  }, [fetchImpl, query, glob]);

  /* A row opens its file at its line in Files, and the overlay steps aside. */
  const open = useCallback(
    (hit: SearchHit) => {
      if (!store) return;
      store.dispatch({
        type: 'files/open',
        path: hit.path,
        ...(hit.line ? { line: hit.line } : {}),
      });
      store.dispatch({ type: 'shell/overlay', overlay: null });
    },
    [store],
  );

  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (hits.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setNavigated(true);
      /* The first arrow lands on the first row; later ones move. */
      setActive((a) => (navigated ? (a + 1) % hits.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setNavigated(true);
      setActive((a) => (navigated ? (a - 1 + hits.length) % hits.length : hits.length - 1));
    } else if (event.key === 'Enter' && navigated) {
      event.preventDefault();
      const hit = hits[active];
      if (hit) open(hit);
    }
  };

  useEffect(() => {
    document.querySelector('[data-search-active="true"]')?.scrollIntoView?.({ block: 'nearest' });
  }, [active, answer]);

  const cap = answer?.stoppedAt ?? null;

  return (
    <section
      className="se-scope se-panel"
      data-testid={SEARCH.root}
      role="dialog"
      aria-label="Search this project"
    >
      <header className="se-head">
        <h2 className="se-title">Search</h2>
      </header>

      <form
        className="se-form"
        onSubmit={(event) => {
          event.preventDefault();
          run();
        }}
      >
        <input
          className="se-input"
          data-testid={SEARCH.query}
          value={query}
          autoFocus
          placeholder="text to find"
          aria-label="Text to find"
          onChange={(event) => {
            setQuery(event.target.value);
            setNavigated(false);
          }}
          onKeyDown={onKeyDown}
        />
        <input
          className="se-input se-glob mono"
          data-testid={SEARCH.glob}
          value={glob}
          placeholder="**/*.ts"
          aria-label="Only these files"
          onChange={(event) => {
            setGlob(event.target.value);
            setNavigated(false);
          }}
          onKeyDown={onKeyDown}
        />
        <button
          type="submit"
          className="se-btn"
          data-testid={SEARCH.submit}
          /* The route's own contract: neither a query nor a glob is refused,
             never answered with everything. */
          disabled={running || (query.trim() === '' && glob.trim() === '')}
        >
          {running ? 'Searching…' : 'Search'}
        </button>
      </form>

      {running ? (
        <p className="se-note" data-testid={SEARCH.running}>
          Searching.
        </p>
      ) : null}

      {!asked && !running ? (
        <p className="se-note" data-testid={SEARCH.idle}>
          Searches the files in this project. Nothing leaves your computer.
        </p>
      ) : null}

      {failure !== null ? (
        <p className="se-note se-note-fail" data-testid={SEARCH.failure}>
          {failure}
        </p>
      ) : null}

      {answer !== null ? (
        <div className="se-answer">
          <p className="se-evidence" data-testid={SEARCH.evidence}>
            {hits.length === 0 ? 'No matches' : `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}`}
            {hits.length === 0 && answer.partial
              ? '. The search stopped before the end of this project; the second box narrows it to some files.'
              : ''}
          </p>
          {hits.length > 0 ? (
            <div className="se-list" role="listbox" aria-label="Matches" data-testid={SEARCH.result}>
              {groups.map((group) => (
                <div className="se-group" key={group.path} role="group" aria-label={group.path}>
                  <div className="se-file" title={group.path}>
                    {group.path}
                  </div>
                  {group.rows.map(({ hit, index }) => (
                    <div
                      key={`${hit.path}:${hit.line ?? 0}:${index}`}
                      role="option"
                      aria-selected={index === active}
                      data-search-active={index === active}
                      className={`se-hit${index === active ? ' is-active' : ''}`}
                      data-testid={SEARCH.hit}
                      data-path={hit.path}
                      {...(hit.line ? { 'data-line': hit.line } : {})}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => open(hit)}
                    >
                      <span className="se-ln mono">{hit.line ?? ''}</span>
                      <span className="se-snippet mono">{hit.snippet}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
          {cap !== null ? (
            <p className="se-cap" data-testid={SEARCH.stopped}>
              {`Stopped after ${cap} matches`}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
