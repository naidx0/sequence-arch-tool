import { describe, expect, it, vi } from 'vitest';
import { createAgentRunStore } from './agentRuns';
import { resetProfiles } from '../chat/agentProfiles';

const sse = (events: object[]) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });

/* A built-in read-only profile must stay read-only even when the profile list cannot be read. */
async function sendWith(question: string, profilesOk: boolean) {
  resetProfiles();
  const f = vi.fn(async (url: string) => {
    if (url === '/api/acp/agents') return new Response(JSON.stringify({ agents: [{ id: 'codex' }] }));
    if (url === '/api/acp/profiles')
      return profilesOk
        ? new Response(JSON.stringify({ profiles: [{ name: 'review', prompt: 'p', readOnly: true }] }))
        : new Response('boom', { status: 500 });
    return sse([{ type: 'acp:result', stopReason: 'end_turn', text: 'ok' }]);
  });
  const store = createAgentRunStore({ fetch: f as never });
  const run = await store.start({ question, access: 'full' } as never);
  const call = f.mock.calls.find((c) => String(c[0]).includes('/api/acp/') && (c as unknown[])[1] && JSON.parse(String(((c as unknown[])[1] as RequestInit).body ?? 'null'))?.permissionMode);
  return { run, body: JSON.parse(String(((call as unknown[])[1] as RequestInit).body)) };
}

describe('profile fail-closed', () => {
  it('@review with an unreadable profile list is sent in Plan, with a note', async () => {
    const { run, body } = await sendWith('@review check this', false);
    expect(body.permissionMode).toBe('plan');
    expect(run.items.some((i) => i.kind === 'note' && /read-only/.test(i.text))).toBe(true);
  });
  it('@reverse (REA) fails closed the same way: an unreadable profile list still sends it in Plan, with the note naming it', async () => {
    const { run, body } = await sendWith('@reverse how does this app search', false);
    expect(body.permissionMode).toBe('plan');
    expect(run.items.some((i) => i.kind === 'note' && /@reverse/.test(i.text) && /read-only/.test(i.text))).toBe(true);
  });
  it('controls: a readable list is Plan too; a plain message and an unknown @name keep the chosen access', async () => {
    expect((await sendWith('@review check this', true)).body.permissionMode).toBe('plan');
    expect((await sendWith('just do it', false)).body.permissionMode).toBe('full');
    expect((await sendWith('@mine do it', false)).body.permissionMode).toBe('full');
  });
});
