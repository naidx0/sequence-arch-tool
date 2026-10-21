/* ══════════════════════════════════════════════════════════════════════════
   SIGN IN ONCE: the one place that knows a sign-in just happened
   packages/web2/src/onboarding/signInState.ts

   Owner, 2026-10-09: "During onboarding you maybe log in and re-auth like
   three times, which is really annoying."

   The vendor's own `auth status` can still read signed-out for a few seconds
   after its sign-in command exits (or after a stale cached read). First Run,
   the model menu's Connect row, Settings > Agents and the failed-run
   RecoveryCard each read that probe on their own, so each asked to sign in
   again in that gap.

   This module is the shared answer. When a sign-in command ends, `settleSignIn`
   polls the probe briefly (backoff, about 8 s) before anyone is allowed to say
   signed-out again; meanwhile every surface shows "Checking sign-in..." through
   `applySignIn`, and a window focus does not re-probe. If the vendor really still
   reports signed-out when the wait is over, the grace ends and the prompts return.
   ══════════════════════════════════════════════════════════════════════════ */

import { Suspense, createElement, lazy, useSyncExternalStore, type ComponentProps } from 'react';

import type { BrowserSignIn as BrowserSignInType } from './BrowserSignIn';
import type { OnboardingClient, ProviderStatus } from './onboardingClient';

/** How long to keep asking the vendor before believing "signed out" again. */
export const SETTLE_BUDGET_MS = 8000;
/** After a confirmed sign-in, a stray signed-out read is not believed for this long. */
export const QUIET_MS = 60_000;
const FIRST_DELAY_MS = 500;
const MAX_DELAY_MS = 2000;

interface Entry {
  settling: boolean;
  /** Until when a signed-out read is treated as unsettled (epoch ms). */
  quietUntil: number;
  /** When the vendor last confirmed (or the person finished) a sign-in. */
  signedAt: number;
}

const entries = new Map<string, Entry>();
const running = new Map<string, Promise<ProviderStatus | null>>();
const listeners = new Set<() => void>();
/** Bumped on every change; the snapshot React reads. */
let version = 0;
/** Bumped when a settle ends, so a surface knows to read the probe again. */
let settledCount = 0;
/** Bumped by a reset: an in-flight settle from an older generation writes nothing back. */
let generation = 0;

function emit(): void {
  version += 1;
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Re-render when any sign-in state changes. Returns a number that changes with it. */
export function useSignInVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

/** Changes each time a settle finishes: an effect depending on it re-reads the probe. */
export function useSettledCount(): number {
  useSyncExternalStore(subscribe, () => version, () => version);
  return settledCount;
}

export function isSettling(id: string): boolean {
  return entries.get(id)?.settling === true;
}

/** True while a signed-out read for this provider should not be believed (settling, or just confirmed). */
export function isQuiet(id: string, now = Date.now()): boolean {
  const e = entries.get(id);
  return !!e && (e.settling || now < e.quietUntil);
}

/** When this provider's sign-in last finished or was confirmed; 0 when never. */
export function signedAt(id: string): number {
  return entries.get(id)?.signedAt ?? 0;
}

/**
 * A passive ready read (nobody signed in just now): a signed-out read right after is probably a stale one,
 * so re-probes get the grace. It never stamps `signedAt`: only a finished settle after an actual sign-in
 * terminal says "the person signed in", which is what RecoveryCard reads.
 */
export function noteReady(id: string, now = Date.now()): void {
  const e = entries.get(id);
  if (e?.settling) return;
  const wasQuiet = !!e && now < e.quietUntil;
  entries.set(id, { settling: false, quietUntil: now + QUIET_MS, signedAt: e?.signedAt ?? 0 });
  if (!wasQuiet) emit();
}

/**
 * Show a signed-out read as "Checking sign-in..." while it should not be believed.
 * Pure over the list: returns the same array when nothing changes.
 */
export function applySignIn<T extends Pick<ProviderStatus, 'id' | 'state'>>(list: readonly T[], now = Date.now()): T[] {
  let changed = false;
  const out = list.map((p) => {
    if (p.state === 'signIn' && isQuiet(p.id, now)) {
      changed = true;
      return { ...p, state: 'checking' as const, checkingSignIn: true };
    }
    return p;
  });
  return changed ? out : (list as T[]);
}

/**
 * The sign-in command ended: ask the vendor again, with backoff, until it stops saying signed-out
 * or the budget is spent. One poll per provider at a time (a second caller gets the same answer).
 * Resolves to the provider's last reading, or null when it never answered.
 */
export function settleSignIn(
  id: string,
  client: Pick<OnboardingClient, 'providers'>,
  onUpdate?: (list: ProviderStatus[]) => void,
  opts: { afterSignIn?: boolean; budgetMs?: number } = {},
): Promise<ProviderStatus | null> {
  const budgetMs = opts.budgetMs ?? SETTLE_BUDGET_MS;
  const gen = generation;
  const existing = running.get(id);
  if (existing) return existing;
  const now = Date.now();
  entries.set(id, { settling: true, quietUntil: now + budgetMs + QUIET_MS, signedAt: entries.get(id)?.signedAt ?? 0 });
  emit();
  const p = (async () => {
    let waited = 0;
    let delay = FIRST_DELAY_MS;
    let last: ProviderStatus | null = null;
    let believed = false;
    try {
      for (;;) {
        const a = await client.providers(true);
        if (a.ok) {
          onUpdate?.(a.body);
          last = a.body.find((x) => x.id === id) ?? null;
          /* Gone from the list, or any answer but "still signed out / still looking", is an answer. */
          if (!last || (last.state !== 'signIn' && last.state !== 'checking')) {
            believed = true;
            break;
          }
        }
        if (waited + delay > budgetMs) break;
        await new Promise((r) => setTimeout(r, delay));
        waited += delay;
        delay = Math.min(Math.round(delay * 1.6), MAX_DELAY_MS);
      }
      return last;
    } finally {
      /* A reset happened while this poll was in flight: it must not write into the new state. */
      if (gen === generation) {
        const at = Date.now();
        const prior = entries.get(id)?.signedAt ?? 0;
        /* Signed-out for the whole wait: believed again, the prompts come back. Otherwise a quiet minute.
           Only a settle that follows a real sign-in terminal records that the person signed in. */
        const signedIn = believed && !!last && last.state !== 'signIn';
        entries.set(id, {
          settling: false,
          quietUntil: believed && last ? at + QUIET_MS : 0,
          signedAt: opts.afterSignIn ? (signedIn ? at : 0) : prior,
        });
        running.delete(id);
        settledCount += 1;
        emit();
      }
    }
  })();
  running.set(id, p);
  return p;
}

/** Tests: forget everything. */
export function resetSignInState(): void {
  generation += 1;
  entries.clear();
  running.clear();
  settledCount = 0;
  emit();
}

/* THE SIGN-IN PANEL, LOADED WHEN A SIGN-IN OPENS. Connect an agent, the Agents settings pane and first run all hold
   BrowserSignIn; a static import made it (and any wrapper of its own) a chunk shared by all three, and the boot chunk
   lists a shared chunk in its preload map (perf ratchet, bootJsBytes). The wrapper lives here, in the module all three
   already share, so no new chunk name appears. The fallback is the panel's own first sentence in its own markup, so
   nothing jumps when the real one arrives. */
const LoadedSignIn = lazy(() => import('./BrowserSignIn').then((m) => ({ default: m.BrowserSignIn })));

export function LazyBrowserSignIn(props: ComponentProps<typeof BrowserSignInType>) {
  const waiting = createElement(
    'div',
    { className: 'fr-signin-state', role: 'status', 'data-testid': 'first-run-signin-waiting' },
    createElement('p', { className: 'fr-agent-say' }, 'Opening the sign-in page…'),
  );
  return createElement(Suspense, { fallback: waiting }, createElement(LoadedSignIn, props));
}
