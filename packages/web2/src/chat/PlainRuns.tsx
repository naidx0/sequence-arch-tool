/* One agent run, drawn in place among the plain transcript's turns (E2).
   Loaded lazily with the first run, like AgentRunsPane: its cards are not on the boot budget. */

import type { AgentRun, AgentRunStore } from '../agents/agentRuns';
import { useStore } from '../state/connect';
import { AgentRunsList } from './AgentRunThread';
import { runCallbacks } from './AgentRunsPane';

export default function PlainRun({ run, store, repoRoot }: { run: AgentRun; store: AgentRunStore; repoRoot: string | null }) {
  const app = useStore();
  const cb = runCallbacks(store, app);
  return <AgentRunsList runs={[run]} repoRoot={repoRoot} onAnswer={cb.onAnswer} onRetry={cb.onRetry} onBuild={cb.onBuild} onAskAgain={cb.onAskAgain} onApply={cb.onApply} />;
}
