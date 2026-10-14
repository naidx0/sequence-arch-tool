import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

/*
 * 0.1.8.1 D6 (audit L2-L4): the Linux packaging config. Linux cannot be built
 * on the machine this is developed on, so the fields are asserted from
 * electron-builder.yml; the build itself is the release workflow's.
 */
const DESKTOP = path.resolve(__dirname, '..', '..');
const yml = fs.readFileSync(path.join(DESKTOP, 'electron-builder.yml'), 'utf8').replace(/\r\n/g, '\n');

/** The top-level block `name:` up to the next top-level key. */
function block(name: string): string {
  const lines = yml.split('\n');
  const start = lines.findIndex((l) => l === `${name}:`);
  assert.ok(start >= 0, `electron-builder.yml has no ${name}: block`);
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (l !== '' && !/^[ \t#]/.test(l)) break;
    out.push(l);
  }
  return out.join('\n');
}

/** The `- item` list under `key:` inside a block. */
function list(text: string, key: string): string[] {
  const lines = text.split('\n');
  const at = lines.findIndex((l) => l.trim() === `${key}:`);
  if (at < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(at + 1)) {
    const m = /^\s+-\s+(\S.*)$/.exec(l);
    if (!m) break;
    out.push(m[1]!.trim());
  }
  return out;
}

test('D6: deb.depends is pinned, and keeps libsecret-1-0 because safeStorage uses it on Linux (B3)', () => {
  const deb = block('deb');
  const depends = list(deb, 'depends');
  assert.ok(depends.length > 0, 'deb.depends is overridden explicitly');
  assert.ok(depends.includes('libsecret-1-0'), 'safeStorage (B3) needs libsecret on Linux');
  for (const lib of ['libgtk-3-0', 'libnss3', 'libxss1', 'libxtst6', 'libnotify4']) assert.ok(depends.includes(lib), `Electron needs ${lib}`);
  const main = fs.readFileSync(path.join(DESKTOP, 'src', 'main.ts'), 'utf8');
  assert.match(main, /safeStorage\.encryptString/, 'the reason libsecret stays: main.ts really uses safeStorage');
});

test('D6: the deb .desktop Exec carries no --no-sandbox (no executableArgs for deb or linux)', () => {
  assert.doesNotMatch(block('deb'), /^\s+executableArgs:/m);
  assert.doesNotMatch(block('linux'), /^\s+executableArgs:/m);
  assert.doesNotMatch(yml.replace(/#.*$/gm, ''), /--no-sandbox/);
});

test('D6: no AppImage static-runtime toolset on electron-builder 25 (it arrived in 26); the gap is written down', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP, 'package.json'), 'utf8')) as { devDependencies: Record<string, string> };
  const major = Number(/(\d+)/.exec(pkg.devDependencies['electron-builder'] ?? '')?.[1]);
  if (major >= 26) {
    assert.match(yml, /^toolsets:\n\s+appimage:/m, 'on electron-builder 26+ the AppImage uses the static runtime');
  } else {
    assert.doesNotMatch(yml, /^toolsets:/m, 'electron-builder 25 rejects an unknown toolsets key');
    assert.match(yml, /toolsets\.appimage/, 'the gap is written down where the next person will look');
  }
});
