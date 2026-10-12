import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { createRepoServer } from '../server/repoServer.js';

/* S3 through the server: Claude Code's hooks (UserPromptSubmit starts a turn,
   an edit tool's PreToolUse records its path before the write) and the
   /api/snapshots routes (turns, files, diff, revert, undo, revert-hunk). The
   specimen is a private temp repository. */

function repo(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-s3-routes-')));
  /* Twenty CRLF lines, so two edits far apart make two hunks. */
  fs.writeFileSync(path.join(root, 'a.ts'), Array.from({ length: 20 }, (_, i) => `line ${i + 1}\r\n`).join(''));
  fs.writeFileSync(path.join(root, 'b.ts'), 'bee\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  return root;
}

async function start(root: string) {
  const userConfigDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-s3-routes-cfg-')));
  const server = await createRepoServer(root, { webDist: undefined, userConfigDir });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    port,
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
      }),
  };
}

function call(port: number, method: string, p: string, body?: unknown): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: p,
        headers: { host: `127.0.0.1:${port}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: any = {};
          try {
            json = JSON.parse(text);
          } catch {
            json = { text };
          }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

test('Claude hooks snapshot a turn and record edits before they land; the routes revert, undo and revert one hunk', async () => {
  const root = repo();
  const srv = await start(root);
  try {
    const sid = 'claude-session-1';
    const a = path.join(root, 'a.ts');
    const b = path.join(root, 'b.ts');
    const before = fs.readFileSync(a);
    const hook = (name: string, extra: Record<string, unknown> = {}) =>
      call(srv.port, 'POST', '/api/agent-event', { hook_event_name: name, session_id: sid, cwd: root, ...extra });

    assert.equal((await hook('UserPromptSubmit', { prompt: 'edit a and add c' })).status, 200);
    /* PreToolUse for each write, then the write lands, as Claude Code does. */
    await hook('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: a }, tool_use_id: 't1' });
    fs.writeFileSync(a, before.toString('utf8').replace('line 2\r\n', 'LINE 2\r\n').replace('line 18\r\n', 'LINE 18\r\n'));
    await hook('PreToolUse', { tool_name: 'Write', tool_input: { file_path: path.join(root, 'c.ts') }, tool_use_id: 't2' });
    fs.writeFileSync(path.join(root, 'c.ts'), 'sea\n');
    /* A Read is not a write: not recorded. */
    await hook('PreToolUse', { tool_name: 'Read', tool_input: { file_path: b }, tool_use_id: 't3' });
    const afterTurn = fs.readFileSync(a);

    const sessions = await call(srv.port, 'GET', '/api/snapshots/sessions');
    assert.deepEqual(sessions.json.sessions.map((s: { sessionId: string; turns: number }) => [s.sessionId, s.turns]), [[sid, 1]]);
    const turns = await call(srv.port, 'GET', `/api/snapshots?sessionId=${sid}`);
    assert.deepEqual(turns.json.turns[0].files.sort(), ['a.ts', 'c.ts']);

    const files = await call(srv.port, 'GET', `/api/snapshots/files?sessionId=${sid}&seq=1`);
    assert.deepEqual(files.json.files, [
      { path: 'a.ts', status: 'modified' },
      { path: 'c.ts', status: 'added' },
    ]);

    /* Two hunks in a.ts; revert only the second (line 18). */
    const diff = (await call(srv.port, 'GET', `/api/snapshots/diff?sessionId=${sid}&seq=1&path=a.ts`)).json.diff as string;
    const headers = diff.split('\n').filter((l) => l.startsWith('@@')).map((l) => l.replace(/\r$/, ''));
    assert.equal(headers.length, 2, diff);
    const stale = await call(srv.port, 'POST', '/api/snapshots/revert-hunk', { sessionId: sid, seq: 1, path: 'a.ts', hunk: 1, header: '@@ -18 +18 @@' });
    assert.equal(stale.status, 409);
    const hunk = await call(srv.port, 'POST', '/api/snapshots/revert-hunk', { sessionId: sid, seq: 1, path: 'a.ts', hunk: 1, header: headers[1] });
    assert.equal(hunk.status, 200, JSON.stringify(hunk.json));
    const hunkReverted = Buffer.from(afterTurn.toString('utf8').replace('LINE 18\r\n', 'line 18\r\n'));
    assert.ok(fs.readFileSync(a).equals(hunkReverted), 'only the second hunk went back, CRLF kept');

    /* Revert to here, then undo. */
    const rev = await call(srv.port, 'POST', '/api/snapshots/revert', { sessionId: sid, seq: 1 });
    assert.equal(rev.status, 200);
    assert.ok(fs.readFileSync(a).equals(before));
    assert.equal(fs.existsSync(path.join(root, 'c.ts')), false);
    assert.equal(fs.readFileSync(b, 'utf8'), 'bee\n');
    const undo = await call(srv.port, 'POST', '/api/snapshots/undo', { sessionId: sid });
    assert.equal(undo.status, 200);
    assert.ok(fs.readFileSync(a).equals(hunkReverted));
    assert.equal(fs.readFileSync(path.join(root, 'c.ts'), 'utf8'), 'sea\n');
    assert.equal((await call(srv.port, 'POST', '/api/snapshots/undo', { sessionId: sid })).status, 409);

    /* A bad session id is a 400, not a path. */
    assert.equal((await call(srv.port, 'GET', '/api/snapshots?sessionId=../x')).status, 400);
  } finally {
    await srv.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
