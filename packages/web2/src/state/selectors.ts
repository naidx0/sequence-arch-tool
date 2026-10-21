/* ══════════════════════════════════════════════════════════════════════════
   SELECTOR HOOKS FOR THE WHOLE-STATE STORE (perf 0.1.8.4)
   packages/web2/src/state/selectors.ts

   `useAppState()` wakes its reader on EVERY store change, so one keystroke
   (a `composer/draft` action) re-rendered each of its 33 readers, and through
   them the rail, the status bar and the transcript. The old note in connect.tsx
   ruled selectors out because `useSyncExternalStore` compares snapshots with
   `Object.is`: a selector that builds a fresh object per call loops forever.

   That is handled here, not by the caller. The snapshot is cached against the
   store's state object, so the selector runs once per state (never twice for
   the same state, which is what loops), and a new result that `isEqual` the
   last one keeps the LAST result's identity, so React sees no change.

   WHAT A CALLER MUST DO: pass a module-level (or useCallback) `select` and, when
   it builds an object or array, an `isEqual` (`shallowEqual` below). The cache
   makes an inline selector safe from looping, but an inline selector that
   returns a fresh object with no `isEqual` re-renders on every store change,
   which is what `useAppState` already did.
   ══════════════════════════════════════════════════════════════════════════ */

import { useMemo, useRef, useSyncExternalStore } from 'react';

import { deriveSendState } from '../chat';
import type { Store } from './store';
import type { AppState } from './types';

export function shallowEqual<T>(a: T, b: T): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/** A selector snapshot that is stable per store state and per equal result. Exported for the test. */
export function createSelectorSnapshot<T>(
  getState: () => AppState,
  select: (state: AppState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): () => T {
  let hasLast = false;
  let lastState: AppState;
  let lastResult: T;
  return () => {
    const state = getState();
    if (hasLast && state === lastState) return lastResult;
    const next = select(state);
    const keep = hasLast && isEqual(lastResult, next);
    lastState = state;
    if (!keep) lastResult = next;
    hasLast = true;
    return lastResult;
  };
}

/**
 * Re-renders the reader only when `select(state)` changes by `isEqual` (default `Object.is`).
 * Takes the store because this file must not import connect.tsx (which imports it); connect.tsx's
 * `useAppSelector` supplies the store from context.
 */
export function useStoreSelector<T>(store: Store, select: (state: AppState) => T, isEqual: (a: T, b: T) => boolean = Object.is): T {
  /* `select` and `isEqual` may be inline: the newest pair is read through a ref, the snapshot function stays put. */
  const live = useRef({ select, isEqual });
  live.current = { select, isEqual };
  const getSnapshot = useMemo(
    () => createSelectorSnapshot(store.getState, (s) => live.current.select(s), (a, b) => live.current.isEqual(a, b)),
    [store],
  );
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/** The app state with the composer's draft held out, so typing does not wake the reader. `composer.draft` reads '' and `composer.send` is derived from that empty draft: take the real draft from the store at event time. */
export const withoutDraft = (state: AppState): AppState => ({
  ...state,
  composer: { ...state.composer, draft: '', send: deriveSendState('', state.session.inFlight) },
});

export function sameExceptDraft(a: AppState, b: AppState): boolean {
  if (a === b) return true;
  for (const k of Object.keys(a) as (keyof AppState)[]) {
    if (k === 'composer') continue;
    if (!Object.is(a[k], b[k])) return false;
  }
  /* `send` is derived from the draft (store.ts derive), so it is held out with it; withoutDraft recomputes it. */
  const { draft: _da, send: _sa, ...ca } = a.composer;
  const { draft: _db, send: _sb, ...cb } = b.composer;
  return shallowEqual(ca, cb);
}
