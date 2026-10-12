/* ══════════════════════════════════════════════════════════════════════════
   THE LONG CHAT, VIRTUALIZED (S6)
   packages/web2/src/chat/VirtualTranscript.tsx

   A chat past VIRTUAL_AT rows is drawn by @legendapp/list (MIT): only the
   rows near the viewport are in the page, so a two-thousand-row chat costs
   about what a screenful does. Loaded with the long chat, never at boot
   (ChatTranscript.tsx imports it lazily).

   ROWS, WITH STABLE KEYS. Sequence's own turns are a row each (`turn:<id>`).
   An agent run is several rows: its head (`run:<id>:head`), one row per item
   group as the run card draws them (`run:<id>:<item or fold id>`) and its
   foot (`run:<id>:foot`), so one run of many calls is not one giant row.
   Whatever follows (the plan card, the live thinking block) closes the list.

   What a card shows when it is opened is kept outside it (useKeptOpen), so a
   row scrolled away and back comes back as it was. Rows are never recycled
   between different keys (`recycleItems={false}`): a card's state is its own.

   Staying at the end is ChatTranscript's (stickToBottom.ts); this list gives
   it the scroller and a way to reach the real end.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { LegendList, type LegendListRef } from '@legendapp/list/react';

import type { AgentRun, AgentRunStore, RunItem } from '../agents/agentRuns';
import { useStore } from '../state/connect';
import type { Turn } from '../state/types';
import { mergedApprovals, RunFoot, RunGroup, RunHead, runGroups, useTicking } from './AgentRunThread';
import { runCallbacks } from './AgentRunsPane';
import { setTranscriptRevealer, SCROLLER_ATTR, type RevealTarget } from './transcriptNav';
import { itemsBeforeTail, orderTurnsAndRuns, type OrderedItem } from './transcriptOrder';
import { revealScroll, stickyOffset } from './revealCard';

export type TranscriptRow =
  | { key: string; kind: 'turn'; turn: Turn }
  | { key: string; kind: 'run-head'; run: AgentRun }
  | { key: string; kind: 'run-group'; run: AgentRun; group: RunItem[]; merged: ReturnType<typeof mergedApprovals> }
  | { key: string; kind: 'run-foot'; run: AgentRun }
  | { key: string; kind: 'node'; node: ReactNode };

/** The rows, in the order the plain transcript draws them: turns and agent runs as they happened (transcriptOrder.ts), the plan card and live thinking after the last turn, then any runs after it. */
export function transcriptRows(
  turns: readonly Turn[],
  runs: readonly AgentRun[],
  head: ReactNode,
  tail: readonly { key: string; node: ReactNode }[],
  foot: readonly { key: string; node: ReactNode }[] = [],
): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  if (head) rows.push({ key: 'head', kind: 'node', node: head });
  const items = orderTurnsAndRuns(turns, runs);
  const split = itemsBeforeTail(items);
  const push = (it: OrderedItem): void => {
    if (it.kind === 'turn') {
      rows.push({ key: `turn:${it.turn.id}`, kind: 'turn', turn: it.turn });
      return;
    }
    const run = it.run;
    const merged = mergedApprovals(run);
    rows.push({ key: `run:${run.id}:head`, kind: 'run-head', run });
    for (const g of runGroups(run, merged)) rows.push({ key: `run:${run.id}:${g.key}`, kind: 'run-group', run, group: g.group, merged });
    rows.push({ key: `run:${run.id}:foot`, kind: 'run-foot', run });
  };
  items.slice(0, split).forEach(push);
  for (const t of tail) rows.push({ key: `tail:${t.key}`, kind: 'node', node: t.node });
  items.slice(split).forEach(push);
  for (const t of foot) rows.push({ key: `foot:${t.key}`, kind: 'node', node: t.node });
  return rows;
}

/** The row that holds `t`: an approval's tool call or approval item, else the run's head. */
export function rowIndexOf(rows: readonly TranscriptRow[], t: RevealTarget): number {
  if (t.requestId) {
    const at = rows.findIndex(
      (r) =>
        r.kind === 'run-group' &&
        r.run.id === t.runId &&
        r.group.some((i) => i.id === t.requestId || (i.kind === 'tool' && (r.merged.byTool.get(i.id) ?? []).some((a) => a.requestId === t.requestId))),
    );
    if (at !== -1) return at;
  }
  return rows.findIndex((r) => r.kind === 'run-head' && r.run.id === t.runId);
}

/* A row scrolled away is unmounted, so its cards leave the page; the toasts'
   own check (toastPlacement.ts) sees that and shows the toast (S1). */
function RowFrame({ row, children }: { row: TranscriptRow; children: ReactNode }) {
  const run = row.kind === 'run-head' || row.kind === 'run-group' || row.kind === 'run-foot' ? row.run : null;
  const user = row.kind === 'turn' && row.turn.role === 'user';
  return (
    <div
      className={`v3-vrow${run ? ' agrun agrun-part' : ''}${user ? ' is-user' : ''}`}
      data-row-key={row.key}
      data-kind={row.kind}
      {...(row.kind === 'run-head' ? { id: `agrun-${row.run.id}`, 'data-testid': 'agent-run', 'aria-label': `Agent run: ${row.run.prompt}` } : {})}
      {...(run ? { 'data-status': run.status } : {})}
    >
      {children}
    </div>
  );
}

export interface VirtualTranscriptApi {
  toEnd: () => void;
}

export default function VirtualTranscript({
  turns,
  renderTurn,
  runs,
  runStore,
  repoRoot,
  head,
  tail,
  foot = [],
  onScroller,
  api,
}: {
  turns: readonly Turn[];
  renderTurn: (turn: Turn) => ReactNode;
  runs: readonly AgentRun[];
  runStore: AgentRunStore;
  repoRoot: string | null;
  head?: ReactNode;
  tail: readonly { key: string; node: ReactNode }[];
  foot?: readonly { key: string; node: ReactNode }[];
  /** The element that scrolls, for stickToBottom. */
  onScroller: (el: HTMLElement | null) => void;
  api: { current: VirtualTranscriptApi | null };
}) {
  const app = useStore();
  const cb = useMemo(() => runCallbacks(runStore, app), [runStore, app]);
  const now = useTicking(runs.some((r) => r.status === 'running'));
  const rows = transcriptRows(turns, runs, head ?? null, tail, foot);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const listRef = useRef<LegendListRef>(null);

  useEffect(() => {
    api.current = { toEnd: () => void listRef.current?.scrollToEnd({ animated: false }) };
    const node = (listRef.current?.getScrollableNode?.() as HTMLElement | null) ?? null;
    onScroller(node);
    setTranscriptRevealer((t) => {
      const index = rowIndexOf(rowsRef.current, t);
      if (index === -1) return false;
      void listRef.current?.scrollToIndex(revealScroll(index, t.align, stickyOffset(node)));
      return true;
    });
    return () => {
      api.current = null;
      onScroller(null);
      setTranscriptRevealer(null);
    };
  }, [api, onScroller]);

  const renderRow = (row: TranscriptRow): ReactNode => {
    switch (row.kind) {
      case 'turn':
        return renderTurn(row.turn);
      case 'run-head':
        return <RunHead run={row.run} now={now} />;
      case 'run-group':
        return <RunGroup run={row.run} group={row.group} merged={row.merged} now={now} repoRoot={repoRoot} onAnswer={cb.onAnswer} onApply={cb.onApply} />;
      case 'run-foot':
        return <RunFoot run={row.run} onRetry={cb.onRetry} onBuild={cb.onBuild} onAskAgain={cb.onAskAgain} />;
      case 'node':
        return row.node;
    }
  };

  return (
    <LegendList<TranscriptRow>
      ref={listRef}
      className="v3-vlist"
      style={{ height: '100%', flex: 1, minHeight: 0 }}
      {...{ [SCROLLER_ATTR]: '' }}
      data={rows}
      extraData={now}
      keyExtractor={(row) => row.key}
      getItemType={(row) => row.kind}
      estimatedItemSize={72}
      recycleItems={false}
      initialScrollAtEnd
      renderItem={({ item }) => <RowFrame row={item}>{renderRow(item)}</RowFrame>}
    />
  );
}
