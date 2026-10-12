import { describe, expect, it } from 'vitest';
import { createOnboardingClient } from './onboardingClient';

/* Review G6 (strike two): the real client, not a fake, must mark a request that got no HTTP answer, so a saved
   skills import is kept for the next attempt instead of being cleared. */
describe('onboarding client: no answer is a network error', () => {
  it('a thrown POST is networkError', async () => {
    const c = createOnboardingClient((() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as typeof fetch);
    const a = await c.skillsImport!('', ['/x']);
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.networkError).toBe(true);
  });
  it('a 5xx with no JSON body is networkError; a 400 with an error body is an answer', async () => {
    const c5 = createOnboardingClient((async () => new Response('bad gateway', { status: 502 })) as unknown as typeof fetch);
    const a5 = await c5.skillsImport!('', ['/x']);
    expect(!a5.ok && a5.networkError).toBe(true);
    const c4 = createOnboardingClient(
      (async () => new Response(JSON.stringify({ error: 'nope' }), { status: 400, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch,
    );
    const a4 = await c4.skillsImport!('', ['/x']);
    expect(a4.ok).toBe(false);
    if (!a4.ok) {
      expect(a4.networkError).toBeUndefined();
      expect(a4.message).toBe('nope');
    }
  });
});
