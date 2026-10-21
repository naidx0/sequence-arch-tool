import fs from 'node:fs';
import path from 'node:path';

import { act, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { replayFetch } from '../../test/support/replaySse';
import { createAgentRunStore, type AgentRun } from '../agents/agentRuns';
import '../agents/agentRunFold';
import type { QuestionAnswers, RunNodeEvent } from '../agents/runNodeStream';
import { startAttention, type RunSource } from '../notify/attention';
import type { RunLike } from '../notify/attentionModel';
import { AgentRunView, resetKeptOpen } from './AgentRunThread';
import { QuestionCard } from './QuestionCard';

/*
 * CODEX'S CLARIFYING QUESTION, IN THE CHAT.
 *
 * The stream is the golden the analyzer's relay test keeps
 * (fixtures/replay/sse-question/plan-question.sse.jsonl): the real server's
 * events while codex-question/plan-question (built around the request codex
 * sent live in the gate's Plan turn) replayed through it. Cut where the
 * question was put, it goes through the shipping run store and fold, and the
 * chat's run view draws it.
 *
 * Decision 49 (DeepSeek): while it waits, the question is asked in the
 * composer's takeover (shell2/Takeover.tsx draws this same QuestionCard), one
 * question at a time with a pager, the agent's recommendation preselected; the
 * thread's card says it waits and keeps the answer once settled.
 */

type Json = Record<string, unknown>;

const GOLDEN = path.resolve(__dirname, '..', '..', '..', 'acp', 'src', 'test', 'fixtures', 'replay', 'sse-question', 'plan-question.sse.jsonl');
const events = (): Json[] =>
  fs
    .readFileSync(GOLDEN, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Json);

/** The run as it stood when the question was put (the stream cut just after it). */
async function asked(): Promise<{ run: AgentRun; store: ReturnType<typeof createAgentRunStore>; asked: Json; settled: Json }> {
  const all = events();
  const at = all.findIndex((e) => e.type === 'acp:question' && e.pending === true);
  const { fetch } = replayFetch(all.slice(0, at + 1));
  const store = createAgentRunStore({ clock: () => 1000, fetch });
  const run = await store.start({ question: 'Plan a health check', access: 'ask', intent: 'plan' }, fetch);
  return { run, store, asked: all[at]!, settled: all.find((e) => e.type === 'acp:question' && e.pending === false)! };
}

/** The thread (the card's header and its waiting line) and the takeover's card, side by side. */
function view(run: AgentRun) {
  const sent: { runId: string; requestId: string; answers: QuestionAnswers | null }[] = [];
  const q = run.questions![0]!;
  const v = render(
    <>
      <AgentRunView run={run} now={1000} repoRoot={null} onAnswer={() => {}} />
      <QuestionCard question={q} onAnswer={(answers) => sent.push({ runId: run.id, requestId: q.requestId, answers })} />
    </>,
  );
  const card = v.getByTestId('agent-question');
  return { v, card, sent };
}

afterEach(() => resetKeptOpen());

describe('the question card (live-recorded request)', () => {
  it('renders: the thread says it waits; the card pages one question at a time, options with their keys and descriptions, a free-text field, the recommendation preselected', async () => {
    const { run, asked: e } = await asked();
    expect(run.questions).toHaveLength(1);
    const { v, card } = view(run);
    const header = v.container.querySelector('[data-kind="question"]') as HTMLElement;
    expect(header.getAttribute('data-status')).toBe('waiting');
    expect(within(header).getByTestId('agent-card-status').textContent).toBe('needs you');
    expect(within(header).getByTestId('agent-card-toggle').textContent).toContain('Question: Endpoint scope, Route contract');
    expect(within(header).getByTestId('agent-question-waiting').textContent).toContain('answer in the composer');
    expect(within(header).queryByTestId('agent-question')).toBeNull();
    const wire = e.questions as Json[];
    const items = within(card).getAllByTestId('agent-question-item');
    expect(items).toHaveLength(wire.length);
    items.forEach((item, i) => {
      const q = wire[i]!;
      expect(item.textContent).toContain(String(q.header));
      expect(item.textContent).toContain(String(q.question));
      const opts = within(item).getAllByTestId('agent-question-option');
      expect(opts.map((o) => o.textContent)).toEqual((q.options as Json[]).map((o, k) => `${k + 1}${String(o.label)}${String(o.description)}`));
      /* The whole description is on hover; the row cuts it to one line. */
      expect(opts.map((o) => o.getAttribute('title'))).toEqual((q.options as Json[]).map((o) => `${String(o.label)}: ${String(o.description)}`));
      expect(within(item).getByTestId('agent-question-text')).toBeTruthy();
      /* One question at a time. */
      expect(item.hidden).toBe(i !== 0);
      /* The agent's recommendation is preselected. */
      expect(opts.filter((o) => o.getAttribute('aria-checked') === 'true').map((o) => o.textContent)).toEqual([`1${String((q.options as Json[])[0]!.label)}${String((q.options as Json[])[0]!.description)}`]);
    });
    expect(within(card).getByTestId('agent-question-pager').textContent).toContain('1 of 2');
    /* Every question has an answer already, so Send is live. */
    expect((within(card).getByTestId('agent-question-send') as HTMLButtonElement).disabled).toBe(false);
  });

  it('pages with the arrows and the pager buttons; Send waits while a question has no answer', async () => {
    const { run } = await asked();
    const q = run.questions![0]!;
    const blank = { ...q, questions: q.questions.map((x) => ({ ...x, options: x.options.map((o) => ({ ...o, label: o.label.replace(' (Recommended)', '') })) })) };
    const sent: (QuestionAnswers | null)[] = [];
    const v = render(<QuestionCard question={blank} onAnswer={(a) => sent.push(a)} />);
    const card = v.getByTestId('agent-question');
    const items = within(card).getAllByTestId('agent-question-item');
    expect((within(card).getByTestId('agent-question-send') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(card, { key: '2' });
    fireEvent.keyDown(card, { key: 'ArrowRight' });
    expect(items[1]!.hidden).toBe(false);
    expect(within(card).getByTestId('agent-question-pager').textContent).toContain('2 of 2');
    fireEvent.keyDown(card, { key: '3' });
    fireEvent.click(v.getByRole('button', { name: 'Previous question' }));
    expect(items[0]!.hidden).toBe(false);
    fireEvent.keyDown(card, { key: 'y' });
    expect(sent).toEqual([{ health_scope: ['Readiness'], route_contract: ['Existing convention'] }]);
  });

  it('answers by option: one option per question, then Send carries each label', async () => {
    const { run } = await asked();
    const { card, sent } = view(run);
    const items = within(card).getAllByTestId('agent-question-item');
    fireEvent.click(within(items[0]!).getAllByTestId('agent-question-option')[1]!);
    fireEvent.click(within(items[1]!).getAllByTestId('agent-question-option')[0]!);
    expect(within(items[0]!).getAllByTestId('agent-question-option')[1]!.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(card).getByTestId('agent-question-send'));
    expect(sent).toEqual([{ runId: run.id, requestId: run.questions![0]!.requestId, answers: { health_scope: ['Readiness'], route_contract: ['GET /health JSON (Recommended)'] } }]);
  });

  it('answers by option with the keys: 1, the next page, 1, then Y', async () => {
    const { run } = await asked();
    const { card, sent } = view(run);
    fireEvent.keyDown(card, { key: '1' });
    fireEvent.keyDown(card, { key: 'ArrowRight' });
    fireEvent.keyDown(card, { key: '1' });
    fireEvent.keyDown(card, { key: 'y' });
    expect(sent.map((s) => s.answers)).toEqual([{ health_scope: ['Liveness only (Recommended)'], route_contract: ['GET /health JSON (Recommended)'] }]);
  });

  it('answers by free text: the words win over an option, and Enter in the field sends', async () => {
    const { run } = await asked();
    const { card, sent } = view(run);
    const items = within(card).getAllByTestId('agent-question-item');
    fireEvent.click(within(items[0]!).getAllByTestId('agent-question-option')[0]!);
    fireEvent.change(within(items[0]!).getByTestId('agent-question-text'), { target: { value: 'Liveness, and check the orders DB' } });
    const field = within(items[1]!).getByTestId('agent-question-text');
    fireEvent.change(field, { target: { value: 'Match gateway' } });
    /* A letter typed in the field is a letter, not an answer key. */
    fireEvent.keyDown(field, { key: 'n' });
    expect(sent).toEqual([]);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(sent.map((s) => s.answers)).toEqual([{ health_scope: ['Liveness, and check the orders DB'], route_contract: ['Match gateway'] }]);
  });

  it('cancel: the button (and N) answers with none', async () => {
    const { run } = await asked();
    const { card, sent } = view(run);
    fireEvent.click(within(card).getByTestId('agent-question-cancel'));
    fireEvent.keyDown(card, { key: 'n' });
    expect(sent.map((s) => s.answers)).toEqual([null, null]);
  });

  it('through the store: Send posts to /api/acp/question, the card says sending, and the settling event folds it to one row', async () => {
    const all = events();
    const at = all.findIndex((e) => e.type === 'acp:question' && e.pending === true);
    const { fetch, calls } = replayFetch(all.slice(0, at + 1));
    const store = createAgentRunStore({ clock: () => 1000, fetch });
    const run = await store.start({ question: 'Plan', access: 'ask' }, fetch);
    const { answerQuestion } = await import('../agents/runNodeStream');
    const requestId = run.questions![0]!.requestId;
    store.apply(run.id, { type: 'acp:question', requestId, sending: true });
    expect(await answerQuestion(requestId, { health_scope: ['Readiness'] }, fetch)).toBe(true);
    expect(calls.at(-1)).toEqual({ url: '/api/acp/question', body: { requestId, answers: { health_scope: ['Readiness'] } } });
    expect(await answerQuestion(requestId, null, fetch)).toBe(true);
    expect(calls.at(-1)?.body).toEqual({ requestId, cancel: true });
    const sending = store.get().runs[0]!;
    const v1 = render(
      <>
        <AgentRunView run={sending} now={1000} repoRoot={null} onAnswer={() => {}} />
        <QuestionCard question={sending.questions![0]!} onAnswer={() => {}} />
      </>,
    );
    expect(v1.getByTestId('agent-card-status').textContent).toBe('sending');
    expect(v1.getByTestId('agent-question-waiting').textContent).toContain('Sending your answer');
    expect((v1.getByTestId('agent-question-send') as HTMLButtonElement).textContent).toContain('Sending');
    v1.unmount();
    store.apply(run.id, all.find((e) => e.type === 'acp:question' && e.pending === false) as RunNodeEvent);
    const done = store.get().runs[0]!;
    const v2 = render(<AgentRunView run={done} now={1000} repoRoot={null} onAnswer={() => {}} />);
    const row = v2.getByTestId('agent-question-folded');
    expect(row.textContent).toContain('Answered by you');
    expect(row.textContent).toContain('Endpoint scope: Liveness only (Recommended)');
    expect(v2.queryByTestId('agent-question')).toBeNull();
  });

  it('turn end while waiting: the question settles as ended, folds to one row, and nothing is left to answer', async () => {
    const { run, store } = await asked();
    store.apply(run.id, { type: 'acp:question', requestId: run.questions![0]!.requestId, pending: false, answers: null, answeredBy: 'ended' });
    store.apply(run.id, { type: 'acp:result', stopReason: 'cancelled', text: '' });
    const after = store.get().runs[0]!;
    const v = render(<AgentRunView run={after} now={1000} repoRoot={null} onAnswer={() => {}} />);
    expect(v.getByTestId('agent-card-status').textContent).toBe('turn ended');
    /* Settled before it was ever drawn, it starts closed; opened, it is the one row. */
    fireEvent.click(v.getByTestId('agent-card-toggle'));
    expect(v.getByTestId('agent-question-folded').getAttribute('data-answered-by')).toBe('ended');
    expect(v.getByTestId('agent-question-folded').textContent).toContain('The turn ended before anyone answered');
    expect((v.container.querySelector('[data-kind="question"]') as HTMLElement).getAttribute('data-status')).toBe('denied');
    expect(v.queryByTestId('agent-question-send')).toBeNull();
  });
});

describe('the question while the window is hidden (S5)', () => {
  function source(runs: RunLike[]): RunSource & { set(r: RunLike[]): void } {
    let now = runs;
    const fns = new Set<() => void>();
    return {
      get: () => ({ runs: now }),
      subscribe: (fn) => (fns.add(fn), () => fns.delete(fn)),
      set: (r) => {
        now = r;
        for (const f of [...fns]) f();
      },
    };
  }

  it('a question that starts waiting while hidden is notified, counted on the badge, and not again once seen', async () => {
    const { run } = await asked();
    const before: RunLike = { ...run, questions: [] };
    const runs = source([before]);
    const shown: { title: string; body: string }[] = [];
    const badge: number[] = [];
    let visible = false;
    const h = startAttention({
      runs,
      isVisible: () => visible,
      desktop: null,
      browser: { permission: () => 'granted', show: (title, body) => void shown.push({ title, body }) },
      prefs: () => true,
      focusChat: () => {},
    });
    act(() => runs.set([run]));
    expect(shown).toHaveLength(1);
    expect(shown[0]!.title).toBe('Codex has a question');
    expect(shown[0]!.body).toContain('What should the health endpoint represent?');
    act(() => runs.set([run]));
    expect(shown).toHaveLength(1);
    h.stop();
    /* The desktop badge counts it as waiting. */
    const d = startAttention({
      runs: source([run]),
      isVisible: () => visible,
      desktop: { attention: async (req) => void (req.kind === 'waiting' && badge.push(req.count)) },
      browser: null,
      prefs: () => true,
      focusChat: () => {},
      seed: 'runs',
    });
    expect(badge).toEqual([1]);
    d.stop();
    /* Visible: not notified. */
    visible = true;
    const seen: string[] = [];
    const v = startAttention({ runs: source([before]), isVisible: () => true, desktop: null, browser: { permission: () => 'granted', show: (t) => void seen.push(t) }, prefs: () => true, focusChat: () => {} });
    v.stop();
    expect(seen).toEqual([]);
  });
});
