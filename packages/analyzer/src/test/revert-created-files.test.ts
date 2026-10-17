import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { beginTurn, revertToTurn, trackTurnWrites } from '../server/snapshot.js';

/* "Revert to here reported '1 file put back' but the file the agent created was still on disk."
   A temp git repo; the agent's turn creates one file and edits another; Revert to here must delete the first, restore the
   second, and report exactly those two. The report is checked against the disk, not against itself. */

function repoWith(files: Record<string, string>): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-revert-created-')));
  const run = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  run(['init', '-q', '-b', 'main']);
  run(['config', 'user.email', 't@example.com']);
  run(['config', 'user.name', 'T']);
  run(['config', 'commit.gpgsign', 'false']);
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  }
  run(['add', '-A']);
  run(['commit', '-q', '-m', 'user history']);
  return root;
}

test('Revert to here deletes what the turn created, restores what it edited, and reports what it did', async () => {
  const root = repoWith({ 'src/keep.txt': 'one\n', 'src/gone.txt': 'will be deleted\n', 'user.txt': 'mine\n' });
  const sid = 'session-created';
  await beginTurn(root, sid, { turnId: 't1' });
  /* The agent announces its writes before they land (the hooks), then writes. */
  await trackTurnWrites(root, sid, ['src/new/made.txt', 'src/keep.txt', 'src/gone.txt'], { turnId: 't1' });
  fs.mkdirSync(path.join(root, 'src', 'new'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/new/made.txt'), 'created by the agent\n');
  fs.writeFileSync(path.join(root, 'src/keep.txt'), 'edited by the agent\n');
  fs.rmSync(path.join(root, 'src/gone.txt'));

  const r = await revertToTurn(root, sid, 1);

  assert.equal(fs.existsSync(path.join(root, 'src/new/made.txt')), false, 'the created file is gone');
  assert.equal(fs.readFileSync(path.join(root, 'src/keep.txt'), 'utf8'), 'one\n', 'the edited file is back');
  assert.equal(fs.readFileSync(path.join(root, 'src/gone.txt'), 'utf8'), 'will be deleted\n', 'the deleted file is back');
  assert.equal(fs.readFileSync(path.join(root, 'user.txt'), 'utf8'), 'mine\n');
  assert.deepEqual(r.files, ['src/gone.txt', 'src/keep.txt', 'src/new/made.txt'], 'the report names exactly what changed on disk');
});

test('a file the agent made with its own tools (never announced) is still gone after Revert to here, and counted', async () => {
  const root = repoWith({ 'a.txt': 'a\n', 'user.txt': 'mine\n' });
  const sid = 'session-unannounced';
  await beginTurn(root, sid, { turnId: 't1' });
  /* Only the edit was announced: the agent created `made-by-shell.txt` through a shell command. */
  await trackTurnWrites(root, sid, ['a.txt'], { turnId: 't1' });
  fs.writeFileSync(path.join(root, 'a.txt'), 'a edited\n');
  fs.writeFileSync(path.join(root, 'made-by-shell.txt'), 'shell\n');
  /* The user's own edit during the turn is not the agent's: it stays. */
  fs.writeFileSync(path.join(root, 'user.txt'), 'mine, edited\n');

  const r = await revertToTurn(root, sid, 1);

  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'a\n');
  assert.equal(fs.existsSync(path.join(root, 'made-by-shell.txt')), false, 'the unannounced created file is gone too');
  assert.equal(fs.readFileSync(path.join(root, 'user.txt'), 'utf8'), 'mine, edited\n', "the user's own edit stays");
  assert.deepEqual(r.files, ['a.txt', 'made-by-shell.txt']);
});
