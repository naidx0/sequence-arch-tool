/**
 * EVERY LINK ON trysequence.app GOES SOMEWHERE THAT EXISTS.
 *
 * The marketing site is Vite + React under site/. Hrefs live in site/src
 * (JSX attributes and data modules). This gate scans those sources and
 * requires a site/dist build so a rename cannot ship a 404.
 *
 * Deliberately does not fetch over the network.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';

import { decide } from '../release/policy.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SITE = path.join(ROOT, 'site');
const SRC = path.join(SITE, 'src');
const DIST = path.join(SITE, 'dist');

const PUBLIC_REPO = 'https://github.com/naidx0/sequence-arch-tool';
const RELEASE_TAG = 'v0.1.0';
const GENERATED_INTO_THE_MIRROR = new Set(['CHANGELOG.md']);

function walk(dir, pred) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'dist') continue;
      out.push(...walk(p, pred));
    } else if (pred(p)) {
      out.push(p);
    }
  }
  return out;
}

/** Hygiene CI does not build site/ by default — build here so the gate is self-contained. */
function ensureDist() {
  const index = path.join(DIST, 'index.html');
  const benches = path.join(DIST, 'benchmarks.html');
  if (fs.existsSync(index) && fs.existsSync(benches)) return;
  /* On Windows `npm` is `npm.cmd`, and Node refuses to spawn a .cmd without a
     shell (CVE-2024-27980), so the shell resolves it; a clean worktree with no
     Git Bash shim on PATH failed here with `spawnSync npm ENOENT` (2026-09-22). */
  const shell = process.platform === 'win32';
  execFileSync('npm', ['install'], { cwd: SITE, stdio: 'pipe', shell });
  execFileSync('npm', ['run', 'build'], { cwd: SITE, stdio: 'pipe', shell });
}

const sourceFiles = walk(SRC, (p) => /\.(tsx?|css)$/.test(p));
const sourceText = sourceFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const releaseText = fs.readFileSync(path.join(SRC, 'data', 'release.ts'), 'utf8');

function expand(s) {
  return s
    .replace(/\$\{PUBLIC_REPO\}/g, PUBLIC_REPO)
    .replace(/\$\{RELEASE_TAG\}/g, RELEASE_TAG)
    .replace(/\$\{RELEASE_URL\}/g, `${PUBLIC_REPO}/releases/tag/${RELEASE_TAG}`);
}

const rawHrefs = [
  ...sourceText.matchAll(/\bhref\s*[:=]\s*(?:\{\s*)?['"`]([^'"`]+)['"`]/g),
  ...sourceText.matchAll(/['"`](https:\/\/github\.com\/[^'"`]+)['"`]/g),
  ...sourceText.matchAll(/['"`]((?:\.\.?\/)?[a-z0-9._/-]*benchmarks\.html(?:#[^'"`]*)?)['"`]/gi),
  ...sourceText.matchAll(/['"`](#[a-z0-9_-]+)['"`]/gi),
].map((m) => expand(m[1]));

const hrefs = [...new Set(rawHrefs)];

test('the site sources exist and carry links — a vacuity guard', () => {
  assert.ok(sourceFiles.length >= 10, `only ${sourceFiles.length} source files under site/src`);
  assert.ok(hrefs.length >= 10, `only ${hrefs.length} hrefs found in site/src`);
});

test('the production build emits both HTML shells', () => {
  ensureDist();
  assert.ok(fs.existsSync(path.join(DIST, 'index.html')), 'site/dist/index.html missing after build');
  assert.ok(fs.existsSync(path.join(DIST, 'benchmarks.html')), 'site/dist/benchmarks.html missing after build');
});

test('every in-page anchor named in source resolves to an id= in source', () => {
  const anchors = hrefs.filter((h) => h.startsWith('#'));
  assert.ok(anchors.length > 0, 'no in-page anchors found');
  const dangling = anchors.filter((a) => {
    const id = a.slice(1);
    return !(
      sourceText.includes(`id="${id}"`) ||
      sourceText.includes(`id={'${id}'}`) ||
      sourceText.includes(`id={"${id}"}`)
    );
  });
  assert.deepEqual(dangling, [], `anchors point at no section: ${dangling.join(', ')}`);
});

test('every cross-page link names a page the build ships', () => {
  ensureDist();
  const broken = [];
  let checked = 0;
  for (const href of hrefs) {
    if (/^(https?:|mailto:|#)/.test(href)) continue;
    const [target, hash] = href.split('#');
    if (!target || target === '/' || target === './') continue;
    if (/\.[a-z0-9]+$/i.test(target) && !/\.html$/i.test(target)) continue;
    checked += 1;
    const file = target.replace(/^\.\//, '');
    const base = file.replace(/\.html$/i, '');
    const distFile = path.join(
      DIST,
      file.endsWith('.html') ? file : `${base === '' || base === 'index' ? 'index' : base}.html`,
    );
    if (!fs.existsSync(distFile)) {
      broken.push(href);
      continue;
    }
    if (hash) {
      if (
        !(
          sourceText.includes(`id="${hash}"`) ||
          sourceText.includes(`id={'${hash}'}`) ||
          sourceText.includes(`id={"${hash}"}`)
        )
      ) {
        broken.push(`${href} (no such id)`);
      }
    }
  }
  assert.ok(checked > 0, 'no cross-page links found');
  assert.deepEqual(broken, [], `links point at pages or sections that do not exist: ${broken.join(', ')}`);
});

test('no link reaches for the private working repository', () => {
  const wrong = hrefs.filter((h) => /github\.com\/[^/]+\/codeforge(\/|$)/i.test(h));
  assert.deepEqual(wrong, [], `links point at the private repo: ${wrong.join(', ')}`);
});

test('every github link is on the public mirror', () => {
  const gh = hrefs.filter((h) => h.startsWith('https://github.com/'));
  assert.ok(gh.length > 0, 'no github links found');
  const off = gh.filter((h) => !h.startsWith(PUBLIC_REPO));
  assert.deepEqual(off, [], `github links leave the mirror: ${off.join(', ')}`);
});

test('the installers named in release.ts all come from one release', () => {
  /*
   * ── READ THE VERSION, DO NOT SPELL IT ────────────────────────────────────
   *
   * This test used to match `Sequence\.Setup\.0\.1\.0\.exe` as a literal, which
   * made it the SEVENTH place the version number was written by hand — and the
   * one that would go red on the day somebody remembered the other six. A gate
   * that has to be edited for every release is a gate that teaches people to
   * edit gates.
   *
   * It reads `VERSION` out of the file now and builds the names the same way
   * the site does, so a release where one filename was missed still fails and
   * a release where all of them moved together passes.
   */
  const version = /export const VERSION = '([^']+)'/.exec(releaseText)?.[1];
  assert.ok(version, 'release.ts must export a VERSION');
  assert.match(releaseText, new RegExp(`RELEASE_TAG = \`v\\$\\{VERSION\\}\``));

  /* THE NAMES ARE BUILT, SO THE CHECK BUILDS THEM TOO. Searching the source
     for "Sequence Setup 0.1.1.exe" would never match a file that writes
     `Sequence Setup ${VERSION}.exe`; substituting the version first is what
     makes this a check on what the reader receives rather than on how it
     happens to be spelled. */
  const resolved = releaseText.split('${VERSION}').join(version);

  /* Every artefact the release page offers, by the name the build writes. */
  for (const name of [
    `Sequence Setup ${version}.exe`,
    `Sequence-${version}-arm64.dmg`,
    `Sequence-${version}.dmg`,
    `Sequence-${version}-win.zip`,
  ]) {
    assert.ok(
      resolved.includes(name),
      `release.ts does not name ${name} — the download button would 404`,
    );
  }

  /* ONE ASSET BUILDER, so a href cannot be assembled a second way with a
     different rule about the spaces GitHub rewrites. */
  assert.match(releaseText, /releases\/download\/\$\{RELEASE_TAG\}\//);
  assert.equal(
    [...releaseText.matchAll(/releases\/download\/\$\{RELEASE_TAG\}\//g)].length,
    1,
    'every asset href must come from the one `asset()` helper',
  );
});

test('the checksum manifest the release workflow attaches is offered to readers', () => {
  /*
   * A checksum nobody is pointed at is a checksum nobody uses. The workflow
   * generates SHASUMS256.txt over the artefacts that actually arrived; this is
   * the check that the page knows about it.
   */
  assert.match(releaseText, /SHASUMS256\.txt/);
  const workflow = fs.readFileSync(
    path.join(ROOT, '.github', 'workflows', 'release.yml'),
    'utf8',
  );
  assert.match(workflow, /sha256sum \* > SHASUMS256\.txt/);
});

test('the release workflow ships the portable build, not only the installer', () => {
  /*
   * 0.1.0 shipped one Windows artefact and a person reported it as corrupted.
   * The hosted file was intact — MZ header, the exact published byte count,
   * `7za t` clean over 17,001 files — so the fault was around the file, and an
   * unsigned NSIS installer is the shape SmartScreen blocks and antivirus
   * bites. The zip has none of that surface, so it goes out too.
   */
  const workflow = fs.readFileSync(
    path.join(ROOT, '.github', 'workflows', 'release.yml'),
    'utf8',
  );
  assert.match(workflow, /\*-win\.zip/, 'the Windows job must collect the portable zip');
  assert.match(workflow, /\*-mac\.zip/, 'the macOS job must collect the app zip');
  assert.match(workflow, /runs-on: \$\{\{ matrix\.os \}\}/);
  assert.match(workflow, /macos-latest/, 'mac cannot be cross-compiled from Windows');
});

test('the help links point at documents the public mirror actually ships', () => {
  const help = hrefs.filter((h) => h.includes('/blob/main/'));
  assert.ok(help.length >= 4, `only ${help.length} help documents linked`);
  for (const h of help) {
    const rel = h.split('/blob/main/')[1];
    if (GENERATED_INTO_THE_MIRROR.has(rel)) continue;
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `${rel} does not exist in this repository`);
    assert.equal(
      decide(rel).keep,
      true,
      `${rel} exists here but the release policy does not ship it — the link would 404 for readers`,
    );
  }
});

test('the generated-file allowlist names only files the mirror really writes', () => {
  const mirror = fs.readFileSync(path.join(ROOT, 'tools', 'release', 'mirror.mjs'), 'utf8');
  for (const rel of GENERATED_INTO_THE_MIRROR) {
    assert.ok(
      mirror.includes(`writeFileSync(path.join(STAGE, '${rel}')`),
      `${rel} is exempted as generated, but the mirror does not write it`,
    );
  }
});

test('fonts are self-hosted through @fontsource (no CDN)', () => {
  const css = fs.readFileSync(path.join(SRC, 'styles', 'globals.css'), 'utf8');
  assert.ok(!/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(css), 'Google Fonts CDN referenced');
  assert.ok(/@fontsource\//.test(css), 'expected @fontsource imports in globals.css');
});
