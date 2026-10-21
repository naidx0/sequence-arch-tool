import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';

import { forgetResolvedTools, launchTool, projectRootOf, resolveTool } from '../server/toolPath.js';
import { createChatWorktree } from '../server/chatWorktree.js';
import { makeNativeShim } from './helpers/nativeShim.js';
import { repo, temp } from './t3Helpers.js';
import { pathKey } from '../server/binResolve.js';

/** A real executable on every OS (a .cmd is not one; helpers/nativeShim.ts). */
const exe = (dir: string, name: string): void => {
  fs.mkdirSync(dir, { recursive: true });
  const noop = path.join(dir, `${name}.noop.mjs`);
  fs.writeFileSync(noop, '');
  makeNativeShim(dir, name, noop);
};

describe('tool lookup', () => {
  test('a tool that was missing is found once it is installed (a miss is not remembered)', () => {
    const dir = temp('seq-tp-');
    const env = { ...process.env, [pathKey(process.env)]: dir, PATHEXT: '.EXE' };
    forgetResolvedTools();
    assert.strictEqual(resolveTool('zz-tool-xyz', [], env).ok, false);
    exe(dir, 'zz-tool-xyz');
    assert.strictEqual(resolveTool('zz-tool-xyz', [], env).ok, true);
  });

  test('a .cmd shim is launched through its absolute path, never by bare name', () => {
    const l = launchTool('C:\\tools\\gh.cmd', ['pr', 'list'], { ...process.env, [pathKey(process.env)]: '' });
    assert.match(l.command, /cmd\.exe$/i);
    assert.strictEqual(l.verbatim, true);
    assert.ok(l.args.join(' ').includes('C:\\tools\\gh.cmd'));
    const plain = launchTool('/usr/bin/gh', ['pr']);
    assert.deepStrictEqual([plain.command, plain.args, plain.verbatim], ['/usr/bin/gh', ['pr'], false]);
  });

  test('a git inside the repository is refused for a worktree, because the repository root is refused too', async () => {
    const dir = repo();
    const dataDir = temp('seq-tp-data-');
    const made = await createChatWorktree(dir, { dataDir, title: 'x' });
    assert.ok(made.ok, JSON.stringify(made));
    const wt = made.ok ? made.ref.path : '';
    assert.strictEqual(path.resolve(projectRootOf(wt)), path.resolve(dir));
    const planted = path.join(dir, 'node_modules', '.bin');
    exe(planted, 'git');
    const key = pathKey(process.env);
    const env = { ...process.env, [key]: `${planted}${path.delimiter}${process.env[key]}` };
    forgetResolvedTools();
    const r = resolveTool('git', [wt, projectRootOf(wt)], env);
    assert.strictEqual(r.ok, false);
    assert.match(r.ok ? '' : r.error, /Refusing/);
    forgetResolvedTools();
  });
});
