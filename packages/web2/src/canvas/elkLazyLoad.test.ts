import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* THE LAYOUT ENGINE LOADS WHEN A LAYOUT NEEDS IT. elk.bundled is 1.4 MB. It was imported by the worker as soon as the
   worker existed, and the worker was started during boot, so the bundle was fetched beside the requests the composer
   waits on. Two requests are counted here: the worker's own import of elkjs, and the first layout's post. */

const loaded = vi.hoisted(() => ({ count: 0 }));
/* The engine is constructed once per loaded worker, right after its import resolves: that is what is counted. */
vi.mock('elkjs/lib/elk.bundled.js', () => ({
  default: class {
    constructor() {
      loaded.count += 1;
    }
    async layout(graph: unknown) {
      return graph;
    }
  },
}));

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('elk.worker: elkjs is requested by the first message, not by the worker starting', () => {
  let posted: unknown[];
  beforeEach(() => {
    vi.resetModules();
    loaded.count = 0;
    posted = [];
    vi.spyOn(self, 'postMessage').mockImplementation(((m: unknown) => void posted.push(m)) as never);
  });
  afterEach(() => vi.restoreAllMocks());

  async function startWorker() {
    await import('./elk.worker');
    return (self as unknown as { onmessage: (e: { data: unknown }) => Promise<void> }).onmessage;
  }

  it('does not import elkjs while it is only started', async () => {
    await startWorker();
    await tick();
    await tick();
    expect(loaded.count).toBe(0);
  });

  it('imports it once for the first layout request and answers it', async () => {
    const onmessage = await startWorker();
    await onmessage({ data: { id: 1, graph: { id: 'root', children: [] } } });
    await onmessage({ data: { id: 2, graph: { id: 'root', children: [] } } });
    expect(loaded.count).toBe(1);
    expect(posted).toEqual([
      { id: 1, result: { id: 'root', children: [] } },
      { id: 2, result: { id: 'root', children: [] } },
    ]);
  });

  it('a warm message loads it without a layout', async () => {
    const onmessage = await startWorker();
    await onmessage({ data: { warm: true } });
    await vi.waitFor(() => expect(loaded.count).toBe(1));
    expect(posted).toEqual([]);
  });
});

describe('layoutOffThread: the first layout is posted after the first paint, not inside the mount', () => {
  class FakeWorker {
    static made: FakeWorker[] = [];
    sent: Array<Record<string, unknown>> = [];
    onmessage: ((e: MessageEvent) => void) | null = null;
    onerror: unknown = null;
    onmessageerror: unknown = null;
    constructor() {
      FakeWorker.made.push(this);
    }
    postMessage(m: Record<string, unknown>) {
      this.sent.push(m);
    }
  }
  const graph = { id: 'root', children: [], edges: [] } as never;

  beforeEach(async () => {
    FakeWorker.made = [];
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 0));
    vi.stubGlobal('requestIdleCallback', (cb: () => void) => setTimeout(cb, 0));
    (await import('./layout')).resetLayoutWorkerForTest();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('holds the first request until the page has painted and gone idle, then posts it and the next at once', async () => {
    const { layoutOffThread } = await import('./layout');
    const first = layoutOffThread(graph);
    first.catch(() => {});
    expect(FakeWorker.made).toHaveLength(1);
    expect(FakeWorker.made[0]!.sent).toEqual([]);
    await new Promise((r) => setTimeout(r, 20));
    expect(FakeWorker.made[0]!.sent).toHaveLength(1);
    layoutOffThread(graph).catch(() => {});
    expect(FakeWorker.made[0]!.sent).toHaveLength(2);
  });

  it('a reader intent (prewarm) loads the engine now and lets the first request through', async () => {
    const { layoutOffThread, prewarmLayoutWorker } = await import('./layout');
    prewarmLayoutWorker();
    expect(FakeWorker.made[0]!.sent).toEqual([{ warm: true }]);
    layoutOffThread(graph).catch(() => {});
    const sent = FakeWorker.made[0]!.sent;
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ graph });
  });

  it('still rejects at once where there is no Worker', async () => {
    vi.stubGlobal('Worker', undefined);
    const { layoutOffThread } = await import('./layout');
    await expect(layoutOffThread(graph)).rejects.toThrow(/no Worker/);
  });
});
