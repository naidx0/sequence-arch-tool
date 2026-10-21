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

import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';

import './onboarding.css';

import { type BootTransport } from '../boot';
import { readRegisteredAgents } from '../shell2/defaultAgent';
import { useAppState, useStore } from '../state';
import { focusComposerSoon } from './landing';
import { modelConfigured } from './setupFallback';
import { createOnboardingClient, type OnboardingClient } from './onboardingClient';
import { pendingNotice, runPendingSkills } from './skillsPending';

/* Perf ratchet: the screen draws only on a first run with nothing attached, so it loads then, not at boot. */
const FirstRun = lazy(() => import('./FirstRun').then((m) => ({ default: m.FirstRun })));
/* Settings > Skills "Find skills on this computer" opens the first-run skills step on its own (0.1.6 G6). */
const FirstRunSkills = lazy(() => import('./FirstRunSkills').then((m) => ({ default: m.FirstRunSkills })));
export const OPEN_SKILLS_FINDER = 'seq:open-skills-finder';

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
  /* The shared read of the agents (shell2/defaultAgent.ts): the same request the default pick makes, which also hands the page the labels. */
  return (await readRegisteredAgents())?.length ?? null;
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

  /* Skills confirmed on first run before any project existed are imported as soon as one is attached. */
  /* Attached means a project is actually there: unattached and a failed attach are not (a retry that scans is the next edge). */
  const attached = state.repo.phase !== 'unattached' && state.repo.phase !== 'failed';
  const project =
    'repoName' in state.repo ? state.repo.repoName : 'repo' in state.repo && state.repo.repo ? state.repo.repo.repoName : 'the project';
  const [notice, setNotice] = useState<string | null>(null);
  const running = useRef(false);
  useEffect(() => {
    if (!attached || running.current) return undefined;
    running.current = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void runPendingSkills(wire)
      .then((o) => {
        if (!o) return;
        setNotice(pendingNotice(o, project));
        timer = setTimeout(() => setNotice(null), 9000);
      })
      .finally(() => {
        running.current = false;
      });
    return () => {
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attached, wire]);

  const [finder, setFinder] = useState(false);
  useEffect(() => {
    const open = () => setFinder(true);
    window.addEventListener(OPEN_SKILLS_FINDER, open);
    return () => window.removeEventListener(OPEN_SKILLS_FINDER, open);
  }, []);
  /* Whether an agent is connected, asked each time the finder opens (the same registry the first run reads). */
  const [finderAgent, setFinderAgent] = useState(false);
  useEffect(() => {
    if (!finder) return undefined;
    let live = true;
    void registeredAgents().then((n) => {
      if (live) setFinderAgent((n ?? 0) > 0);
    });
    return () => {
      live = false;
    };
  }, [finder]);
  /* "Ask my agent": the ready prompt goes in the chat box (after anything already typed), and the caret follows it. */
  const askAgent = (prompt: string) => {
    const draft = store.getState().composer.draft;
    store.dispatch({ type: 'composer/draft', text: draft.trim() === '' ? prompt : `${draft.replace(/\s+$/, '')}
${prompt}` });
    focusComposerSoon();
  };
  /* The finder is a modal: Escape closes it and nothing behind it. Listeners on `window` run in the order they were
     added, and the Settings panel adds its own Escape handler when it opens, so this one is added once, when the gate
     mounts (before any overlay can exist), and only acts while the finder is open. */
  const finderOpen = useRef(false);
  finderOpen.current = finder;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !finderOpen.current) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      setFinder(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  if (finder) {
    return (
      <Suspense fallback={null}>
        <div
          className="fr-root fr-finder"
          data-testid="skills-finder"
          role="dialog"
          aria-modal="true"
          aria-label="Find skills on this computer"
          onKeyDown={(e) => {
            if (e.key !== 'Tab') return;
            const box = e.currentTarget;
            const all = Array.from(box.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea, [tabindex]:not([tabindex="-1"])'));
            const first = all[0];
            const last = all[all.length - 1];
            if (!first || !last) {
              e.preventDefault();
              return;
            }
            const at = document.activeElement;
            const inside = at instanceof Node && box.contains(at);
            if (e.shiftKey && (at === first || !inside)) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && (at === last || !inside)) {
              e.preventDefault();
              first.focus();
            }
          }}
        >
          <FirstRunSkills client={wire} modal active agentConnected={finderAgent} onAskAgent={askAgent} onNext={() => setFinder(false)} />
        </div>
      </Suspense>
    );
  }

  const show =
    !skipped &&
    agents !== undefined &&
    (agents === null || agents === 0) &&
    state.net.reachable === true &&
    state.repo.phase === 'unattached' &&
    state.shell.overlay?.kind !== 'attach';
  if (!show) {
    return notice ? (
      <p className="fr-notice" role="status" data-testid="skills-pending-notice">
        {notice}
      </p>
    ) : null;
  }

  return (
    <Suspense fallback={null}>
      <FirstRun
        client={wire}
        onConnected={writeSkipped}
        onAskAgent={askAgent}
        canAnswer={modelConfigured(state.composer.model)}
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
