import type { GitServerEvent } from './gitClient';
import { subscribeGitEventsSafe } from './gitCalls';
import { onWorkspaceSwitched } from '../sessions/workspaceEvents';

/* ONE git event stream per tab, however many components listen (the switcher
   in Files, the switcher in Diff, the board, the status-bar chip). Reference
   counted: the stream opens with the first listener and closes with the last.

   A stream that failed is reopened. An EventSource retries a dropped connection itself, but one that was refused
   (the engine was not up yet, or answered text/html) is CLOSED for good, and every later listener would join that
   dead stream. So a closed stream is replaced after a bounded backoff, and only once the engine says a repository is
   attached (`GET /api/status`), so a host with no engine is never asked for /api/git/events and nothing spins. */

type Listener = (event: GitServerEvent) => void;

/** Waits between reopen attempts; after the last attempt fails the stream stays down until a listener joins or the workspace switches. */
export const REOPEN_BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 30000];

const listeners = new Set<Listener>();
let stop: (() => void) | null = null;
/** The open stream's generation: an error from a stream already replaced is not about the current one. */
let generation = 0;
let dead = false;
let attempts = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

const fanOut: Listener = (event) => {
  for (const l of [...listeners]) l(event);
};

const REREAD: GitServerEvent = { type: 'graph:updated', reason: 'git:head', branch: null, sha: null };

type SourceLike = {
  readyState?: number;
  addEventListener(type: string, listener: (e: { data: string }) => void): void;
  close(): void;
};

function open(): void {
  const mine = (generation += 1);
  dead = false;
  stop = subscribeGitEventsSafe(fanOut, (url) => {
    const source = new EventSource(url) as unknown as SourceLike;
    source.addEventListener('open', () => {
      if (mine === generation) attempts = 0;
    });
    source.addEventListener('error', () => {
      /* readyState 2 is CLOSED: the browser will not retry it. (0 is CONNECTING: it is retrying by itself.) */
      if (mine === generation && source.readyState === 2) {
        dead = true;
        scheduleReopen();
      }
    });
    return source;
  });
}

async function engineAttached(): Promise<boolean> {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return false;
    return ((await res.json()) as { attached?: unknown })?.attached === true;
  } catch {
    return false;
  }
}

function scheduleReopen(): void {
  if (timer !== null || listeners.size === 0 || attempts >= REOPEN_BACKOFF_MS.length) return;
  const delay = REOPEN_BACKOFF_MS[attempts];
  attempts += 1;
  timer = setTimeout(() => {
    timer = null;
    void (async () => {
      if (listeners.size === 0 || !dead) return;
      if (!(await engineAttached())) {
        scheduleReopen();
        return;
      }
      if (listeners.size === 0 || !dead) return;
      stop?.();
      open();
      /* Whatever moved while the stream was down was never announced: every listener reads again. */
      fanOut(REREAD);
    })();
  }, delay);
}

function clearTimer(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

export function onGitEvent(listener: Listener): () => void {
  listeners.add(listener);
  if (stop === null) open();
  else if (dead && timer === null) {
    /* A late subscriber to a stream that failed: try again now rather than wait out a backoff that began before it. */
    attempts = 0;
    scheduleReopen();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && stop) {
      stop();
      stop = null;
      dead = false;
      attempts = 0;
      clearTimer();
    }
  };
}

/* A new workspace has its own HEAD and its own watcher on the server: reopen the stream, and tell every listener to
   read again (a graph:updated carries no branch change, so nothing announces a switch that did not happen). */
onWorkspaceSwitched(() => {
  clearTimer();
  attempts = 0;
  if (stop !== null) {
    stop();
    open();
  }
  fanOut(REREAD);
});

/** Test hook. */
export function resetGitEvents(): void {
  listeners.clear();
  stop?.();
  stop = null;
  dead = false;
  attempts = 0;
  clearTimer();
}
