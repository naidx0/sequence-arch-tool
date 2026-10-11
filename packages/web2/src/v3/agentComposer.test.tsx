import fs from 'node:fs';
import path from 'node:path';

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SSE_GOLDEN, readGolden } from '../../test/support/replaySse';
import { agentActivity, limitsText, usageChip } from '../agents/agentActivity';
import { agentRuns, type AgentCaps } from '../agents/agentRuns';
import '../agents/agentRunFold';
import { agentSlash } from '../agents/agentRunner';
import type { RunNodeEvent } from '../agents/runNodeStream';
import { createStore } from '../state';
import { V3App } from './V3App';

/*
 * S2b IN THE COMPOSER: a chat that talks to an agent sends to it; its `/`
 * offers the CLI's own commands and skills; its model menu is the agent's
 * models and efforts; the header shows context and cost with Compact; the
 * strip shows the agent's todos.
 *
 * What the agent offers comes from what the real server answered while the
 * codex-s2b capabilities fixture replayed (sse-s2b/capabilities.json, not
 * run live), and Claude's commands from the claude-plan-mode fixture (not
 * run live). Runs are fed the recorded streams (fixtures/replay/sse).
 */

type Json = Record<string, unknown>;

const S2B = path.join(SSE_GOLDEN, '..', 'sse-s2b');
const codexCaps = JSON.parse(fs.readFileSync(path.join(S2B, 'capabilities.json'), 'utf8')) as AgentCaps & { agentRef: string };
const claudeCommands = (() => {
  const lines = fs
    .readFileSync(path.join(SSE_GOLDEN, '..', 'claude', 'claude-plan-mode.jsonl'), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Json);
  const u = lines.map((l) => ((l.msg as Json)?.params as Json)?.update as Json).find((x) => x?.sessionUpdate === 'available_commands_update')!;
  return (u.availableCommands as Json[]).map((c) => ({ name: String(c.name), description: String(c.description) }));
})();

let posted: Json[] = [];

beforeEach(() => {
  posted = [];
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/acp/run-node')) {
        posted.push(JSON.parse(String(init?.body)) as Json);
        return new Promise<Response>(() => {});
      }
      if (url.startsWith('/api/acp/capabilities')) return new Response(JSON.stringify(codexCaps), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Promise<Response>(() => {});
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  agentRuns.patch((s) => ({ ...s, agents: {}, caps: {}, config: {} }));
});

function app(chat: string) {
  const store = createStore({});
  store.dispatch({ type: 'session/index', sessions: [{ id: chat, title: 'Agent chat', pinned: false, updatedAt: '2026-01-01' }], activeId: chat } as never);
  render(<V3App appStore={store} />);
  return store;
}

/** The first run answered and ended: the next Enter is a new turn (while it runs, Enter steers it, S5). */
const ENDED: Json[] = [{ type: 'acp:result', text: 'Done.' }];

async function startIn(chat: string, events: Json[] = []) {
  await act(async () => {
    void agentRuns.start({ agentRef: 'codex', question: 'first', access: 'ask', sessionId: chat }, () => new Promise<Response>(() => {}));
  });
  const id = agentRuns.get().runs.filter((r) => r.sessionId === chat).at(-1)!.id;
  act(() => {
    for (const e of events) agentRuns.apply(id, e as RunNodeEvent);
  });
  return id;
}

const send = async (text: string) => {
  const field = screen.getByTestId('composer-field');
  fireEvent.change(field, { target: { value: text } });
  await act(async () => {
    fireEvent.keyDown(field, { key: 'Enter' });
    await Promise.resolve();
  });
};

describe('a chat that talks to an agent', () => {
  it('the composer sends to the agent, in this chat, with its mode', async () => {
    app('s2b-send');
    await startIn('s2b-send', ENDED);
    await send('And now the tests?');
    await waitFor(() => expect(posted.length).toBeGreaterThan(0));
    const body = posted.at(-1)!;
    expect([body.agentRef, body.prompt, body.chatId]).toEqual(['codex', 'And now the tests?', 's2b-send']);
    expect(String(body.sessionKey)).toBe('chat::s2b-send::codex');
    expect((screen.getByTestId('composer-field') as HTMLTextAreaElement).value).toBe('');
  });

  it('`/` offers the CLI\'s own commands and skills under the agent\'s name; a command with words goes to the agent as typed', async () => {
    app('s2b-slash');
    await startIn('s2b-slash', ENDED);
    act(() => agentRuns.patch((s) => ({ ...s, caps: { ...s.caps, codex: { ...codexCaps, commands: claudeCommands, slash: agentSlash({ ...codexCaps, commands: claudeCommands }) } } })));
    fireEvent.change(screen.getByTestId('composer-field'), { target: { value: '/' } });
    const palette = await screen.findByTestId('v3-slash');
    const section = palette.querySelector('[data-group="agent"]') as HTMLElement;
    expect(section.querySelector('.s2-menu-gh')?.textContent).toBe('Codex');
    const names = [...section.querySelectorAll('[data-testid="v3-slash-item"]')].map((b) => b.getAttribute('data-command'));
    expect(names).toEqual(['compact', 'review', 'init', 'release-notes']);
    await send('/review 12');
    await waitFor(() => expect(posted.at(-1)?.prompt).toBe('/review 12'));
  });

  it('the model menu is the agent\'s: its models (from model/list) and efforts; the pick goes on the next run; "Use a Sequence model" detaches', async () => {
    app('s2b-model');
    await startIn('s2b-model', ENDED);
    fireEvent.click(screen.getByTestId('v3-model-trigger'));
    /* The agent's row opens its models to the right. */
    fireEvent.click(await screen.findByTestId('s2-agent-row'));
    const rows = await screen.findAllByTestId('agent-model');
    expect(rows.map((r) => r.getAttribute('data-model'))).toEqual(['gpt-5-codex', 'gpt-5']);
    expect(rows[0]!.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(rows[1]!);
    const efforts = screen.getAllByTestId('agent-effort').map((b) => b.getAttribute('data-effort'));
    expect(efforts).toEqual(['minimal', 'low', 'medium', 'high']);
    fireEvent.click(screen.getAllByTestId('agent-effort').find((b) => b.getAttribute('data-effort') === 'high')!);
    await send('Use GPT-5.');
    await waitFor(() => expect(posted.at(-1)?.prompt).toBe('Use GPT-5.'));
    expect(posted.at(-1)!.config).toEqual({ model: 'gpt-5', effort: 'high' });
    fireEvent.click(screen.getByTestId('agent-detach'));
    expect(screen.getByTestId('v3-model-trigger').getAttribute('data-action')).not.toBe('agent');
  });

  it('live edit-with-plan: the status bar\'s ring measures the agent\'s usage and its panel names the account\'s limit; Compact (in +) asks the agent to compact', async () => {
    app('s2b-head');
    await startIn('s2b-head', readGolden('edit-with-plan'));
    /* The ring lives in the status bar under the chat: no number, the measurement in its panel. */
    const ring = within(await screen.findByTestId('s2-status-context')).getByTestId('composer-context');
    expect(ring.textContent).toBe('');
    expect(Math.round(Number(ring.getAttribute('data-fraction')) * 100)).toBe(10);
    fireEvent.click(ring);
    expect(screen.getByTestId('composer-context-note').textContent).toMatch(/^free plan\. Limit: 52% used of the 30-day window/);
    fireEvent.click(ring);
    fireEvent.click(screen.getByTestId('v3-tools-trigger'));
    fireEvent.click(screen.getByTestId('agent-compact'));
    await waitFor(() => expect(posted.at(-1)?.compact).toBe(true));
    expect(posted.at(-1)!.chatId).toBe('s2b-head');
  });

  it('todo-plan-synthetic (not run live), mid-turn: the agent\'s todo list is its plan card in the thread, and the status bar says what it is doing', async () => {
    app('s2b-strip');
    const events = readGolden('todo-plan-synthetic');
    const firstPlan = events.findIndex((e) => e.type === 'acp:update' && ((e.update as Json).update as Json).sessionUpdate === 'plan');
    await startIn('s2b-strip', events.slice(0, firstPlan + 1));
    const plan = await screen.findByTestId('agent-card-plan');
    fireEvent.click(within(plan).getByTestId('agent-card-toggle'));
    expect(plan.textContent).toMatch(/Inspect module setup and imports/);
    expect(plan.textContent).toMatch(/Summarise what the file does/);
  });
});

describe('agentActivity, the value the strip, header and board share', () => {
  it('reads todos, usage and limits from the chat\'s runs', () => {
    const state = { runs: [], dismissed: new Set<string>(), agents: { c: 'codex' } } as never;
    expect(agentActivity(state, 'c')).toMatchObject({ agentRef: 'codex', latest: null, todos: [], subagents: [] });
    expect(agentActivity(state, 'other')).toBeNull();
    expect(usageChip({ used: 41_000, size: 200_000, cost: { amount: 0.04, currency: 'USD' } })).toBe('21% ctx, $0.04');
    expect(usageChip(null)).toBeNull();
    expect(limitsText({ plan: null, primary: { usedPercent: 10, windowMins: 300, resetsAt: null }, secondary: null })).toBe('Limit: 10% used of the 5-hour window');
  });
});
