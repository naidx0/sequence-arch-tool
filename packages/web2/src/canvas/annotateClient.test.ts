import { afterEach, describe, expect, it } from 'vitest';

import { annotationsForScan, annotationsFrom, clearAnnotationCache } from './annotateClient';

/* ══════════════════════════════════════════════════════════════════════════
   THE ANNOTATE CLIENT — Wave 2, Decision 6.
   Ground truth is the analyzer's own route:
   POST /api/annotate in packages/analyzer/src/server/repoServer.ts — answers
   `{ annotations: Record<nodeId, string[]>, mode, provider?,
   detailLevel }`, with `annotations: {}` when no provider is bound
   ("No key ⇒ honest empty map (200), never fabricated prose").
   The client renders WHAT THE ENDPOINT RETURNED and stays calm otherwise:
   a static origin, an abort, or a malformed body are all "no English", not
   errors the board should wear.
   ══════════════════════════════════════════════════════════════════════════ */

describe('annotationsFrom — the real response shape, validated', () => {
  it('reads the endpoint’s map of node id → bullets', () => {
    const body = {
      annotations: {
        'svc:analyzer': ['Reads a repository and produces a graph of its services.'],
        'svc:web2': ['Draws the board.', 'Answers clicks with English.'],
      },
      mode: 'ai',
      detailLevel: 'regular',
    };
    expect(annotationsFrom(body)).toEqual(body.annotations);
  });

  it('accepts the no-provider answer as an empty map, not a failure', () => {
    expect(annotationsFrom({ annotations: {}, mode: 'none' })).toEqual({});
  });

  it('drops keys whose value is not a list of strings, rather than rendering them', () => {
    const out = annotationsFrom({
      annotations: {
        'svc:good': ['Fine.'],
        'svc:bad': 'not a list',
        'svc:worse': [1, 2],
        'svc:empty': [],
      },
    });
    expect(out).toEqual({ 'svc:good': ['Fine.'] });
  });

  it('answers {} for every calm-absence case: null, non-object, missing map', () => {
    expect(annotationsFrom(null)).toEqual({});
    expect(annotationsFrom(undefined)).toEqual({});
    expect(annotationsFrom('not json')).toEqual({});
    expect(annotationsFrom({})).toEqual({});
    expect(annotationsFrom({ annotations: 42 })).toEqual({});
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   REVIEW ROUND 2, FINDING G1 — THE CACHE ONLY EVER HOLDS SETTLED ANSWERS.
   `fetchAnnotations` converts an AbortError into calm `{}`, and the per-scan
   memo cached that like any answer: abort mid-POST (tab flip before the
   response) and scan A wore `{}` for the rest of the session. Three locks:
   an aborted ask is never cached; concurrent callers share one wire ask; a
   new scannedAt evicts the older entries.
   ══════════════════════════════════════════════════════════════════════════ */

describe('annotationsForScan — only settled answers enter the cache', () => {
  let calls = 0;
  /* A wire that behaves like the real one about aborts: an abort lands as an
     AbortError rejection even when it fires after the request started. */
  const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    const signal = init?.signal ?? null;
    const body = () =>
      new Response(JSON.stringify({ annotations: { 'svc:a': ['one bullet'] }, mode: 'ai' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    if (signal?.aborted) throw new DOMException('The user aborted a request.', 'AbortError');
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(body()), 0);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new DOMException('The user aborted a request.', 'AbortError'));
        },
        { once: true },
      );
    });
  }) as typeof fetch;

  afterEach(() => {
    calls = 0;
    clearAnnotationCache();
  });

  it('an aborted ask is never cached — a remount against the same scan asks again', async () => {
    /* The board mounts on scan A and flips away before the POST resolves:
       cleanup aborts mid-flight. */
    const controller = new AbortController();
    const aborted = annotationsForScan(fetchImpl, controller.signal, 'scan-a');
    controller.abort();

    /* The aborted mount still reads calm absence — that part of F8 stands. */
    await expect(aborted).resolves.toEqual({});

    /* But nothing was cached under scan A: a fresh mount asks again. */
    await expect(annotationsForScan(fetchImpl, undefined, 'scan-a')).resolves.toEqual({
      'svc:a': ['one bullet'],
    });
    expect(calls).toBe(2);
  });

  it('two mounts arriving while one ask is on the wire share it — one POST', async () => {
    const first = annotationsForScan(fetchImpl, undefined, 'scan-a');
    const second = annotationsForScan(fetchImpl, undefined, 'scan-a');
    const [a, b] = await Promise.all([first, second]);
    expect(calls).toBe(1);
    expect(a).toEqual(b);
  });

  it('a new scannedAt evicts the older entries — the map holds one scan', async () => {
    await annotationsForScan(fetchImpl, undefined, 'scan-a'); // call 1, cached
    await annotationsForScan(fetchImpl, undefined, 'scan-b'); // call 2, retires scan-a
    await annotationsForScan(fetchImpl, undefined, 'scan-a'); // call 3: asked again, not served stale
    expect(calls).toBe(3);
  });
});
