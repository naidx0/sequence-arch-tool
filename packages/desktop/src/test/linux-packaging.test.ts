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

test('item 22: electron-builder is 26+ and the AppImage uses the static runtime (toolsets.appimage), not the legacy 0.0.0 toolset', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP, 'package.json'), 'utf8')) as { devDependencies: Record<string, string> };
  const major = Number(/(\d+)/.exec(pkg.devDependencies['electron-builder'] ?? '')?.[1]);
  assert.ok(major >= 26, `electron-builder ${pkg.devDependencies['electron-builder']} predates the toolsets key`);
  const m = /^toolsets:\n\s+appimage:\s*"?([\d.]+)"?\s*$/m.exec(yml);
  assert.ok(m, 'toolsets.appimage is set');
  assert.notEqual(m![1], '0.0.0', '0.0.0 is the legacy toolset: libfuse2 and a baked-in --no-sandbox');
  assert.match(m![1]!, /^1\./, 'a 1.x toolset is the static type-2 runtime');
});

test('item 22: the deb afterInstall script makes chrome-sandbox root-owned and setuid unconditionally', () => {
  const deb = block('deb');
  const ref = /^\s+afterInstall:\s*(\S+)\s*$/m.exec(deb);
  assert.ok(ref, 'deb.afterInstall points at our script');
  /* electron-builder resolves deb.afterInstall from the package folder, not from directories.buildResources: the bare
     name passed this test and failed the real Linux build on v0.1.8.2 (ENOENT at packages/desktop/<name>). */
  const script = fs.readFileSync(path.join(DESKTOP, ref![1]!), 'utf8').replace(/\r\n/g, '\n');
  assert.match(script, /^#!\/bin\/bash\n/, 'a bash script');
  const code = script.replace(/#.*$/gm, '');
  assert.match(code, /^chmod 4755 '\/opt\/\$\{sanitizedProductName\}\/chrome-sandbox'/m, 'chrome-sandbox gets mode 4755');
  assert.match(code, /^chown root:root '\/opt\/\$\{sanitizedProductName\}\/chrome-sandbox'/m, 'and root ownership, which setuid needs');
  assert.doesNotMatch(code, /chmod 0755 '\/opt\/[^']*chrome-sandbox'/, 'no branch strips the setuid bit');
  assert.doesNotMatch(code, /--no-sandbox/, 'the install script does not hand out --no-sandbox either');
  assert.match(code, /update-alternatives/, "it still keeps electron-builder's /usr/bin link, which tools/ci/linux-launch-smoke relies on");
});

test('item 22: no source launches the app with --no-sandbox (the app, the launchers, the config)', () => {
  const src = path.join(DESKTOP, 'src');
  for (const f of fs.readdirSync(src)) {
    if (!f.endsWith('.ts')) continue;
    assert.doesNotMatch(fs.readFileSync(path.join(src, f), 'utf8'), /no-sandbox/, `${f} mentions no-sandbox`);
  }
  const main = fs.readFileSync(path.join(src, 'main.ts'), 'utf8');
  assert.match(main, /sandbox: true/, 'the renderer sandbox stays on');
  assert.doesNotMatch(main, /commandLine\.appendSwitch\(\s*['"]no-sandbox/);
});
