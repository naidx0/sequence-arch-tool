#!/usr/bin/env node
// checksums — write release/SHASUMS256.txt for every artifact electron-builder
// produced, so "the download is corrupted" becomes a claim somebody can check.
//
// ── WHY ───────────────────────────────────────────────────────────────────
//
// A report came back on 2026-09-19 that the published 0.1.0 installer was
// corrupt. The hosted asset was then fetched and tested here:
//
//     GET .../v0.1.0/Sequence.Setup.0.1.0.exe   →  200, 187,852,868 bytes
//     first two bytes                           →  MZ
//     7za t                                     →  "Everything is Ok"
//                                                  17,001 files, 962 MB packed
//     Get-AuthenticodeSignature                 →  NotSigned
//
// The archive is intact. So the failure was downstream of the file — a
// truncated or antivirus-quarantined copy, or a SmartScreen block read as
// corruption — and NONE of that was distinguishable from the other, because
// there was nothing published to compare a local copy against.
//
// That is the actual defect this fixes. A checksum does not stop a bad
// download; it turns an unanswerable report into a one-line answer, which is
// the difference between "it's broken" and "your copy is 4 MB short".
//
// ── WHAT COUNTS AS AN ARTIFACT ────────────────────────────────────────────
//
// Installers and archives only. `.blockmap` is derived from the artifact it
// sits beside, `builder-debug.yml` is a log, and `win-unpacked/` is an
// intermediate — hashing those would put rows in the file that nobody
// downloads, and a manifest with unreachable rows is one people stop reading.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const RELEASE_DIR = path.resolve(here, '..', 'release');

/** Extensions a person can actually download and run. */
export const ARTIFACT_EXTENSIONS = ['.exe', '.dmg', '.zip', '.AppImage', '.deb'];

export function isArtifact(name) {
  if (name.endsWith('.blockmap')) return false;
  return ARTIFACT_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export function sha256(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

/**
 * The manifest text, in the format `sha256sum -c` and `shasum -a 256 -c` both
 * read — two spaces, then the bare filename.
 *
 * SORTED BY NAME so two builds of the same artifacts produce the same file and
 * a diff between them is a real change rather than a directory-order shuffle.
 */
export function manifest(rows) {
  return (
    [...rows]
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
      .map((r) => `${r.sha256}  ${r.name}`)
      .join('\n') + '\n'
  );
}

function main() {
  if (!fs.existsSync(RELEASE_DIR)) {
    console.error(`checksums: no ${RELEASE_DIR} — run electron-builder first`);
    process.exit(1);
  }
  const rows = fs
    .readdirSync(RELEASE_DIR)
    .filter((name) => isArtifact(name))
    .filter((name) => fs.statSync(path.join(RELEASE_DIR, name)).isFile())
    .map((name) => ({
      name,
      bytes: fs.statSync(path.join(RELEASE_DIR, name)).size,
      sha256: sha256(path.join(RELEASE_DIR, name)),
    }));

  if (rows.length === 0) {
    console.error('checksums: release/ holds no installers or archives');
    process.exit(1);
  }

  const out = path.join(RELEASE_DIR, 'SHASUMS256.txt');
  fs.writeFileSync(out, manifest(rows), 'utf8');
  for (const r of rows) {
    console.log(`${r.sha256}  ${r.name}  (${(r.bytes / 1e6).toFixed(1)} MB)`);
  }
  console.log(`\nchecksums: wrote ${path.relative(process.cwd(), out)}`);
  console.log('Upload it beside the artifacts. A reader checks their copy with:');
  console.log('  Windows   certutil -hashfile "Sequence Setup 0.1.0.exe" SHA256');
  console.log('  macOS     shasum -a 256 -c SHASUMS256.txt');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
