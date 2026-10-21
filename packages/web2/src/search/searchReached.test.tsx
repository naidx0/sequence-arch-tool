import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SHELL_COMMANDS } from '../shell';
import { filterCommands } from '../shell/shellModel';
import { App } from '../app/App';
import { createStore } from '../state';
import { StoreProvider } from '../state/connect';
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

/* The assistant-facing text carries prompt-safety framing; a person must never see it. */
const AGENT_TEXT =
  '<untrusted_repo_content>\n### search results for "handleOrder" (2) (stopped after 20 matches - there may be more; read_file still opens them)\n```\n' +
  'src/gateway.ts:12: export function handleOrder() {\n```\n</untrusted_repo_content>';
const FOUND = {
  ok: true,
  text: AGENT_TEXT,
  evidence: 'search "handleOrder" — 2 matches',
  hits: [
    { path: 'src/gateway.ts', line: 12, snippet: 'export function handleOrder() {' },
    { path: 'src/orders.ts', line: 3, snippet: 'handleOrder(req);' },
  ],
  stoppedAt: null,
  partial: false,
};

describe('it is reachable at all', () => {
  it('THE PALETTE OFFERS IT', async () => {
    /* Drive the shipped composition end to end. Merely finding the declaration
       in SHELL_COMMANDS stays green if App's overlay host returns null. */
    render(<App appStore={createStore()} />);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.change(screen.getByTestId('command-field'), { target: { value: 'search repository' } });
    const row = document.querySelector('[data-command="overlay.search"]');
    expect(row).not.toBeNull();
    fireEvent.click(row!);

    /* The overlay loads when it opens (perf ratchet): its body arrives a tick later. */
    /* The overlay's chunk is awaited, not raced: a loaded suite can take longer than findBy's default. */
    await act(async () => {
      await import('../search/ConnectedSearch');
    });
    expect(screen.getByTestId('v3-overlay-search').contains(await screen.findByTestId(SEARCH.root))).toBe(true);
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

  it('RENDERS THE HITS AS ROWS, and never the assistant-facing text', async () => {
    /*
     * `text` is the search tool's output for the ASSISTANT: prompt-safety tags,
     * a heading, code fences and a sentence about read_file. A person was shown
     * it verbatim (the sweep's blocker). The route now also returns `hits`, and
     * those are all the overlay draws.
     */
    stubFetch(() => ({ status: 200, body: FOUND }));
    render(<ConnectedSearch />);
    fireEvent.change(screen.getByTestId(SEARCH.query), { target: { value: 'handleOrder' } });
    fireEvent.click(screen.getByTestId(SEARCH.submit));

    await waitFor(() => expect(screen.getAllByTestId(SEARCH.hit)).toHaveLength(2));
    const rows = screen.getAllByTestId(SEARCH.hit);
    expect(rows[0]!.getAttribute('data-path')).toBe('src/gateway.ts');
    expect(rows[0]!.getAttribute('data-line')).toBe('12');
    expect(rows[0]!.textContent).toContain('export function handleOrder() {');
    expect(screen.getByTestId(SEARCH.evidence).textContent).toBe('2 matches');

    const shown = screen.getByTestId(SEARCH.root).textContent ?? '';
    expect(shown).not.toMatch(/untrusted_repo_content/);
    expect(shown).not.toMatch(/### search results/);
    expect(shown).not.toMatch(/```/);
    expect(shown).not.toMatch(/read_file/);
    /* a negative control: the old surface did draw that text, so the assertion above can fail */
    expect(AGENT_TEXT).toMatch(/untrusted_repo_content/);
  });

  it('says plainly when the result cap cut the list', async () => {
    stubFetch(() => ({ status: 200, body: { ...FOUND, stoppedAt: 20 } }));
    render(<ConnectedSearch />);
    fireEvent.change(screen.getByTestId(SEARCH.query), { target: { value: 'handleOrder' } });
    fireEvent.click(screen.getByTestId(SEARCH.submit));
    await waitFor(() => expect(screen.getByTestId(SEARCH.stopped).textContent).toBe('Stopped after 20 matches'));
  });

  it('draws no cap note when nothing was cut', async () => {
    stubFetch(() => ({ status: 200, body: FOUND }));
    render(<ConnectedSearch />);
    fireEvent.change(screen.getByTestId(SEARCH.query), { target: { value: 'handleOrder' } });
    fireEvent.click(screen.getByTestId(SEARCH.submit));
    await waitFor(() => expect(screen.getAllByTestId(SEARCH.hit)).toHaveLength(2));
    expect(screen.queryByTestId(SEARCH.stopped)).toBeNull();
  });
});

describe('a row opens the file at its line', () => {
  async function searched() {
    stubFetch(() => ({ status: 200, body: FOUND }));
    const store = createStore();
    store.dispatch({ type: 'shell/overlay', overlay: { kind: 'search' } });
    render(
      <StoreProvider store={store}>
        <ConnectedSearch />
      </StoreProvider>,
    );
    fireEvent.change(screen.getByTestId(SEARCH.query), { target: { value: 'handleOrder' } });
    fireEvent.click(screen.getByTestId(SEARCH.submit));
    await waitFor(() => expect(screen.getAllByTestId(SEARCH.hit)).toHaveLength(2));
    return store;
  }

  it('CLICKING A ROW dispatches files/open with the path and line, and closes the overlay', async () => {
    const store = await searched();
    fireEvent.click(screen.getAllByTestId(SEARCH.hit)[1]!);
    const focus = store.getState().session.filesFocus;
    expect(focus?.path).toBe('src/orders.ts');
    expect(focus?.line).toBe(3);
    expect(store.getState().shell.overlay).toBeNull();
  });

  it('ARROWS MOVE AND ENTER OPENS, and Enter still searches until an arrow has been used', async () => {
    const store = await searched();
    const field = screen.getByTestId(SEARCH.query);
    /* Enter before any arrow is a form submit, not an open. */
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(store.getState().session.filesFocus).toBeNull();

    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(screen.getAllByTestId(SEARCH.hit)[0]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    expect(screen.getAllByTestId(SEARCH.hit)[1]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(field, { key: 'ArrowUp' });
    expect(screen.getAllByTestId(SEARCH.hit)[0]!.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    fireEvent.keyDown(field, { key: 'Enter' });
    const focus = store.getState().session.filesFocus;
    expect(focus?.path).toBe('src/orders.ts');
    expect(focus?.line).toBe(3);
  });
});

describe('the words on it are plain', () => {
  it('the idle line is plain and has no jargon or em dash', () => {
    stubFetch(() => ({ status: 200, body: FOUND }));
    render(<ConnectedSearch />);
    const text = screen.getByTestId(SEARCH.idle).textContent ?? '';
    expect(text).toBe('Searches the files in this project. Nothing leaves your computer.');
    expect(text).not.toMatch(/jail|model call|route|â€”/i);
  });
});

describe('THE THREE ABSENCES, TOLD APART', () => {
  it('not yet asked is its own state', () => {
    stubFetch(() => ({ status: 200, body: FOUND }));
    render(<ConnectedSearch />);
    expect(screen.getByTestId(SEARCH.idle)).toBeTruthy();
    expect(screen.queryByTestId(SEARCH.result)).toBeNull();
  });

  it('ASKED AND FOUND NOTHING says "No matches" and draws no rows', async () => {
    /* A measurement, not an absence: asked, answered, and empty. */
    stubFetch(() => ({
      status: 200,
      body: { ok: true, text: '', evidence: 'search "zzz" - no matches', hits: [], stoppedAt: null, partial: false },
    }));
    render(<ConnectedSearch />);
    fireEvent.change(screen.getByTestId(SEARCH.query), { target: { value: 'zzz' } });
    fireEvent.click(screen.getByTestId(SEARCH.submit));

    await waitFor(() => {
      expect(screen.getByTestId(SEARCH.evidence).textContent).toBe('No matches');
    });
    expect(screen.queryByTestId(SEARCH.result)).toBeNull();
    expect(screen.queryByTestId(SEARCH.idle)).toBeNull();
  });

  it('NO MATCHES FROM A PARTIAL WALK says the search stopped early', async () => {
    stubFetch(() => ({
      status: 200,
      body: { ok: true, text: '', evidence: '', hits: [], stoppedAt: null, partial: true },
    }));
    render(<ConnectedSearch />);
    fireEvent.change(screen.getByTestId(SEARCH.query), { target: { value: 'zzz' } });
    fireEvent.click(screen.getByTestId(SEARCH.submit));
    await waitFor(() => {
      expect(screen.getByTestId(SEARCH.evidence).textContent).toMatch(/stopped before the end/);
    });
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

describe('the palette finds the workflows overlay by the word "activity"', () => {
  it('"activity" matches overlay.activity, and a word nothing carries still finds nothing', () => {
    const ids = (q: string) => filterCommands(q).map((c) => c.id);
    expect(ids('activity')).toContain('overlay.activity');
    /* the negative control: the filter is real, it does not return everything */
    expect(ids('qqqzzz')).toHaveLength(0);
  });
});
