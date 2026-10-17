import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgentRunStore } from '../agents/agentRuns';
import { applyProfile, profileMention, profileQuery, resetProfiles, type AgentProfile } from './agentProfiles';
import { SLASH_GROUP_ORDER, slashCommands, slashGroupOf } from './composerModel';

/**
 * AGENT PROFILES: `@review find what breaks` sends one message in a role read
 * from the agent files people already have. The chat keeps what was typed; the
 * agent gets the role's instructions; a read-only role runs that message in Plan.
 */

const REVIEW: AgentProfile = { name: 'review', description: 'Reviews', prompt: 'You are a code reviewer.', readOnly: true, source: 'builtin', format: 'builtin' };
const TEST: AgentProfile = { name: 'test', description: 'Writes tests', prompt: 'You write tests.', readOnly: false, source: 'project', format: 'claude', file: '.claude/agents/test.md' };

afterEach(() => resetProfiles());

function sse(events: unknown[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const e of events) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

describe('agent profiles', () => {
  it('a mention is @name at the very start, nowhere else', () => {
    expect(profileMention('@review the parser')).toEqual({ name: 'review', rest: 'the parser' });
    expect(profileMention('@Review')).toEqual({ name: 'review', rest: '' });
    expect(profileMention('please @review this')).toBeNull();
    expect(profileMention('email me@review.dev')).toBeNull();
    expect(profileMention('@review,now')).toBeNull();
  });

  it('a known profile puts its instructions in front; an unknown @name changes nothing', () => {
    const p = applyProfile('@review the parser', '@review the parser\n[drawing: d1]', [REVIEW, TEST]);
    expect(p?.profile.name).toBe('review');
    expect(p?.agentText).toMatch(/act as the "review" agent profile\. This message runs read-only/);
    expect(p?.agentText).toMatch(/You are a code reviewer\.\n\n\[The request:\]\nthe parser\n\[drawing: d1\]$/);
    expect(applyProfile('@someone hi', '@someone hi', [REVIEW])).toBeNull();
    expect(applyProfile('hi', 'hi', [REVIEW])).toBeNull();
  });

  it('a leading @word, alone, opens the profile menu; a sentence or a space does not', () => {
    expect([profileQuery('@'), profileQuery('@Re'), profileQuery('@review '), profileQuery('hi @re'), profileQuery('/re')]).toEqual(['', 're', null, null, null]);
  });

  it('the hint drops "(read-only)" when the description already says it edits nothing', () => {
    const rows = slashCommands([], [], { profiles: [{ ...REVIEW, description: 'Reviews code and edits nothing' }, REVIEW] });
    expect(rows.map((r) => r.hint)).toEqual(['Reviews code and edits nothing', 'Reviews (read-only)']);
  });

  it('the palette offers each profile as @name, on its own shelf after the agent\'s own commands', () => {
    const rows = slashCommands([], [], { profiles: [REVIEW, TEST] });
    expect(rows.map((r) => [r.name, r.label, r.hint])).toEqual([
      ['review', '@review', 'Reviews (read-only)'],
      ['test', '@test', 'Writes tests'],
    ]);
    expect(rows.every((r) => slashGroupOf(r.source) === 'profiles')).toBe(true);
    expect(SLASH_GROUP_ORDER.indexOf('profiles')).toBe(SLASH_GROUP_ORDER.indexOf('agent') + 1);
  });

  it('sending @review: the agent gets the role, the chat keeps what was typed, and the message runs in Plan', async () => {
    const f = vi.fn(async (url: string) => {
      if (url === '/api/acp/agents') return new Response(JSON.stringify({ agents: [{ id: 'codex' }] }));
      if (url === '/api/acp/profiles') return new Response(JSON.stringify({ profiles: [REVIEW, TEST] }));
      return sse([{ type: 'acp:result', stopReason: 'end_turn', text: 'Looked.' }]);
    });
    const store = createAgentRunStore({ fetch: f });
    const run = await store.start({ question: '@review the parser', access: 'autoEdit' });
    const call = f.mock.calls.find((c) => String(c[0]).startsWith('/api/acp/run-node')) as unknown as [string, RequestInit];
    const body = JSON.parse(String(call[1].body));
    expect(body.display).toBe('@review the parser');
    expect(body.prompt).toMatch(/You are a code reviewer\./);
    expect(body.prompt).not.toMatch(/^@review/);
    expect(body.permissionMode).toBe('plan');
    expect(run.prompt).toBe('@review the parser');
    expect(run.items.some((i) => i.kind === 'note' && i.text === 'As @review, read-only.')).toBe(true);
  });

  it('a writing profile keeps the chat\'s own mode; a message with no @ never asks for profiles', async () => {
    const f = vi.fn(async (url: string) => {
      if (url === '/api/acp/agents') return new Response(JSON.stringify({ agents: [{ id: 'codex' }] }));
      if (url === '/api/acp/profiles') return new Response(JSON.stringify({ profiles: [REVIEW, TEST] }));
      return sse([{ type: 'acp:result', stopReason: 'end_turn', text: 'Done.' }]);
    });
    const store = createAgentRunStore({ fetch: f });
    await store.start({ question: '@test the parser', access: 'autoEdit' });
    const sent = (f.mock.calls.filter((c) => String(c[0]).startsWith('/api/acp/run-node')) as unknown as [string, RequestInit][]).map((c) => JSON.parse(String(c[1].body)));
    expect(sent[0].permissionMode).toBe('autoEdit');
    resetProfiles();
    f.mockClear();
    await store.start({ question: 'plain question', access: 'autoEdit' });
    expect(f.mock.calls.some((c) => c[0] === '/api/acp/profiles')).toBe(false);
  });
});
