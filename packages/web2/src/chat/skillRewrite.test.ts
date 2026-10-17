import { describe, expect, it, vi } from 'vitest';

import { REWRITE_SKILL, rewriteWithSkill } from './skillRewrite';

const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('Rewrite with be-ambitious (client)', () => {
  it('posts the draft to the skill route, with the chat agent, and returns the server fenced prompt', async () => {
    const fetchImpl = reply(200, { slug: 'be-ambitious', prompt: 'Start from the raw logs.' });
    const r = await rewriteWithSkill('  find out why checkout is slow  ', { agentId: 'claude', model: 'm-1', fetchImpl });
    expect(r).toEqual({ ok: true, prompt: 'Start from the raw logs.' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/api/skills/${REWRITE_SKILL}/run`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ input: 'find out why checkout is slow', agentId: 'claude', model: 'm-1' });
  });

  it('a plain chat sends no agent; a server that answers raw text still yields the fenced block', async () => {
    const fetchImpl = reply(200, { text: 'Analysis.\n```\nthe deeper prompt\n```\nRun it?' });
    const r = await rewriteWithSkill('x', { fetchImpl });
    expect(r).toEqual({ ok: true, prompt: 'the deeper prompt' });
    expect(JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({ input: 'x' });
  });

  it('negative controls: an empty draft makes no request; a refusal, no fenced block and a dead network each say why and leave the draft alone', async () => {
    const never = vi.fn();
    expect(await rewriteWithSkill('   ', { fetchImpl: never as unknown as typeof fetch })).toMatchObject({ ok: false, message: expect.stringContaining('Write the prompt first') });
    expect(never).not.toHaveBeenCalled();
    expect(await rewriteWithSkill('x', { fetchImpl: reply(502, { error: 'no provider' }) })).toEqual({ ok: false, message: 'Could not rewrite the prompt: no provider' });
    expect(await rewriteWithSkill('x', { fetchImpl: reply(200, { text: 'just prose' }) })).toMatchObject({ ok: false, message: expect.stringContaining('unchanged') });
    expect(await rewriteWithSkill('x', { fetchImpl: vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch })).toEqual({ ok: false, message: 'Could not rewrite the prompt: offline' });
  });
});
