/* ══════════════════════════════════════════════════════════════════════════
   THE RUN CARDS AND THEIR TOASTS, AS ONE LAZY CHUNK
   packages/web2/src/chat/AgentRunsPane.tsx

   Nothing here is drawn until an agent run exists, so it is loaded then and
   not at boot (AgentChatLayer.tsx imports it with React.lazy). The boot
   budget is the first board's script bytes, and these cards are not on it.

   S6: in a long chat the transcript is virtualized (VirtualTranscript.tsx)
   and draws the run cards itself, row by row; this pane then draws only the
   toasts (`cards={false}`). Both answer through runCallbacks.
   ══════════════════════════════════════════════════════════════════════════ */

import type { AgentRun, AgentRunStore } from '../agents/agentRuns';
import { askAgainFrom } from '../agents/askAgain';
import type { ApprovalAnswer, RunNodeEvent } from '../agents/runNodeStream';
import type { Store } from '../state/store';
import { claimAutoResume, declineAutoResume } from '../agents/autoResume';
import { useStore } from '../state/connect';
import { AgentRunsList } from './AgentRunThread';
import { AgentToasts } from './AgentToasts';
import { EditUndoBar } from './EditFromHere';
import { RefineNoteCard } from './RefineNoteCard';

/** What the agent is told when its plan is approved (S2b). */
export const BUILD_THE_PLAN = 'The plan is approved. Build it now.';

export interface RunCallbacks {
  onAnswer: (runId: string, requestId: string, d: ApprovalAnswer) => void;
  /**
   * Ask the same question again. `auto` is the usage-limit timer: it only goes through for the chat's newest
   * turn, and when the server says this page is the one sender; resolves false when it did not send.
   * `declineAuto` is Don't (this chat never reruns by itself).
   */
  onRetry: (run: AgentRun, opts?: { auto?: boolean; declineAuto?: boolean }) => boolean | Promise<boolean>;
  onBuild: (run: AgentRun) => void;
  /** The ask ledger: send the follow-up that names the asks the agent left open. */
  onAskAgain: (run: AgentRun, text: string) => void;
  /** S6: "Show all" folds the call's update again with its whole body. */
  onApply: (runId: string, e: RunNodeEvent) => void;
}

export function runCallbacks(store: AgentRunStore, app: Store): RunCallbacks {
  return {
    onAnswer: (runId, requestId, d) => void store.answer(runId, requestId, d),
    onApply: (runId, e) => store.apply(runId, e),
    onRetry: (run, opts) => {
      if (opts?.declineAuto) {
        store.patch((s) => ({ ...s, runs: s.runs.map((r) => (r.id === run.id ? { ...r, autoDeclined: true } : r)) }));
        if (run.sessionId && typeof run.recovery?.resetsAt === 'number') void declineAutoResume(run.sessionId, run.recovery.resetsAt);
        return false;
      }
      if (!run.retry || run.retried) return false;
      if (opts?.auto) {
        const chat = store.get().runs.filter((r) => r.sessionId === run.sessionId);
        const resetsAt = run.recovery?.resetsAt;
        if (!run.sessionId || chat[chat.length - 1]?.id !== run.id || run.autoDeclined || typeof resetsAt !== 'number') return false;
        return claimAutoResume(run.sessionId, resetsAt).then((ok) => {
          if (!ok || run.retried || store.get().runs.find((r) => r.id === run.id)?.retried) return false;
          store.markRetried(run.id);
          void store.start(run.retry!);
          return true;
        });
      }
      store.markRetried(run.id);
      void store.start(run.retry);
      return true;
    },
    onAskAgain: (run, text) => void askAgainFrom(store, run, text),
    /* Build: the composer flips to Build, and the agent is switched (set_mode,
       codex's sandbox) and carries on in the same conversation. */
    onBuild: (run) => {
      app.dispatch({ type: 'composer/permission', mode: 'build' });
      void store.start({ ...(run.agentRef ? { agentRef: run.agentRef } : {}), sessionId: run.sessionId, question: BUILD_THE_PLAN, intent: 'build', ...(run.access ? { access: run.access } : {}) });
    },
  };
}

export default function AgentRunsPane({
  runs,
  store,
  repoRoot,
  cards = true,
  sessionId = null,
}: {
  runs: readonly AgentRun[];
  store: AgentRunStore;
  repoRoot: string | null;
  /** False while the virtualized transcript draws the cards (S6). */
  cards?: boolean;
  /** The open chat (the undo bar of an edit shows in it). */
  sessionId?: string | null;
}) {
  const app = useStore();
  const cb = runCallbacks(store, app);
  return (
    <>
      {cards ? <AgentRunsList runs={runs} repoRoot={repoRoot} onAnswer={cb.onAnswer} onRetry={cb.onRetry} onBuild={cb.onBuild} onAskAgain={cb.onAskAgain} onApply={cb.onApply} /> : null}
      <EditUndoBar sessionId={sessionId} />
      <RefineNoteCard sessionId={sessionId} />
      <AgentToasts store={store} repoRoot={repoRoot} />
    </>
  );
}
