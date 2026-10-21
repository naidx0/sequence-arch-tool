import { useState } from 'react';
import type { InFlightTurn } from '../state/types';
import { S2Icon } from '../shell2/icons';
import { ProviderIcon, brandOf } from '../shell2/brandIcons';
import { StepList } from '../shell2/StepList';
import { TurnSurfaces } from '../genui/chatSurfaces';
import { useToolDetail } from '../settings/toolDetailPreference';
import { formatContextWindowTokens } from './ContextRing';
import { ProseMessage } from './ProseMessage';
import { TodoList } from './TodoList';
import { splitThinking } from './splitThinking';
import { stripToolProse, toolCardTitle } from './stripToolProse';
import { LazyReasoningTrace as ReasoningTraceView } from './LazyReasoningTrace';

/** Settled and live API thoughts wear the answering model's mark; no named brand stays the spark. */
function ThoughtBrandMark({ model }: { model?: string }) {
  const brand = brandOf(model);
  if (brand !== 'other' && brand !== 'sequence') {
    return <span className="r9-kindicon r9-thought-brand" aria-hidden="true"><ProviderIcon provider={brand} /></span>;
  }
  return <S2Icon name="spark" small className="r9-kindicon" />;
}

function foldClickIsNotASelection(): boolean {
  const sel = typeof window !== 'undefined' ? window.getSelection?.() : null;
  return !sel || sel.isCollapsed || sel.toString().trim() === '';
}

export function ThoughtFold({ text, ms, model }: { text: string; ms?: number; model?: string }) {
  const [open, setOpen] = useState(false);
  const detail = useToolDetail();
  return (
    <div className="s2-think" data-open={open || undefined}>
      <button type="button" className="s2-think-h" data-testid="v3-turn-thought" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <ThoughtBrandMark model={model} />
        <span className="s2-grow" data-testid="v3-turn-thought-label">{ms === undefined ? 'Thought' : `Thought for ${(ms / 1000).toFixed(1)} s`}</span>
        <S2Icon name={open ? 'chev' : 'chevr'} small />
      </button>
      <div className="s2-think-wrap" data-open={open ? 'yes' : 'no'}>
        <div className="s2-think-b" aria-hidden={!open} {...(!open ? { inert: '' } : {})} data-testid="v3-turn-thought-body" onClick={() => {
          if (!foldClickIsNotASelection()) return;
          setOpen((v) => !v);
        }}>
          {detail === 'detailed' ? <div className="v3-thinking-thought-chunk">{text}</div> : <ReasoningTraceView chunks={[text]} />}
        </div>
      </div>
    </div>
  );
}

function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${(sec % 60).toString().padStart(2, '0')}s`;
}

export function ThinkingBlock({ inFlight, now, workTools }: {
  inFlight: InFlightTurn;
  now: number;
  workTools: { id: string; name: string; text?: string; evidence?: string | null }[];
}) {
  // Focused starts collapsed; a person's choice survives a detail-mode change.
  const detail = useToolDetail();
  const [pressed, setPressed] = useState<boolean | null>(null);
  const thoughtOpen = pressed ?? detail === 'detailed';
  const setThoughtOpen = (next: (v: boolean) => boolean) => setPressed(next(thoughtOpen));
  const elapsed = formatElapsed(now - inFlight.startedAt);
  const workRunning = inFlight.work.filter((w) => w.status === 'running');
  const work = workRunning.length;
  const segments = splitThinking(inFlight.text ?? '');
  const thoughtSegments = segments.filter((s) => s.kind === 'thinking');
  const answerText = segments.filter((s) => s.kind === 'answer').map((s) => s.text).join('');
  const { stripped: answerStripped, tools: streamingTools } = stripToolProse(answerText);
  const streamedThought = inFlight.reasoning?.trim() ?? '';
  const thoughtChunks = [...(streamedThought ? [streamedThought] : []), ...thoughtSegments.map((s) => s.text)];
  const thoughtOpenLive = thoughtSegments.some((s) => s.open) || (streamedThought.length > 0 && !answerStripped.trim() && inFlight.phase !== 'finalizing');
  const liveTools = inFlight.evidence.tools;
  const timeline = liveTools.length > 0 ? liveTools : workTools.length > 0 ? workTools : streamingTools.map((t) => ({ id: t.id, name: t.name, text: undefined as string | undefined }));
  const latestTool = timeline.length > 0 ? timeline[timeline.length - 1] : null;
  const runningCalled = workRunning.map((r) => /^Called (\S+)$/.exec(r.verb)?.[1]).find((n): n is string => Boolean(n));
  const toolVerb = runningCalled ? toolCardTitle(runningCalled) : latestTool ? toolCardTitle(latestTool.name) : null;
  const toolRowShown = timeline.length > 0 && toolVerb !== null;
  const phaseLabel = inFlight.phase === 'queued' ? 'Queued' : inFlight.phase === 'finalizing' ? 'Finalizing' : toolVerb && !toolRowShown ? toolVerb : 'Working';
  // Reasoning frames do not start the answer clock.
  const thoughtMs = Math.max(0, (inFlight.firstTokenAt ?? now) - inFlight.startedAt);
  const live = inFlight.phase !== 'queued' && inFlight.phase !== 'finalizing';
  return (
    <div className="s2-live chat-scope" data-testid="v3-thinking" aria-live="polite">
      <div className={`s2-live-bar${live ? ' live' : ''}`} data-testid="v3-thinking-bar">
        <span className="s2-live-phase" data-testid="v3-thinking-phase">{phaseLabel}</span>
        {work > 0 ? <span className="s2-meta" data-testid="v3-thinking-running">{work} running</span> : null}
        {inFlight.usage ? <span className="s2-live-tokens s2-mono" data-testid="v3-thinking-tokens" title="Tokens accounted so far this turn: input into the last provider call, plus output produced">
          {formatContextWindowTokens(inFlight.usage.inputTokens)} in<span className="s2-vb" aria-hidden="true" />{formatContextWindowTokens(inFlight.usage.outputTokens)} out
        </span> : null}
        <span className="s2-live-elapsed s2-mono" data-testid="v3-thinking-elapsed">{elapsed}</span>
      </div>
      {(inFlight.todos?.length ?? 0) > 0 ? <TodoList items={inFlight.todos} streaming /> : null}
      {thoughtChunks.length > 0 ? <div className="s2-think" data-open={thoughtOpen || undefined}>
        <button type="button" className={`s2-think-h${thoughtOpenLive ? ' live' : ''}`} data-testid="v3-thinking-fold" aria-expanded={thoughtOpen} onClick={() => setThoughtOpen((v) => !v)}>
          <ThoughtBrandMark model={inFlight.thoughtModel} />
          <span className="s2-grow" data-testid="v3-thinking-fold-label">{thoughtOpenLive ? 'Thinking' : `Thought for ${(thoughtMs / 1000).toFixed(1)} s`}</span>
          {thoughtOpenLive ? <span className="s2-mono s2-meta">{elapsed}</span> : null}
          <S2Icon name={thoughtOpen ? 'chev' : 'chevr'} small />
        </button>
        <div className="s2-think-wrap" data-open={thoughtOpen ? 'yes' : 'no'}>
          <div className="s2-think-b" aria-hidden={!thoughtOpen} {...(!thoughtOpen ? { inert: '' } : {})} data-testid="v3-thinking-body" onClick={() => {
            if (!foldClickIsNotASelection()) return;
            setThoughtOpen((v) => !v);
          }}>
            {detail === 'detailed' ? thoughtChunks.map((chunk, index) => <div key={index} className="v3-thinking-thought-chunk">{chunk}</div>) : <ReasoningTraceView chunks={thoughtChunks} streaming={thoughtOpenLive} />}
          </div>
        </div>
      </div> : null}
      <StepList tools={timeline} running={inFlight.phase !== 'finalizing'} />
      {answerStripped.trim() ? <div className="s2-answer"><ProseMessage text={answerStripped} streaming={inFlight.phase !== 'finalizing'} /></div> : null}
      <TurnSurfaces turnId={inFlight.turnId} />
    </div>
  );
}
