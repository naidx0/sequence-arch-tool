/* ══════════════════════════════════════════════════════════════════════════
   NEVER MISS A TURN: the page side (S5)
   packages/web2/src/notify/attention.ts

   Watches the agent run store and, while the window is hidden or not
   focused, says so when a turn ends or an approval starts waiting:

     desktop   through the preload (`window.sequence.attention`): main shows
               the OS notification, badges the dock with the waiting count,
               flashes the Windows taskbar, and clears both on focus
               (packages/desktop/src/attention.ts). A click raises the window
               and comes back on `onFocusChat`.
     browser   the Notification API, only once the person granted it from the
               enable click in Settings (notifyModel's ruling: we never pick
               the moment the prompt appears).

   WHETHER and WHAT come from notifyModel (turnEndedNotice,
   approvalWaitingNotice, which share runFinishedNotice's gate); WHICH events
   from attentionModel. This file only moves them to the OS, with every
   global injected so a test can drive it with a fake store and fake hosts.
   ══════════════════════════════════════════════════════════════════════════ */

import type { NotifyPermission } from '../settings/notifyModel';
import { approvalWaitingNotice, questionWaitingNotice, turnEndedNotice } from './attentionNotices';
import type { AttentionKind } from '../settings/attentionPreference';
import { agentName, attentionEvents, snapshotOf, waitingCount, type AttentionSnapshot, type RunLike } from './attentionModel';

export type DesktopAttentionRequest =
  | { kind: 'notify'; title: string; body: string; runId?: string | null }
  | { kind: 'waiting'; count: number }
  /** Read back main's state; `notificationsBlocked` when Windows' settings refused the last toast. */
  | { kind: 'status' };

/** What the preload exposes (packages/desktop/src/preload.ts). */
export interface DesktopAttention {
  attention(req: DesktopAttentionRequest): Promise<unknown>;
  onFocusChat?(cb: (info: { runId: string | null }) => void): () => void;
}

export interface BrowserNotifier {
  permission(): NotifyPermission;
  show(title: string, body: string, onClick: () => void): void;
}

export interface RunSource {
  get(): { runs: readonly RunLike[] };
  subscribe(fn: () => void): () => void;
}

export interface AttentionDeps {
  runs: RunSource;
  /** True when the page is visible AND its window has focus. */
  isVisible(): boolean;
  desktop: DesktopAttention | null;
  browser: BrowserNotifier | null;
  prefs(kind: AttentionKind): boolean;
  /** Bring the chat forward: the run's thread, the composer focused. */
  focusChat(run: RunLike | null): void;
  /**
   * What counts as already seen when the watcher starts. `current` (default):
   * everything on screen now. `runs`: finished runs are old news, but an
   * approval already waiting is announced, because the watcher is started
   * lazily the first time the window goes to the background (AttentionBoot),
   * and an approval that waited while the person looked away is the news.
   */
  seed?: 'current' | 'runs';
}

export interface AttentionHandle {
  stop(): void;
  /** Re-read the store now (focus came back, a test). */
  check(): void;
}

export function startAttention(deps: AttentionDeps): AttentionHandle {
  const seen = snapshotOf(deps.runs.get().runs);
  let prev: AttentionSnapshot = deps.seed === 'runs' ? { status: seen.status, waiting: new Set() } : seen;
  let reported = -1;

  const findRun = (runId: string | null): RunLike | null =>
    runId === null ? null : (deps.runs.get().runs.find((r) => r.id === runId) ?? null);

  const permission = (): NotifyPermission => {
    if (deps.desktop) return 'granted';
    return deps.browser ? deps.browser.permission() : 'unsupported';
  };

  const send = (title: string, body: string, run: RunLike): void => {
    if (deps.desktop) {
      void deps.desktop.attention({ kind: 'notify', title, body, runId: run.id }).catch(() => undefined);
      return;
    }
    try {
      deps.browser?.show(title, body, () => deps.focusChat(run));
    } catch {
      /* A browser that exposes the API and refuses it anyway. */
    }
  };

  const reportWaiting = (count: number): void => {
    if (!deps.desktop || count === reported) return;
    reported = count;
    void deps.desktop.attention({ kind: 'waiting', count }).catch(() => undefined);
  };

  const check = (): void => {
    const runs = deps.runs.get().runs;
    const events = attentionEvents(prev, runs);
    prev = snapshotOf(runs);
    const visible = deps.isVisible();
    const waiting = waitingCount(runs);
    for (const e of events) {
      const name = agentName(e.run.agentRef);
      const notice =
        e.kind === 'turn-ended'
          ? turnEndedNotice({ state: { permission: permission(), enabled: deps.prefs('turns') }, visible, agentName: name, status: e.status, prompt: e.run.prompt })
          : e.kind === 'question'
            ? questionWaitingNotice({ state: { permission: permission(), enabled: deps.prefs('approvals') }, visible, agentName: name, question: e.question, waiting })
            : approvalWaitingNotice({ state: { permission: permission(), enabled: deps.prefs('approvals') }, visible, agentName: name, title: e.title, waiting });
      if (notice) send(notice.title, notice.body, e.run);
    }
    reportWaiting(deps.prefs('approvals') ? waiting : 0);
  };

  const unsubscribe = deps.runs.subscribe(check);
  const unfocus = deps.desktop?.onFocusChat?.((info) => deps.focusChat(findRun(info.runId))) ?? (() => {});
  check();
  return {
    check,
    stop() {
      unsubscribe();
      unfocus();
    },
  };
}

/* ── the real hosts ─────────────────────────────────────────────────────── */

export function pageVisible(): boolean {
  if (typeof document === 'undefined') return true;
  const focused = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
  return document.visibilityState === 'visible' && focused;
}

export function desktopAttention(host: unknown = typeof window === 'undefined' ? undefined : window): DesktopAttention | null {
  const api = (host as { sequence?: Partial<DesktopAttention> } | undefined)?.sequence;
  return api && typeof api.attention === 'function' ? (api as DesktopAttention) : null;
}

export function browserNotifier(): BrowserNotifier | null {
  if (typeof Notification === 'undefined') return null;
  return {
    permission: () => Notification.permission as NotifyPermission,
    show(title, body, onClick) {
      const n = new Notification(title, { body });
      n.onclick = () => {
        try {
          window.focus();
        } catch {
          /* not allowed: the click still opens the chat */
        }
        onClick();
        n.close();
      };
    },
  };
}
