import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { pnpmInvocation } from '../../packages/desktop/scripts/pnpm-invocation.mjs';

/**
 * PACKAGING ON THE PLATFORM THE INSTALLER TARGETS.
 *
 * `electron-builder.yml` builds an NSIS installer for Windows. Assembling the
 * server bundle that installer ships ran `execFileSync('pnpm', …)`, and on
 * Windows that fails with `spawnSync pnpm ENOENT` — pnpm is `pnpm.cmd` there,
 * and since the fix for CVE-2024-27980 Node refuses to spawn a `.cmd` without
 * a shell. Measured on a real Windows machine: `pnpm desktop:dist` could not
 * get past step 3, and the error it printed blamed the user's pnpm install.
 *
 * These lock the branch itself rather than the platform running the suite —
 * a check that only runs on Windows leaves the Windows bug invisible to
 * everyone else, which is exactly how it survived this long.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const SCRIPT = path.join(ROOT, 'packages', 'desktop', 'scripts', 'prepare-server.mjs');

describe('pnpmInvocation', () => {
  it('runs pnpm directly where a bare name resolves', () => {
    const run = pnpmInvocation('darwin', ['--filter', 'x', 'deploy']);
    assert.equal(run.command, 'pnpm');
    assert.equal(run.shell, false);
    assert.deepEqual(run.args, ['--filter', 'x', 'deploy']);
  });

  it('GOES THROUGH A SHELL ON WINDOWS, or the deploy cannot start at all', () => {
    const run = pnpmInvocation('win32', ['--filter', 'x', 'deploy']);
    assert.equal(run.shell, true, 'a .cmd cannot be spawned without one');
    assert.match(run.command, /^pnpm --filter x deploy$/);
  });

  it('hands the shell ONE finished line, never a list beside it', () => {
    /*
     * Node's DEP0190: `args` alongside `shell: true` are concatenated without
     * escaping. Splitting the invocation across both fields would put the
     * quoting this function exists to do into a deprecated code path that does
     * it invisibly and differently.
     */
    assert.deepEqual(pnpmInvocation('win32', ['deploy', 'x']).args, []);
  });

  it('QUOTES A TARGET PATH WITH SPACES, which is what a shell costs', () => {
    /*
     * Unquoted, `pnpm deploy` receives two arguments and writes the bundle
     * somewhere nobody asked for — a silently wrong output, which is worse
     * than the ENOENT this replaced.
     *
     * BUILT WITH `path.win32.join` RATHER THAN TYPED. A Windows path written
     * as a literal needs doubled escapes, and the first cut of this test lost
     * its backslashes in transit and asserted on "C:UsersFirst Lastout" —
     * which is not a path, and proves nothing about one.
     */
    const target = path.win32.join('C:', 'Users', 'First Last', 'out');
    assert.match(pnpmInvocation('win32', ['deploy', target]).command, /"C:.*First Last.*out"$/);
  });

  it('leaves a path with no spaces alone, so ordinary output stays readable', () => {
    const target = path.win32.join('C:', 'out');
    assert.equal(pnpmInvocation('win32', ['deploy', target]).command, 'pnpm deploy ' + target);
  });

  it('escapes an embedded quote rather than ending the argument early', () => {
    /* Asserted as PROPERTIES, not against a second copy of the quoting rule —
       an expected literal computed the same way the function computes it would
       agree with any bug the two of them shared. */
    const got = pnpmInvocation('win32', ['deploy', path.win32.join('C:', 'a "b" c')]).command;
    assert.ok(got.endsWith('"'), 'the argument is wrapped');
    assert.ok(got.includes('""b""'), 'each inner quote is doubled rather than left to close it');
  });
});

describe('prepare-server uses it', () => {
  /*
   * THE SEAM, NOT THE PIECES EITHER SIDE OF IT. A correct helper that the
   * script never calls is this repository's documented failure mode, and the
   * previous three assertions would all pass in that state.
   */
  const src = fs.readFileSync(SCRIPT, 'utf8');

  it('imports the helper', () => {
    assert.match(src, /import \{ pnpmInvocation \} from '\.\/pnpm-invocation\.mjs'/);
  });

  it('spawns through it, and passes the shell flag it returned', () => {
    assert.match(src, /pnpmInvocation\(process\.platform,/);
    assert.match(src, /execFileSync\(run\.command, run\.args, \{[^}]*shell: run\.shell/);
  });

  it("never spawns a bare 'pnpm' again", () => {
    assert.doesNotMatch(
      src,
      /execFileSync\(\s*'pnpm'/,
      'a bare name is the ENOENT this file exists to prevent',
    );
  });
});

/**
 * THE APP ICON — the one asset whose absence is silent.
 *
 * `directories.buildResources` is `build`, so electron-builder picks up
 * `build/icon.png` BY NAME and derives the `.ico` and `.icns` each target
 * needs. Nothing imports that file, nothing references it by path, and no
 * build step fails without it: the packer simply prints
 *
 *     default Electron icon is used
 *
 * mid-log and ships an installer wearing Electron's own logo. That is the
 * "absence of a signal is not evidence of absence" shape — the build is green
 * and the product looks like somebody else's on the taskbar.
 *
 * So the file is asserted here, by the name and the floor electron-builder
 * actually applies. A PNG under 256x256 is rejected by the packer, which is a
 * loud failure; the quiet one is the file not being there at all.
 */
describe('the app icon', () => {
  const ICON = path.join(ROOT, 'packages', 'desktop', 'build', 'icon.png');

  it('exists where electron-builder looks for it, by name', () => {
    assert.ok(
      fs.existsSync(ICON),
      'packages/desktop/build/icon.png is missing — the packer will fall back to the ' +
        'default Electron icon and say so only in its own log',
    );
  });

  it('is a real PNG at or above the 256px floor the packer requires', () => {
    const buf = fs.readFileSync(ICON);
    assert.equal(
      buf.subarray(0, 8).toString('hex'),
      '89504e470d0a1a0a',
      'not a PNG — electron-builder reads this by content, not by extension',
    );
    /* IHDR is the first chunk: width and height are at byte 16 and 20. */
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    assert.ok(width >= 256 && height >= 256, `icon is ${width}x${height}, below the 256px floor`);
    assert.equal(width, height, `icon is ${width}x${height} — an app icon must be square`);
  });

  it('the generator that produced it is checked in beside it', () => {
    /* Otherwise the icon is a binary nobody can regenerate or correct, and the
       next change to the mark has to be done by hand in an image editor. */
    const gen = path.join(ROOT, 'packages', 'desktop', 'scripts', 'make-icon.mjs');
    assert.ok(fs.existsSync(gen), 'make-icon.mjs is missing');
    assert.match(
      fs.readFileSync(gen, 'utf8'),
      /site\/favicon\.svg/,
      'the generator must name the mark it is rasterising, so the two can be diffed',
    );
  });
});
