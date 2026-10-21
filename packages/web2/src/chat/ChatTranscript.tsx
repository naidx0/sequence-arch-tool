/* ══════════════════════════════════════════════════════════════════════════
   THE CHAT TRANSCRIPT: PLAIN WHILE SHORT, VIRTUALIZED WHEN LONG (S6)
   packages/web2/src/chat/ChatTranscript.tsx

   A short chat is drawn as it always was, every row in the page. Past
   VIRTUAL_AT rows (Sequence's turns plus each agent run's head, items and
   foot) it is drawn by VirtualTranscript.tsx, which loads with the long chat
   and is never part of boot. While that chunk loads, the plain list stands in.

   Either way the scroller stays at the end while it rests within 40 px of it
   (stickToBottom.ts), and once the reader has scrolled up a "Jump to latest"
   button takes them back.
   ══════════════════════════════════════════════════════════════════════════ */

import { Suspense, lazy, memo, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

import { agentRuns, type AgentRun, type AgentRunStore } from '../agents/agentRuns';
import { groundedRepoRoot, useAppState } from '../state/connect';
import type { Turn } from '../state/types';
import { AgentChatLayer } from './AgentChatLayer';
import { Icon } from './Icon';
import { useToolDetail } from '../settings/toolDetailPreference';
import { useStickToBottom } from './stickToBottom';
import { SCROLLER_ATTR } from './transcriptNav';
import { itemsBeforeTail, orderTurnsAndRuns, type OrderedItem } from './transcriptOrder';
import type { VirtualTranscriptApi } from './VirtualTranscript';

const VirtualTranscript = lazy(() => import('./VirtualTranscript'));
const PlainRun = lazy(() => import('./PlainRuns'));

/** From this many rows on, the transcript is virtualized. */
export const VIRTUAL_AT = 60;

/** How many of the last turns stand in for a long chat while its virtual list loads. */
export const FALLBACK_TURNS = 12;

/** Rows as the virtualized list counts them: a turn is one, a run is its head, its items and its foot. */
export function transcriptRowCount(turns: readonly Turn[], runs: readonly AgentRun[]): number {
  let n = turns.length;
  for (const r of runs) n += 2 + r.items.length;
  return n;
}

/* Memoised: the composer's owner re-renders on every keystroke and hands this stable props (v3/V3Chat.tsx), so typing does not redraw the transcript. */
export const ChatTranscript = memo(function ChatTranscript({
  head,
  turns,
  renderTurn,
  tail,
  foot = [],
  empty,
  runStore = agentRuns,
  virtualAt = VIRTUAL_AT,
}: {
  head?: ReactNode;
  turns: readonly Turn[];
  renderTurn: (turn: Turn) => ReactNode;
  /** After the turns and before the agent runs: the plan card, the live thinking block. */
  tail: readonly { key: string; node: ReactNode }[];
  /** After the agent runs: the turn's changed-files line (Decision 49). */
  foot?: readonly { key: string; node: ReactNode }[];
  empty: boolean;
  runStore?: AgentRunStore;
  virtualAt?: number;
}) {
  const state = useAppState();
  const toolDetail = useToolDetail();
  const runsState = useSyncExternalStore(runStore.subscribe, runStore.get, runStore.get);
  const sessionId = state.session.activeId;
  const mine = runsState.runs.filter((r) => r.sessionId === sessionId);
  const virtual = transcriptRowCount(turns, mine) >= virtualAt;

  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const api = useRef<VirtualTranscriptApi | null>(null);
  const toEnd = useCallback(() => api.current?.toEnd(), []);
  const { away, jump } = useStickToBottom(scroller, virtual ? toEnd : undefined);

  /* SENDING GOES TO THE END. A reader who scrolled up to read and then sends a message wants to see the answer arrive:
     the chat stays where it was only for what the agent streams, never for what the person just did. A send is a user
     turn that is now the last turn, or a new agent run in this chat; the chat's first paint and a switch to another
     chat only take the mark. */
  const lastTurn = turns[turns.length - 1];
  const sendMark = `${lastTurn?.role === 'user' ? lastTurn.id : ''}|${mine[mine.length - 1]?.id ?? ''}`;
  const seenSend = useRef({ sessionId, sendMark });
  useEffect(() => {
    const seen = seenSend.current;
    seenSend.current = { sessionId, sendMark };
    if (seen.sessionId !== sessionId || seen.sendMark === sendMark) return;
    jump();
  }, [sessionId, sendMark, jump]);

  /* While the long-chat chunk loads, the stand-in draws only the last screenful. It used to draw all
     of them (500 turns: a 1.2 s task and 0.4 s of layout at boot, tools/measure/switch-bench.mjs). */
  const shown = virtual ? turns.slice(-FALLBACK_TURNS) : turns;
  /* Turns and runs as they happened (transcriptOrder.ts); the layer keeps the host, starters and toasts, as in the virtual list. */
  const ordered = orderTurnsAndRuns(shown, mine);
  const split = itemsBeforeTail(ordered);
  const repoRoot = groundedRepoRoot(state);
  const renderItem = (it: OrderedItem): ReactNode =>
    it.kind === 'turn' ? (
      renderTurn(it.turn)
    ) : (
      <Suspense key={`run:${it.run.id}`} fallback={null}>
        <PlainRun run={it.run} store={runStore} repoRoot={repoRoot} />
      </Suspense>
    );
  const plain = (
    <div className="v3-transcript chat-scope" role="region" aria-label="Chat transcript" data-tool-detail={toolDetail} ref={virtual ? undefined : setScroller} {...{ [SCROLLER_ATTR]: '' }}>
      {head}
      {ordered.slice(0, split).map(renderItem)}
      {tail.map((t) => (
        <TailSlot key={t.key}>{t.node}</TailSlot>
      ))}
      {ordered.slice(split).map(renderItem)}
      <AgentChatLayer empty={empty} runs={runStore} cards={false} />
      {foot.map((t) => (
        <TailSlot key={t.key}>{t.node}</TailSlot>
      ))}
    </div>
  );

  return (
    <div className="v3-transcript-wrap">
      {virtual ? (
        <div className="v3-transcript is-virtual chat-scope" role="region" aria-label="Chat transcript" data-testid="v3-transcript-virtual" data-tool-detail={toolDetail}>
          <Suspense fallback={plain}>
            {/* The mode is part of the key: the rows are cut into groups from it, so a flip draws them again. */}
            <VirtualTranscript
              key={toolDetail}
              turns={turns}
              renderTurn={renderTurn}
              runs={mine}
              runStore={runStore}
              repoRoot={groundedRepoRoot(state)}
              head={head}
              tail={tail}
              foot={foot}
              onScroller={setScroller}
              api={api}
            />
          </Suspense>
          <AgentChatLayer empty={false} runs={runStore} cards={false} />
        </div>
      ) : (
        plain
      )}
      {away ? (
        <button type="button" className="v3-jump" data-testid="v3-jump-latest" aria-label="Jump to latest message" onClick={jump}>
          <Icon name="chevdown" size={12} />
          Jump to latest
        </button>
      ) : null}
    </div>
  );
});

/* Keys a tail node without adding a wrapper element (the plain list keeps its old markup). */
function TailSlot({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
