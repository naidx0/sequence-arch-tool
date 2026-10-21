import { draftFromBody } from '../app/rescanClient';
import type { Store } from '../state/store';

import type { GitServerEvent } from './gitClient';
import { onGitEvent } from './gitEvents';

/* ══════════════════════════════════════════════════════════════════════════
   THE BOARD FOLLOWS THE BRANCH
   packages/web2/src/git/boardReload.ts

   Jaden: "when you do actually change any branches make sure it updates the
   architecture board accordingly."

   THE ENGINE DOES THE RESCAN. A branch change makes it rescan (`git:head`,
   rescan: true) and, when that lands, it says `graph:updated`. This client
   therefore only RE-READS /archgraph.json on `graph:updated`: it never starts a
   scan of its own and never dispatches `repo/scanning`, which would blank the
   board (store.ts: a rescan while scanning drops `previous`).

   SINGLE FLIGHT, EXACTLY ONE TRAILING READ. A read that is running when
   another event arrives is not joined (it may have fetched the graph of the
   branch before this one): a single trailing read is queued, however many
   events pile up behind it. There is no quiet window after a read, so a
   switch 800 ms later reads again. And while someone else's scan is running
   (the rail's Retry) a read waits for it to finish rather than landing on top.
   ══════════════════════════════════════════════════════════════════════════ */

export interface ReloadDeps {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

type BoardStore = Pick<Store, 'getState' | 'dispatch' | 'subscribe'>;

let running: Promise<void> | null = null;
let trailing = false;

/** Test hook: forget any read in flight. */
export function resetBoardReload(): void {
  running = null;
  trailing = false;
  lastGraphUpdated = 0;
}

function heldRepo(store: BoardStore) {
  const state = store.getState();
  return state.repo.phase === 'attached' || state.repo.phase === 'stale'
    ? state.repo.repo
    : state.repo.phase === 'scanning'
      ? state.repo.previous
      : null;
}

/** Resolves when no scan is running (immediately when none is). */
function untilNotScanning(store: BoardStore): Promise<void> {
  if (store.getState().repo.phase !== 'scanning') return Promise.resolve();
  return new Promise((resolve) => {
    const stop = store.subscribe(() => {
      if (store.getState().repo.phase !== 'scanning') {
        stop();
        resolve();
      }
    });
  });
}

type Drafted = { draft: NonNullable<ReturnType<typeof draftFromBody>> } | { status: number | null; message: string };

async function fetchDraft(deps: ReloadDeps): Promise<Drafted> {
  const f = deps.fetchImpl ?? ((i, n) => fetch(i, n));
  const why = (m: string) => `the board could not follow the branch: ${m}`;
  let response: Response;
  try {
    response = await f('/archgraph.json');
  } catch (error) {
    return { status: null, message: why((error as Error).message || 'the engine did not answer') };
  }
  if (!response.ok) return { status: response.status, message: why(`/archgraph.json answered ${response.status}`) };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { status: response.status, message: why('/archgraph.json was not JSON') };
  }
  const draft = draftFromBody(body);
  return draft === null ? { status: response.status, message: why('/archgraph.json was not a graph') } : { draft };
}

async function readOnce(store: BoardStore, deps: ReloadDeps): Promise<void> {
  await untilNotScanning(store);
  if (heldRepo(store) === null) return;
  const now = deps.now ?? Date.now;
  const got = await fetchDraft(deps);
  if ('draft' in got) store.dispatch({ type: 'repo/loaded', draft: got.draft, at: now() });
  else store.dispatch({ type: 'net/failed', failure: { status: got.status, message: got.message, route: 'GET /archgraph.json', at: now() } });
}

/** When the engine last said graph:updated (0 = never): proof the event stream is alive. */
let lastGraphUpdated = 0;

/**
 * AFTER A SWITCH WITH NO EVENT STREAM. The engine is rescanning when it answers
 * the switch, so reading /archgraph.json at once returns the OLD branch's
 * graph. Wait for the graph's own `scannedAt` to change (poll, bounded), then
 * load it. If graph:updated arrives meanwhile the event path owns the read and
 * this stops without polling (with the stream alive only the trailing read runs).
 */
export async function reloadAfterSwitch(
  store: BoardStore,
  deps: ReloadDeps = {},
  opts: { tries?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void>; since?: number } = {},
): Promise<void> {
  const { tries = 40, intervalMs = 750, sleep = (ms) => new Promise<void>((r) => setTimeout(r, ms)) } = opts;
  const since = opts.since ?? Date.now();
  const startedWith = heldRepo(store)?.scannedAt ?? null;
  for (let i = 0; i < tries; i += 1) {
    if (lastGraphUpdated >= since) return;
    await sleep(intervalMs);
    if (lastGraphUpdated >= since) return;
    await untilNotScanning(store);
    const got = await fetchDraft(deps);
    /* The engine cannot be read at all: stop polling (the event path or the next switch retries). */
    if (!('draft' in got)) return;
    if (got.draft.scannedAt !== startedWith) {
      store.dispatch({ type: 'repo/loaded', draft: got.draft, at: (deps.now ?? Date.now)() });
      return;
    }
  }
}

export function reloadBoard(store: BoardStore, deps: ReloadDeps = {}): Promise<void> {
  if (running) {
    trailing = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        trailing = false;
        await readOnce(store, deps);
      } while (trailing);
    } finally {
      running = null;
    }
  })();
  return running;
}

/* One subscription per store, shared by every component that asks. */
const follows = new WeakMap<object, { count: number; stop: () => void }>();

export function followGitEvents(
  store: BoardStore,
  deps: ReloadDeps & { subscribe?: (on: (e: GitServerEvent) => void) => () => void } = {},
): () => void {
  let entry = follows.get(store);
  if (!entry) {
    const subscribe = deps.subscribe ?? onGitEvent;
    const stop = subscribe((event) => {
      if (event.type === 'graph:updated') {
        lastGraphUpdated = Date.now();
        void reloadBoard(store, deps);
      }
    });
    entry = { count: 0, stop };
    follows.set(store, entry);
  }
  entry.count += 1;
  const held = entry;
  return () => {
    held.count -= 1;
    if (held.count <= 0) {
      held.stop();
      follows.delete(store);
    }
  };
}
