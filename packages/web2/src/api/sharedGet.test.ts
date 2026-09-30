/* One GET per URL in flight (api/sharedGet.ts): the /api/ai-config ×3 and
   /api/sessions/<id> ×2 repeats measured at boot. */
import { describe, expect, it } from 'vitest';

import { createModelPicker } from '../chat/modelPicker';
import { createSettingsClient } from '../settings/settingsClient';
import { sharedGet } from './sharedGet';

function wire(body: unknown = { model: 'm', profiles: [] }) {
  const calls: string[] = [];
  let open: (() => void) | undefined;
  let gate: Promise<void> | undefined;
  const fetchImpl = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    if (gate) await gate;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return {
    fetchImpl,
    calls,
    hold: () => void (gate = new Promise<void>((r) => (open = r))),
    release: () => {
      gate = undefined;
      open?.();
    },
  };
}

describe('sharedGet', () => {
  it('concurrent readers of one URL share one fetch and each parse their own copy', async () => {
    const w = wire({ hello: 'world' });
    w.hold();
    const all = Promise.all([1, 2, 3].map(() => sharedGet('/api/ai-config', undefined, w.fetchImpl)));
    w.release();
    const bodies = await Promise.all((await all).map((r) => r.json()));
    expect(w.calls).toEqual(['/api/ai-config']);
    expect(bodies).toEqual([{ hello: 'world' }, { hello: 'world' }, { hello: 'world' }]);
  });

  it('a read after the first one settles goes to the network again', async () => {
    const w = wire();
    await sharedGet('/api/ai-config', undefined, w.fetchImpl);
    await sharedGet('/api/ai-config', undefined, w.fetchImpl);
    expect(w.calls).toHaveLength(2);
  });

  it('different URLs are not shared', async () => {
    const w = wire();
    await Promise.all([
      sharedGet('/api/sessions/a', undefined, w.fetchImpl),
      sharedGet('/api/sessions/a?repoPath=%2Fr', undefined, w.fetchImpl),
    ]);
    expect(w.calls).toHaveLength(2);
  });

  it("one caller's abort rejects only that caller", async () => {
    const w = wire();
    const gone = new AbortController();
    w.hold();
    const a = sharedGet('/api/ai-config', gone.signal, w.fetchImpl);
    const b = sharedGet('/api/ai-config', undefined, w.fetchImpl);
    gone.abort();
    w.release();
    await expect(a).rejects.toMatchObject({ name: 'AbortError' });
    await expect(b.then((r) => r.ok)).resolves.toBe(true);
    expect(w.calls).toHaveLength(1);
  });

  it('the settings read and the model picker share one /api/ai-config at boot', async () => {
    const w = wire({ model: 'granite', profiles: [{ id: 'p1', model: 'granite' }] });
    w.hold();
    const both = Promise.all([createSettingsClient(w.fetchImpl).read(), createModelPicker(w.fetchImpl).list()]);
    w.release();
    const [settings, models] = await both;
    expect(w.calls).toEqual(['/api/ai-config']);
    expect(settings.outcome).toBe('ok');
    expect(models.outcome).toBe('ok');
  });
});
