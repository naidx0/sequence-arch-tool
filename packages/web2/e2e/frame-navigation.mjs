#!/usr/bin/env node
/**
 * (lane visual) A sandboxed srcdoc page cannot make its frame request a remote URL when the app's HTML
 * carries the policy the repo server sends (analyzer server/static.ts APP_FRAME_POLICY). Real Chromium; a
 * counting server stands in for "the internet". The control page, served WITHOUT the header, does leak,
 * so this check fails if the header goes away. Skips cleanly with no Chromium.
 */
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { findChromium, launchOptions, loadPlaywright } from './lib/chromium.mjs';

const exe = findChromium();
const pw = await loadPlaywright();
if (!exe || !pw) {
  console.log('[frame-navigation] SKIP: no Chromium / playwright-core');
  process.exit(0);
}
const { APP_FRAME_POLICY } = await import(pathToFileURL(path.resolve(import.meta.dirname, '../../analyzer/dist/server/static.js')).href);

let hits = [];
const sink = http.createServer((req, res) => {
  hits.push(req.url);
  res.writeHead(204).end();
});
await new Promise((r) => sink.listen(0, '127.0.0.1', r));
const SINK = `http://127.0.0.1:${sink.address().port}`;

const PAYLOADS = {
  href: `<script>location.href="${SINK}/href?secret=1"</script>`,
  meta: `<meta http-equiv="refresh" content="0;url=${SINK}/meta?secret=1">`,
  anchor: `<a id=a href="${SINK}/anchor?secret=1">x</a><script>document.getElementById("a").click()</script>`,
};
const pageFor = (payload) =>
  `<!doctype html><body><iframe id=f sandbox="allow-scripts" srcdoc="${payload.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe></body>`;
const app = (withHeader) =>
  http.createServer((req, res) => {
    const kind = new URL(req.url, 'http://x').pathname.slice(1);
    res.writeHead(200, { 'content-type': 'text/html', ...(withHeader ? { 'content-security-policy': APP_FRAME_POLICY } : {}) });
    res.end(pageFor(PAYLOADS[kind] ?? ''));
  });

const browser = await pw.launch(launchOptions(exe));
let failed = 0;
for (const withHeader of [true, false]) {
  const server = app(withHeader);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const kind of Object.keys(PAYLOADS)) {
    hits = [];
    const page = await browser.newPage();
    await page.goto(`${base}/${kind}`);
    await page.waitForTimeout(700);
    const leaked = hits.length > 0;
    const ok = withHeader ? !leaked : leaked;
    console.log(`[frame-navigation] ${ok ? 'ok  ' : 'FAIL'} ${withHeader ? 'with header: no request' : 'control without header: leaks'} (${kind}, ${hits.length} hits)`);
    if (!ok) failed += 1;
    await page.close();
  }
  server.close();
}
await browser.close();
sink.close();
process.exit(failed ? 1 : 0);
