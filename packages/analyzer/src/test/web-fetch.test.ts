/**
 * web_fetch / web_search core (server/netFetch.ts): SSRF on every hop,
 * HTML to markdown on a fixture page, truncation + offset continuation, the
 * Cloudflare challenge retry, and the keyless Exa search parser. No live
 * network: every fetch is a stub.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  checkPublicUrl,
  guardedLookup,
  htmlToMarkdown,
  isPrivateAddress,
  parseExaText,
  readWebEnabled,
  webFetch,
  webSearch,
} from '../server/netFetch.js';

import { parse as parseHtml } from 'parse5';
import { HTML_CAP, MAX_NESTING, htmlToMarkdown as renderHtml, maxNesting } from '../server/htmlMarkdown.js';
import { bound } from './load-scale.js';

type Stub = (url: string, init?: RequestInit) => Response | Promise<Response>;
const stub = (fn: Stub) => {
  const calls: { url: string; ua: string }[] = [];
  const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, ua: String((init?.headers as Record<string, string> | undefined)?.['user-agent'] ?? '') });
    return fn(url, init);
  };
  return { fetchImpl, calls };
};
const html = (body: string, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });

const PAGE = `<!doctype html><html><head><title>Anatomy &amp; Flow</title><style>body{color:red}</style>
<script>var x = "<h1>not a heading</h1>";</script></head><body>
<nav><a href="/home">Home</a></nav>
<h1>Hello <em>world</em></h1>
<p>First <strong>bold</strong> and <code>code()</code> with a <a href="/docs/x?a=1&amp;b=2">link</a>.</p>
<ul><li>one</li><li>two<ul><li>nested</li></ul></li></ul>
<ol><li>first</li><li>second</li></ol>
<pre>line 1
  line 2</pre>
<blockquote>quoted text</blockquote>
<img src="/i.png" alt="pic">
<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
<svg><text>ignored svg text</text></svg>
</body></html>`;

test('htmlToMarkdown: fixture page converts headings, emphasis, links, lists, pre, quote, table; scripts and svg vanish', () => {
  const md = htmlToMarkdown(PAGE, { baseUrl: 'https://example.com/a/b' });
  assert.match(md, /^\[Home\]\(https:\/\/example\.com\/home\)/);
  assert.match(md, /^# Hello _world_$/m);
  assert.match(md, /First \*\*bold\*\* and `code\(\)` with a \[link\]\(https:\/\/example\.com\/docs\/x\?a=1&b=2\)\./);
  assert.match(md, /^- one$/m);
  assert.match(md, /^- two$/m);
  assert.match(md, /^ {2}- nested$/m);
  assert.match(md, /^1\. first$/m);
  assert.match(md, /^2\. second$/m);
  assert.match(md, /```\nline 1\n {2}line 2\n```/);
  assert.match(md, /^> quoted text$/m);
  assert.match(md, /!\[pic\]\(https:\/\/example\.com\/i\.png\)/);
  assert.match(md, /\| A \| B \|\n\| --- \| --- \|\n\| 1 \| 2 \|/);
  assert.doesNotMatch(md, /not a heading|color:red|ignored svg text|<[a-z]/);
});

test('htmlToMarkdown: a bare <title> (no <head>) is not part of the body', () => {
  assert.equal(htmlToMarkdown('<title>T</title><body><p>x</p></body>'), 'x');
});

test('htmlToMarkdown: text mode has no markup', () => {
  const t = htmlToMarkdown(PAGE, { markup: false });
  assert.match(t, /Hello world/);
  assert.doesNotMatch(t, /[#*_`]|\]\(/);
});

test('isPrivateAddress / checkPublicUrl: v4, v6 and mapped forms are refused', async () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '::1', '::', 'fe80::1', 'fd12::1', '::ffff:7f00:1', '::ffff:10.0.0.1']) {
    assert.equal(isPrivateAddress(a), true, a);
  }
  for (const a of ['8.8.8.8', '2606:4700:4700::1111', '93.184.216.34']) assert.equal(isPrivateAddress(a), false, a);
  for (const u of ['http://127.0.0.1/', 'https://10.0.0.5/x', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://2130706433/', 'file:///etc/passwd', 'http://localhost:8080/']) {
    const r = await checkPublicUrl(u);
    assert.equal(r.ok, false, u);
  }
  assert.equal((await checkPublicUrl('https://example.com/')).ok, true);
});

test('webFetch refuses private targets without calling fetch', async () => {
  const s = stub(() => html('x'));
  for (const u of ['http://127.0.0.1/', 'http://10.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data/']) {
    const r = await webFetch(u, { fetchImpl: s.fetchImpl });
    assert.equal(r.ok, false, u);
  }
  assert.equal(s.calls.length, 0);
});

test('webFetch: a redirect to a private address is refused on that hop (and each hop is checked)', async () => {
  const s = stub((url) => {
    if (url === 'https://public.example/start') return new Response(null, { status: 302, headers: { location: 'https://hop.example/mid' } });
    if (url === 'https://hop.example/mid') return new Response(null, { status: 301, headers: { location: 'http://10.0.0.7/admin' } });
    return html('secret');
  });
  const r = await webFetch('https://public.example/start', { fetchImpl: s.fetchImpl });
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : '', /private|loopback/);
  assert.deepEqual(s.calls.map((c) => c.url), ['https://public.example/start', 'https://hop.example/mid']);
  const v6 = stub((url) => (url.includes('start') ? new Response(null, { status: 302, headers: { location: 'http://[::1]:9/x' } }) : html('s')));
  const r2 = await webFetch('https://public.example/start', { fetchImpl: v6.fetchImpl });
  assert.equal(r2.ok, false);
  assert.equal(v6.calls.length, 1);
});

test('webFetch: a hostname that resolves to a private address is refused', async () => {
  const s = stub(() => html('x'));
  const r = await webFetch('https://rebind.example/', { fetchImpl: s.fetchImpl, lookup: async () => ['93.184.216.34', '127.0.0.1'] });
  assert.equal(r.ok, false);
  assert.equal(s.calls.length, 0);
});

test('webFetch: markdown of the fixture, title, and follows a safe redirect', async () => {
  const s = stub((url) => (url.endsWith('/old') ? new Response(null, { status: 301, headers: { location: '/new' } }) : html(PAGE)));
  const r = await webFetch('https://example.com/old', { fetchImpl: s.fetchImpl });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.url, 'https://example.com/new');
  assert.equal(r.title, 'Anatomy & Flow');
  assert.equal(r.format, 'markdown');
  assert.match(r.output, /^\[Home\]\(https:\/\/example\.com\/home\)/);
  const raw = await webFetch('https://example.com/new', { fetchImpl: s.fetchImpl, format: 'html' });
  assert.ok(raw.ok && raw.output.startsWith('<!doctype html>'));
});

test('webFetch: truncation names the offset and offset continues without gaps or overlap', async () => {
  const lines = Array.from({ length: 400 }, (_, i) => `line ${String(i).padStart(4, '0')} ${'x'.repeat(40)}`);
  const body = `<html><body><pre>${lines.join('\n')}</pre></body></html>`;
  const s = stub(() => html(body));
  const first = await webFetch('https://example.com/big', { fetchImpl: s.fetchImpl, outputCap: 5000 });
  assert.ok(first.ok);
  if (!first.ok) return;
  assert.ok(first.nextOffset !== undefined && first.nextOffset > 0);
  assert.ok(first.output.length <= 5000);
  let all = first.output;
  let next: number | undefined = first.nextOffset;
  let guard = 0;
  while (next !== undefined && guard++ < 20) {
    const r = await webFetch('https://example.com/big', { fetchImpl: s.fetchImpl, outputCap: 5000, offset: next });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.equal(r.offset, next);
    all += r.output;
    next = r.nextOffset;
  }
  const whole = await webFetch('https://example.com/big', { fetchImpl: s.fetchImpl, outputCap: 10_000_000 });
  assert.ok(whole.ok && whole.nextOffset === undefined);
  if (whole.ok) assert.equal(all, whole.output);
});

test('webFetch: Cloudflare challenge 403 is retried once with the alternate User-Agent', async () => {
  const s = stub((_u, init) => {
    const ua = String((init?.headers as Record<string, string>)['user-agent']);
    return ua.startsWith('Mozilla') ? html('blocked', 403, { 'cf-mitigated': 'challenge' }) : html('<p>through</p>');
  });
  const r = await webFetch('https://cf.example/', { fetchImpl: s.fetchImpl });
  assert.ok(r.ok);
  assert.equal(s.calls.length, 2);
  assert.notEqual(s.calls[0]!.ua, s.calls[1]!.ua);
  if (r.ok) assert.equal(r.output, 'through');
  /* a plain 403 is not retried */
  const plain = stub(() => html('no', 403));
  const r2 = await webFetch('https://cf.example/', { fetchImpl: plain.fetchImpl });
  assert.equal(r2.ok, false);
  assert.equal(plain.calls.length, 1);
});

test('webFetch: binary types refused, byte bound cuts the download, errors do not throw', async () => {
  const img = stub(() => new Response('x', { headers: { 'content-type': 'image/png' } }));
  const r = await webFetch('https://example.com/a.png', { fetchImpl: img.fetchImpl });
  assert.equal(r.ok, false);
  const big = stub(() => html('<p>' + 'a'.repeat(50_000) + '</p>'));
  const c = await webFetch('https://example.com/', { fetchImpl: big.fetchImpl, maxBytes: 1000 });
  assert.ok(c.ok && c.downloadTruncated === true);
  const boom = stub(() => {
    throw new Error('ECONNRESET');
  });
  const e = await webFetch('https://example.com/', { fetchImpl: boom.fetchImpl });
  assert.equal(e.ok, false);
});

/* A real answer from the hosted Exa MCP endpoint (recorded 2026-10-12, shortened): SSE framing, text blocks split on ---. */
const EXA_SSE =
  'event: message\n' +
  'data: ' +
  JSON.stringify({
    result: {
      content: [
        {
          type: 'text',
          text:
            'Title: Using the Fetch API with Undici in Node.js\nURL: https://nodejs.org/learn/getting-started/fetch\nPublished: N/A\nAuthor: N/A\nHighlights:\nOn this page\n...\nUndici is an HTTP client library that powers the fetch API in Node.js.\n...\n## Basic GET Usage\n\n---\n\n' +
            'Title: Node.js 18 is now available!\nURL: https://nodejs.org/uk/blog/announcements/v18-release-announce\nPublished: N/A\nAuthor: N/A\nHighlights:\nWe are excited to announce that Node.js 18 was released today!',
        },
      ],
    },
    jsonrpc: '2.0',
    id: 1,
  }) +
  '\n\n';

test('parseExaText: title, url, snippet from the recorded block format', () => {
  const hits = parseExaText(JSON.parse(EXA_SSE.split('\ndata: ')[1]!.trim()).result.content[0].text);
  assert.equal(hits.length, 2);
  assert.equal(hits[0]!.title, 'Using the Fetch API with Undici in Node.js');
  assert.equal(hits[0]!.url, 'https://nodejs.org/learn/getting-started/fetch');
  assert.match(hits[0]!.snippet, /Undici is an HTTP client library/);
  assert.equal(hits[1]!.url, 'https://nodejs.org/uk/blog/announcements/v18-release-announce');
});

test('webSearch: POSTs JSON-RPC web_search_exa with no key and parses the SSE answer', async () => {
  let seen: { url: string; method?: string; headers: Record<string, string>; body: { method: string; params: { name: string; arguments: { query: string; numResults: number } } } } | undefined;
  const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    seen = { url: String(input), method: init?.method, headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) };
    return new Response(EXA_SSE, { headers: { 'content-type': 'text/event-stream' } });
  };
  const r = await webSearch('node fetch', { fetchImpl, numResults: 2 });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.results.length, 2);
    assert.equal(r.results[0]!.title, 'Using the Fetch API with Undici in Node.js');
  }
  assert.equal(seen!.url, 'https://mcp.exa.ai/mcp');
  assert.equal(seen!.method, 'POST');
  assert.equal(seen!.body.method, 'tools/call');
  assert.equal(seen!.body.params.name, 'web_search_exa');
  assert.equal(seen!.body.params.arguments.query, 'node fetch');
  assert.equal(seen!.body.params.arguments.numResults, 2);
  assert.ok(!Object.keys(seen!.headers).some((h) => /authorization|api-?key/i.test(h)));
  assert.ok(!JSON.stringify(seen!.body).toLowerCase().includes('exaapikey'));
});

test('webSearch: 5xx, unreadable answers and network failure are honest errors, never throws', async () => {
  const five = await webSearch('q', { fetchImpl: async () => new Response('bad', { status: 503 }) });
  assert.equal(five.ok, false);
  assert.match(!five.ok ? five.error : '', /503/);
  const junk = await webSearch('q', { fetchImpl: async () => new Response('not json at all') });
  assert.equal(junk.ok, false);
  const down = await webSearch('q', {
    fetchImpl: async () => {
      throw new Error('getaddrinfo ENOTFOUND mcp.exa.ai');
    },
  });
  assert.equal(down.ok, false);
  assert.match(!down.ok ? down.error : '', /unreachable/);
  assert.equal((await webSearch('   ')).ok, false);
  const none = await webSearch('q', { fetchImpl: async () => new Response(JSON.stringify({ result: { content: [{ type: 'text', text: 'No results' }] } })) });
  assert.ok(none.ok && none.results.length === 0);
});

test('readWebEnabled: missing, corrupt or unrelated settings mean ON; only an explicit false is off', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-en-'));
  try {
    assert.equal(readWebEnabled(dir), true);
    assert.equal(readWebEnabled(undefined), true);
    fs.writeFileSync(path.join(dir, 'agent-settings.json'), '{not json');
    assert.equal(readWebEnabled(dir), true);
    fs.writeFileSync(path.join(dir, 'agent-settings.json'), JSON.stringify({ autoRefine: true }));
    assert.equal(readWebEnabled(dir), true);
    fs.writeFileSync(path.join(dir, 'agent-settings.json'), JSON.stringify({ 'web.enabled': false }));
    assert.equal(readWebEnabled(dir), false);
    fs.writeFileSync(path.join(dir, 'agent-settings.json'), JSON.stringify({ web: { enabled: false } }));
    assert.equal(readWebEnabled(dir), false);
    fs.writeFileSync(path.join(dir, 'agent-settings.json'), JSON.stringify({ web: { enabled: true } }));
    assert.equal(readWebEnabled(dir), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const EXAMPLE_COM =
  '<!doctype html><html><head><title>Example Domain</title><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<style type="text/css">body{background:#f0f0f2}div{width:600px}</style></head><body><div><h1>Example Domain</h1>' +
  '<p>This domain is for use in illustrative examples in documents.</p><p><a href="https://iana.org/domains/example">Learn more</a></p></div></body></html>';

test('htmlToMarkdown: the example.com page keeps its H1, text and link', () => {
  const md = htmlToMarkdown(EXAMPLE_COM, { baseUrl: 'https://example.com/' });
  assert.equal(md, '# Example Domain\n\nThis domain is for use in illustrative examples in documents.\n\n[Learn more](https://iana.org/domains/example)');
});

test('htmlToMarkdown: missing end tags (head never closed, unclosed iframe/svg) do not swallow the page', () => {
  assert.match(htmlToMarkdown('<head><style>p{}</style><body><h1>x</h1><p>after</p>'), /^# x\n\nafter$/);
  assert.match(htmlToMarkdown('<html><head><title>t</title><body><h1>Kept</h1>'), /# Kept/);
  const unclosed = htmlToMarkdown('<body><p>one</p><iframe src="x"><p>two</p>');
  assert.match(unclosed, /one/);
  assert.match(htmlToMarkdown('<body><svg><g></svg><p>after svg</p>'), /after svg/);
  assert.match(htmlToMarkdown('<body><svg><g><p>after</p>'), /after/, 'HTML5 breaks out of foreign content on a <p>');
});

/* Wall-clock bounds scaled by this machine right now: a flat 1MB conversion is the unit, so a
   loaded CI box (or eight parallel lanes) moves the bound with it instead of failing a linear
   converter. Quadratic behaviour still fails by orders of magnitude, not by a few hundred ms. */
/* Measured at each call, not once per file: the unit taken at the first call said nothing about the
   load by the time a later test ran (the gate runs four files at once next to other lanes), so a
   nested-tables case failed its 3 s bound on a machine that had merely got busier since. */
function budget(ms: number): number {
  const flat = "<p>" + "flat text ".repeat(100_000) + "</p>";
  const t0 = Date.now();
  htmlToMarkdown(flat);
  const unitMs = Math.max(1, Date.now() - t0);
  return Math.max(ms, ms * unitMs / 150);
}

test('htmlToMarkdown is linear: 1MB of <p> converts in under a second, as does a long run of tags in attributes', () => {
  const big = '<html><body>' + '<p>paragraph text <b>bold</b></p>'.repeat(33_000) + '</body></html>';
  assert.ok(big.length > 1_000_000);
  const t0 = Date.now();
  const md = htmlToMarkdown(big);
  const ms = Date.now() - t0;
  assert.ok(ms < budget(1000), 'took ' + ms + ' ms');
  assert.ok(md.startsWith('paragraph text **bold**'));
  const t1 = Date.now();
  htmlToMarkdown('<div title="' + '<'.repeat(200_000) + '">x</div>' + '<a>'.repeat(50_000));
  assert.ok(Date.now() - t1 < budget(1000));
  const lists = '<ul><li>a'.repeat(300) + '</li></ul>'.repeat(300);
  const deep = htmlToMarkdown(lists);
  const maxIndent = Math.max(...deep.split('\n').map((l) => /^ */.exec(l)![0].length));
  assert.ok(maxIndent <= 16, 'list indent capped at depth 8, got ' + maxIndent);
});

test('htmlToMarkdown: only http(s) and relative links survive (javascript:, data:, entity-obfuscated forms are dropped)', () => {
  const md = htmlToMarkdown(
    '<a href="javascript:alert(1)">js</a> <a href=" JaVa&#x73;cript:alert(2)">js2</a> <a href="data:text/html,x">d</a> <a href="mailto:a@b.c">m</a> <a href="/ok">ok</a> <a href="https://x.example/y">abs</a> <img src="data:image/png;base64,AAA" alt="i">',
    { baseUrl: 'https://site.example/dir/' },
  );
  assert.ok(!/javascript|data:|mailto/i.test(md), md);
  assert.match(md, /\[ok\]\(https:\/\/site\.example\/ok\)/);
  assert.match(md, /\[abs\]\(https:\/\/x\.example\/y\)/);
});

test('isPrivateAddress: NAT64, IPv4-translated, 198.18/15 and mapped hex forms are refused', () => {
  for (const a of ['64:ff9b::7f00:1', '64:ff9b::8.8.8.8', '::ffff:0:7f00:1', '::ffff:7f00:1', '::ffff:a00:1', '198.18.0.1', '198.19.255.255', '0:0:0:0:0:ffff:7f00:1', '192.0.0.8']) {
    assert.equal(isPrivateAddress(a), true, a);
  }
  for (const a of ['198.20.0.1', '2606:4700:4700::1111', '::ffff:808:808']) assert.equal(isPrivateAddress(a), false, a);
});

test('connect-time guard: the lookup that picks the socket address refuses a name that resolves private (DNS rebinding)', async () => {
  const run = (allow: boolean) =>
    new Promise<{ err: Error | null; addr: unknown }>((resolve) => guardedLookup(allow)('localhost', {}, (err, addr) => resolve({ err, addr })));
  const refused = await run(false);
  assert.match(refused.err?.message ?? '', /private/);
  const allowed = await run(true);
  assert.equal(allowed.err, null);
});

test('webFetch with no injected fetch goes through the guarded node client: gzip decoded, redirect re-checked, loopback refused', async () => {
  const http = await import('node:http');
  const zlib = await import('node:zlib');
  const server = http.createServer((req, res) => {
    if (req.url === '/gz') {
      res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
      res.end(zlib.gzipSync('<h1>zipped</h1>'));
    } else if (req.url === '/bin') {
      res.writeHead(200);
      res.end(Buffer.from([0, 1, 2, 3, 0, 255]));
    } else {
      res.writeHead(302, { location: 'http://10.9.9.9/x' });
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const prev = process.env.SEQUENCE_RESEARCH_ALLOW_LOOPBACK;
  try {
    const gz = 'http://127.0.0.1:' + port + '/gz';
    const bin = 'http://127.0.0.1:' + port + '/bin';
    const redir = 'http://127.0.0.1:' + port + '/r';
    const none = await webFetch(gz);
    assert.equal(none.ok, false, 'a loopback server is refused without the test allowlist');
    process.env.SEQUENCE_RESEARCH_ALLOW_LOOPBACK = [gz, bin, redir].join(',');
    const ok = await webFetch(gz);
    assert.ok(ok.ok && ok.output === '# zipped', JSON.stringify(ok));
    const b = await webFetch(bin);
    assert.equal(b.ok, false);
    assert.match(!b.ok ? b.error : '', /binary/);
    const r = await webFetch(redir);
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.error : '', /private/);
  } finally {
    if (prev === undefined) delete process.env.SEQUENCE_RESEARCH_ALLOW_LOOPBACK;
    else process.env.SEQUENCE_RESEARCH_ALLOW_LOOPBACK = prev;
    server.close();
  }
});

test('deep nesting: 32k and 1M nested <div> never reach the parser (flattened to text in well under a second)', () => {
  for (const n of [32_000, 1_000_000]) {
    const html = '<div>'.repeat(n) + 'bottom text';
    const t0 = Date.now();
    const md = htmlToMarkdown(html);
    const ms = Date.now() - t0;
    assert.ok(ms < budget(3000), n + ' nested divs took ' + ms + ' ms');
    assert.match(md, /deeper than 512 levels/);
  }
  /* 300 levels parse normally and, past the walk limit, the content is flattened to text rather than dropped */
  const mid = htmlToMarkdown('<div>'.repeat(400) + '<p>deep text kept</p>' + '</div>'.repeat(400));
  assert.match(mid, /deep text kept/);
});

/** Nodes in the tree the converter will walk: the same capped input, parsed the same way, counted iteratively. */
function treeSize(html: string): number {
  const stack: { childNodes?: unknown[] }[] = [parseHtml(html.length > HTML_CAP ? html.slice(0, HTML_CAP) : html) as never];
  let n = 0;
  while (stack.length) {
    const x = stack.pop()!;
    n += 1;
    for (const c of x.childNodes ?? []) stack.push(c as never);
  }
  return n;
}

test('nested tables and blockquotes at 2MB/5MB render each subtree once', () => {
  const filler = 'word '.repeat(400_000);
  const cases: [string, string][] = [
    ['60 nested tables', '<table><tr><td>'.repeat(60) + filler + '</td></tr></table>'.repeat(60)],
    ['60 nested blockquotes', '<blockquote>'.repeat(60) + filler + '</blockquote>'.repeat(60)],
    ['5MB of cells', '<table>' + '<tr><td>cell <a href="/x">link</a></td><td>two</td></tr>'.repeat(90_000) + '</table>'],
    ['nested lists', '<ul><li>item '.repeat(300) + filler],
  ];
  for (const [name, html] of cases) {
    const nodes = treeSize(html);
    const visits = { count: 0 };
    const t0 = Date.now();
    const md = renderHtml(html, { visits });
    const ms = Date.now() - t0;
    assert.ok(md.length > 0, name);
    /* the claim, as a count: no node is entered more than once (a text-only cell is read in place, so fewer is fine) */
    assert.ok((maxNesting(html.slice(0, HTML_CAP)) > MAX_NESTING || visits.count > 0) && visits.count <= nodes, `${name}: ${visits.count} renders for ${nodes} nodes`);
    /* positive control: this counter does see a second pass over the same tree (a re-render per level would show as a multiple of this) */
    const twice = { count: 0 };
    renderHtml(html, { visits: twice });
    renderHtml(html, { visits: twice });
    assert.equal(twice.count, visits.count * 2, `${name}: the counter must count a second pass over the same tree`);
    /* secondary: wall clock, moved by load but capped well under the cost of a quadratic walk */
    assert.ok(ms < bound(3000, 15000), name + ' took ' + ms + ' ms');
  }
  const q = htmlToMarkdown('<blockquote>a<blockquote>b</blockquote>c</blockquote><p>after</p>');
  assert.equal(q, '> a\n>\n> > b\n>\n> c\n\nafter');
});

test('webFetch converts in a worker with a hard timeout: a stuck conversion is an honest error, text mode falls back', async () => {
  const page = '<html><body><h1>Title</h1>' + '<p>some text here</p>'.repeat(50_000) + '</body></html>';
  const s = stub(() => html(page));
  const r = await webFetch('https://example.com/slow', { fetchImpl: s.fetchImpl, convertTimeoutMs: 1 });
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : '', /too complex to convert; use format=text or html/);
  const t = await webFetch('https://example.com/slow', { fetchImpl: s.fetchImpl, convertTimeoutMs: 1, format: 'text' });
  assert.ok(t.ok && t.output.includes('some text here'));
  const fine = await webFetch('https://example.com/slow', { fetchImpl: s.fetchImpl });
  assert.ok(fine.ok && fine.output.startsWith('# Title'), 'the worker path works normally');
});

test('webFetch never consults a patched globalThis.fetch: only the options param is a test seam', async () => {
  const prev = globalThis.fetch;
  let called = 0;
  globalThis.fetch = (async () => {
    called += 1;
    return new Response('x');
  }) as typeof fetch;
  try {
    const r = await webFetch('https://stub-not-called.invalid/');
    assert.equal(r.ok, false);
    assert.equal(called, 0, 'the connect-time guarded client was used, not the patched fetch');
  } finally {
    globalThis.fetch = prev;
  }
});
