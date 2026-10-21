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

/* elkjs (1.4 MB) is fetched when it is first NEEDED, not when this worker starts: the worker is started early (the
   Architecture tab's hover, the first board's mount) and a layout request, or a `warm` message from a reader's
   intent, is what pulls the bundle. A failed load is forgotten so the next request tries again. */
let elkPromise: Promise<any> | null = null;
function loadElk(): Promise<any> {
  if (!elkPromise) {
    elkPromise = import('elkjs/lib/elk.bundled.js').then((m) => new (m.default as any)());
    elkPromise.catch(() => {
      elkPromise = null;
    });
  }
  return elkPromise;
}

self.onmessage = async (e: MessageEvent) => {
  const { id, graph, warm } = e.data;
  if (warm) {
    loadElk().catch(() => {});
    return;
  }
  try {
    const elk = await loadElk();
    const result = await elk.layout(graph);
    (self as unknown as Worker).postMessage({ id, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: (err as Error).message });
  }
};
