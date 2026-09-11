import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AttachDialog } from './AttachDialog';
import { BootSurface } from './BootSurface';
import { createBootTransport, isSameOriginPath } from './bootClient';

/**
 * ITEM 2.4's LOCK, IN THE WORDS IT WAS GIVEN IN:
 *
 *   "boot with the server unreachable and assert the app still renders its
 *    shell and says so plainly; assert zero network requests to any
 *    third-party host."
 *
 * Both halves are here, and the first one is the one with teeth. Local-first is
 * a non-negotiable in CLAUDE.md — "the app boots and delivers its core with no
 * network and no key" — and the failure mode it forbids is not a crash. It is
 * an app that renders a spinner forever, or a red wall, or worse: a plausible
 * board with nothing behind it. So the assertions are (a) something rendered,
 * (b) it says in words that the engine is not running, and (c) it does NOT
 * claim a graph.
 *
 * A NOTE ON "THE SHELL". `app/Shell.tsx` is item 2.3's file and is not this
 * lane's to import — a test that reached for it would go red for another lane's
 * reason and, worse, would go GREEN for another lane's reason too. What this
 * lane owns is the surface the shell hosts, so what is asserted here is that
 * the boot surface always renders its own frame and never returns nothing.
 * When 2.3 lands, the same three assertions should be re-run through <Shell/>;
 * that is recorded in the handback rather than faked here with a stand-in shell
 * written by the lane being tested.
 */

/* -------------------------------------------------------------------------- *
 * A fetch that records every URL it is handed, and answers nothing.
 * -------------------------------------------------------------------------- */

interface Recorder {
  urls: string[];
  fetch: typeof fetch;
}

/** The dead-server case: every request rejects the way a browser rejects when
 *  nothing is listening on the origin. */
function deadServer(): Recorder {
  const urls: string[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL) => {
    urls.push(String(input));
    throw new TypeError('Failed to fetch');
  });
  return { urls, fetch: impl as unknown as typeof fetch };
}

/** A server that answers each route from a table keyed by path. */
function server(table: Record<string, { status: number; body: unknown }>): Recorder {
  const urls: string[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const path = url.split('?')[0];
    const hit = table[path];
    if (!hit) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    return new Response(JSON.stringify(hit.body), {
      status: hit.status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { urls, fetch: impl as unknown as typeof fetch };
}

const GRAPH = {
  version: 1,
  scannedAt: '2026-08-20T10:00:00.000Z',
  repoRoot: '/home/max/projects/shopfront',
  repoName: 'shopfront',
  nodes: [{ id: 'svc:web', kind: 'service', label: 'Web' }],
  edges: [],
  warnings: [],
  nodeDetail: {},
};

/* -------------------------------------------------------------------------- *
 * The lock
 * -------------------------------------------------------------------------- */

describe('item 2.4 — boot with the server unreachable', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('still renders, and says plainly that the engine is not running', async () => {
    const net = deadServer();
    render(<BootSurface transport={createBootTransport(net.fetch)} />);

    // Something is on screen on the first frame — before any answer, and
    // therefore also on a machine where no answer ever comes.
    expect(screen.getByTestId('boot-surface')).toBeTruthy();

    await waitFor(() => expect(screen.getByTestId('boot-state').textContent).toBe('no-engine'));

    const said = screen.getByTestId('boot-message').textContent ?? '';
    expect(said.length).toBeGreaterThan(0);
    // In words a person can act on, naming the thing that is not running.
    expect(said.toLowerCase()).toContain('engine');
    expect(said.toLowerCase()).toContain('not running');
  });

  it('claims no repo, no graph and no counts when nothing answered', async () => {
    const net = deadServer();
    render(<BootSurface transport={createBootTransport(net.fetch)} />);

    await waitFor(() => expect(screen.getByTestId('boot-state').textContent).toBe('no-engine'));

    // The fabrication this lane must never commit. `null` is the honest value
    // and the DOM is where it has to be visible: a graph summary rendered as
    // "0 nodes" would be a measurement nobody took.
    expect(screen.queryByTestId('boot-repo-name')).toBeNull();
    expect(screen.queryByTestId('boot-summary')).toBeNull();
  });

  it('does not render an error wall for a server that is simply not there', async () => {
    const net = deadServer();
    render(<BootSurface transport={createBootTransport(net.fetch)} />);

    await waitFor(() => expect(screen.getByTestId('boot-state').textContent).toBe('no-engine'));

    // Tone is a product decision here, not a style one: an engine that is not
    // running is the local-first case working as designed, and the hue budget
    // says a hue is a claim about the world. `data-tone` is what the stylesheet
    // keys off, so asserting it is asserting the paint.
    expect(screen.getByTestId('boot-surface').getAttribute('data-tone')).toBe('plain');
  });

  it('offers the one thing to do about it', async () => {
    const net = deadServer();
    render(<BootSurface transport={createBootTransport(net.fetch)} />);

    await waitFor(() => expect(screen.getByTestId('boot-state').textContent).toBe('no-engine'));

    // Sheet 08.5: what is not here, why it is not here, and ONE THING TO DO.
    expect(screen.getByTestId('boot-action')).toBeTruthy();
  });

  it('paints a statically served graph and still says the engine is down', async () => {
    const net = server({ '/archgraph.json': { status: 200, body: GRAPH } });
    // /api/status is absent from the table above, so it answers 404 with a JSON
    // error — a static host with no platform behind it.
    render(<BootSurface transport={createBootTransport(net.fetch)} />);

    await waitFor(() => expect(screen.getByTestId('boot-state').textContent).toBe('static-graph'));

    expect(screen.getByTestId('boot-repo-name').textContent).toBe('shopfront');
    expect((screen.getByTestId('boot-message').textContent ?? '').toLowerCase()).toContain(
      'not running',
    );
  });
});

describe('item 2.4 — zero requests to any third-party host', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('asks for relative, same-origin paths and nothing else', async () => {
    const net = deadServer();
    render(<BootSurface transport={createBootTransport(net.fetch)} />);

    await waitFor(() => expect(screen.getByTestId('boot-state').textContent).toBe('no-engine'));

    expect(net.urls.length).toBeGreaterThan(0);
    for (const url of net.urls) {
      // A leading single slash and no scheme is the entire mechanism: the
      // browser can only resolve it against the page's own origin, so there is
      // no host for a third party to be. Protocol-relative `//host/…` is the
      // classic way past a check that only looks for `https://`, so it is
      // rejected explicitly.
      expect(url.startsWith('/'), url).toBe(true);
      expect(url.startsWith('//'), url).toBe(false);
      expect(url, url).not.toMatch(/^[a-z][a-z0-9+.-]*:/i);
    }
  });

  it('refuses to build a request at an absolute URL at all', () => {
    // The guard is in the transport rather than in a review comment, because
    // the way a CDN or a telemetry host gets into a client is one convenient
    // absolute URL added months later by someone who never read this file.
    expect(isSameOriginPath('/api/status')).toBe(true);
    expect(isSameOriginPath('/archgraph.json')).toBe(true);
    expect(isSameOriginPath('//evil.example.com/api/status')).toBe(false);
    expect(isSameOriginPath('https://evil.example.com/api/status')).toBe(false);
    expect(isSameOriginPath('http://127.0.0.1:4173/api/status')).toBe(false);
    expect(isSameOriginPath('api/status')).toBe(false);
  });

  it('throws rather than fetching when handed an absolute URL', async () => {
    const net = deadServer();
    const transport = createBootTransport(net.fetch);
    await expect(transport.browse('\u0000')).resolves.toBeTruthy();
    // The path a user browses to is server-side and arbitrary; it travels as a
    // query PARAMETER and can never become the request's own host.
    for (const url of net.urls) expect(url.startsWith('/api/browse?')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- *
 * The attach dialog
 * -------------------------------------------------------------------------- */

describe('item 2.4 — the attach dialog', () => {
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = realFetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const BROWSE = {
    root: '/home/max',
    path: '/home/max/projects',
    parent: '/home/max',
    entries: [
      { name: 'shopfront', path: '/home/max/projects/shopfront', isRepo: true, hasChildren: true },
      { name: 'notes', path: '/home/max/projects/notes', isRepo: false, hasChildren: false },
    ],
  };

  function dialogServer(over: Record<string, { status: number; body: unknown }> = {}) {
    return server({
      '/api/recent': { status: 200, body: { recent: [{ path: '/home/max/old', name: 'old' }] } },
      '/api/browse': { status: 200, body: BROWSE },
      ...over,
    });
  }

  it('names the browse root as a boundary, not as a decoration', async () => {
    const net = dialogServer();
    render(<AttachDialog transport={createBootTransport(net.fetch)} onAttached={() => {}} />);

    const callout = await screen.findByTestId('attach-root-callout');
    expect(callout.textContent).toContain('/home/max');
    // The jail is the reason the up control disables at the top, and a user who
    // does not know the boundary exists reads a disabled control as a bug.
    expect((callout.textContent ?? '').toLowerCase()).toContain('outside');
  });

  it('lists the path as crumbs from the root, and disables up at the top', async () => {
    const net = dialogServer({
      '/api/browse': { status: 200, body: { ...BROWSE, path: '/home/max', parent: null } },
    });
    render(<AttachDialog transport={createBootTransport(net.fetch)} onAttached={() => {}} />);

    await screen.findByTestId('attach-crumbs');
    // `parent === null` IS the top of the jail. Nothing else may decide it —
    // deriving "am I at the root" from string prefixes is how a client and a
    // server come to disagree about a boundary.
    expect(screen.getByTestId('attach-up').hasAttribute('disabled')).toBe(true);
  });

  it('starts the crumbs AT the browse root, never above it', async () => {
    const net = dialogServer();
    render(<AttachDialog transport={createBootTransport(net.fetch)} onAttached={() => {}} />);

    /* Wait for the listing (callout / entries), not the empty crumbs nav —
       crumbs mount empty while browse is in flight. */
    await screen.findByTestId('attach-root-callout');
    const crumbs = await screen.findAllByTestId('attach-crumb');

    // /home/max is the jail and /home/max/projects is the cursor, so there are
    // exactly two crumbs. A crumb for `/` or for `home` would be a control that
    // navigates somewhere the server will refuse — an offer the app cannot
    // keep, and the reason the boundary is rendered rather than inferred.
    expect(crumbs.map((c) => c.textContent)).toEqual(['max', 'projects']);
  });

  it('tags a folder the scanner will find something in, and leaves the others alone', async () => {
    const net = dialogServer();
    render(<AttachDialog transport={createBootTransport(net.fetch)} onAttached={() => {}} />);

    const rows = await screen.findAllByTestId('attach-entry');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('shopfront');
    expect(rows[0].querySelector('[data-testid="attach-scannable"]')).toBeTruthy();
    // The second row is still openable. `isRepo` is a hint read off markers
    // (.git, package.json, a compose file); it is not permission.
    expect(rows[1].querySelector('[data-testid="attach-scannable"]')).toBeNull();
    expect(rows[1].querySelector('button')).toBeTruthy();
  });

  it('shows recents first, because the repo you want is usually the last one', async () => {
    const net = dialogServer();
    render(<AttachDialog transport={createBootTransport(net.fetch)} onAttached={() => {}} />);

    const recents = await screen.findAllByTestId('attach-recent');
    expect(recents[0].textContent).toContain('old');
  });

  it('renders the 422 as a note that keeps the repo name, never as a wall', async () => {
    const net = dialogServer({
      '/api/attach': {
        status: 422,
        body: { error: 'no deployment manifests found', code: 'no-manifests', repoName: 'notes' },
      },
    });
    render(<AttachDialog transport={createBootTransport(net.fetch)} onAttached={() => {}} />);

    const rows = await screen.findAllByTestId('attach-entry');
    fireEvent.click(rows[1].querySelector('button') as HTMLButtonElement);

    const failure = await screen.findByTestId('attach-failure');
    expect(failure.getAttribute('data-tone')).toBe('note');
    expect(failure.textContent).toContain('notes');
    // The words matter: the repo is real and the scan is honest about what it
    // did not recognise. "Failed" would be false.
    expect((failure.textContent ?? '').toLowerCase()).not.toContain('failed');
  });

  it('a typed path attaches on Enter, and the request carries exactly what was typed', async () => {
    /*
     * DECISION 5's lock. Measured before it existed: a repository outside the
     * browse tree could not be attached from this dialog AT ALL — the up
     * control refused (correctly) and no other door existed. The input is the
     * door; the JAIL is unchanged and lives server-side, which the next test
     * pins.
     */
    const net = dialogServer({
      '/api/attach': {
        status: 200,
        body: {
          attached: true,
          repoName: 'shopfront',
          root: '/home/max/deep/nested/shopfront',
          graphSummary: { nodes: 1, edges: 0, services: 1, datastores: 0, topics: 0 },
        },
      },
      '/archgraph.json': { status: 200, body: GRAPH },
    });
    const attached: string[] = [];
    render(
      <AttachDialog
        transport={createBootTransport(net.fetch)}
        onAttached={(repo) => attached.push(repo.root)}
      />,
    );

    const input = (await screen.findByTestId('attach-path')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  /home/max/deep/nested/shopfront  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(attached).toHaveLength(1));
    const attachCall = net.urls.find((u) => u.startsWith('/api/attach'));
    expect(attachCall).toBeTruthy();
    // Trimmed — a pasted path arrives with whitespace more often than not.
    const body = JSON.parse(
      String((net.fetch as unknown as { mock: { calls: [unknown, RequestInit][] } }).mock.calls
        .find(([u]) => String(u).startsWith('/api/attach'))?.[1]?.body ?? '{}'),
    ) as { path?: string };
    expect(body.path).toBe('/home/max/deep/nested/shopfront');
  });

  it('a typed path OUTSIDE the jail meets the refusal strip, not a dead end', async () => {
    // The server's own words for its own boundary; the dialog renders the
    // refusal with the kind the copy table names. Nothing client-side decides
    // what is inside the jail — the input would otherwise become a second
    // opinion about a security boundary.
    const net = dialogServer({
      '/api/attach': { status: 403, body: { error: 'path escapes the browse root' } },
    });
    render(<AttachDialog transport={createBootTransport(net.fetch)} onAttached={() => {}} />);

    const input = (await screen.findByTestId('attach-path')) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'C:/realapp' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    const failure = await screen.findByTestId('attach-failure');
    expect(failure.getAttribute('data-kind')).toBe('outside-browse-root');
    expect(failure.getAttribute('data-tone')).toBe('plain');
    // And the control recovers — the user edits the path and tries again.
    await waitFor(() => expect(input.hasAttribute('disabled')).toBe(false));
  });

  it('an empty or whitespace path on Enter sends nothing', async () => {
    const net = dialogServer();
    render(<AttachDialog transport={createBootTransport(net.fetch)} onAttached={() => {}} />);

    const input = (await screen.findByTestId('attach-path')) as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(net.urls.some((u) => u.startsWith('/api/attach'))).toBe(false);
    // The pointer half of the same door disables rather than no-oping.
    expect(screen.getByTestId('attach-path-open').hasAttribute('disabled')).toBe(true);
  });

  it('renders the jail escape as a refusal that names the boundary', async () => {
    const net = dialogServer({
      '/api/attach': { status: 403, body: { error: 'path escapes the browse root' } },
    });
    render(<AttachDialog transport={createBootTransport(net.fetch)} onAttached={() => {}} />);

    const rows = await screen.findAllByTestId('attach-entry');
    fireEvent.click(rows[0].querySelector('button') as HTMLButtonElement);

    const failure = await screen.findByTestId('attach-failure');
    expect(failure.getAttribute('data-tone')).toBe('plain');
    expect(failure.getAttribute('data-kind')).toBe('outside-browse-root');
  });

  it('re-enables the row and says something when the transport itself throws', async () => {
    /*
     * FOUND BY LOOKING, NOT BY READING. Driving the real page turned up a row
     * that stayed disabled with a progress cursor and no message, forever,
     * because the click set `busy` and the await never came back. `attach` is
     * an async boundary, and an async boundary with a `setBusy(true)` before it
     * and a `setBusy(null)` only on the happy paths is a control that can be
     * left switched off by any throw.
     *
     * `createBootTransport` catches its own fetch rejections, so today this is
     * only reachable through the same-origin precondition or a caller-supplied
     * transport — which is exactly the kind of "cannot happen" that is not
     * worth the shape of a permanently dead button.
     */
    const net = dialogServer();
    const transport = createBootTransport(net.fetch);
    const throwing = { ...transport, attach: async () => { throw new Error('boom'); } };
    render(<AttachDialog transport={throwing} onAttached={() => {}} />);

    const rows = await screen.findAllByTestId('attach-entry');
    const button = rows[0].querySelector('button') as HTMLButtonElement;
    fireEvent.click(button);

    const failure = await screen.findByTestId('attach-failure');
    expect(failure.textContent).toContain('boom');
    // The control comes back. A dialog whose only row is permanently disabled
    // is indistinguishable from a hung app.
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  });

  it('hands the scanned repo back on success rather than deciding for the shell', async () => {
    const net = dialogServer({
      '/api/attach': {
        status: 200,
        body: {
          attached: true,
          repoName: 'shopfront',
          root: '/home/max/projects/shopfront',
          graphSummary: { nodes: 1, edges: 0, services: 1, datastores: 0, topics: 0 },
        },
      },
      '/archgraph.json': { status: 200, body: GRAPH },
    });
    const attached = vi.fn();
    render(<AttachDialog transport={createBootTransport(net.fetch)} onAttached={attached} />);

    const rows = await screen.findAllByTestId('attach-entry');
    fireEvent.click(rows[0].querySelector('button') as HTMLButtonElement);

    await waitFor(() => expect(attached).toHaveBeenCalledTimes(1));
    const draft = attached.mock.calls[0][0];
    expect(draft.repoName).toBe('shopfront');
    // The summary is the SERVER'S, taken from the attach response rather than
    // recounted here — the platform has a graphSummary() and a second count in
    // the client is a second answer waiting to disagree with it.
    expect(draft.summary).toEqual({ nodes: 1, edges: 0, services: 1, datastores: 0, topics: 0 });
  });

  /* ------------------------------------------------------------------------ *
   * The native picker — the Electron seam, actually read
   * ------------------------------------------------------------------------ */

  describe('the native folder picker', () => {
    /*
     * THESE EXIST BECAUSE THE SEAM WAS DEAD FOR A WHOLE PRODUCT.
     *
     * `packages/desktop/src/preload.ts` exposed `window.sequence` from the start
     * and its own comment invited the web app to feature-detect it. Nothing ever
     * did: `grep window.sequence` over the v1 web tree returned zero hits, and
     * the desktop build shipped a browser's folder browser inside a native
     * window. `packages/desktop/src/test/preload-bridge.test.ts` locks the
     * preload half of the contract; this locks the half that consumes it, so the
     * seam cannot quietly go dead again.
     */
    afterEach(() => {
      delete (window as unknown as { sequence?: unknown }).sequence;
    });

    function asDesktop(openRepo: () => Promise<string | null>) {
      (window as unknown as { sequence?: unknown }).sequence = { openRepo };
    }

    it('offers no native control in the browser build', async () => {
      const net = dialogServer();
      render(<AttachDialog transport={createBootTransport(net.fetch)} onAttached={() => {}} />);

      await screen.findByTestId('attach-crumbs');
      // The browser has no OS dialog to open. A control that cannot work is
      // worse than an absent one: it teaches the user a gesture that fails.
      expect(screen.queryByTestId('attach-native')).toBeNull();
    });

    it('opens the OS dialog and attaches what it returns', async () => {
      const net = dialogServer({
        '/api/attach': {
          status: 200,
          body: {
            attached: true,
            repoName: 'picked',
            root: '/home/max/projects/picked',
            graphSummary: { nodes: 1, edges: 0, services: 1, datastores: 0, topics: 0 },
          },
        },
        '/archgraph.json': { status: 200, body: GRAPH },
      });
      const openRepo = vi.fn(() => Promise.resolve('/home/max/projects/picked'));
      asDesktop(openRepo);
      const attached = vi.fn();
      render(<AttachDialog transport={createBootTransport(net.fetch)} onAttached={attached} />);

      fireEvent.click(await screen.findByTestId('attach-native'));

      await waitFor(() => expect(attached).toHaveBeenCalledTimes(1));
      expect(openRepo).toHaveBeenCalledTimes(1);
      // The picked path goes through the SAME attach as a browsed row — the
      // picker chooses a path, it does not become a second way to attach one.
      expect(attached.mock.calls[0][0].repoName).toBe('picked');
    });

    it('treats a cancelled dialog as nothing happening, not as a failure', async () => {
      const net = dialogServer();
      // `null` is the OS dialog's "the user pressed Cancel". Reporting that as
      // an error strip would put a red sentence on a deliberate act.
      asDesktop(vi.fn(() => Promise.resolve(null)));
      const attached = vi.fn();
      render(<AttachDialog transport={createBootTransport(net.fetch)} onAttached={attached} />);

      fireEvent.click(await screen.findByTestId('attach-native'));

      await waitFor(() =>
        expect((screen.getByTestId('attach-native') as HTMLButtonElement).disabled).toBe(false),
      );
      expect(attached).not.toHaveBeenCalled();
      expect(screen.queryByTestId('attach-failure')).toBeNull();
    });
  });
});
