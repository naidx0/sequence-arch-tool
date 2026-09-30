import { useEffect, useRef, useState } from 'react';

import { bootIsStale, runBoot } from './bootSequence';
import type { BootOutcome, BootTransport } from './bootSequence';

/**
 * ITEM 2.4 — THE ADAPTER. The only React in the boot lane's data path.
 *
 * NO STORE, DELIBERATELY. `docs/research/ml-harness-adoption.md` §5: "Server
 * truth stays on the server; hooks are `useState` + `useEffect` + `refresh()`.
 * Anything a fold can produce is a `useMemo` fold, never state." Boot is the
 * clearest case of that rule in the product — it is one async question asked
 * once, and its answer is a value. Putting it in the store would mean the store
 * has to exist before the app can decide whether there is an engine to talk to,
 * which is the dependency inversion that makes a boot path hard to test.
 *
 * When 2.2's store lands, the shell calls `useBoot` once at the root and hands
 * the outcome in; the store's `repo` slice is then SET from it rather than
 * fetching for itself. The mapping is one switch, written out in the handback.
 */

export type BootPhase =
  | { phase: 'probing' }
  | { phase: 'settled'; outcome: BootOutcome };

export interface UseBoot {
  state: BootPhase;
  /** Ask again. The one control every failed boot state offers. */
  retry: () => void;
}

export function useBoot(transport: BootTransport): UseBoot {
  const [state, setState] = useState<BootPhase>({ phase: 'probing' });
  const [attempt, setAttempt] = useState(0);

  /*
   * The transport is held in a ref so that a caller who builds it inline —
   * `<BootSurface transport={createBootTransport()} />`, which is the natural
   * thing to write — does not re-run the whole boot ladder on every render. A
   * dependency array containing a freshly-constructed object is an infinite
   * fetch loop, and it is a loop that only shows up against a server that
   * answers slowly.
   */
  const held = useRef(transport);
  held.current = transport;

  useEffect(() => {
    /*
     * `cancelled` rather than an AbortController: aborting the browser's fetch
     * would not stop anything on the server (gap G3 — there are two abort sites
     * in the whole engine and both are elsewhere), so claiming to cancel would
     * be the dishonest version. What this actually guarantees is narrower and
     * true: a component that unmounted mid-probe does not set state afterwards.
     */
    let cancelled = false;
    setState({ phase: 'probing' });

    void runBoot(held.current).then(
      (outcome) => {
        if (!cancelled) setState({ phase: 'settled', outcome });
      },
      (error: unknown) => {
        /*
         * `runBoot` is total and does not throw, so reaching here means the
         * TRANSPORT threw — today the only way that happens is the same-origin
         * precondition in bootClient.ts refusing an absolute URL somebody
         * added. It is logged loudly because it is a programmer error, and it
         * still SETTLES, because the alternative is the failure mode this lane
         * exists to prevent: a probe that never resolves and a screen that
         * spins forever with nothing to read.
         */
        // eslint-disable-next-line no-console
        console.error('boot: the transport threw', error);
        if (cancelled) return;
        setState({
          phase: 'settled',
          outcome: {
            kind: 'no-engine',
            platform: {
              reachable: false,
              detail: `the boot transport threw: ${(error as Error).message}`,
              at: Date.now(),
            },
          },
        });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  /*
   * RE-ASK WHEN THE READER COMES BACK.
   *
   * Boot settles once, which is the right shape - but nothing ever re-asked,
   * so a tab opened before a repository was attached kept saying `no repo
   * attached` while the engine answered from that repository's graph. Three
   * reported symptoms came from that single staleness; `bootIsStale` carries
   * the full account.
   *
   * NOT A POLL, and not a status light. The cheap question is asked when the
   * tab becomes visible or regains focus - the moments a reader is about to
   * believe what is on screen - and the ladder is re-run ONLY if the answer
   * moved. A settled boot that still matches costs one small GET and changes
   * nothing.
   */
  useEffect(() => {
    if (state.phase !== 'settled') return undefined;
    const settled = state.outcome;
    let cancelled = false;

    const reask = (): void => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      void held.current
        .status()
        .then((answer) => {
          if (cancelled) return;
          /* Only an ANSWER can prove staleness. An unreachable engine is not a
             reason to re-run the ladder - see bootIsStale. */
          const body = answer.outcome === 'ok' ? answer.body : null;
          if (bootIsStale(settled, body)) setAttempt((n) => n + 1);
        })
        .catch(() => {
          /* The transport threw. The screen the reader is looking at is still
             the last thing the engine actually said, which is the honest thing
             to leave up. */
        });
    };

    document.addEventListener('visibilitychange', reask);
    window.addEventListener('focus', reask);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', reask);
      window.removeEventListener('focus', reask);
    };
  }, [state]);

  return { state, retry: () => setAttempt((n) => n + 1) };
}
