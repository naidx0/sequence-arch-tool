import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRepoServer } from '../server/repoServer.js';
import { setHookTrust } from '../server/store.js';
import { HOOK_EVENTS_LIVE } from '../server/hooks.js';

/**
 * B5.1 — Settings hooks fire as claimed, on the HTTP path.
 *
 * Unit tests already prove `runHooks` + trust. These lock the routes Settings
 * and the file/commit surfaces actually call: GET /api/hooks honesty, and
 * PUT /api/file blocked by a trusted pre-write hook.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const PLAINAPP = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'plainapp');

async function startServer(
  repoRoot: string,
  userConfigDir: string,
): Promise<{ base: string; close: () => Promise<void> }> {
  const server = await createRepoServer(repoRoot, { webDist: undefined, userConfigDir });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function scratch(): { home: string; repo: string; clean: () => void } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-hooks-http-home-'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-hooks-http-repo-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(PLAINAPP, repo, { recursive: true });
  fs.mkdirSync(path.join(repo, '.sequence'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'note.txt'), 'before\n');
  return {
    home,
    repo,
    clean: () => {
      for (const d of [home, dir]) {
        try {
          fs.rmSync(d, { recursive: true, force: true });
        } catch {
          /* temp */
        }
      }
    },
  };
}

test('GET /api/hooks: live + unfired name dead declared events (B5.1)', async () => {
  const w = scratch();
  try {
    fs.writeFileSync(
      path.join(w.repo, '.sequence', 'hooks.json'),
      JSON.stringify({
        version: 1,
        hooks: {
          'pre-tool': [{ command: [process.execPath, '-e', 'process.exit(0)'] }],
          'pre-write': [{ command: [process.execPath, '-e', 'process.exit(0)'] }],
        },
      }),
    );
    const { base, close } = await startServer(w.repo, w.home);
    try {
      const res = await fetch(`${base}/api/hooks`);
      assert.strictEqual(res.status, 200);
      const body = (await res.json()) as {
        live: string[];
        unfired: string | null;
        trusted: boolean;
        declared: Record<string, unknown>;
      };
      assert.deepStrictEqual([...body.live].sort(), [...HOOK_EVENTS_LIVE].sort());
      assert.strictEqual(body.trusted, false);
      assert.ok(body.declared['pre-tool']);
      assert.ok(body.unfired);
      assert.match(body.unfired, /pre-tool/);
      assert.doesNotMatch(body.unfired, /pre-write/);
    } finally {
      await close();
    }
  } finally {
    w.clean();
  }
});

test('PUT /api/file: trusted pre-write hook blocks with the hook reason (B5.1)', async () => {
  const w = scratch();
  try {
    fs.writeFileSync(
      path.join(w.repo, '.sequence', 'hooks.json'),
      JSON.stringify({
        version: 1,
        hooks: {
          'pre-write': [
            {
              command: [
                process.execPath,
                '-e',
                'process.stderr.write("note.txt is frozen"); process.exit(2);',
              ],
            },
          ],
        },
      }),
    );
    setHookTrust(w.home, w.repo, true);
    const { base, close } = await startServer(w.repo, w.home);
    try {
      const res = await fetch(`${base}/api/file`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'note.txt', content: 'after\n' }),
      });
      assert.strictEqual(res.status, 403);
      const text = await res.text();
      assert.match(text, /frozen|pre-write|hook/i);
      assert.strictEqual(fs.readFileSync(path.join(w.repo, 'note.txt'), 'utf8'), 'before\n');
    } finally {
      await close();
    }
  } finally {
    w.clean();
  }
});

test('PUT /api/file: untrusted pre-write hook does not run — write proceeds (B5.1)', async () => {
  const w = scratch();
  try {
    fs.writeFileSync(
      path.join(w.repo, '.sequence', 'hooks.json'),
      JSON.stringify({
        version: 1,
        hooks: {
          'pre-write': [
            {
              command: [
                process.execPath,
                '-e',
                'process.stderr.write("should not run"); process.exit(2);',
              ],
            },
          ],
        },
      }),
    );
    /* No setHookTrust — default untrusted. */
    const { base, close } = await startServer(w.repo, w.home);
    try {
      const res = await fetch(`${base}/api/file`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'note.txt', content: 'after\n' }),
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(fs.readFileSync(path.join(w.repo, 'note.txt'), 'utf8'), 'after\n');
    } finally {
      await close();
    }
  } finally {
    w.clean();
  }
});
