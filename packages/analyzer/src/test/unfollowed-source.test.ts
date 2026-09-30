import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { scanRepo } from '../scan.js';
import {
  UnfollowedTally,
  unfollowedLanguageOf,
  unfollowedSentence,
} from '../lang/unfollowed.js';

/**
 * THE HALF OF THE SYSTEM THIS SCANNER CANNOT SEE.
 *
 * `LANG_BY_EXT` covers TypeScript, JavaScript, Python, Go and Java. Every other
 * source file was `continue`d during the walk, silently — so a repository whose
 * payment service is C# produced a graph with no payment service in it and
 * nothing anywhere saying why. The graph did not look wrong. It looked like a
 * system that has no payment service.
 *
 * That is the failure one level up from a false edge: not a wrong claim, a
 * confident silence. "Grounded, not guessed" governs the edges we draw; this
 * governs the ones we cannot see.
 */

/** A repo with a readable service and an unreadable one. */
function mixedRepo(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-unfollowed-'));
  const repo = path.join(root, 'repo');

  fs.mkdirSync(path.join(repo, 'gateway', 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'gateway', 'package.json'),
    JSON.stringify({ name: 'gateway', version: '1.0.0' }),
  );
  fs.writeFileSync(path.join(repo, 'gateway', 'src', 'index.ts'), 'export const x = 1;\n');

  /* The C# service. Nothing here can be parsed, and before this change nothing
     said so. */
  fs.mkdirSync(path.join(repo, 'payment', 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, 'payment', 'package.json'),
    JSON.stringify({ name: 'payment', version: '1.0.0' }),
  );
  for (const name of ['Program.cs', 'Charge.cs', 'Refund.cs']) {
    fs.writeFileSync(path.join(repo, 'payment', 'src', name), 'namespace Payment { }\n');
  }
  /* Documentation and config, which must NOT be reported: a scanner is not
     missing a README. */
  fs.writeFileSync(path.join(repo, 'payment', 'README.md'), '# payment\n');
  fs.writeFileSync(path.join(repo, 'payment', 'settings.json'), '{}\n');

  fs.writeFileSync(
    path.join(repo, 'package.json'),
    JSON.stringify({ name: 'mono', workspaces: ['gateway', 'payment'] }),
  );
  return repo;
}

/* ═══ the classifier ══════════════════════════════════════════════════════ */

test('source languages are named; documents and data are not', () => {
  assert.strictEqual(unfollowedLanguageOf('.cs'), 'C#');
  assert.strictEqual(unfollowedLanguageOf('.rb'), 'Ruby');
  assert.strictEqual(unfollowedLanguageOf('.rs'), 'Rust');
  /*
   * A repo is full of markdown, JSON, lockfiles and images that no scanner
   * should claim to be missing. Reporting them would bury the one line that
   * matters under a hundred that do not — which is how a warning stops being
   * read.
   */
  for (const ext of ['.md', '.json', '.yml', '.svg', '.lock', '.txt', '.png']) {
    assert.strictEqual(unfollowedLanguageOf(ext), null, `${ext} must not be reported`);
  }
});

test('extensions that share a language are counted under it once', () => {
  const t = new UnfollowedTally();
  t.add('.cc', 'engine');
  t.add('.cpp', 'engine');
  t.add('.hpp', 'engine');
  const report = t.report();
  assert.strictEqual(report.length, 1);
  assert.strictEqual(report[0]!.language, 'C++');
  assert.deepStrictEqual(report[0]!.extensions, ['.cc', '.cpp', '.hpp']);
  assert.strictEqual(report[0]!.files, 3);
});

test('the biggest hole is first, and ties do not swap between scans', () => {
  const t = new UnfollowedTally();
  t.add('.rb');
  t.add('.cs');
  t.add('.cs');
  t.add('.rs');
  const langs = t.report().map((u) => u.language);
  /* Biggest first, because that is the one that decides whether the picture on
     screen can be trusted; then alphabetical, so a tie is stable. */
  assert.deepStrictEqual(langs, ['C#', 'Ruby', 'Rust']);
});

test('nothing skipped is an empty report, and NO sentence', () => {
  assert.deepStrictEqual(new UnfollowedTally().report(), []);
  /* A reassurance printed on every scan of every pure-TypeScript repo is noise,
     and noise is what makes the one time it matters easy to miss. */
  assert.strictEqual(unfollowedSentence([]), null);
});

test('the sentence names the language, the count and where it lives', () => {
  const t = new UnfollowedTally();
  t.add('.cs', 'payment');
  t.add('.cs', 'payment');
  const line = unfollowedSentence(t.report())!;
  assert.match(line, /2 C# files in payment/);
  /* And it says what the consequence is, because "could not read 2 files" does
     not tell a reader that their architecture picture has a hole in it. */
  assert.match(line, /missing from this graph — not absent from the system/);
});

/* ═══ on a real scan ══════════════════════════════════════════════════════ */

test('a C# service is REPORTED rather than silently absent', async () => {
  const repo = mixedRepo();
  try {
    const g = await scanRepo(repo, {});
    const report = g.unfollowed ?? [];
    const cs = report.find((u) => u.language === 'C#');
    assert.ok(cs, `expected C# in the report; got ${JSON.stringify(report)}`);
    assert.strictEqual(cs.files, 3);
    /*
     * The graph itself still has no payment service — the scanner genuinely
     * cannot read those files. What changed is that it says so, which is the
     * difference between a partial picture and a wrong one.
     */
    assert.ok(cs.services.length > 0, 'the report says WHERE the unreadable files are');
  } finally {
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('markdown and json in that same repo are NOT reported', async () => {
  const repo = mixedRepo();
  try {
    const g = await scanRepo(repo, {});
    const langs = (g.unfollowed ?? []).map((u) => u.language);
    assert.deepStrictEqual(langs, ['C#'], `only real source should be reported; got ${langs}`);
  } finally {
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  }
});

test('a fully readable repo reports an EMPTY list, not an absent one', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-allreadable-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'clean', version: '1.0.0' }));
  fs.writeFileSync(path.join(repo, 'src', 'index.ts'), 'export const a = 1;\n');
  try {
    const g = await scanRepo(repo, {});
    /*
     * Empty and absent are different answers. Absent means "not recorded" — an
     * older graph, or a design spec — and a reader must be able to tell that
     * from "the scan looked and everything was readable".
     */
    assert.deepStrictEqual(g.unfollowed, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
