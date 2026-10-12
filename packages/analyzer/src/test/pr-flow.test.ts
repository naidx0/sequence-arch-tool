import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import { recordAgentRun } from '../server/agentChatStore.js';
import { createSession, readSessionIndex, readSessionWorktree, updateSession } from '../server/sessionsStore.js';
import { call, git, repo, serve, temp, userState, type Json } from './t3Helpers.js';

/* ══════════════════════════════════════════════════════════════════════════
   PULL REQUEST FROM A WORKTREE CHAT. The remote is a local bare repository
   and `gh` is a stub script ($SEQUENCE_GH) that records its arguments and
   prints a link: nothing here can reach a real remote or a real GitHub.
   ══════════════════════════════════════════════════════════════════════════ */

function ghStub(): { script: string; log: string; calls: () => string[][] } {
  const dir = temp('seq-pr-gh-');
  const log = path.join(dir, 'calls.jsonl');
  const script = path.join(dir, 'gh-stub.mjs');
  fs.writeFileSync(script, `import fs from 'node:fs';\nfs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');\nconsole.log('https://github.com/example/repo/pull/7');\n`);
  return { script, log, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as string[]) : []) };
}

/** A repo whose only remote is a local bare repository, with main already pushed. */
function repoWithBareRemote(): { dir: string; bare: string } {
  const dir = repo();
  const bare = temp('seq-pr-bare-');
  git(bare, ['init', '-q', '--bare', '-b', 'main']);
  git(dir, ['remote', 'add', 'origin', bare]);
  git(dir, ['push', '-q', 'origin', 'main']);
  return { dir, bare };
}

describe('PR flow', () => {
  test('one click commits the chat\'s work, pushes its branch to the bare remote, calls gh with the generated title, and links the PR to the chat', async () => {
    const { dir, bare } = repoWithBareRemote();
    const store = temp('seq-pr-store-');
    const stub = ghStub();
    process.env.SEQUENCE_GH = stub.script;
    const { base, close } = await serve(dir, store);
    try {
      const chat = createSession(dir).id;
      updateSession(dir, chat, { title: 'Add a ping endpoint' });
      recordAgentRun(dir, chat, { id: 'r1', agentRef: 'codex', prompt: 'please add GET /ping that answers pong', text: 'done', status: 'done', error: null, stopReason: 'end_turn', startedAt: 1, endedAt: 2, model: null, nodeId: null, tools: [] });
      assert.strictEqual((await call(base, `/api/sessions/${chat}/worktree`, {})).status, 200);
      const wt = readSessionWorktree(dir, chat)!;
      fs.writeFileSync(path.join(wt.path, 'ping.txt'), 'pong\n');
      const mainBefore = userState(dir);

      const pv = await call(base, `/api/sessions/${chat}/pr/preview`, {});
      assert.strictEqual(pv.status, 200, JSON.stringify(pv.json));
      assert.strictEqual(pv.json.title, 'Add a ping endpoint');
      assert.match(String(pv.json.body), /please add GET \/ping/);
      assert.match(String(pv.json.body), /added `ping.txt`/);
      assert.deepStrictEqual([pv.json.remote, pv.json.base, pv.json.dirty], ['origin', 'main', true]);
      assert.deepStrictEqual(stub.calls(), [], 'a preview calls nothing');
      assert.strictEqual(git(wt.path, ['rev-parse', 'HEAD']).trim(), wt.baseCommit, 'a preview commits nothing');

      const opened = await call(base, `/api/sessions/${chat}/pr`, {});
      assert.strictEqual(opened.status, 200, JSON.stringify(opened.json));
      assert.deepStrictEqual((opened.json.pr as Json).url, 'https://github.com/example/repo/pull/7');
      assert.strictEqual((opened.json.pr as Json).number, 7);

      /* the commit is on the chat's branch, and the bare remote has that branch at that commit */
      assert.notStrictEqual(git(wt.path, ['rev-parse', 'HEAD']).trim(), wt.baseCommit);
      assert.strictEqual(git(wt.path, ['status', '--porcelain']).trim(), '', 'nothing left uncommitted');
      assert.strictEqual(git(bare, ['rev-parse', `refs/heads/${wt.branch}`]).trim(), git(wt.path, ['rev-parse', 'HEAD']).trim());
      assert.strictEqual(git(bare, ['show', `${wt.branch}:ping.txt`]), 'pong\n');
      assert.ok(!git(bare, ['ls-tree', '-r', '--name-only', wt.branch]).includes('.sequence'), '.sequence is never committed');
      assert.match(git(wt.path, ['log', '-1', '--format=%s']), /Add a ping endpoint/);

      /* gh got the generated title, the branch as head, and main as base */
      const [args] = stub.calls();
      assert.deepStrictEqual(args!.slice(0, 2), ['pr', 'create']);
      assert.strictEqual(args![args!.indexOf('--title') + 1], 'Add a ping endpoint');
      assert.strictEqual(args![args!.indexOf('--head') + 1], wt.branch);
      assert.strictEqual(args![args!.indexOf('--base') + 1], 'main');
      assert.match(args![args!.indexOf('--body') + 1]!, /Opened from a Sequence chat/);

      /* linked to the chat */
      assert.strictEqual(readSessionIndex(dir)!.sessions.find((s) => s.id === chat)!.pr?.url, 'https://github.com/example/repo/pull/7');
      assert.strictEqual(((await call(base, `/api/sessions/${chat}/pr`)).json.pr as Json).number, 7);
      assert.strictEqual(userState(dir), mainBefore, "the user's own checkout was not touched");

      /* more work: the push updates the same pull request, gh is not called again */
      fs.writeFileSync(path.join(wt.path, 'more.txt'), 'more\n');
      const again = await call(base, `/api/sessions/${chat}/pr`, {});
      assert.strictEqual(again.status, 200, JSON.stringify(again.json));
      assert.strictEqual(again.json.existing, true);
      assert.strictEqual(stub.calls().length, 1);
      assert.strictEqual(git(bare, ['show', `${wt.branch}:more.txt`]), 'more\n');
    } finally {
      delete process.env.SEQUENCE_GH;
      await close();
    }
  });

  test('no worktree and no remote are each refused before anything is committed or pushed', async () => {
    const dir = repo();
    const store = temp('seq-pr-store-');
    const stub = ghStub();
    process.env.SEQUENCE_GH = stub.script;
    const { base, close } = await serve(dir, store);
    try {
      const chat = createSession(dir).id;
      assert.strictEqual((await call(base, `/api/sessions/${chat}/pr`, {})).status, 404, 'no worktree');
      assert.strictEqual((await call(base, `/api/sessions/${chat}/worktree`, {})).status, 200);
      const wt = readSessionWorktree(dir, chat)!;
      fs.writeFileSync(path.join(wt.path, 'a.ts'), 'x\n');
      const noRemote = await call(base, `/api/sessions/${chat}/pr`, {});
      assert.strictEqual(noRemote.status, 409);
      assert.match(String(noRemote.json.error), /no remote/);
      assert.match(git(wt.path, ['status', '--porcelain']), /a\.ts/, 'still uncommitted');
      assert.deepStrictEqual(stub.calls(), []);
    } finally {
      delete process.env.SEQUENCE_GH;
      await close();
    }
  });

  test('a missing gh still leaves the branch pushed, and says so', async () => {
    const { dir, bare } = repoWithBareRemote();
    const store = temp('seq-pr-store-');
    process.env.SEQUENCE_GH = path.join(temp('seq-pr-none-'), 'no-such-gh');
    const { base, close } = await serve(dir, store);
    try {
      const chat = createSession(dir).id;
      await call(base, `/api/sessions/${chat}/worktree`, {});
      const wt = readSessionWorktree(dir, chat)!;
      fs.writeFileSync(path.join(wt.path, 'a.ts'), 'x\n');
      const r = await call(base, `/api/sessions/${chat}/pr`, {});
      assert.strictEqual(r.status, 424, JSON.stringify(r.json));
      assert.match(String(r.json.error), /was pushed/);
      assert.strictEqual(git(bare, ['show', `${wt.branch}:a.ts`]), 'x\n');
      assert.strictEqual(readSessionIndex(dir)!.sessions.find((s) => s.id === chat)!.pr, undefined, 'nothing is linked that does not exist');
    } finally {
      delete process.env.SEQUENCE_GH;
      await close();
    }
  });

  test('secret-shaped and git-ignored files never reach the remote unless ticked; the preview names every file', async () => {
    const { dir, bare } = repoWithBareRemote();
    fs.writeFileSync(path.join(dir, '.gitignore'), 'dist/\n');
    git(dir, ['add', '.gitignore']);
    git(dir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'ignore']);
    git(dir, ['push', '-q', 'origin', 'main']);
    const store = temp('seq-pr-store-');
    const stub = ghStub();
    process.env.SEQUENCE_GH = stub.script;
    const { base, close } = await serve(dir, store);
    try {
      const chat = createSession(dir).id;
      await call(base, `/api/sessions/${chat}/worktree`, {});
      const wt = readSessionWorktree(dir, chat)!;
      const put = (f: string, c = 'x\n'): void => {
        fs.mkdirSync(path.dirname(path.join(wt.path, f)), { recursive: true });
        fs.writeFileSync(path.join(wt.path, f), c);
      };
      put('src/ok.ts');
      put('.env', 'TOKEN=abc\n');
      put('.env.example', 'TOKEN=\n');
      put('keys/server.pem');
      put('id_rsa');
      put('config/credentials.json');
      put('dist/out.js');

      const pv = await call(base, `/api/sessions/${chat}/pr/preview`, {});
      const names = (pv.json.pending as Json[]).map((f) => f.path);
      assert.deepStrictEqual(names, ['.env', '.env.example', 'config/credentials.json', 'id_rsa', 'keys/server.pem', 'src/ok.ts'], 'every pending file is listed, ignored ones are not');
      const flagged = (pv.json.pending as Json[]).filter((f) => f.flagged).map((f) => f.path);
      assert.deepStrictEqual(flagged, ['.env', 'config/credentials.json', 'id_rsa', 'keys/server.pem']);
      assert.deepStrictEqual((pv.json.files as Json[]).map((f) => f.path), ['.env.example', 'src/ok.ts'], 'the file list is what will be committed');

      const r = await call(base, `/api/sessions/${chat}/pr`, {});
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      const pushed = git(bare, ['ls-tree', '-r', '--name-only', wt.branch]).split('\n');
      assert.ok(pushed.includes('src/ok.ts') && pushed.includes('.env.example'));
      for (const bad of ['.env', 'keys/server.pem', 'id_rsa', 'config/credentials.json', 'dist/out.js']) assert.ok(!pushed.includes(bad), `${bad} must not be pushed`);
      assert.match(git(wt.path, ['status', '--porcelain']), /\.env/, 'the flagged files stay uncommitted on disk');

      const again = await call(base, `/api/sessions/${chat}/pr/preview`, {});
      assert.ok((again.json.pending as Json[]).some((f) => f.path === '.env'), 'Push newer commits lists the held files too');
      assert.ok(again.json.pr);
      const ticked = await call(base, `/api/sessions/${chat}/pr`, { includeFlagged: ['id_rsa'] });
      assert.strictEqual(ticked.status, 200, JSON.stringify(ticked.json));
      const after = git(bare, ['ls-tree', '-r', '--name-only', wt.branch]).split('\n');
      assert.ok(after.includes('id_rsa'));
      assert.ok(!after.includes('.env'), 'only what was ticked');
    } finally {
      delete process.env.SEQUENCE_GH;
      await close();
    }
  });

  test('when the only changes look like secrets nothing is committed or pushed', async () => {
    const { dir, bare } = repoWithBareRemote();
    const store = temp('seq-pr-store-');
    const stub = ghStub();
    process.env.SEQUENCE_GH = stub.script;
    const { base, close } = await serve(dir, store);
    try {
      const chat = createSession(dir).id;
      await call(base, `/api/sessions/${chat}/worktree`, {});
      const wt = readSessionWorktree(dir, chat)!;
      fs.writeFileSync(path.join(wt.path, '.env'), 'A=1\n');
      const r = await call(base, `/api/sessions/${chat}/pr`, {});
      assert.strictEqual(r.status, 409);
      assert.match(String(r.json.error), /like secrets/);
      assert.strictEqual(git(wt.path, ['rev-parse', 'HEAD']).trim(), wt.baseCommit);
      assert.strictEqual(git(bare, ['branch', '--list', wt.branch]).trim(), '', 'nothing pushed');
      assert.deepStrictEqual(stub.calls(), []);
    } finally {
      delete process.env.SEQUENCE_GH;
      await close();
    }
  });

  test('the agent mid-turn: opening a pull request is refused by the server', async () => {
    const { dir } = repoWithBareRemote();
    const store = temp('seq-pr-store-');
    const { base, close } = await serve(dir, store);
    try {
      const chat = createSession(dir).id;
      await call(base, `/api/sessions/${chat}/worktree`, {});
      const wt = readSessionWorktree(dir, chat)!;
      fs.writeFileSync(path.join(wt.path, 'a.ts'), 'x\n');
      const { openPullRequest } = await import('../server/prFlow.js');
      const r = await openPullRequest(dir, chat, wt, { busy: true });
      assert.strictEqual(r.ok, false);
      assert.strictEqual((r as { status: number }).status, 409);
      assert.match(git(wt.path, ['status', '--porcelain']), /a\.ts/, 'nothing committed');
    } finally {
      await close();
    }
  });

  test('gh is run from an absolute path: one found on PATH works, one that sits inside the project is refused', { skip: process.platform === 'win32' }, async () => {
    const { dir, bare } = repoWithBareRemote();
    const store = temp('seq-pr-store-');
    const saved = process.env.PATH;
    const { forgetResolvedTools } = await import('../server/toolPath.js');
    const { base, close } = await serve(dir, store);
    try {
      const chat = createSession(dir).id;
      await call(base, `/api/sessions/${chat}/worktree`, {});
      const wt = readSessionWorktree(dir, chat)!;
      fs.writeFileSync(path.join(wt.path, 'a.ts'), 'x\n');
      const log = path.join(temp('seq-pr-ghlog-'), 'ran');
      const script = `#!/bin/sh\necho ran >> ${JSON.stringify(log)}\necho https://github.com/example/repo/pull/9\n`;

      const planted = path.join(wt.path, 'bin');
      fs.mkdirSync(planted);
      fs.writeFileSync(path.join(planted, 'gh'), script, { mode: 0o755 });
      delete process.env.SEQUENCE_GH;
      process.env.PATH = `${planted}${path.delimiter}${saved}`;
      forgetResolvedTools();
      const refused = await call(base, `/api/sessions/${chat}/pr`, {});
      assert.strictEqual(refused.status, 409, JSON.stringify(refused.json));
      assert.match(String(refused.json.error), /Refusing to run gh/);
      assert.match(String(refused.json.error), /was pushed/);
      assert.ok(!fs.existsSync(log), 'the planted gh never ran');
      assert.ok(git(bare, ['branch', '--list', wt.branch]).trim(), 'the branch was still pushed');

      fs.writeFileSync(path.join(wt.path, 'gh'), script, { mode: 0o755 });
      process.env.PATH = `.${path.delimiter}${saved}`;
      forgetResolvedTools();
      const cwdOnly = await call(base, `/api/sessions/${chat}/pr`, {});
      assert.ok(!fs.existsSync(log), 'a gh in the working directory never ran');
      assert.notStrictEqual(cwdOnly.status, 200);

      const good = temp('seq-pr-goodbin-');
      fs.writeFileSync(path.join(good, 'gh'), script, { mode: 0o755 });
      process.env.PATH = `${good}${path.delimiter}${saved}`;
      forgetResolvedTools();
      const ok = await call(base, `/api/sessions/${chat}/pr`, {});
      assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
      assert.ok(fs.existsSync(log));
    } finally {
      process.env.PATH = saved;
      forgetResolvedTools();
      await close();
    }
  });

  test('secrets the agent committed itself are caught too: the push is refused until each one is ticked', async () => {
    const { dir, bare } = repoWithBareRemote();
    const store = temp('seq-pr-store-');
    const stub = ghStub();
    process.env.SEQUENCE_GH = stub.script;
    const { base, close } = await serve(dir, store);
    try {
      const chat = createSession(dir).id;
      await call(base, `/api/sessions/${chat}/worktree`, {});
      const wt = readSessionWorktree(dir, chat)!;
      for (const f of ['.env', 'id_rsa', 'c.txt']) fs.writeFileSync(path.join(wt.path, f), 'x\n');
      git(wt.path, ['add', '-A', '--', '.env', 'id_rsa', 'c.txt']);
      git(wt.path, ['-c', 'user.name=agent', '-c', 'user.email=a@a', 'commit', '-q', '-m', 'agent commit']);

      const pv = await call(base, `/api/sessions/${chat}/pr/preview`, {});
      assert.deepStrictEqual((pv.json.pending as Json[]).length, 0);
      const held = (pv.json.committed as Json[]).filter((f) => f.flagged).map((f) => f.path);
      assert.deepStrictEqual(held, ['.env', 'id_rsa'], 'the preview lists the committed secrets');

      const refused = await call(base, `/api/sessions/${chat}/pr`, {});
      assert.strictEqual(refused.status, 409, JSON.stringify(refused.json));
      assert.match(String(refused.json.error), /\.env/);
      assert.match(String(refused.json.error), /Already committed/);
      assert.strictEqual(git(bare, ['branch', '--list', wt.branch]).trim(), '', 'nothing was pushed');
      assert.deepStrictEqual(stub.calls(), []);

      const partly = await call(base, `/api/sessions/${chat}/pr`, { includeFlagged: ['.env'] });
      assert.strictEqual(partly.status, 409, 'one of two ticked is still refused');
      assert.match(String(partly.json.error), /id_rsa/);

      const ok = await call(base, `/api/sessions/${chat}/pr`, { includeFlagged: ['.env', 'id_rsa'] });
      assert.strictEqual(ok.status, 200, JSON.stringify(ok.json));
      assert.ok(git(bare, ['ls-tree', '-r', '--name-only', wt.branch]).includes('.env'));
    } finally {
      delete process.env.SEQUENCE_GH;
      await close();
    }
  });

  test('more secret shapes are held back: .envrc, *.env, secrets.local.json, *.tfvars, and files whose content holds a private key or a token', async () => {
    const { dir, bare } = repoWithBareRemote();
    const store = temp('seq-pr-store-');
    process.env.SEQUENCE_GH = ghStub().script;
    const { base, close } = await serve(dir, store);
    try {
      const chat = createSession(dir).id;
      await call(base, `/api/sessions/${chat}/worktree`, {});
      const wt = readSessionWorktree(dir, chat)!;
      const put = (f: string, c = 'x\n'): void => {
        fs.mkdirSync(path.dirname(path.join(wt.path, f)), { recursive: true });
        fs.writeFileSync(path.join(wt.path, f), c);
      };
      put('.envrc');
      put('config/prod.env');
      put('secrets.local.json');
      put('infra/prod.tfvars');
      /* A real throwaway key made here, so no key is checked in (the public export refuses any). */
      put('notes.txt', crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
      put('deploy.sh', `curl -H "Authorization: token ghp_${'a'.repeat(36)}" x\n`);
      put('src/fine.ts', 'export const a = 1;\n');
      const pv = await call(base, `/api/sessions/${chat}/pr/preview`, {});
      const flagged = (pv.json.pending as Json[]).filter((f) => f.flagged).map((f) => f.path);
      assert.deepStrictEqual(flagged, ['.envrc', 'config/prod.env', 'deploy.sh', 'infra/prod.tfvars', 'notes.txt', 'secrets.local.json']);
      assert.strictEqual((await call(base, `/api/sessions/${chat}/pr`, {})).status, 200);
      assert.deepStrictEqual(git(bare, ['ls-tree', '-r', '--name-only', wt.branch]).trim().split('\n').filter((f) => f !== 'a.txt'), ['src/fine.ts']);
    } finally {
      delete process.env.SEQUENCE_GH;
      await close();
    }
  });

  test('a force-added ignored file is a held-back file with a reason, not a 500; ticking sends it', async () => {
    const { dir, bare } = repoWithBareRemote();
    fs.writeFileSync(path.join(dir, '.gitignore'), 'dist/\n');
    git(dir, ['add', '.gitignore']);
    git(dir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'ignore']);
    git(dir, ['push', '-q', 'origin', 'main']);
    const store = temp('seq-pr-store-');
    process.env.SEQUENCE_GH = ghStub().script;
    const { base, close } = await serve(dir, store);
    try {
      const chat = createSession(dir).id;
      await call(base, `/api/sessions/${chat}/worktree`, {});
      const wt = readSessionWorktree(dir, chat)!;
      fs.mkdirSync(path.join(wt.path, 'dist'));
      fs.writeFileSync(path.join(wt.path, 'dist', 'out.js'), 'x\n');
      fs.writeFileSync(path.join(wt.path, 'ok.ts'), 'x\n');
      git(wt.path, ['add', '-f', 'dist/out.js']);
      const pv = await call(base, `/api/sessions/${chat}/pr/preview`, {});
      assert.deepStrictEqual((pv.json.pending as Json[]).filter((f) => f.flagged).map((f) => [f.path, f.flagged]), [['dist/out.js', 'ignored by .gitignore']]);
      const r = await call(base, `/api/sessions/${chat}/pr`, {});
      assert.strictEqual(r.status, 200, JSON.stringify(r.json));
      assert.ok(!git(bare, ['ls-tree', '-r', '--name-only', wt.branch]).includes('dist/out.js'));
      fs.writeFileSync(path.join(wt.path, 'more.ts'), 'x\n');
      git(wt.path, ['add', '-f', 'dist/out.js']);
      const ticked = await call(base, `/api/sessions/${chat}/pr`, { includeFlagged: ['dist/out.js'] });
      assert.strictEqual(ticked.status, 200, JSON.stringify(ticked.json));
      assert.ok(git(bare, ['ls-tree', '-r', '--name-only', wt.branch]).includes('dist/out.js'));
    } finally {
      delete process.env.SEQUENCE_GH;
      await close();
    }
  });
});
