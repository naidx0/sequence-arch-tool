import fs from 'node:fs';
import path from 'node:path';

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import '../agents/agentRunFold';
import { createAgentRunStore, type AgentRunStore } from '../agents/agentRuns';
import type { QuestionAnswers, RunNodeEvent } from '../agents/runNodeStream';
import { replayFetch } from '../../test/support/replaySse';
import { AgentRunView, resetKeptOpen, resetRevealedQuestions } from './AgentRunThread';
import { AgentToasts, toastsFor } from './AgentToasts';
import { setTranscriptRevealer, type RevealTarget } from './transcriptNav';
import { Takeover } from '../shell2/Takeover';

/*
 * PARITY WITH APPROVALS: the agent's question, out of view, raises the same
 * in-app toast with "Show in chat", and while it is the only thing waiting
 * its keys work from anywhere that is not a text field. On the relay's
 * golden stream of the live-recorded request.
 *
 * Decision 49 (DeepSeek): the question is answered in the composer's takeover,
 * so "Show in chat" brings the thread's card into view and puts the keys on
 * the takeover's card, and the page's keys go there too.
 */

type Json = Record<string, unknown>;

const GOLDEN = path.resolve(__dirname, '..', '..', '..', 'acp', 'src', 'test', 'fixtures', 'replay', 'sse-question', 'plan-question.sse.jsonl');
const events = (): Json[] =>
  fs
    .readFileSync(GOLDEN, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Json);

async function asked(extra: RunNodeEvent[] = []): Promise<AgentRunStore> {
  const all = events();
  const at = all.findIndex((e) => e.type === 'acp:question' && e.pending === true);
  const { fetch } = replayFetch([...all.slice(0, at + 1), ...(extra as unknown as Json[])]);
  const store = createAgentRunStore({ clock: () => 1000, fetch });
  await store.start({ question: 'Plan', access: 'ask', intent: 'plan', agentRef: 'codex' }, fetch);
  return store;
}

const hadScroll = 'scrollIntoView' in HTMLElement.prototype;
if (!hadScroll) (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView = function () {};

afterEach(() => {
  resetKeptOpen();
  resetRevealedQuestions();
  setTranscriptRevealer(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the question toast', () => {
  it('ranks a waiting question with the approvals, and drops it once settled', async () => {
    const store = await asked();
    /* (The cut stream ends the run without a result, so a failed-run toast follows.) */
    expect(toastsFor(store.get())[0]?.kind).toBe('question');
    const run = store.get().runs[0]!;
    store.apply(run.id, { type: 'acp:question', requestId: run.questions![0]!.requestId, pending: false, answers: null, answeredBy: 'cancel' });
    expect(toastsFor(store.get()).some((s) => s.kind === 'question')).toBe(false);
  });

  it('shows "has a question" with the first question; Show in chat brings the card\'s top into view and focuses it', async () => {
    const store = await asked();
    const run = store.get().runs[0]!;
    const view = render(
      <>
        <AgentRunView run={run} now={1000} repoRoot={null} onAnswer={() => {}} onQuestion={() => {}} />
        <Takeover store={store} sessionId={run.sessionId} repoRoot={null} draftKept={false} onQuestion={() => {}} />
      </>,
    );
    const scrolled: { id: string; arg: unknown }[] = [];
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement, arg?: boolean | ScrollIntoViewOptions) {
      scrolled.push({ id: this.id, arg });
    });
    render(<AgentToasts store={store} repoRoot={null} />);
    const toast = screen.getAllByTestId('agent-toast').find((t) => t.getAttribute('data-kind') === 'question')!;
    expect(toast.textContent).toContain('codex has a question');
    expect(toast.textContent).toContain('What should the health endpoint represent?');
    fireEvent.click(screen.getByTestId('agent-toast-show'));
    const id = run.questions![0]!.requestId;
    expect(scrolled).toEqual([{ id: `agcard-${id}`, arg: { block: 'start', behavior: 'smooth' } }]);
    expect(document.activeElement).toBe(view.getByTestId('agent-question'));
  });

  it('Show in chat for a card not on the page asks the list for its row, top-aligned', async () => {
    const store = await asked();
    const asks: RevealTarget[] = [];
    setTranscriptRevealer((t) => (asks.push(t), true));
    render(<AgentToasts store={store} repoRoot={null} />);
    fireEvent.click(screen.getByTestId('agent-toast-show'));
    const run = store.get().runs[0]!;
    expect(asks).toEqual([{ runId: run.id, requestId: run.questions![0]!.requestId, align: 'top' }]);
  });

  it('Cancel on the toast answers with none', async () => {
    const store = await asked();
    const posted: unknown[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      posted.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response('{}', { status: 200 });
    });
    render(<AgentToasts store={store} repoRoot={null} />);
    fireEvent.click(screen.getByTestId('agent-toast-cancel'));
    const run = store.get().runs[0]!;
    expect(posted).toEqual([{ url: '/api/acp/question', body: { requestId: run.questions![0]!.requestId, cancel: true } }]);
  });
});

describe('the question keys from anywhere', () => {
  async function rig(extra: RunNodeEvent[] = []) {
    const store = await asked(extra);
    const run = store.get().runs[0]!;
    const sent: (QuestionAnswers | null)[] = [];
    render(
      <>
        <input aria-label="composer" />
        <AgentRunView run={run} now={1000} repoRoot={null} onAnswer={() => {}} />
        <Takeover store={store} sessionId={run.sessionId} repoRoot={null} draftKept={false} onQuestion={(_r, _q, a) => sent.push(a)} />
        <AgentToasts store={store} repoRoot={null} />
      </>,
    );
    return { sent };
  }

  it('2, then y from the page (focus not in a text field) answers the only waiting question by option', async () => {
    const { sent } = await rig();
    /* Each its own event (and render), as a person types them. The second
       question keeps the agent's recommendation, which is preselected. */
    for (const key of ['2', 'y']) act(() => void fireEvent.keyDown(document.body, { key }));
    expect(sent).toEqual([{ health_scope: ['Readiness'], route_contract: ['GET /health JSON (Recommended)'] }]);
  });

  it('n from the page cancels it', async () => {
    const { sent } = await rig();
    act(() => void fireEvent.keyDown(document.body, { key: 'n' }));
    expect(sent).toEqual([null]);
  });

  it('a key typed in a text field (the composer) is a letter, not an answer', async () => {
    const { sent } = await rig();
    const composer = screen.getByLabelText('composer');
    composer.focus();
    act(() => {
      fireEvent.keyDown(composer, { key: '1' });
      fireEvent.keyDown(composer, { key: 'n' });
    });
    expect(sent).toEqual([]);
  });

  it('with an approval also waiting, the keys belong to neither alone', async () => {
    const { sent } = await rig([{ type: 'acp:permission', requestId: 'appr-1', pending: true, decision: null, toolKind: 'execute', title: 'Run ls', proposal: { title: 'Run ls', files: [] } } as RunNodeEvent]);
    act(() => void fireEvent.keyDown(document.body, { key: 'n' }));
    expect(sent).toEqual([]);
  });
});
