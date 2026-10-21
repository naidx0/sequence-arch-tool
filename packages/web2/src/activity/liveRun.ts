/* The run the Agents surface is watching live (0.1.8.4). Launch sets it; the Workflows tab and the overview read it. */

import type { Program } from '@sequence/schema';

import type { ActivityClient } from './activityClient';
import { wireMessage } from './activityClient';
import { requestAgentsView } from '../agents/agentsSection';

let current: string | null = null;
const subs = new Set<() => void>();

export const getLiveRun = (): string | null => current;
export function setLiveRun(runId: string | null): void {
  current = runId;
  subs.forEach((f) => f());
}
export function subscribeLiveRun(f: () => void): () => void {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

/** Start the program through the run path, then open the live view on the Agents surface. */
export async function launchAndWatch(client: Pick<ActivityClient, 'start'>, program: Program): Promise<{ ok: true; runId: string } | { ok: false; message: string }> {
  const answer = await client.start(program);
  if (answer.outcome !== 'ok') return { ok: false, message: wireMessage(answer) };
  setLiveRun(answer.body.runId);
  requestAgentsView('workflows');
  return { ok: true, runId: answer.body.runId };
}
