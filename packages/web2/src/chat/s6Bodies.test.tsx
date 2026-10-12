import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readGolden, replayFetch } from '../../test/support/replaySse';
import { foldRunEvent } from '../agents/agentRunFold';
import { createAgentRunStore, type AgentRun } from '../agents/agentRuns';
import { setRunFrameClock } from '../agents/agentRunner';
import type { RunNodeEvent } from '../agents/runNodeStream';
import { fromChatMemory, toChatMemory } from '../sessions/chatMemory';
import { createStore } from '../state';
import type { FrameClock } from '../state/frameQueue';
import type { AssistantTurn } from '../state/types';
import { AgentRunView, resetKeptOpen } from './AgentRunThread';
import { cappedOf, resetStreamBodies, streamBodyUrl, withStringAt } from './cappedBody';
import { anchorRowTop, HOLD_EVENT, SCROLLER_ATTR } from './transcriptNav';
import { WorkRowLine } from './WorkRowLine';

/*
 * S6, BOUNDED PAYLOADS ON THE PAGE. The server cuts a body over 8 KB and
 * names it on the event: `capped: [{ at, id, bytes, shownBytes }]` (analyzer
 * streamBodies.ts). "Show all (N KB)" fetches GET /api/stream-body and puts
 * the whole string back at `at`. And the run stream is applied a frame at a
 * time.
 */

type Json = Record<string, unknown>;
const ID = 'a'.repeat(32);
const WHOLE = Array.from({ length: 400 }, (_, i) => `line ${i}: résumé output`).join('\n');
const HEAD = WHOLE.slice(0, 120);

afterEach(() => {
  resetStreamBodies();
  resetKeptOpen();
  setRunFrameClock(undefined);
  vi.unstubAllGlobals();
});

const capped = (at: (string | number)[]) => [{ at, id: ID, bytes: 48_213, shownBytes: 120 }];

function runWith(events: RunNodeEvent[]): AgentRun {
  let run: AgentRun = { id: 'run-1', sessionId: 's1', agentRef: 'codex', nodeId: null, nodeLabel: null, prompt: 'build it', status: 'running', startedAt: 0, endedAt: null, items: [], approvals: [], error: null };
  for (const e of events) run = foldRunEvent(run, e, 10);
  return run;
}

const outputUpdate = (text: string, extra: Json = {}): RunNodeEvent =>
  ({
    type: 'acp:update',
    update: { sessionId: 't', update: { sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text } }] } },
    ...extra,
  }) as RunNodeEvent;

describe('the marker and the path', () => {
  it('reads valid entries only, and puts a string back at its path without touching the rest', () => {
    expect(cappedOf({ capped: [...capped(['output']), { at: ['x'], id: 'nope', bytes: 1, shownBytes: 1 }, null] })).toEqual(capped(['output']));
    expect(cappedOf({})).toEqual([]);
    const e = { type: 'acp:update', update: { update: { content: [{ type: 'content', content: { type: 'text', text: 'cut' } }], other: { keep: 1 } } } };
    const back = withStringAt(e, ['update', 'update', 'content', 0, 'content', 'text'], 'whole');
    expect(((back.update.update.content[0] as Json).content as Json).text).toBe('whole');
    expect(back.update.update.other).toBe(e.update.update.other);
    expect(((e.update.update.content[0] as Json).content as Json).text).toBe('cut');
    expect(streamBodyUrl(ID, 's1')).toBe(`/api/stream-body?id=${ID}&chat=s1`);
  });
});

describe('"Show all" on a capped tool output', () => {
  it('fetches the whole body for this chat and puts it back where it was cut; the card shows all of it', async () => {
    const store = createAgentRunStore({ fetch: async () => new Response('{}') });
    const events = [
      { type: 'acp:update', update: { sessionId: 't', update: { sessionUpdate: 'tool_call', toolCallId: 'call-1', title: 'npm test', kind: 'execute', status: 'in_progress' } } } as RunNodeEvent,
      outputUpdate(HEAD, { capped: capped(['update', 'update', 'content', 0, 'content', 'text']) }),
    ];
    const run = runWith(events);
    store.patch((s) => ({ ...s, runs: [run] }));
    const fetched: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        fetched.push(url);
        return new Response(WHOLE, { status: 200, headers: { 'content-type': 'text/plain' } });
      }),
    );
    const view = () => <AgentRunView run={store.get().runs[0]!} now={20} repoRoot={null} onAnswer={() => {}} onApply={(id, e) => store.apply(id, e)} />;
    const r = render(view());
    fireEvent.click(screen.getByTestId('agent-card-toggle'));
    expect(screen.getByTestId('agent-card-body').textContent).toContain(HEAD);
    const button = screen.getByRole('button', { name: 'Show all of this output (47 KB)' });
    expect(button.textContent).toBe('Show all (47 KB)');
    await act(async () => {
      fireEvent.click(button);
      await new Promise((res) => setTimeout(res, 0));
    });
    expect(fetched).toEqual([`/api/stream-body?id=${ID}&chat=s1`]);
    r.rerender(view());
    const tool = store.get().runs[0]!.items[0] as { output: string; status: string; capped?: unknown };
    expect(tool.output).toBe(WHOLE);
    expect(tool.status).toBe('done');
    expect(tool.capped).toBeUndefined();
    expect(within(screen.getByTestId('agent-card-body')).getByText(/line 399/)).toBeTruthy();
    expect(screen.queryByTestId('agent-card-show-all')).toBeNull();
  });

  it('a body the server no longer keeps (404) says so and leaves the start shown', async () => {
    const run = runWith([outputUpdate(HEAD, { capped: capped(['update', 'update', 'content', 0, 'content', 'text']) })]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no such body', { status: 404 })));
    render(<AgentRunView run={run} now={20} repoRoot={null} onAnswer={() => {}} onApply={() => {}} />);
    fireEvent.click(screen.getByTestId('agent-card-toggle'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('agent-card-show-all'));
      await new Promise((res) => setTimeout(res, 0));
    });
    /* A running turn now also draws its own live-activity status (R9); the note is the one in the card. */
    expect(within(screen.getByTestId('agent-card-body')).getByRole('status').textContent).toBe('The full output is no longer kept.');
    expect(screen.getByTestId('agent-card-body').textContent).toContain(HEAD);
  });
});

describe('the opened row keeps its place on screen', () => {
  it('anchors on the row, not the scroll offset: however far the row moved, the scroller moves with it, and following stops', () => {
    const scroller = document.createElement('div');
    scroller.setAttribute(SCROLLER_ATTR, '');
    const row = document.createElement('div');
    row.setAttribute('data-row-key', 'run:r:call-1');
    const inner = document.createElement('div');
    row.appendChild(inner);
    scroller.appendChild(row);
    document.body.appendChild(scroller);
    let rowTop = 140;
    scroller.getBoundingClientRect = () => ({ top: 40 }) as DOMRect;
    row.getBoundingClientRect = () => ({ top: rowTop }) as DOMRect;
    scroller.scrollTop = 500;
    const holds: number[] = [];
    scroller.addEventListener(HOLD_EVENT, () => holds.push(1));
    const restore = anchorRowTop(inner);
    expect(holds).toHaveLength(1);
    /* Something above grew by 60 px and pushed the row down. */
    rowTop = 200;
    restore();
    expect(scroller.scrollTop).toBe(560);
    /* Nothing moved: nothing changes. */
    const again = anchorRowTop(inner);
    again();
    expect(scroller.scrollTop).toBe(560);
    scroller.remove();
  });
});

describe('a command output cut by the ask stream', () => {
  it('keeps its marker with the turn through chat memory, and "Show all" fetches the rest', async () => {
    const store = createStore();
    store.dispatch({ type: 'composer/draft', text: 'run the tests' });
    store.dispatch({ type: 'turn/send', at: 1 });
    store.dispatch({ type: 'turn/event', event: { type: 'command:log', cmd: 'npm test', exitCode: 0, ok: true, output: HEAD, capped: capped(['output']) } as never, at: 2 });
    store.dispatch({ type: 'turn/event', event: { type: 'result', text: 'done' } as never, at: 3 });
    const turn = store.getState().session.turns.find((t): t is AssistantTurn => t.role === 'assistant')!;
    const row = turn.work.find((w) => w.from === 'command:log')!;
    expect(row.outcome).toEqual({ kind: 'exit', code: 0, output: HEAD, capped: { id: ID, bytes: 48_213, shownBytes: 120 } });
    /* A reload: the memory round trip keeps it. */
    const back = fromChatMemory(JSON.parse(JSON.stringify(toChatMemory('s1', store.getState().session.turns))));
    const kept = (back.find((t) => t.role === 'assistant') as AssistantTurn).work.find((w) => w.from === 'command:log')!;
    expect(kept.outcome).toEqual(row.outcome);

    const fetched: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        fetched.push(url);
        return new Response(WHOLE, { status: 200 });
      }),
    );
    render(
      <div className="chat-scope">
        <WorkRowLine row={kept} />
      </div>,
    );
    const button = await screen.findByRole('button', { name: 'Show all of this output (47 KB)' }, { timeout: 10_000 });
    await act(async () => {
      fireEvent.click(button);
      await new Promise((res) => setTimeout(res, 0));
    });
    expect(fetched).toEqual([`/api/stream-body?id=${ID}`]);
    expect(screen.getByTestId('chat-command-output-full').textContent).toBe(WHOLE);
  });
});

describe('a run streams into the page once per frame', () => {
  it('todo-plan (recorded): the whole stream is a handful of notifications, not one per event, and ends the same', async () => {
    const events = readGolden('todo-plan');
    /* Frames that never come: only the urgent events (the result) apply what waits. */
    const clock: FrameClock = { frame: () => 1, cancelFrame: () => {}, timer: () => 2, cancelTimer: () => {}, hidden: () => false, onVisibility: () => () => {} };
    setRunFrameClock(clock);
    const framed = createAgentRunStore({ fetch: replayFetch(events).fetch });
    let told = 0;
    framed.subscribe(() => (told += 1));
    const run = await framed.start({ agentRef: 'codex', question: 'go', sessionId: 's1' });
    /* The same stream folded one event at a time, for comparison. */
    let direct = runWith([]);
    for (const e of events) direct = foldRunEvent(direct, e as unknown as RunNodeEvent, 10);
    console.log(`  S6 todo-plan into the run store: ${events.length} events -> ${told} notifications`);
    /* The server now coalesces message chunks (21957570), so the golden fell from
       191 events to 51 and the same 6 notifications no longer clear a tenth.
       The property is unchanged: a handful, independent of how many events came. */
    expect(told).toBeLessThanOrEqual(6);
    expect(told).toBeLessThan(events.length / 8);
    expect(run.status).toBe('done');
    expect(run.items.map((i) => i.kind)).toEqual(direct.items.map((i) => i.kind));
    const text = (r: AgentRun) =>
      r.items
        .filter((i) => i.kind === 'message')
        .map((i) => (i as { text: string }).text)
        .join('');
    expect(text(run)).toBe(text(direct));
  });
});
