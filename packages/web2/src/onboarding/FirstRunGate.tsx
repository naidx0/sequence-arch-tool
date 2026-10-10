/* ══════════════════════════════════════════════════════════════════════════
   FIRST RUN — when it shows
   packages/web2/src/onboarding/FirstRunGate.tsx

   Round 13: the screen is "Welcome to Sequence": four options, then a swipe-style
   setup (FirstRun.tsx, FirstRunSetup.tsx).

   Shown once boot has settled with the engine reachable and NO repository
   attached. Before boot settles `repo.phase` is also `unattached`, so the
   reachability answer is what separates "nothing attached" from "not asked
   yet" — drawing the screen over a repo that is about to load would flash it.

   It also needs NO registered agent (GET /api/acp/agents): once one is connected
   a new launch goes straight to the chat. Starting a chat or "Skip for now" is
   remembered in localStorage.
   ══════════════════════════════════════════════════════════════════════════ */

import { Suspense, lazy, useEffect, useMemo, useState } from 'react';

import './onboarding.css';

import { type BootTransport } from '../boot';
import { useAppState, useStore } from '../state';
import { focusComposer } from './landing';
import { createOnboardingClient, type OnboardingClient } from './onboardingClient';

/* Perf ratchet: the screen draws only on a first run with nothing attached, so it loads then, not at boot. */
const FirstRun = lazy(() => import('./FirstRun').then((m) => ({ default: m.FirstRun })));

export const SKIP_KEY = 'sequence.onboarding.skip';

/* Round 12: the skip is remembered on this machine (localStorage), not per tab: a new launch
   with an agent connected, or after "Skip for now", must not bring the screen back. */
function readSkipped(): boolean {
  try {
    return window.localStorage.getItem(SKIP_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSkipped(): void {
  try {
    window.localStorage.setItem(SKIP_KEY, '1');
  } catch {
    /* The screen still closes for this render tree. */
  }
}

export const REGISTERED_AGENTS = '/api/acp/agents';

/** How many agents the server has registered; null when it cannot say (the screen then shows). */
async function registeredAgents(): Promise<number | null> {
  try {
    const r = await fetch(REGISTERED_AGENTS);
    if (!r.ok) return null;
    return (((await r.json()) as { agents?: unknown[] }).agents ?? []).length;
  } catch {
    return null;
  }
}

/** The chat box mounts a frame after the screen leaves: put the caret in it once it exists. */
function focusComposerSoon(): void {
  let tries = 0;
  const tick = () => {
    tries += 1;
    if (focusComposer() || tries > 60) return;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export interface FirstRunGateProps {
  /** Kept for the app root's call site; first run no longer attaches a project. */
  transport?: BootTransport;
  client?: OnboardingClient;
}

export function FirstRunGate({ client }: FirstRunGateProps) {
  const state = useAppState();
  const store = useStore();
  const [skipped, setSkipped] = useState(readSkipped);
  const wire = useMemo(() => client ?? createOnboardingClient(), [client]);

  /* undefined: not asked yet (draw nothing, so a connected machine never flashes the screen). */
  const [agents, setAgents] = useState<number | null | undefined>(undefined);
  const reachable = state.net.reachable === true;
  useEffect(() => {
    if (!reachable || skipped) return undefined;
    let live = true;
    void registeredAgents().then((n) => {
      if (live) setAgents(n);
    });
    return () => {
      live = false;
    };
  }, [reachable, skipped]);

  const show =
    !skipped &&
    agents !== undefined &&
    (agents === null || agents === 0) &&
    state.net.reachable === true &&
    state.repo.phase === 'unattached' &&
    state.shell.overlay?.kind !== 'attach';
  if (!show) return null;

  return (
    <Suspense fallback={null}>
      <FirstRun
        client={wire}
        onConnected={writeSkipped}
        onDone={(_connected, setup) => {
          writeSkipped();
          setSkipped(true);
          /* The setup's "Choose a project": the usual picker, once this screen is gone. */
          if (setup?.openProject) store.dispatch({ type: 'shell/overlay', overlay: { kind: 'attach' } });
          else focusComposerSoon();
        }}
      />
    </Suspense>
  );
}
