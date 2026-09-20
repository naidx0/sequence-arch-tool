import { useCallback, useState } from 'react';

import { isSameOriginPath, type WireResult } from '../boot';

/* ══════════════════════════════════════════════════════════════════════════
   SEARCHING THE REPOSITORY — the route nobody could reach
   packages/web2/src/search/ConnectedSearch.tsx

   `GET /api/search` is correct, security-gated, and was fetched by NOTHING.
   Its own handler says why it exists — so a person can reach `executeSearchFiles`
   WITHOUT spending an assistant turn — and the results surface it was built for
   was never written. An independent classification of the whole API put it
   first among twenty-one routes serving surfaces that do not exist, on the
   grounds that repo-wide search is a basic, key-free navigation need.

   ── IT RENDERS THE ENGINE'S OWN TEXT, AND DOES NOT PARSE IT ──────────────

   The route answers `{ ok, text, evidence }`, and the `text` is the search
   tool's own output verbatim — the handler's comment is explicit that it
   already carries the match count, the capped snippets and the sentence it uses
   when there are none, and that "rewriting any of that here would be a second
   voice for one answer". The same reasoning stops one more level out: this
   surface displays it and never re-derives its meaning. `usability-standard`
   and the repo server agree — a surface renders the server's sentence.

   ── EMPTY, NO MATCH AND REFUSED ARE THREE DIFFERENT THINGS ──────────────

   The activity lane's rule, applied here: "the engine has not answered" is not
   "the engine answered with nothing", and neither is "the engine refused". A
   surface that draws one blank for all three tells the reader nothing about
   which of the three happened.
   ══════════════════════════════════════════════════════════════════════════ */

export const SEARCH_ROUTE = '/api/search';

export interface SearchAnswer {
  ok: boolean;
  /** The engine's own text. Never parsed, never rewritten. */
  text: string;
  /** Its one-line account of what it did — `search "x" — 3 matches`. */
  evidence: string;
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
  /** The engine answered. Its text, verbatim. */
  result: 'search-result',
  evidence: 'search-evidence',
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
  const [query, setQuery] = useState('');
  const [glob, setGlob] = useState('');
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  /* Whether the engine has been asked AT ALL. Distinct from "answered with
     nothing", which is a measurement. */
  const [asked, setAsked] = useState(false);

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
    void (async () => {
      const result = await ask(fetchImpl ?? globalThis.fetch, query, glob);
      setRunning(false);
      setAsked(true);
      if (result.outcome === 'ok') {
        setAnswer(result.body);
        return;
      }
      setAnswer(null);
      setFailure(said(result));
    })();
  }, [fetchImpl, query, glob]);

  return (
    <section
      className="se-scope se-panel"
      data-testid={SEARCH.root}
      role="dialog"
      aria-label="Search this repository"
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
          onChange={(event) => setQuery(event.target.value)}
        />
        <input
          className="se-input se-glob mono"
          data-testid={SEARCH.glob}
          value={glob}
          placeholder="**/*.ts"
          onChange={(event) => setGlob(event.target.value)}
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
          Asking the engine.
        </p>
      ) : null}

      {!asked && !running ? (
        <p className="se-note" data-testid={SEARCH.idle}>
          Text, a glob, or both. This reads the attached repository through the same jail the file
          route uses — it cannot see outside it, and it costs no model call.
        </p>
      ) : null}

      {failure !== null ? (
        <p className="se-note se-note-fail" data-testid={SEARCH.failure}>
          {failure}
        </p>
      ) : null}

      {answer !== null ? (
        <div className="se-answer">
          {/* THE ENGINE'S ACCOUNT OF WHAT IT DID, first and unedited. */}
          <p className="se-evidence mono" data-testid={SEARCH.evidence}>
            {answer.evidence}
          </p>
          {/* AND ITS TEXT, VERBATIM. A search that found nothing has an empty
              `text` and an evidence line that says so; rendering a second
              "no results" sentence here would be this surface answering a
              question the engine already answered.

              If prompt-safety delimiters appear here, the route has exposed
              agent-tool framing as presentation text. The server must return a
              user-facing field; stripping delimiters here would make the client
              reinterpret an engine-owned answer. */}
          {answer.text !== '' ? (
            <pre className="se-text mono" data-testid={SEARCH.result}>
              {answer.text}
            </pre>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
