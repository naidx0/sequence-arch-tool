import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEB_BINARY, launchCommand, selectArtefacts, verdict } from './linux-launch-smoke.mjs';

/* The script's logic only. Launching a real AppImage needs Linux, xvfb and a built release: that is the release run. */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('selectArtefacts needs exactly one AppImage and one deb, and says which is missing or doubled', () => {
  const ok = selectArtefacts(['Sequence-0.1.8-x86_64.AppImage', 'Sequence-0.1.8-amd64.deb', 'latest.yml']);
  assert.deepEqual(ok, { appImage: 'Sequence-0.1.8-x86_64.AppImage', deb: 'Sequence-0.1.8-amd64.deb', problems: [] });
  assert.deepEqual(selectArtefacts(['a.deb']).problems, ['no .AppImage in the release folder']);
  assert.deepEqual(selectArtefacts(['a.AppImage']).problems, ['no .deb in the release folder']);
  const two = selectArtefacts(['a.AppImage', 'b.AppImage', 'c.deb']);
  assert.equal(two.appImage, null);
  assert.match(two.problems[0], /more than one \.AppImage/);
});

test('launchCommand: a virtual display, the smoke flag, --no-sandbox, the deb at its installed path', () => {
  const a = launchCommand('appimage', '/r/Sequence.AppImage');
  assert.deepEqual([a.cmd, a.args], ['xvfb-run', ['-a', '/r/Sequence.AppImage', '--no-sandbox']]);
  assert.equal(a.env.SEQUENCE_DESKTOP_SMOKE, '1');
  assert.equal(a.env.APPIMAGE_EXTRACT_AND_RUN, '1', 'no FUSE needed on the runner');
  const d = launchCommand('deb', '/r/Sequence.deb');
  assert.equal(d.args[1], DEB_BINARY);
  assert.equal(d.env.APPIMAGE_EXTRACT_AND_RUN, undefined);
});

test('verdict: PASS needs the line and exit 0; no line, FAIL, PASS with a bad exit and a timeout are all failures', () => {
  const pass = 'noise\nSEQUENCE_DESKTOP_SMOKE PASS {"mounted":true}\n';
  assert.equal(verdict({ stdout: pass, code: 0, timedOut: false }).ok, true);
  assert.equal(verdict({ stdout: pass, code: 1, timedOut: false }).ok, false);
  assert.match(verdict({ stdout: pass, code: 1, timedOut: false }).reason, /exited 1/);
  assert.match(verdict({ stdout: 'SEQUENCE_DESKTOP_SMOKE FAIL {"reason":"x"}', code: 1, timedOut: false }).reason, /FAIL/);
  assert.match(verdict({ stdout: 'booted fine, I think', code: 0, timedOut: false }).reason, /printed no SEQUENCE_DESKTOP_SMOKE line/);
  assert.equal(verdict({ stdout: '', code: 0, timedOut: false }).ok, false, 'silence is not a pass');
  assert.equal(verdict({ stdout: pass, code: null, timedOut: true }).ok, false);
});

test('release.yml runs the smoke on the Linux row, before the artefacts are uploaded', () => {
  const y = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'release.yml'), 'utf8').replace(/\r\n/g, '\n');
  const smoke = y.indexOf('tools/ci/linux-launch-smoke.mjs');
  const upload = y.indexOf('uses: actions/upload-artifact@v4');
  assert.ok(smoke > 0, 'the step exists');
  assert.ok(smoke < upload, 'it runs before upload-artifact');
  const step = y.slice(y.lastIndexOf('- name:', smoke), smoke + 200);
  assert.match(step, /if: matrix\.os == 'ubuntu-latest'/);
  assert.match(step, /xvfb/);
});

test('F8: electron-builder names the Linux executable `sequence`, the path the smoke launches inside the deb', () => {
  const yml = fs.readFileSync(path.join(ROOT, 'packages', 'desktop', 'electron-builder.yml'), 'utf8').replace(/\r\n/g, '\n');
  const linux = yml.slice(yml.indexOf('\nlinux:\n'));
  assert.match(linux.slice(0, linux.indexOf('\ndeb:')), /^ {2}executableName: sequence$/m);
  assert.equal(DEB_BINARY, '/opt/Sequence/sequence');
});
