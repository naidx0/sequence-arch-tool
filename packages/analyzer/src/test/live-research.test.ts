/**
 * Unit locks for live research — mocked fetch only. No real network.
 */

import assert from 'node:assert';
import { test } from 'node:test';
import {
  assembleLiveResearchMarkdown,
  buildLiveResearchPrompt,
  extractUrls,
  fetchUrlContent,
  htmlToPlainText,
  isSafePublicHttpUrl,
  runLiveResearch,
  searchWebUrls,
  type FetchImpl,
} from '../research/liveResearch.js';

test('extractUrls de-dupes and strips trailing punctuation', () => {
  const urls = extractUrls(
    'See https://example.com/a. and https://example.com/a again plus https://other.dev/x)',
  );
  assert.deepStrictEqual(urls, ['https://example.com/a', 'https://other.dev/x']);
});

test('isSafePublicHttpUrl refuses loopback / private / non-http', () => {
  assert.strictEqual(isSafePublicHttpUrl('https://example.com/ok').ok, true);
  assert.strictEqual(isSafePublicHttpUrl('http://127.0.0.1/x').ok, false);
  assert.strictEqual(isSafePublicHttpUrl('http://localhost/x').ok, false);
  assert.strictEqual(isSafePublicHttpUrl('http://192.168.1.1/x').ok, false);
  assert.strictEqual(isSafePublicHttpUrl('http://10.0.0.5/x').ok, false);
  assert.strictEqual(isSafePublicHttpUrl('file:///etc/passwd').ok, false);
  assert.strictEqual(isSafePublicHttpUrl('http://169.254.169.254/latest').ok, false);
});

test('htmlToPlainText strips scripts and tags', () => {
  const t = htmlToPlainText(
    '<html><head><script>evil()</script><title>Hi</title></head><body><p>Hello &amp; world</p></body></html>',
  );
  assert.match(t, /Hello & world/);
  assert.ok(!t.includes('evil'));
});

test('fetchUrlContent: success records excerpt; failure records error — never invents', async () => {
  const fetchImpl: FetchImpl = async (input) => {
    const url = String(input);
    if (url.includes('good.example/doc')) {
      return new Response('<html><title>Good Doc</title><body><p>Real content here.</p></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    return new Response('nope', { status: 404 });
  };
  const ok = await fetchUrlContent('https://good.example/doc', { fetchImpl });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.title, 'Good Doc');
  assert.match(ok.text ?? '', /Real content/);

  const bad = await fetchUrlContent('https://good.example/missing', { fetchImpl });
  assert.strictEqual(bad.ok, false);
  assert.match(bad.error ?? '', /HTTP 404/);
});

test('fetchUrlContent refuses SSRF targets without calling fetch', async () => {
  let called = false;
  const fetchImpl: FetchImpl = async () => {
    called = true;
    return new Response('x');
  };
  const r = await fetchUrlContent('http://127.0.0.1/secret', { fetchImpl });
  assert.strictEqual(r.ok, false);
  assert.match(r.error ?? '', /refused/);
  assert.strictEqual(called, false);
});

test('searchWebUrls returns only FirstURL values from the JSON — empty when none', async () => {
  const fetchImpl: FetchImpl = async () =>
    new Response(
      JSON.stringify({
        AbstractURL: 'https://docs.example/abs',
        RelatedTopics: [
          { FirstURL: 'https://docs.example/a' },
          { Topics: [{ FirstURL: 'https://docs.example/b' }] },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  const { urls, error } = await searchWebUrls('circuit breaker', { fetchImpl });
  assert.strictEqual(error, undefined);
  assert.deepStrictEqual(urls, [
    'https://docs.example/abs',
    'https://docs.example/a',
    'https://docs.example/b',
  ]);

  const emptyFetch: FetchImpl = async () =>
    new Response(JSON.stringify({ RelatedTopics: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  const empty = await searchWebUrls('zzz-no-results', { fetchImpl: emptyFetch });
  assert.deepStrictEqual(empty.urls, []);
});

test('assembleLiveResearchMarkdown cites only attempted URLs; failures stay failures', () => {
  const out = assembleLiveResearchMarkdown({
    query: 'saga vs outbox',
    modelText: 'Outbox is evidenced in source 1.',
    sources: [
      { url: 'https://a.example/outbox', ok: true, title: 'Outbox', text: '…' },
      { url: 'https://b.example/saga', ok: false, error: 'HTTP 503' },
    ],
  });
  assert.match(out.path, /^\.sequence\/decisions\/live-research-/);
  assert.match(out.markdown, /https:\/\/a\.example\/outbox/);
  assert.match(out.markdown, /https:\/\/b\.example\/saga/);
  assert.match(out.markdown, /fetch failed: HTTP 503/);
  assert.match(out.markdown, /Only URLs listed above were requested/);
  assert.strictEqual(out.citations.filter((c) => c.ok).length, 1);
  // Must not invent a third URL
  assert.ok(!out.markdown.includes('https://invented.example'));
});

test('buildLiveResearchPrompt forbids inventing URLs', () => {
  const p = buildLiveResearchPrompt({
    query: 'patterns',
    sources: [{ url: 'https://a.example', ok: true, text: 'body' }],
  });
  assert.match(p, /Do not invent URLs/);
  assert.match(p, /https:\/\/a\.example/);
  assert.match(p, /SOURCES \(1 fetched\)/);
});

test('runLiveResearch: explicit URL path — mocked fetch + model; cites fetched only', async () => {
  const fetchImpl: FetchImpl = async (input) => {
    const url = String(input);
    if (url.includes('api.duckduckgo.com')) {
      assert.fail('search must not run when explicit URLs are present');
    }
    if (url.includes('ok.example')) {
      return new Response('<html><title>OK</title><body>Grounded page body.</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    return new Response('gone', { status: 500 });
  };
  const result = await runLiveResearch({
    query: 'Compare with https://ok.example/doc and https://bad.example/x',
    callModel: async (prompt) => {
      assert.match(prompt, /Grounded page body/);
      assert.match(prompt, /https:\/\/ok\.example\/doc/);
      return 'Finding: grounded page supports outbox.';
    },
    fetchImpl,
  });
  assert.match(result.markdown, /Finding: grounded page supports outbox/);
  assert.match(result.markdown, /\[ok\]/);
  assert.match(result.markdown, /\[fail\]/);
  assert.strictEqual(result.citations.some((c) => c.url.includes('ok.example') && c.ok), true);
  assert.strictEqual(result.citations.some((c) => c.url.includes('bad.example') && !c.ok), true);
});

test('runLiveResearch: search path when no URLs — uses DuckDuckGo JSON then fetches', async () => {
  const fetchImpl: FetchImpl = async (input) => {
    const url = String(input);
    if (url.includes('api.duckduckgo.com')) {
      return new Response(
        JSON.stringify({ RelatedTopics: [{ FirstURL: 'https://wiki.example/circuit' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url.includes('wiki.example')) {
      return new Response('<html><title>CB</title><body>Circuit breaker pattern.</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    return new Response('no', { status: 404 });
  };
  const result = await runLiveResearch({
    query: 'circuit breaker patterns',
    callModel: async () => 'CB is a stability pattern.',
    fetchImpl,
  });
  assert.match(result.markdown, /https:\/\/wiki\.example\/circuit/);
  assert.strictEqual(result.citations.length, 1);
  assert.strictEqual(result.citations[0].ok, true);
});

test('runLiveResearch: search failure is reported — no invented sources', async () => {
  const fetchImpl: FetchImpl = async () => {
    throw new Error('network down');
  };
  const result = await runLiveResearch({
    query: 'anything',
    callModel: async (prompt) => {
      assert.match(prompt, /SOURCES: none fetched successfully|none fetched/i);
      return 'No sources retrieved.';
    },
    fetchImpl,
  });
  assert.match(result.markdown, /fetch failed|network down|No URLs were fetched/i);
  assert.ok(!result.markdown.includes('https://made-up.example'));
  assert.ok(result.citations.every((c) => !c.ok));
});
