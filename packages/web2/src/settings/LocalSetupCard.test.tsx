import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalSetupCard } from './LocalSetupCard';

/**
 * ONE CLICK TO A LOCAL MODEL.
 *
 * Owner, 2026-09-19: "render in a one-click local AI setup like Magnitude Dev
 * does." Magnitude profiles the machine and ranks a whole catalogue by
 * estimated tokens/second; we rank by FIT and say so, because a speed figure
 * we did not measure is the exact thing this product exists to catch in other
 * tools.
 */

const GB = 1024 * 1024 * 1024;
const machine = { totalMemoryBytes: 16 * GB, freeMemoryBytes: 8 * GB, cpus: 16 };

function server(plan: unknown, status = 200) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/local/pull')) {
      return new Response(JSON.stringify({ state: 'idle' }), { status: 200 });
    }
    return new Response(typeof plan === 'string' ? plan : JSON.stringify(plan), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the local setup card', () => {
  it('offers the model already on the machine, with the reading it was chosen by', async () => {
    vi.stubGlobal(
      'fetch',
      server({ outcome: 'ready', model: 'qwen3:8b', bytes: 5 * GB, machine }),
    );
    render(<LocalSetupCard />);
    const use = await screen.findByTestId('settings-local-use');
    expect(use.textContent).toMatch(/qwen3:8b/);

    /* "This 16 GB machine gets this one" is checkable; "we picked this one" is
       not. The card shows the reading, always. */
    const card = screen.getByTestId('settings-local-setup');
    expect(card.textContent).toMatch(/16\.0 GB of memory/);
    expect(card.textContent).toMatch(/16 cores/);
    expect(card.textContent).toMatch(/No key, no account/);
  });

  it('when nothing fits, it shows WHAT IS INSTALLED so the claim is checkable', async () => {
    vi.stubGlobal(
      'fetch',
      server({
        outcome: 'needs-model',
        recommended: 'qwen3:8b',
        note: 'The balance point on most machines.',
        installed: [{ name: 'enormous:70b', bytes: 40 * GB }],
        machine,
      }),
    );
    render(<LocalSetupCard />);
    expect((await screen.findByTestId('settings-local-pull')).textContent).toMatch(/qwen3:8b/);
    expect(screen.getByTestId('settings-local-installed').textContent).toMatch(/enormous:70b/);
  });

  it('NEVER OFFERS TO INSTALL OLLAMA — it links, and the person decides', async () => {
    /*
     * Downloading and running somebody else's installer is not a button this
     * product gets to own. `localProviders.ts` draws the same line one step
     * earlier: "the detection is an OFFER".
     */
    vi.stubGlobal(
      'fetch',
      server({ outcome: 'needs-ollama', downloadUrl: 'https://ollama.com/download', machine }),
    );
    render(<LocalSetupCard />);
    const link = await screen.findByTestId('settings-local-get-ollama');
    expect(link.getAttribute('href')).toBe('https://ollama.com/download');
    expect(link.tagName).toBe('A');
    expect(screen.queryByTestId('settings-local-pull')).toBeNull();
  });

  it('A BODY IT DOES NOT RECOGNISE COSTS ONE CARD, NEVER THE PANE', async () => {
    /*
     * THE FAULT THIS TEST EXISTS FOR HAPPENED HERE ON 2026-09-19: the Settings
     * pane went blank because a component read a `/api/skills` body of another
     * shape and threw, taking permissions, MCP and autonomy down with it.
     *
     * It is not only a test concern. A packaged app talks to whatever engine is
     * on the machine, and an older one answers this route with a 404 page or a
     * bare `{}`. Reading `.machine.totalMemoryBytes` off either is a TypeError
     * during render, which React escalates to unmounting the tree.
     */
    vi.stubGlobal('fetch', server({}));
    render(<LocalSetupCard />);
    await waitFor(() => {
      expect(screen.getByTestId('settings-local-setup').textContent).toMatch(/does not offer/);
    });
    /* And it offers the one act that could change the answer. */
    expect(screen.getByTestId('settings-local-recheck')).toBeTruthy();
  });

  it('a half-built plan is as unrecognised as an empty one', async () => {
    /* `outcome: 'ready'` with no model is the shape a partial write or a
       truncated proxy produces, and it would render "Use undefined". */
    vi.stubGlobal('fetch', server({ outcome: 'ready', machine }));
    render(<LocalSetupCard />);
    await waitFor(() => {
      expect(screen.getByTestId('settings-local-setup').textContent).toMatch(/does not offer/);
    });
    expect(screen.queryByTestId('settings-local-use')).toBeNull();
  });
});
