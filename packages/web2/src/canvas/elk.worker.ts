// elkjs's bundled build embeds its own algorithm "worker" module, which
// self-detects a Worker-like environment via `typeof document === 'undefined'
// && typeof self !== 'undefined'` and hijacks `self.onmessage` to turn itself
// into a standalone worker entrypoint. Since this file already *is* a Worker,
// that self-check misfires and elkjs fails to construct (`_Worker is not a
// constructor`). Stubbing `document` makes elkjs take its normal same-thread
// code path instead, which is what we want since layout already runs off the
// main thread inside this worker. Static `import` declarations are hoisted
// and evaluate before any of this module's own statements, so the stub has
// to be set before elkjs is loaded via a dynamic `import()`.
(self as unknown as { document?: unknown }).document ??= {};

const elkPromise = import('elkjs/lib/elk.bundled.js').then((m) => new (m.default as any)());

self.onmessage = async (e: MessageEvent) => {
  const { id, graph } = e.data;
  try {
    const elk = await elkPromise;
    const result = await elk.layout(graph);
    (self as unknown as Worker).postMessage({ id, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: (err as Error).message });
  }
};
