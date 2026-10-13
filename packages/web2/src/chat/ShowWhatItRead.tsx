/* "Show what it read" in an agent run's footer: lights the services whose files the run read, using the
   board's `lookup` dim (the same one a symbol lookup uses). Hidden when the run read nothing the scan owns. */

import type { AgentRun } from '../agents/agentRuns';
import { readNodeIds, readPathsOf } from '../agents/readPathsLit';
import { useCanvasOptional } from '../canvas/canvasChannel';
import { useStoreIfAny } from '../state/connect';

export function ShowWhatItRead({ run }: { run: AgentRun }) {
  const canvas = useCanvasOptional();
  const store = useStoreIfAny();
  const paths = readPathsOf(run);
  if (run.status !== 'done' || !canvas || !store || paths.length === 0) return null;
  const repo = store.getState().repo;
  const nodes = repo.phase === 'attached' || repo.phase === 'stale' ? (repo.repo.graph.nodes ?? []) : [];
  const ids = readNodeIds(paths, nodes as never);
  if (ids.length === 0) return null;
  const lit = canvas.canvas.dim?.reason === 'lookup' && ids.length === canvas.canvas.dim.litNodeIds.length && ids.every((id) => canvas.canvas.dim!.litNodeIds.includes(id));
  return (
    <button
      type="button"
      className="s2-btn s2-btn-sm"
      data-testid="run-show-read"
      aria-pressed={lit}
      onClick={() => canvas.dispatch({ type: 'canvas/dim', dim: lit ? null : { reason: 'lookup', litNodeIds: ids, litEdgeIds: [] } })}
    >
      {lit ? 'Hide what it read' : 'Show what it read'}
    </button>
  );
}
