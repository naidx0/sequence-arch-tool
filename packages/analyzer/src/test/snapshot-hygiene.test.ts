import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { GC_EVERY_DROPPED, MAX_TURNS, beginTurn, ensureSequenceIgnored, readSession, resetSequenceIgnoredCheck, shadowGitDir, snapshotsIdle } from '../server/snapshot.js';

/* S3 shadow snapshots, three hygiene checks (coordinator, before the S1
   merge). Each repository is a temp git repo this test owns.
     1 the shadow honours the user's ignore rules, .git/info/exclude included
     2 .sequence/ is kept out of the user's commits through their LOCAL
       exclude, never their .gitignore
     3 growth: the last MAX_TURNS turns per chat are kept, older trees are
       garbage-collected from the shadow, and the user's repo is untouched */

const ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
const ID = ['-c', 'user.email=t@example.com', '-c', 'user.name=T', '-c', 'commit.gpgsign=false'];

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: ENV });
}

function userRepo(gitignore: string): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-snaphyg-')));
  fs.writeFileSync(path.join(root, 'a.txt'), 'one\n');
  fs.writeFileSync(path.join(root, '.gitignore'), gitignore);
  git(root, ['init', '-q', '-b', 'main']);
  git(root, [...ID, 'add', '-A']);
  git(root, [...ID, 'commit', '-q', '-m', 'user history']);
  return root;
}

/** KiB the shadow repository's objects take (loose + packed). */
function shadowKiB(root: string): number {
  const out = git(root, ['--git-dir', shadowGitDir(root), 'count-objects', '-v']);
  const n = (k: string) => Number(new RegExp(`^${k}: (\\d+)`, 'm').exec(out)?.[1] ?? 0);
  return n('size') + n('size-pack');
}

function inShadow(root: string, id: string): boolean {
  return spawnSync('git', ['--git-dir', shadowGitDir(root), 'cat-file', '-e', id], { env: ENV }).status === 0;
}

function userObjects(root: string): string {
  return git(root, ['count-objects', '-v']);
}

test('1. the shadow honours .gitignore AND .git/info/exclude: a 50 MB ignored folder adds nothing', async () => {
  const root = userRepo('node_modules/\ndist/\n');
  try {
    fs.appendFileSync(path.join(root, '.git', 'info', 'exclude'), 'bigout/\n');
    const big: string[] = [];
    for (const dir of ['node_modules', 'dist', 'bigout']) {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
      const file = path.join(root, dir, 'big.bin');
      fs.writeFileSync(file, crypto.randomBytes(dir === 'bigout' ? 30 * 1024 * 1024 : 10 * 1024 * 1024));
      big.push(git(root, ['hash-object', '--no-filters', file]).trim());
    }
    await beginTurn(root, 'chat-1');
    for (const id of big) assert.equal(inShadow(root, id), false, `ignored blob ${id} is not in the shadow`);
    assert.ok(shadowKiB(root) < 512, `the shadow holds ${shadowKiB(root)} KiB, not the 50 MB it ignores`);
    /* The tracked file is in it: the snapshot happened. */
    assert.equal(inShadow(root, git(root, ['hash-object', 'a.txt']).trim()), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('2. .sequence/ goes in the user\'s local info/exclude, once; their .gitignore is byte-identical; git status never shows it', async () => {
  const root = userRepo('node_modules/\r\n');
  try {
    const gitignore = fs.readFileSync(path.join(root, '.gitignore'));
    const exclude = path.join(root, '.git', 'info', 'exclude');
    resetSequenceIgnoredCheck();
    await beginTurn(root, 'chat-1');
    resetSequenceIgnoredCheck();
    await beginTurn(root, 'chat-1');
    ensureSequenceIgnored(root);
    assert.ok(fs.readFileSync(path.join(root, '.gitignore')).equals(gitignore), '.gitignore untouched');
    const lines = fs.readFileSync(exclude, 'utf8').split(/\r?\n/).filter((l) => l.trim() === '.sequence/');
    assert.equal(lines.length, 1, 'the line once');
    assert.ok(fs.existsSync(path.join(root, '.sequence')), 'the store exists');
    assert.doesNotMatch(git(root, ['status', '--porcelain', '--untracked-files=all']), /\.sequence/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('2b. a repo whose .gitignore already ignores .sequence: its exclude is left alone', async () => {
  const root = userRepo('.sequence/\n');
  try {
    const exclude = path.join(root, '.git', 'info', 'exclude');
    const before = fs.readFileSync(exclude);
    resetSequenceIgnoredCheck();
    await beginTurn(root, 'chat-1');
    assert.ok(fs.readFileSync(exclude).equals(before));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test(`3. growth: ${MAX_TURNS} turns kept per chat, older trees collected from the shadow only; the user repo's objects do not change`, async () => {
  const root = userRepo('node_modules/\n');
  try {
    const before = userObjects(root);
    const trees: string[] = [];
    for (let i = 0; i < MAX_TURNS + GC_EVERY_DROPPED; i++) {
      fs.writeFileSync(path.join(root, 'a.txt'), `turn ${i}\n${'x'.repeat(4096)}${i}\n`);
      trees.push((await beginTurn(root, 'chat-1')).tree);
      if (i === MAX_TURNS - 1) console.log(`# shadow after ${MAX_TURNS} turns: ${shadowKiB(root)} KiB`);
    }
    const s = readSession(root, 'chat-1');
    assert.equal(s.turns.length, MAX_TURNS);
    assert.deepEqual(s.turns.map((t) => t.tree), trees.slice(GC_EVERY_DROPPED));
    await snapshotsIdle(root);
    for (const t of trees.slice(0, GC_EVERY_DROPPED)) assert.equal(inShadow(root, t), false, 'aged-out trees were collected (in one batched gc, after the turn)');
    for (const t of trees.slice(GC_EVERY_DROPPED)) assert.equal(inShadow(root, t), true, 'every kept tree is still there');
    assert.equal(git(root, ['--git-dir', shadowGitDir(root), 'for-each-ref']), '', 'no refs at rest');
    assert.equal(userObjects(root), before, 'the user repository did not change');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
