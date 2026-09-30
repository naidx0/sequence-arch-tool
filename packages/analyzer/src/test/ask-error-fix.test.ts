import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRepoServer } from '../server/repoServer.js';

/**
 * AN ERROR THAT NAMES A FIX MUST CARRY THAT FIX AS DATA.
 *
 * Ask a question with no provider configured and the turn does everything
 * right — reads the files, builds the prompt, streams its progress — and then
 * ends with:
 *
 *   "the free assistant is not live yet — add your own API key in Settings"
 *
 * The client renders that on a strip whose only controls are RETRY and
 * DISMISS. Retry fails identically. Dismiss hides it. So the product tells the
 * reader exactly what to do and gives them no way to do it, which is the
 * dead-end defect the owner walk opened on: "the whole path out of 'the free
 * default is unavailable' ended in a dead end".
 *
 * The client must NOT solve this by matching the prose. `usability-standard`
 * and this server's own rule are the same: a surface renders the server's
 * sentence and never re-derives its meaning. So the failure carries a machine
 * readable `fix`, and the client routes on that.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');

function repo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-askfix-'));
  const root = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, root, { recursive: true });
  return root;
}

async function serve(root: string): Promise<{ base: string; close: () => Promise<void> }> {
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-askfix-home-'));
  const server = await createRepoServer(root, { webDist: undefined, userConfigDir: userDir });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Every `data:` payload from a streamed ask. */
async function events(base: string, body: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${base}/api/ask/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question: 'what does this app do?', ...body }),
  });
  const text = await res.text();
  const out: Record<string, unknown>[] = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    out.push(JSON.parse(line.slice(6)) as Record<string, unknown>);
  }
  return out;
}

test('a turn with no provider configured ends by NAMING ITS FIX as data', async () => {
  const root = repo();
  const { base, close } = await serve(root);
  try {
    /* The default mode with no live gateway and no key - which is the state a
       reader is in the first time they open this product. */
    await fetch(`${base}/api/ai-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'default' }),
    });

    const seen = await events(base, {});
    const error = seen.find((e) => e.type === 'error');
    assert.ok(error, 'the turn ends in an error');

    /* The sentence is still the server's, unchanged. */
    assert.match(String(error.error), /API key|not live/i);

    /*
     * AND IT SAYS WHAT WOULD FIX IT, as a value.
     *
     * Without this the client can only match the prose to decide whether to
     * offer a way out - and a surface that re-derives the server's meaning
     * from its wording breaks the moment the wording improves.
     */
    assert.strictEqual(
      error.fix,
      'provider',
      'a configuration failure must name the fix so a client can offer the route',
    );
  } finally {
    await close();
  }
});

test('an ordinary failure does NOT claim a fix it does not have', async () => {
  /*
   * The counterpart, and the reason `fix` is not simply always set: an
   * unreachable provider, a rate limit, a bad request are not fixed by opening
   * Settings, and offering that route would send the reader somewhere useless
   * and teach them the button is noise.
   */
  const root = repo();
  const { base, close } = await serve(root);
  try {
    await fetch(`${base}/api/ai-config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        provider: 'anthropic',
        baseUrl: 'http://127.0.0.1:1/never-listening',
        model: 'claude-test',
        apiKey: 'sk-ant-test-UNREACHABLE-1',
      }),
    });

    const seen = await events(base, {});
    const error = seen.find((e) => e.type === 'error');
    assert.ok(error, 'the turn ends in an error');
    assert.strictEqual(error.fix, undefined, 'an outage is not a configuration problem');
  } finally {
    await close();
  }
});
