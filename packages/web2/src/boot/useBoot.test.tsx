import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { bootIsStale } from './bootSequence';
import type { BootOutcome, BootTransport, ScannedRepoDraft, WireResult } from './bootSequence';
import { useBoot } from './useBoot';

/**
 * THE CLIENT MUST STOP ASSERTING A STATE THE ENGINE HAS LEFT.
 *
 * MEASURED on the owner's own run, 2026-08-24: a tab opened before a repository
 * was attached kept its footer on `no repo attached` and its board on `No graph
 * yet`, while the assistant answered questions from that repository and cited
 * "300 of 1,743 edges" - the real figure for this monorepo. It read as
 * fabricated grounding. It was not: `activeRoot()` throws when nothing is
 * attached, so the engine could not have answered from nothing. The CLIENT was
 * a boot old.
 *
 * `useBoot` had no test file at all, which is why a hook whose entire job is to
 * learn one fact could go the whole programme without ever re-learning it.
 *
 * Three reported symptoms reduce to this one, and the third is the reason it
 * matters more than a stale footer: `GET /api/ai-config` is fetched GATED ON
 * ATTACHMENT, so a client that believes nothing is attached never asks for the
 * model - and the composer offers "choose a model in Settings" over a provider
 * that has been configured for hours.
 */

const platform = { reachable: true, detail: 'ok', at: 0 };

const draft = (root: string): ScannedRepoDraft => ({
  root,
  repoName: root.split('/').pop() ?? root,
  graph: { nodes: [], edges: [] } as never,
  summary: { nodes: 0, edges: 0 } as never,
  scannedAt: '2026-08-24T00:00:00.000Z',
});

const attached = (root = '/repo'): BootOutcome => ({ kind: 'attached', repo: draft(root), platform });
const unattached = (): BootOutcome => ({ kind: 'unattached', platform });

const ok = <T,>(body: T): WireResult<T> => ({ outcome: 'ok', status: 200, body });

describe('bootIsStale', () => {
  it('is false when the engine still says what the client believes', () => {
    expect(bootIsStale(unattached(), { attached: false })).toBe(false);
    expect(bootIsStale(attached(), { attached: true })).toBe(false);
  });

  it('IS TRUE when the engine attached and the client never heard', () => {
    // The owner's case, reduced to one call.
    expect(bootIsStale(unattached(), { attached: true })).toBe(true);
  });

  it('is true when the engine detached and the client is still showing a repo', () => {
    expect(bootIsStale(attached(), { attached: false })).toBe(true);
  });

  it('is true when the engine moved to a DIFFERENT repository', () => {
    /* Same answer to "is anything attached", different repo — the same lie in a
       shape the boolean alone cannot see. */
    expect(bootIsStale(attached('/one'), { attached: true, root: '/two' } as never)).toBe(true);
    expect(bootIsStale(attached('/one'), { attached: true, root: '/one' } as never)).toBe(false);
  });

  it('AN UNREACHABLE ENGINE IS NOT STALE', () => {
    /*
     * The conservative direction, and it is deliberate: re-running the ladder
     * because a probe failed turns a flaky network into a boot loop, and "the
     * engine stopped answering" has its own surface.
     */
    expect(bootIsStale(attached(), null)).toBe(false);
    expect(bootIsStale(unattached(), null)).toBe(false);
  });
});

/** Renders the hook and prints the outcome kind, so the assertion is on screen. */
function Probe({ transport }: { transport: BootTransport }): JSX.Element {
  const { state } = useBoot(transport);
  return <div data-testid="kind">{state.phase === 'settled' ? state.outcome.kind : 'probing'}</div>;
}

describe('useBoot re-asks when the reader comes back', () => {
  /** A transport whose status answer can be changed between calls. */
  function transportThatBecomesAttached(): { transport: BootTransport; attach: () => void; calls: () => number } {
    let isAttached = false;
    let calls = 0;
    const transport: BootTransport = {
      status: () => {
        calls += 1;
        /* The literal branches, not `{ attached: isAttached }`: GetStatusResponse
           is a union of literal-typed members, and a widened boolean matches
           none of them. */
        return Promise.resolve(ok(isAttached ? { attached: true } : { attached: false }));
      },
      archGraph: () =>
        Promise.resolve(
          ok({
            repoName: 'repo',
            root: '/repo',
            nodes: [],
            edges: [],
            scannedAt: '2026-08-24T00:00:00.000Z',
          }),
        ),
      recent: () => Promise.resolve(ok({ recent: [] } as never)),
      browse: () => Promise.resolve(ok({ entries: [] } as never)),
      attach: () => Promise.resolve(ok({} as never)),
      detach: () => Promise.resolve(ok({ attached: false } as never)),
    };
    return { transport, attach: () => { isAttached = true; }, calls: () => calls };
  }

  it('settles unattached, and CORRECTS ITSELF when the tab comes back to an attached engine', async () => {
    const { transport, attach } = transportThatBecomesAttached();
    render(<Probe transport={transport} />);

    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('unattached'));

    // The repository is attached from somewhere else — another window, the CLI,
    // the desktop shell switching repos.
    attach();

    // The reader comes back to this tab.
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => expect(screen.getByTestId('kind').textContent).not.toBe('unattached'));
  });

  it('does NOT re-run the ladder when nothing moved', async () => {
    const { transport, calls } = transportThatBecomesAttached();
    render(<Probe transport={transport} />);
    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('unattached'));

    const afterBoot = calls();
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(calls()).toBe(afterBoot + 1));

    /*
     * One cheap GET, and no second ladder. This is the assertion that keeps the
     * fix from becoming a poll: if re-asking re-ran boot every time, this count
     * would keep climbing and the "not a status light" framing would be gone.
     */
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls()).toBe(afterBoot + 1);
  });

  it('ignores the re-ask while the tab is hidden', async () => {
    const { transport, calls } = transportThatBecomesAttached();
    render(<Probe transport={transport} />);
    await waitFor(() => expect(screen.getByTestId('kind').textContent).toBe('unattached'));
    const afterBoot = calls();

    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(calls()).toBe(afterBoot);
    } finally {
      spy.mockRestore();
    }
  });
});
