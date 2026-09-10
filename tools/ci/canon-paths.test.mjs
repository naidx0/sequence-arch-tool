import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import url from 'node:url';

/**
 * EVERY PATH THE AUTHORITY DOCS SEND YOU TO MUST EXIST.
 *
 * WHY THIS EXISTS
 * ---------------
 * `docs/CANON.md` is reading item 0 — the one page a fresh agent is told to read
 * before anything else. It states what Sequence is, who we are against, what our
 * advantage actually is, and where the design lives. An agent follows its
 * pointers before it has any independent picture of the repo, so a dead pointer
 * there is worse than a dead pointer anywhere else in the tree: it is the first
 * thing read and there is nothing yet to contradict it.
 *
 * On 2026-08-21 five claims in these files had rotted, all from the v1 deletion:
 *
 *   - CANON's single strongest advantage claim measured the import closure of
 *     `web/src/state/store.ts`, a file deleted with `packages/web` the day before.
 *   - It cited "7 files called App.tsx"; six of them were in `packages/web`, so
 *     the real count is one.
 *   - It listed an activity view, checkpoint-and-rewind, worktree handoff and a
 *     headless entry point as "still absent" after all four had shipped.
 *   - It described `packages/web` as "dead code awaiting deletion" when it was
 *     already gone.
 *   - PIVOT-V2's bar table still called the token claim "being measured" after
 *     CANON had measured it and marked it ✗ NOT TRUE.
 *
 * None of that was catchable by any existing gate: the brand gates check the
 * BOOK, the citation gate checks `repoServer.ts` line pins, and nothing checked
 * whether the strategy page still described the repository it sits in.
 *
 * WHAT THIS ASSERTS, AND THE ESCAPE HATCH
 * ---------------------------------------
 * Every repo-relative path these documents cite in backticks resolves on disk —
 * UNLESS the line marks it as history. A page that records its own retractions
 * is doing the right thing (`packages/web` is *named* in CANON precisely to say
 * it is gone), so a past-tense marker on the same line exempts it. That is the
 * same principle as the `packages/mcp` honesty guard's double-quote exemption:
 * deleting the history to satisfy a regex is the worse outcome.
 */

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

const DOCS = [
  'docs/CANON.md',
  'docs/PIVOT-V2.md',
  'docs/brand/GRAPHITE-DECISIONS.md',
  /* The other four an agent or a human actually opens first. Added 2026-08-21:
     the v1 deletion left dead pointers in every one of them (a brand mark, a
     lora validator, a qa-loop metric, two e2e harnesses) and nothing noticed,
     because this gate only read the three above. A line phrased as history is
     still exempt — see HISTORY. */
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'docs/HANDOFF-AGENT-RESTART.md',
];

/**
 * Gitignored build products. `packages/analyzer/dist/cli.js` and `tmp-shots/`
 * are absent on a clean checkout and present after `pnpm -r build` / a shot run,
 * so their absence says nothing about whether the citation is honest.
 */
const BUILD_OUTPUT = /(^|\/)(dist|tmp-shots|node_modules|coverage)(\/|$)/;

/** A line saying "this used to be" does not have to point at something live. */
const HISTORY =
  /\b(deleted|gone|removed|retired|archived|superseded|was|were|used to|until|no longer|do(?:es)? not exist|dead|stale|drift)\b/i;

/**
 * Every real path in the tree, so a citation can be matched as a SUFFIX.
 *
 * These documents cite by the shortest unambiguous name rather than always from
 * the repo root — `graphite/` and `v1/_core.html` both mean the frozen book,
 * and both are correct and readable in context. Requiring repo-relative spelling
 * would fail honest citations and push authors toward longer, worse prose, so
 * the check is "does the tree contain a path ending in this", not "is this
 * exactly a repo-relative path".
 */
function allPaths() {
  const out = new Set();
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = entry.name;
      if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
      const childRel = rel ? `${rel}/${name}` : name;
      out.add(childRel);
      if (entry.isDirectory()) walk(path.join(dir, name), childRel);
    }
  };
  walk(REPO, '');
  return out;
}

const REAL = allPaths();

function resolves(probe) {
  if (REAL.has(probe)) return true;
  for (const real of REAL) {
    if (real === probe || real.endsWith(`/${probe}`)) return true;
  }
  return false;
}

/** Looks like a repo-relative path we could actually check. */
function looksLikePath(token) {
  if (!/^[A-Za-z0-9_.@/-]+$/.test(token)) return false;
  if (token.startsWith('/') || token.startsWith('http')) return false;
  // A directory reference, or a file with an extension we can resolve.
  if (token.endsWith('/')) return token.includes('/');
  return /\.(ts|tsx|mjs|js|md|css|html|json|sh|yml)$/.test(token) && token.includes('/');
}

test('the authority docs exist at the paths CLAUDE.md sends agents to', () => {
  for (const d of DOCS) {
    assert.ok(fs.existsSync(path.join(REPO, d)), `${d} is missing — it is reading item 0 or cited by it`);
  }
});

test('every path CANON, PIVOT-V2 and GRAPHITE-DECISIONS cite resolves on disk', () => {
  const dead = [];

  for (const doc of DOCS) {
    const lines = fs.readFileSync(path.join(REPO, doc), 'utf8').replace(/\r\n/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      // A retraction often opens on the line above its list ("… were DELETED:"
      // then the names). Read a one-line window so the exemption matches prose
      // as it is actually written.
      if (HISTORY.test(line) || (i > 0 && HISTORY.test(lines[i - 1]))) continue;

      for (const m of line.matchAll(/`([^`\n]+)`/g)) {
        const token = m[1].trim();
        if (!looksLikePath(token)) continue;
        if (BUILD_OUTPUT.test(token)) continue; // gitignored, exists only after a build
        // Strip a trailing glob segment: `v1/pages/*.html` is a real directory.
        const probe = token
          .replace(/^\.\//, '') // `./start.sh` is how a human types it
          .replace(/\/\*+\.[A-Za-z]+$/, '')
          .replace(/\/+$/, '');
        if (!probe) continue;
        if (!resolves(probe)) {
          dead.push(`${doc}:${i + 1} cites \`${token}\``);
        }
      }
    }
  }

  assert.deepEqual(
    dead,
    [],
    'These are the FIRST paths a new agent follows, and they do not exist.\n' +
      'Repoint them at living code, or mark the line as history (see the note at\n' +
      'the top of this file for the exemption). Dead pointers:\n  ' +
      dead.join('\n  '),
  );
});

test('the Graphite book is where every one of them says it is', () => {
  // CANON §4, PIVOT-V2 and GRAPHITE-DECISIONS all name this exact path as the
  // visual source of truth. If the book ever moves, all three go stale at once.
  // One copy since Decision 3 (2026-08-21) — the v1 duplicate is gone.
  const book = path.join(REPO, 'docs/brand/graphite');
  assert.ok(fs.existsSync(path.join(book, '_core.html')), 'the substrate _core.html is missing');

  const sheets = fs.readdirSync(path.join(book, 'pages')).filter((f) => f.endsWith('.html'));
  // A FLOOR, not an equality. The book shipped with twelve and is being extended
  // (docs/brand/GRAPHITE-SHELL-SHEETS-BRIEF.md), so pinning the exact number here
  // would make adding a sheet fail a test about paths. Sheets going MISSING is the
  // failure worth catching, and graphite-freeze.test.mjs catches silent edits.
  assert.ok(
    sheets.length >= 12,
    `the book shipped with twelve sheets and they are not removed silently; found ${sheets.length}`,
  );
});
