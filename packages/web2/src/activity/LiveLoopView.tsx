/* The live view of one run: its blocks in order, lit by state, with the loop's pass count. Reads useLiveLoop. */

import { useSyncExternalStore } from 'react';

import { useLiveLoop, type LiveLoop, type LiveLoopOptions } from './useLiveLoop';
import { getLiveRun, subscribeLiveRun } from './liveRun';

import './workflowPreview.css';

const WORD = { pending: 'Waiting', running: 'Running', done: 'Done', failed: 'Failed' } as const;

export function LiveLoopBlocks({ live, title }: { live: LiveLoop; title?: string }) {
  if (live.blocks.length === 0) return <p className="wfl-note" data-testid="live-loop-wait">Waiting for the run to report.</p>;
  return (
    <div className="wfl" data-testid="live-loop" data-status={live.status} role="group" aria-label={title ? `Live run of ${title}` : 'Live run'}>
      <div className="wfl-head">
        <span className="wfl-status" data-testid="live-loop-status">{live.status}</span>
        {live.maxIterations !== null ? (
          <span className="wfl-iter" data-testid="live-loop-iteration">{`Pass ${Math.max(live.iteration, 1)} of ${live.maxIterations}`}</span>
        ) : null}
      </div>
      <ol className="wfl-blocks">
        {live.blocks.map((b, i) => (
          <li key={b.id} className="wfl-block" data-testid="live-block" data-state={b.state} data-active={i === live.activeIndex ? 'true' : undefined} aria-current={i === live.activeIndex ? 'step' : undefined}>
            <span className="wfl-block-t" title={b.title}>{b.title}</span>
            <span className="wfl-block-s">{WORD[b.state]}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The run launched from a preview card (or any run id), watched live. Draws nothing until a run is being watched. */
export function LiveLoopView({ runId, opts }: { runId?: string | null; opts?: LiveLoopOptions }) {
  const watched = useSyncExternalStore(subscribeLiveRun, getLiveRun, getLiveRun);
  const id = runId ?? watched;
  const live = useLiveLoop(id, opts);
  if (!id) return null;
  return <LiveLoopBlocks live={live} />;
}
