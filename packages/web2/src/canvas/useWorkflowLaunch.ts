import { useCallback, useEffect, useRef, useState } from 'react';

import type { SeqDiagramV1 } from '@sequence/schema';
import { compileSeqDiagramToProgram, type CompileTier } from '@sequence/schema';

import { requestHostCommand } from '../app/hostCommands.js';
import { postWorkflowRun } from './workflowLaunchClient.js';
import { beginBoardRunWatch } from './workflowRunEvents.js';

export type WorkflowLaunchPhase = 'idle' | 'preview' | 'launching' | 'running' | 'error';

export interface UseWorkflowLaunchOptions {
  doc: SeqDiagramV1 | null;
  tier?: CompileTier;
}

const RUN_STORAGE_KEY = 'sequence:active-program-run';

export function useWorkflowLaunch({ doc, tier: tierProp = 'standard' }: UseWorkflowLaunchOptions) {
  const [tier, setTier] = useState<CompileTier>(tierProp);
  useEffect(() => {
    setTier(tierProp);
  }, [tierProp]);
  const [phase, setPhase] = useState<WorkflowLaunchPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [previewProgramId, setPreviewProgramId] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(RUN_STORAGE_KEY);
    } catch {
      return null;
    }
  });

  /* THE OPEN STREAM, HELD SO IT CAN BE CLOSED. A ref rather than state: it is
     not something anything renders, and putting it in state would re-render the
     launch bar every time a socket opened. */
  const stopWatch = useRef<(() => void) | null>(null);
  const watch = useCallback((stop: () => void) => {
    /* One watch at a time. Launching again, or restoring a run while one is
       already being watched, must not leave the first socket open with nobody
       holding its unsubscribe. */
    stopWatch.current?.();
    stopWatch.current = stop;
  }, []);

  const canLaunch = doc?.kind === 'agent-workflow' && (doc.nodes?.length ?? 0) > 0;

  const preview = useCallback(() => {
    if (!doc) return;
    setError(null);
    const compiled = compileSeqDiagramToProgram(doc, { tier });
    if (!compiled.ok) {
      setPhase('error');
      setError(compiled.errors.join('; '));
      return;
    }
    setPreviewProgramId(compiled.program.id);
    setPhase('preview');
  }, [doc, tier]);

  const launch = useCallback(async () => {
    if (!doc) return;
    setPhase('launching');
    setError(null);
    const compiled = compileSeqDiagramToProgram(doc, { tier });
    if (!compiled.ok) {
      setPhase('error');
      setError(compiled.errors.join('; '));
      return;
    }
    const emptyPrompt = doc.nodes.find(
      (n) => n.kind === 'agent' && (!n.agent?.prompt || n.agent.prompt.trim() === ''),
    );
    if (emptyPrompt) {
      setPhase('error');
      setError(`Agent "${emptyPrompt.label}" needs a prompt before launch.`);
      return;
    }
    const outcome = await postWorkflowRun({
      program: compiled.program,
      sourceDiagramId: doc.grounded.graphId,
      sourceDiagramHash: compiled.diagramHash,
    });
    if (!outcome.ok) {
      setPhase('error');
      setError(outcome.problems?.join('; ') ?? outcome.message);
      return;
    }
    setActiveRunId(outcome.runId);
    try {
      sessionStorage.setItem(RUN_STORAGE_KEY, outcome.runId);
    } catch {
      /* private mode */
    }
    setPhase('running');
    requestHostCommand('canvas.ai');
    watch(
      beginBoardRunWatch(
        outcome.runId,
        compiled.program.id,
        compiled.program.nodes.map((n) => n.id),
      ),
    );
  }, [doc, tier, watch]);

  useEffect(() => {
    if (!activeRunId || phase === 'running') return;
    let cancelled = false;
    void fetch(`/api/program/runs/${encodeURIComponent(activeRunId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (cancelled || !body?.run) return;
        const run = body.run as { status: string; program: { id: string; nodes: { id: string }[] } };
        if (run.status === 'running' || run.status === 'paused') {
          setPhase('running');
          watch(
            beginBoardRunWatch(
              activeRunId,
              run.program.id,
              run.program.nodes.map((n) => n.id),
            ),
          );
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeRunId, phase, watch]);

  /* THE UNSUBSCRIBE IS CALLED. `beginBoardRunWatch` has always returned one and
     every call site dropped it on the floor, so nothing in the package could
     close a run's EventSource — `grep -rn endBoardRunWatch packages/` found the
     definition and no caller at all. Clicking "Open on board" on N runs opened
     N sockets that outlived the component and reconnected every ~3s forever.

     THE OVERLAY IS NOT CLEARED HERE, and that is the same decision the comment
     this replaces was making: the reader may unmount the launch bar while a run
     is going, and blanking the board's run state would throw away what they are
     watching. What is released is the CONNECTION, which is the thing that
     leaks. `endBoardRunWatch` is the other gesture and stays separate. */
  useEffect(() => {
    return () => {
      stopWatch.current?.();
      stopWatch.current = null;
    };
  }, []);

  const reset = useCallback(() => {
    setPhase('idle');
    setError(null);
    setPreviewProgramId(null);
  }, []);

  return {
    canLaunch,
    phase,
    error,
    previewProgramId,
    activeRunId,
    tier,
    setTier,
    preview,
    launch,
    reset,
  };
}
