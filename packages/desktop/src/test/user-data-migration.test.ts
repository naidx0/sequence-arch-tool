import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { prepareUserData, type NameApp } from '../userDataMigration.js';

/*
 * AUDIT P2-13: userData was <appData>/@sequence/desktop; it is <appData>/Sequence.
 * Every test runs in a temp "appData" with an injected app facade: no Electron,
 * and never the owner's real %APPDATA%.
 */

function sandbox() {
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-userdata-'));
  const calls: string[] = [];
  let userData: string | null = null;
  const name = '@sequence/desktop';
  const app: NameApp & { setName(n?: string): void } = {
    setName: () => {
      calls.push('setName');
    },
    getPath: (k) => {
      calls.push(`getPath:${k}`);
      return k === 'appData' ? appData : (userData ?? path.join(appData, name));
    },
    setPath: (k, v) => {
      calls.push(`setPath:${k}`);
      userData = v;
    },
  };
  const oldDir = path.join(appData, '@sequence', 'desktop');
  const newDir = path.join(appData, 'Sequence');
  return { appData, app, calls, oldDir, newDir, chosen: () => userData };
}

function seedOld(dir: string): void {
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'ai-keys.sealed'), 'sealed-bytes');
  fs.writeFileSync(path.join(dir, 'logs', 'main.log'), 'line1\nline2\n');
}

test('setName is never called; the only getPath before setPath(userData) is appData', () => {
  const s = sandbox();
  prepareUserData(s.app);
  assert.ok(!s.calls.includes('setName'));
  assert.equal(s.calls[0], 'getPath:appData');
  assert.equal(s.calls[1], 'setPath:userData');
  assert.deepEqual(s.calls.slice(2), []);
});

test('an explicit --user-data-dir is kept: nothing is renamed, copied or set', () => {
  const s = sandbox();
  seedOld(s.oldDir);
  const r = prepareUserData({ ...s.app, commandLine: { hasSwitch: (n) => n === 'user-data-dir' } });
  assert.equal(r.outcome, 'explicit');
  assert.ok(!s.calls.includes('setPath:userData'), 'userData is not overridden');
  assert.ok(fs.existsSync(path.join(s.oldDir, 'ai-keys.sealed')), 'the old folder is untouched');
  assert.ok(!fs.existsSync(s.newDir));
  /* control: without the switch the same facade migrates */
  const t = sandbox();
  seedOld(t.oldDir);
  assert.equal(prepareUserData({ ...t.app, commandLine: { hasSwitch: () => false } }).outcome, 'migrated');
});

test('main.ts imports the boot module before any other import', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main.ts'), 'utf8');
  const firstImport = src.split(/\r?\n/).find((l) => l.startsWith('import '));
  assert.match(firstImport ?? '', /from '\.\/bootUserData'/);
  assert.doesNotMatch(src, /app\.setName\(/);
});

test('fresh install: no old folder, the new folder is used', () => {
  const s = sandbox();
  const r = prepareUserData(s.app);
  assert.equal(r.outcome, 'fresh');
  assert.equal(r.userData, s.newDir);
  assert.equal(s.chosen(), s.newDir);
  assert.equal(path.basename(s.app.getPath('userData')), 'Sequence');
});

test('old folder only: contents move, identical, old removed', () => {
  const s = sandbox();
  seedOld(s.oldDir);
  const r = prepareUserData(s.app);
  assert.equal(r.outcome, 'migrated');
  assert.equal(r.userData, s.newDir);
  assert.equal(fs.readFileSync(path.join(s.newDir, 'ai-keys.sealed'), 'utf8'), 'sealed-bytes');
  assert.equal(fs.readFileSync(path.join(s.newDir, 'logs', 'main.log'), 'utf8'), 'line1\nline2\n');
  assert.equal(fs.existsSync(s.oldDir), false);
});

test('an empty new folder does not block the migration', () => {
  const s = sandbox();
  seedOld(s.oldDir);
  fs.mkdirSync(s.newDir, { recursive: true });
  assert.equal(prepareUserData(s.app).outcome, 'migrated');
  assert.equal(fs.readFileSync(path.join(s.newDir, 'ai-keys.sealed'), 'utf8'), 'sealed-bytes');
});

test('both exist: nothing overwritten, old kept, new used', () => {
  const s = sandbox();
  seedOld(s.oldDir);
  fs.mkdirSync(s.newDir, { recursive: true });
  fs.writeFileSync(path.join(s.newDir, 'ai-keys.sealed'), 'newer');
  const r = prepareUserData(s.app);
  assert.equal(r.outcome, 'both-exist');
  assert.equal(r.userData, s.newDir);
  assert.equal(fs.readFileSync(path.join(s.newDir, 'ai-keys.sealed'), 'utf8'), 'newer');
  assert.equal(fs.readFileSync(path.join(s.oldDir, 'ai-keys.sealed'), 'utf8'), 'sealed-bytes');
});

test('old folder locked (rename fails): no data lost, the old folder is used this run, the next run migrates', () => {
  const s = sandbox();
  seedOld(s.oldDir);
  const r = prepareUserData(s.app, {
    rename: () => {
      throw Object.assign(new Error('resource busy'), { code: 'EBUSY' });
    },
  });
  assert.equal(r.outcome, 'locked');
  assert.equal(r.userData, s.oldDir);
  assert.equal(s.chosen(), s.oldDir);
  assert.equal(s.app.getPath('userData'), s.oldDir);
  assert.match(r.detail ?? '', /EBUSY/);
  assert.equal(fs.readFileSync(path.join(s.oldDir, 'ai-keys.sealed'), 'utf8'), 'sealed-bytes');
  assert.equal(fs.existsSync(s.newDir), false);
  assert.equal(prepareUserData(sandboxOn(s)).outcome, 'migrated');
});

/** A second launch over the same temp appData (a fresh facade, nothing remembered). */
function sandboxOn(s: ReturnType<typeof sandbox>): NameApp {
  return { getPath: () => s.appData, setPath: () => undefined };
}

test('cross-volume rename (EXDEV): copied, verified, old removed', () => {
  const s = sandbox();
  seedOld(s.oldDir);
  const r = prepareUserData(s.app, {
    rename: () => {
      throw Object.assign(new Error('cross-device'), { code: 'EXDEV' });
    },
  });
  assert.equal(r.outcome, 'copied');
  assert.equal(fs.readFileSync(path.join(s.newDir, 'logs', 'main.log'), 'utf8'), 'line1\nline2\n');
  assert.equal(fs.existsSync(s.oldDir), false);
  assert.equal(fs.existsSync(`${s.newDir}.migrating`), false);
});

test('second run is a no-op', () => {
  const s = sandbox();
  seedOld(s.oldDir);
  prepareUserData(s.app);
  const before = fs.readFileSync(path.join(s.newDir, 'ai-keys.sealed'), 'utf8');
  const r = prepareUserData(sandboxOn(s));
  assert.equal(r.outcome, 'current');
  assert.equal(r.userData, s.newDir);
  assert.equal(fs.readFileSync(path.join(s.newDir, 'ai-keys.sealed'), 'utf8'), before);
  assert.equal(fs.existsSync(s.oldDir), false);
});

test('the migration module never renames the app (safeStorage secrets are keyed by the app name)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'userDataMigration.ts'), 'utf8');
  assert.doesNotMatch(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''), /\.setName\(/);
});
