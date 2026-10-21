import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRepoServer } from '../server/repoServer.js';

/*
 * 0.1.8.1 C5 (audit P1-8): "Allow this folder". A folder outside home is
 * refused with ONE plain sentence and an `allow-folder` action; after
 * POST /api/allowed-folders it can be browsed and opened. No user-facing error
 * on these routes names an internal (jail, boundary, browse root).
 */

const SENTENCE = 'This folder is outside your home folder. Sequence only reads folders you allow.';
const INTERNAL = /jail|boundary|browse ?root|browseRoot|escapes/i;

function tmp(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

async function start(): Promise<{ base: string; home: string; outside: string; userDir: string; close: () => Promise<void> }> {
  const top = tmp('seq-c5-');
  const home = path.join(top, 'home');
  const outside = path.join(top, 'elsewhere', 'project');
  const userDir = path.join(top, 'user');
  fs.mkdirSync(path.join(home, 'inside'), { recursive: true });
  fs.mkdirSync(path.join(outside, 'src'), { recursive: true });
  fs.writeFileSync(path.join(outside, 'src', 'index.ts'), 'export const x = 1;\n');
  fs.mkdirSync(userDir);
  const server = await createRepoServer(null, { webDist: undefined, browseRoot: home, userConfigDir: userDir, recentStoreDir: userDir });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    home,
    outside,
    userDir,
    close: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      fs.rmSync(top, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}

function post(base: string, route: string, body: unknown, method = 'POST'): Promise<Response> {
  return fetch(`${base}${route}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

test('C5: outside home, attach and browse refuse with the one sentence and an allow-folder action', async () => {
  const s = await start();
  try {
    const attach = await post(s.base, '/api/attach', { path: s.outside });
    assert.strictEqual(attach.status, 403);
    assert.deepStrictEqual(await attach.json(), { error: SENTENCE, action: 'allow-folder', path: s.outside });

    const browse = await fetch(`${s.base}/api/browse?path=${encodeURIComponent(s.outside)}`);
    assert.strictEqual(browse.status, 403);
    assert.deepStrictEqual(await browse.json(), { error: SENTENCE, action: 'allow-folder', path: s.outside });
  } finally {
    await s.close();
  }
});

test('C5: after "Allow this folder" the folder is browsed and opened; removing it closes the door again', async () => {
  const s = await start();
  try {
    const allow = await post(s.base, '/api/allowed-folders', { path: s.outside });
    assert.strictEqual(allow.status, 200);
    assert.deepStrictEqual(await allow.json(), { folders: [fs.realpathSync(s.outside)] });
    assert.ok(fs.existsSync(path.join(s.userDir, 'allowed-folders.json')), 'remembered at user level');

    const list = (await (await fetch(`${s.base}/api/allowed-folders`)).json()) as { folders: string[] };
    assert.deepStrictEqual(list.folders, [fs.realpathSync(s.outside)]);

    const browse = await fetch(`${s.base}/api/browse?path=${encodeURIComponent(s.outside)}`);
    assert.strictEqual(browse.status, 200, 'browsable now');
    const listing = (await browse.json()) as { entries: { name: string }[] };
    assert.ok(listing.entries.some((e) => e.name === 'src'));

    const attach = await post(s.base, '/api/attach', { path: s.outside });
    assert.strictEqual(attach.status, 200, `opened: ${await attach.clone().text()}`);
    const status = (await (await fetch(`${s.base}/api/status`)).json()) as { attached: boolean; root: string };
    assert.strictEqual(status.attached, true);
    assert.strictEqual(status.root, fs.realpathSync(s.outside));

    /* Home is still home. */
    assert.strictEqual((await post(s.base, '/api/attach', { path: path.join(s.home, 'inside') })).status, 200);

    const removed = await post(s.base, '/api/allowed-folders', { path: s.outside }, 'DELETE');
    assert.deepStrictEqual(await removed.json(), { folders: [] });
    assert.strictEqual((await post(s.base, '/api/attach', { path: s.outside })).status, 403, 'refused again');
  } finally {
    await s.close();
  }
});

test('C5: a folder that holds home (or a drive root) can never be allowed', async () => {
  const s = await start();
  try {
    for (const p of [path.dirname(s.home), path.parse(s.home).root]) {
      const res = await post(s.base, '/api/allowed-folders', { path: p });
      assert.strictEqual(res.status, 400, `refuses ${p}`);
      const body = (await res.json()) as { error: string };
      assert.match(body.error, /holds your home folder/);
    }
    const none = (await (await fetch(`${s.base}/api/allowed-folders`)).json()) as { folders: string[] };
    assert.deepStrictEqual(none.folders, []);
  } finally {
    await s.close();
  }
});

test('C5: no user-facing error on browse, attach or allow names an internal', async () => {
  /* Positive control: the check catches the sentence this replaced. */
  assert.match('path escapes the browse root', INTERNAL);
  const s = await start();
  try {
    const symlinkOut = path.join(s.home, 'link-out');
    let linked = true;
    try {
      fs.symlinkSync(s.outside, symlinkOut, 'dir');
    } catch {
      linked = false;
    }
    const probes: Response[] = [
      await post(s.base, '/api/attach', { path: s.outside }),
      await post(s.base, '/api/attach', { path: path.join(s.home, '..', '..') }),
      await post(s.base, '/api/attach', { path: path.join(s.home, 'missing') }),
      await post(s.base, '/api/attach', { path: s.home }),
      await post(s.base, '/api/attach', {}),
      await fetch(`${s.base}/api/browse?path=${encodeURIComponent(s.outside)}`),
      await fetch(`${s.base}/api/browse?path=${encodeURIComponent(path.join(s.home, '..'))}`),
      await post(s.base, '/api/allowed-folders', { path: path.join(s.outside, 'nope') }),
      await post(s.base, '/api/allowed-folders', { path: 'relative/path' }),
      await post(s.base, '/api/allowed-folders', { path: path.dirname(s.home) }),
      ...(linked ? [await post(s.base, '/api/attach', { path: symlinkOut })] : []),
    ];
    let errors = 0;
    for (const res of probes) {
      assert.ok(res.status >= 400, `a refusal (${res.url} ${res.status})`);
      const body = (await res.json()) as { error?: string };
      assert.strictEqual(typeof body.error, 'string');
      assert.doesNotMatch(body.error!, INTERNAL, `internal term in: ${body.error}`);
      errors += 1;
    }
    assert.ok(errors >= 10, 'the probe set is not empty');
  } finally {
    await s.close();
  }
});

/* ── review B, blocker 2: no other spelling of home gets in ───────────────── */

test('review B: UNC and device paths are refused outright (\\localhost\C$\Users\<me> led to home)', { skip: process.platform !== 'win32' && 'UNC paths exist only on Windows' }, async () => {
  const s = await start();
  try {
    const me = os.homedir();
    const drive = me.slice(0, 1);
    const rest = me.slice(3);
    const B = String.fromCharCode(92);
    const spellings = [
      `${B}${B}localhost${B}${drive}$${B}${rest}`,
      `${B}${B}localhost${B}${drive}$${B}Users`,
      `${B}${B}127.0.0.1${B}${drive}$`,
      `${B}${B}?${B}${drive}:${B}Users`,
      `${B}${B}?${B}UNC${B}localhost${B}${drive}$`,
      `${B}${B}.${B}${drive}:${B}Users`,
      `//localhost/${drive}$/Users`,
    ];
    for (const p of spellings) {
      const res = await post(s.base, '/api/allowed-folders', { path: p });
      assert.strictEqual(res.status, 400, `refuses ${p}`);
    }
    const list = (await (await fetch(`${s.base}/api/allowed-folders`)).json()) as { folders: string[] };
    assert.deepStrictEqual(list.folders, []);
  } finally {
    await s.close();
  }
});

test('review B: a hand-edited allowed-folders.json is re-validated on read (a drive root or UNC entry is ignored)', async () => {
  const s = await start();
  try {
    const B = String.fromCharCode(92);
    fs.writeFileSync(
      path.join(s.userDir, 'allowed-folders.json'),
      JSON.stringify({ version: 1, folders: [path.parse(s.home).root, path.dirname(s.home), `${B}${B}localhost${B}C$`, s.outside] }),
    );
    const list = (await (await fetch(`${s.base}/api/allowed-folders`)).json()) as { folders: string[] };
    assert.deepStrictEqual(list.folders, [fs.realpathSync.native(s.outside)], 'only the valid entry survives');
    /* The root entry gives nothing: home itself still cannot be opened through it. */
    const viaRoot = await post(s.base, '/api/attach', { path: path.join(path.dirname(s.home), 'not-allowed') });
    assert.ok(viaRoot.status >= 400);
    assert.strictEqual((await post(s.base, '/api/attach', { path: s.outside })).status, 200, 'the valid entry still works');
  } finally {
    await s.close();
  }
});

test('review B: a link to the folder above home is refused by identity, whatever it is called', async () => {
  const s = await start();
  try {
    const link = path.join(s.outside, '..', 'up-link');
    try {
      fs.symlinkSync(path.dirname(s.home), link, 'junction');
    } catch {
      return; // links not permitted here
    }
    const res = await post(s.base, '/api/allowed-folders', { path: link });
    assert.strictEqual(res.status, 400);
    assert.match(((await res.json()) as { error: string }).error, /holds your home folder/);
  } finally {
    await s.close();
  }
});
