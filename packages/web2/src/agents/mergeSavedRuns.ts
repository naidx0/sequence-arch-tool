/**
 * A CHAT'S SAVED AGENT TURNS, MERGED IN AS THEY LAND (a goal run's turns).
 *
 * `agentRuns.hydrate` puts a chat's saved turns back after a reload, ahead of whatever is live. A goal run's turns are
 * taken by the server, so this window never started them and no stream brought them: they exist only as the chat's saved
 * records (`GET /api/acp/runs`). Reading those again while the run works, and ADDING the ones this page does not hold, at
 * the END and in order, is what makes the open chat show the run the way a reload would, without the reload.
 *
 * A turn still running on the server is followed (`follow`, GET /api/acp/attach) so its words stream, exactly as
 * `hydrate` does for a turn found mid-flight after a reload. A turn already on the page (by id, or by the turn id a live
 * run of this page carries) is left alone; a restored turn the server now says has ended is replaced by its final record.
 */
import type { AgentRun, AgentRunStore } from './agentRuns';

export function mergeSavedRuns(store: AgentRunStore, sessionId: string, saved: readonly AgentRun[]): void {
  const state = store.get();
  const haveIds = new Set(state.runs.map((r) => r.id));
  const haveTurns = new Set(state.runs.map((r) => r.turnId).filter(Boolean));
  const ended = new Map(saved.filter((r) => r.status !== 'running').map((r) => [r.id, r]));
  const fresh = saved.filter((r) => !haveIds.has(r.id) && !(r.turnId && haveTurns.has(r.turnId))).map((r) => ({ ...r, sessionId, restored: true }));
  /* A restored run still marked running that the server has finished since: its final record replaces it. */
  const settles = state.runs.some((r) => r.sessionId === sessionId && r.restored && r.status === 'running' && ended.has(r.id));
  if (fresh.length === 0 && !settles) return;
  store.patch((s) => ({
    ...s,
    runs: [
      ...s.runs.map((r) => (r.sessionId === sessionId && r.restored && r.status === 'running' && ended.has(r.id) ? { ...ended.get(r.id)!, sessionId, restored: true } : r)),
      ...fresh,
    ],
  }));
  for (const r of fresh) {
    if (r.status === 'running' && r.turnId) store.follow({ turnId: r.turnId, chatId: sessionId, agentRef: r.agentRef ?? '', prompt: r.prompt, startedAt: r.startedAt });
  }
}
