import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  INSTRUCTIONS_CAP_BYTES,
  INSTRUCTION_FILES,
  readRepoInstructions,
  renderInstructionsSection,
} from '../explain/instructions.js';

/**
 * THE REPOSITORY'S OWN INSTRUCTIONS.
 *
 * Every competitor reads a project instruction file. Sequence read none — a
 * team could write down "never touch generated/" and the assistant would answer
 * the next question having seen none of it.
 *
 * This repository is its own best example: it carries AGENTS.md and CLAUDE.md
 * at the root, both written to be read by an assistant, and nothing in the
 * product ever opened either one.
 */

/** A fake filesystem: only the named paths exist. */
function only(files: Record<string, string>) {
  return (p: string): string => {
    /* split/join rather than a regex: a backslash in a regex literal is
       exactly the escape that keeps getting eaten in transit here. */
    const norm = p.split(String.fromCharCode(92)).join('/');
    for (const [rel, text] of Object.entries(files)) {
      if (norm.endsWith(rel)) return text;
    }
    throw new Error('ENOENT');
  };
}

/**
 * Lexical resolver — `path.join` with NO containment check.
 *
 * The selection tests below (precedence, one-file-only, cap, blank-skip) run
 * against the fake filesystem above, whose `/r` root does not exist on disk, so
 * the real jail would correctly refuse every path and they would all assert on
 * null. They are testing WHICH file is chosen, not whether it escaped.
 *
 * Containment itself is exercised against a REAL temp directory with a REAL
 * symlink at the bottom of this file — the only thing that can prove it.
 */
const lexical = (root: string, rel: string): string | null => path.join(root, rel);

/** Selection test helper: fake filesystem, jail deliberately bypassed. */
function readFake(read: (p: string) => string) {
  return readRepoInstructions('/r', read, lexical);
}

test('reads the repository instruction file', () => {
  const found = readFake(only({ 'AGENTS.md': 'we use tabs' }));
  assert.strictEqual(found?.text, 'we use tabs');
  assert.strictEqual(found?.file, 'AGENTS.md');
});

test('OUR OWN FILE WINS, because it was written for this product', () => {
  /*
   * The others are shared with other tools and may say things aimed at them.
   * A file inside `.sequence/` was written for us.
   */
  const found = readFake(
    only({ '.sequence/instructions.md': 'ours', 'AGENTS.md': 'theirs', 'CLAUDE.md': 'theirs too' }),
  );
  assert.strictEqual(found?.text, 'ours');
});

test('ONLY ONE FILE IS USED — they are not concatenated', () => {
  /*
   * Four instruction files merged produce a prompt where two contradict each
   * other and nothing says which wins, and the reader cannot see the merge to
   * debug it.
   */
  const found = readFake(only({ 'AGENTS.md': 'first', 'CLAUDE.md': 'second' }));
  assert.strictEqual(found?.text, 'first');
  assert.ok(!found?.text.includes('second'));
});

test('an unreadable file does not stop the next one being found', () => {
  const read = (p: string): string => {
    const norm = p.split(String.fromCharCode(92)).join('/');
    if (norm.endsWith('AGENTS.md')) throw new Error('EACCES');
    if (norm.endsWith('CLAUDE.md')) return 'reachable';
    throw new Error('ENOENT');
  };
  assert.strictEqual(readFake(read)?.text, 'reachable');
});

test('an empty or whitespace file is skipped, not used', () => {
  /* An empty instruction file is a file somebody created and never wrote; it
     is not an instruction to do nothing. */
  const found = readFake(only({ 'AGENTS.md': '   \n\n', 'CLAUDE.md': 'real' }));
  assert.strictEqual(found?.text, 'real');
});

test('NO FILE IS AN ORDINARY ANSWER, not a warning', () => {
  /* Most repositories have none. A product that complained about a missing
     optional file would train its users to ignore its warnings. */
  assert.strictEqual(readFake(only({})), null);
});

test('a runaway file is capped', () => {
  const huge = 'x'.repeat(INSTRUCTIONS_CAP_BYTES * 2);
  const found = readFake(only({ 'AGENTS.md': huge }))!;
  assert.strictEqual(found.text.length, INSTRUCTIONS_CAP_BYTES);
  assert.strictEqual(found.truncated, true);
});

test('a normal file is not marked truncated', () => {
  const found = readFake(only({ 'AGENTS.md': 'short' }))!;
  assert.strictEqual(found.truncated, false);
});

test('THE PROMPT NAMES THE FILE', () => {
  /*
   * A model that can say "your AGENTS.md says X" gives the user somewhere to
   * go and edit. One that just asserts X leaves them guessing which file it
   * came from, or whether it was invented.
   */
  const lines = renderInstructionsSection({ file: 'AGENTS.md', text: 'we use tabs', truncated: false });
  assert.ok(lines.join('\n').includes('AGENTS.md'));
  assert.ok(lines.join('\n').includes('we use tabs'));
});

test('THE PROMPT DECLARES A TRUNCATION', () => {
  /* Silently cutting a user's rules in half is how an assistant appears to
     ignore the second half of them, invisibly. */
  const lines = renderInstructionsSection({ file: 'AGENTS.md', text: 'x', truncated: true });
  assert.match(lines.join('\n'), /cut here/i);
});

test('the instructions rank BELOW the code, and say so', () => {
  /*
   * An instruction file is a statement of intent; the graph is a measurement
   * of fact. Where they disagree the code is what is true, and the model is
   * told to say when that happens rather than quietly picking one.
   */
  const lines = renderInstructionsSection({ file: 'AGENTS.md', text: 'x', truncated: false });
  assert.match(lines.join('\n'), /unless the code contradicts/i);
});

test('no instructions render no lines at all', () => {
  /* Not an empty heading — a section header with nothing under it reads to the
     model as instructions it failed to receive. */
  assert.deepStrictEqual(renderInstructionsSection(null), []);
});

test('the search order is most-specific first', () => {
  assert.strictEqual(INSTRUCTION_FILES[0], '.sequence/instructions.md');
});

/* ==================================================================== jail ===
 * THE SYMLINK ESCAPE. These use a REAL temp directory and REAL symlinks, and
 * they are the only tests here that can prove containment — the fake filesystem
 * above has no notion of a link, so it would pass either way.
 *
 * The hole: `readRepoInstructions` used `path.join` + `readFileSync`, both of
 * which FOLLOW a symlink, and `renderInstructionsSection` then presents whatever
 * came back as BINDING standing instructions for the model. So a repository
 * committing `AGENTS.md -> <anything>` had up to INSTRUCTIONS_CAP_BYTES of that
 * file injected into the prompt as its own rules, and shipped to the provider.
 * Git stores symlinks, so a clone carries the payload.
 *
 * On Linux the headline target is `/proc/self/environ`. On Windows — the
 * owner's platform — the sharper one is `~/.sequence/openrouter-key`, which
 * makes this a key exfiltration, against a repo law that says never leak a user
 * key. Same one-line fix for both.
 */

/** Make a real temp repo; returns its path. Skips symlink tests when denied. */
function tempRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'seq-instr-'));
}

/** Windows needs elevation or Developer Mode for symlinks; skip if unavailable. */
function trySymlink(target: string, link: string): boolean {
  try {
    fs.symlinkSync(target, link);
    return true;
  } catch {
    return false;
  }
}

test('JAIL — an AGENTS.md symlinked OUTSIDE the repo is not read', (t) => {
  const repo = tempRepo();
  const outsideDir = tempRepo();
  const secret = path.join(outsideDir, 'stolen.txt');
  fs.writeFileSync(secret, 'SUPER_SECRET_KEY=sk-or-v1-do-not-leak', 'utf8');

  if (!trySymlink(secret, path.join(repo, 'AGENTS.md'))) {
    t.skip('symlink creation not permitted on this host');
    return;
  }
  // A real, legitimate file the walker should fall through to instead.
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), 'the real rules', 'utf8');

  const found = readRepoInstructions(repo);
  assert.strictEqual(
    found?.file,
    'CLAUDE.md',
    'the escaping AGENTS.md must be skipped like an absent file, and the next name still found',
  );
  assert.ok(
    !JSON.stringify(found).includes('SUPER_SECRET'),
    'contents of a file outside the repo reached the prompt — this is the exfiltration hole',
  );
});

test('JAIL — a DANGLING symlink out of the repo is not read either', (t) => {
  /*
   * HONESTY NOTE: unlike the test above, this one PASSES WITHOUT THE FIX. A
   * dangling link makes `readFileSync` throw ENOENT, which the loop already
   * caught and treated as absent, so the old code was accidentally right here.
   * It is kept as a regression pin, not claimed as a lock — the escape test
   * above is the one that goes red when containment is removed.
   *
   * It still earns its place: `resolveInRepo` has a dedicated dangling-symlink
   * branch (its comment records a jail escape where falling back to the lexical
   * path allowed an arbitrary WRITE), and this pins that reads stay closed if
   * that branch is ever loosened.
   */
  const repo = tempRepo();
  if (!trySymlink(path.join(tempRepo(), 'does-not-exist.txt'), path.join(repo, 'AGENTS.md'))) {
    t.skip('symlink creation not permitted on this host');
    return;
  }
  assert.strictEqual(readRepoInstructions(repo), null);
});

test('JAIL — an ordinary in-repo AGENTS.md still reads normally', () => {
  /* The fix must not cost the feature: containment rejects escapes, not files.
     Without this, "read nothing, ever" would pass the two tests above. */
  const repo = tempRepo();
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), 'we use tabs', 'utf8');
  const found = readRepoInstructions(repo);
  assert.strictEqual(found?.text, 'we use tabs');
  assert.strictEqual(found?.file, 'AGENTS.md');
});

test('JAIL — a symlink pointing INSIDE the repo is still followed', (t) => {
  /* Containment is about escaping, not about links. A repo that keeps its rules
     in `docs/rules.md` and links `AGENTS.md` at it is doing something ordinary
     and must keep working. */
  const repo = tempRepo();
  fs.mkdirSync(path.join(repo, 'docs'));
  fs.writeFileSync(path.join(repo, 'docs', 'rules.md'), 'inside is fine', 'utf8');
  if (!trySymlink(path.join(repo, 'docs', 'rules.md'), path.join(repo, 'AGENTS.md'))) {
    t.skip('symlink creation not permitted on this host');
    return;
  }
  assert.strictEqual(readRepoInstructions(repo)?.text, 'inside is fine');
});

test('JAIL — a repo root that does not exist yields null, not a throw', () => {
  /* Callers ask "does this repo have instructions?"; the honest answer for a
     missing root is "no". Throwing would take down the whole ask turn. */
  assert.strictEqual(readRepoInstructions(path.join(os.tmpdir(), 'seq-no-such-root-xyz')), null);
});
