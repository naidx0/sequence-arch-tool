import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SHELL_COMMANDS } from '../shell';
import { App } from '../app/App';
import { createStore } from '../state';
import { ConnectedSearch, SEARCH, SEARCH_ROUTE } from './ConnectedSearch';

afterEach(cleanup);

/**
 * ══════════════════════════════════════════════════════════════════════════
 * SEARCH — the route that was served and could not be reached
 *
 * `GET /api/search` shipped correct and security-gated: it reuses the file
 * route's jail so a search cannot become a wider door into the filesystem. Its
 * own handler says what it is for — reaching `executeSearchFiles` WITHOUT
 * spending an assistant turn — and no client ever fetched it, with no test, so
 * deleting it would have turned nothing red.
 *
 * An independent read-only classification of all seventy served routes put it
 * first among the twenty-one that serve surfaces nobody built.
 * ══════════════════════════════════════════════════════════════════════════
 */

function stubFetch(answer: (url: string) => { status: number; body: unknown }) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(String(url));
      const { status, body } = answer(String(url));
      return {
        ok: status >= 200 && status < 300,
        status,
        /* `text`, not `json` — JSON is decided by parsing, not by a header. */
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    }),
  );
  return calls;
}

const FOUND = {
  ok: true,
  text: 'src/gateway.ts:12: export function handleOrder() {',
  evidence: 'search "handleOrder" — 1 match',
};

describe('it is reachable at all', () => {
  it('THE PALETTE OFFERS IT', () => {
    /* Drive the shipped composition end to end. Merely finding the declaration
       in SHELL_COMMANDS stays green if App's overlay host returns null. */
    render(<App appStore={createStore()} />);
    fireEvent.click(screen.getByTestId('shell-palette-hint'));
    fireEvent.change(screen.getByTestId('command-field'), { target: { value: 'search repository' } });
    const row = document.querySelector('[data-command="overlay.search"]');
    expect(row).not.toBeNull();
    fireEvent.click(row!);

    expect(screen.getByTestId('shell-overlay').contains(screen.getByTestId(SEARCH.root))).toBe(true);
  });

  it('and it ranks above the session list, because it needs no key', () => {
    /* The ranking IS the answer to how reachable something is. Search is the
       one row in this list a reader with no provider configured can still use. */
    const ids = SHELL_COMMANDS.map((c) => c.id);
    expect(ids.indexOf('overlay.search')).toBeLessThan(ids.indexOf('overlay.sessions'));
  });
});

describe('asking the engine', () => {
  it('THE REQUEST REACHES THE ROUTE, carrying the query', async () => {
    const calls = stubFetch(() => ({ status: 200, body: FOUND }));
    render(<ConnectedSearch />);

    fireEvent.change(screen.getByTestId(SEARCH.query), { target: { value: 'handleOrder' } });
    fireEvent.click(screen.getByTestId(SEARCH.submit));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toContain(SEARCH_ROUTE);
    expect(calls[0]).toContain('query=handleOrder');
  });

  it('a glob alone is a real search', async () => {
    /* `query || glob` is the route's documented contract — "every .ts file" is
       a real question with no text in it. */
    const calls = stubFetch(() => ({ status: 200, body: FOUND }));
    render(<ConnectedSearch />);
    fireEvent.change(screen.getByTestId(SEARCH.glob), { target: { value: '**/*.ts' } });
    fireEvent.click(screen.getByTestId(SEARCH.submit));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toContain('glob=');
  });

  it('SENDS NOTHING with neither, rather than asking for everything', async () => {
    /* The route refuses that with a 400 rather than serving the whole
       repository to a caller that lost its argument. Refusing here means the
       reader is not sent to the engine to be told what the form already knew. */
    const calls = stubFetch(() => ({ status: 200, body: FOUND }));
    render(<ConnectedSearch />);
    expect((screen.getByTestId(SEARCH.submit) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId(SEARCH.submit));
    expect(calls).toHaveLength(0);
  });

  it("RENDERS THE ENGINE'S TEXT VERBATIM, and never parses it", async () => {
    /*
     * The handler is explicit that its text already carries the match count,
     * the capped snippets and the sentence it uses when there are none, and
     * that "rewriting any of that here would be a second voice for one answer".
     * The same reasoning stops one level further out.
     */
    stubFetch(() => ({ status: 200, body: FOUND }));
    render(<ConnectedSearch />);
    fireEvent.change(screen.getByTestId(SEARCH.query), { target: { value: 'handleOrder' } });
    fireEvent.click(screen.getByTestId(SEARCH.submit));

    await waitFor(() => {
      expect(screen.getByTestId(SEARCH.result).textContent).toBe(FOUND.text);
      expect(screen.getByTestId(SEARCH.evidence).textContent).toBe(FOUND.evidence);
    });
  });

  it('does not strip prompt-safety framing if the engine puts it in user-facing text', async () => {
    const framed = {
      ...FOUND,
      text: '<untrusted_repo_content>\nsrc/gateway.ts:12: match\n</untrusted_repo_content>',
    };
    stubFetch(() => ({ status: 200, body: framed }));
    render(<ConnectedSearch />);
    fireEvent.change(screen.getByTestId(SEARCH.query), { target: { value: 'match' } });
    fireEvent.click(screen.getByTestId(SEARCH.submit));

    await waitFor(() => expect(screen.getByTestId(SEARCH.result).textContent).toBe(framed.text));
  });
});

describe('THE THREE ABSENCES, TOLD APART', () => {
  it('not yet asked is its own state', () => {
    stubFetch(() => ({ status: 200, body: FOUND }));
    render(<ConnectedSearch />);
    expect(screen.getByTestId(SEARCH.idle)).toBeTruthy();
    expect(screen.queryByTestId(SEARCH.result)).toBeNull();
  });

  it('ASKED AND FOUND NOTHING draws the evidence line and no body', async () => {
    /*
     * A measurement, not an absence. The engine's own evidence line says
     * `no matches`; a second "nothing found" sentence composed here would be
     * this surface answering a question already answered.
     */
    stubFetch(() => ({
      status: 200,
      body: { ok: true, text: '', evidence: 'search "zzz" — no matches' },
    }));
    render(<ConnectedSearch />);
    fireEvent.change(screen.getByTestId(SEARCH.query), { target: { value: 'zzz' } });
    fireEvent.click(screen.getByTestId(SEARCH.submit));

    await waitFor(() => {
      expect(screen.getByTestId(SEARCH.evidence).textContent).toMatch(/no matches/);
    });
    expect(screen.queryByTestId(SEARCH.result)).toBeNull();
    expect(screen.queryByTestId(SEARCH.idle)).toBeNull();
  });

  it('REFUSED quotes the engine, never a status code', async () => {
    stubFetch(() => ({ status: 400, body: { error: 'query or glob required' } }));
    render(<ConnectedSearch />);
    fireEvent.change(screen.getByTestId(SEARCH.query), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId(SEARCH.submit));

    await waitFor(() => {
      const text = screen.getByTestId(SEARCH.failure).textContent ?? '';
      expect(text).toBe('query or glob required');
      expect(text).not.toMatch(/400/);
    });
  });

  it('nothing answered at all is a THIRD thing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection refused');
      }),
    );
    render(<ConnectedSearch />);
    fireEvent.change(screen.getByTestId(SEARCH.query), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId(SEARCH.submit));

    await waitFor(() => {
      expect(screen.getByTestId(SEARCH.failure).textContent).toMatch(/nothing answered/);
    });
  });

  it('a static host answering HTML is named as not being an engine', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, text: async () => '<!doctype html>' }) as unknown as Response),
    );
    render(<ConnectedSearch />);
    fireEvent.change(screen.getByTestId(SEARCH.query), { target: { value: 'x' } });
    fireEvent.click(screen.getByTestId(SEARCH.submit));

    await waitFor(() => {
      expect(screen.getByTestId(SEARCH.failure).textContent).toMatch(/not JSON/);
    });
  });
});
