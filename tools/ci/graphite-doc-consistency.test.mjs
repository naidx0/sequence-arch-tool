/**
 * The docs must hand a fresh agent the Graphite book — never the retired ones.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-08-20 the owner ordered the whole v1 UI deleted and rebuilt against
 * the frozen Graphite book. On that morning 28 files still named
 * `docs/brand/console/sequence-brand-console.html` as the brand source of
 * truth. An agent that reads its entry point, follows that pointer, and builds
 * to Console has burned a wave and produced a surface the owner will reject.
 * The owner's words: *"there should be 0 confusion."*
 *
 * The brand source of truth is `docs/brand/graphite/` — the FROZEN book
 * (substrate `_core.html` plus the sheets under `pages/`). Owner rulings live in
 * `docs/brand/GRAPHITE-DECISIONS.md` as numbered decisions. The decision of
 * record is `docs/PIVOT-V2.md`.
 *
 * WHAT THIS FILE DOES **NOT** ASSERT, AND WHY — READ BEFORE TRUSTING IT
 * --------------------------------------------------------------------
 * The rule we would like is "no living doc mentions `brand/console` at all".
 * That rule is not shippable and would be a lie if it were:
 *
 *   1. RESOLVED 2026-08-20 — kept here as the record of why the carve-out existed.
 *      `docs/brand/console/**` and `docs/brand/ledger/**` WERE the retired books
 *      sitting beside the live one, held open because `packages/web/src/product/
 *      docsCanonV31.test.ts` required `docs/README.md` to carry an index row for
 *      every living file in both folders — which is why the living index held ~20
 *      lines naming retired canon. The owner ruled on 2026-08-20 that they go. Both
 *      folders were moved to `docs/archive/brand-books/{console,ledger}/`, the three
 *      assertions that existed only to police their index rows were retired with
 *      them, the two HELD_OPEN entries were deleted, and CITATION_CENSUS below went
 *      to zero rows. The A2 ratchet reached its own floor for this class.
 *   2. RESOLVED 2026-08-20, later the same day. `docs/archive/` and
 *      `docs/brand/refs/owner-walk-console-v31/` were the last two carve-outs — the
 *      archive by design, the owner-walk register because `tools/ci/owner-walk-
 *      register.test.mjs` parsed its REGISTER.md rows. The owner then overruled
 *      archiving in favour of deleting: *"an archive is still a path an agent can
 *      route into."* Both folders were DELETED from the working tree, the register's
 *      jailer test was deleted with the register, and HELD_OPEN went empty. Nothing
 *      is carved out of this lock any more — see HELD_OPEN below.
 *   3. Correct, *useful* sentences name the retired book in order to retire it
 *      ("Any doc below that names `docs/brand/console/` is describing the retired
 *      book"). A string ban would delete the signposts. As of 2026-08-20 every such
 *      signpost was rewritten to name the BOOK ("Console v3.1") rather than its old
 *      path, so none survives — but the reason stands, and the ratchet, not a string
 *      ban, is still the right instrument.
 *
 * A previous doc lock in this repo asserted only that a citation STRING appeared
 * and never resolved it — it silently pinned three wrong citations in place for a
 * whole wave. So this file deliberately avoids proximity/vocabulary heuristics
 * ("is there a nearby word like 'retired'?"), which are trivially satisfied by
 * accident: when this was written `.claude/skills/sequence-design/SKILL.md` named
 * Console as the source of truth two lines under a heading containing the word
 * "supersedes", and any proximity heuristic would have passed it.
 *
 * Instead it asserts two things that cannot misfire:
 *
 *   A1  POSITIVE. In every ENTRY-POINT document, the FIRST paragraph that makes a
 *       brand-authority claim must resolve to `graphite/`. Whatever a document
 *       says later, the first thing it tells you is your brand is the one you act on.
 *   A2  RATCHET. A frozen census of how many lines in each living file cite a
 *       retired book. A new file citing one fails. A count going UP fails. A count
 *       going DOWN also fails, telling you to ratchet the census down — so the
 *       census can never quietly bless a citation that was already removed.
 *
 * A1 + A2 together mean: no entry point can name a retired book as authority, and
 * no new retired-book citation can appear anywhere living. They do NOT mean the
 * string is gone. Do not read a green run here as "the retired books are unmentioned".
 *
 * RED WHEN WRITTEN (2026-08-20) — FIXED THE SAME DAY, KEPT AS THE RECORD
 * ---------------------------------------------------------------------
 * Tests `a` and `b` failed on `.claude/skills/sequence-design/SKILL.md`, which said
 * *"The brand source of truth is now `docs/brand/console/…`"* and shipped six
 * `@sequence/web` gate commands. That skill AUTO-LOADS on any restyle request in
 * this repo, so it handed the retired book to an agent before a single doc was read —
 * the highest-value wrong pointer in the tree. The doc sweep that produced this lock
 * was scoped to `docs/` and could not edit that file.
 *
 * It was deliberately NOT allow-listed. Carving out the worst violation to buy a green
 * run is exactly how the previous doc lock pinned three wrong citations in place for a
 * whole wave. The file was fixed, not exempted; its census row went to 0 and was
 * deleted with the rest when the retired books were archived (see CITATION_CENSUS).
 * The reason this paragraph survives its own fix: the next agent tempted to add an
 * allow-list entry should see what the alternative cost, which was one edit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
const lines = (rel) => read(rel).split('\n');

const FIX_A =
  'Cite the book `docs/brand/graphite/` (substrate `_core.html` + the sheets in `pages/`).\n' +
  '    Never cite the live `docs/brand/graphite/` path, and never edit a sheet to encode a ruling —\n' +
  '    owner rulings are numbered decisions in `docs/brand/GRAPHITE-DECISIONS.md`.\n' +
  '    Decision of record: `docs/PIVOT-V2.md`. The Console and Ledger books are RETIRED.';

/* ------------------------------------------------------------------ *
 * Shared scanning
 * ------------------------------------------------------------------ */

/**
 * Folders that legitimately still contain retired-book text, each with its jailer.
 *
 * EMPTY 2026-08-20, AND THAT IS THE STRONG STATE. Four entries have stood here and all
 * four are gone, in two steps:
 *
 *   · `docs/brand/console/` and `docs/brand/ledger/`, blocked by
 *     `packages/web/src/product/docsCanonV31.test.ts` — removed when the owner ruled the
 *     retired books out of `docs/brand/`.
 *   · `docs/archive/` ("the archive — retired docs live here by design") and
 *     `docs/brand/refs/owner-walk-console-v31/` (blocked by
 *     `tools/ci/owner-walk-register.test.mjs`) — removed when the owner overruled ARCHIVE
 *     in favour of DELETE: *"i think i would rather delete the old stuff, it can be too
 *     confusing… we want a lean program with current and real information without extra
 *     nonsense and possible mistakes and extra routing especially when working with AI
 *     agents."* Both folders were deleted from the working tree; git history still holds
 *     every byte. The register's jailer test was deleted with the register it parsed.
 *
 * An empty list means `livingDocs()` now walks every markdown file under `docs/`,
 * `.claude/` and `.cursor/` with NOTHING carved out — the widest scope this lock has ever
 * had, and the reason the census below can be trusted at zero.
 *
 * Do NOT re-add an entry to buy a green run. An exclusion for a folder that no longer
 * exists is exactly what the guard below is here to catch, and an exclusion for a folder
 * that DOES exist is a request to keep retired text in the tree — which the owner has now
 * ruled against. Delete the text instead.
 */
const HELD_OPEN = [];

/**
 * `site/` is VESTIGIAL — there is no such directory any more.
 *
 * This carve-out was written because `site/README.md` and `site/BRAND-CHECK.md` named the
 * Console book as the marketing site's spec, which was a *true* record of what the site was
 * built to; `docs/PIVOT-V2.md` rules on the app, not on the marketing site, so retargeting them
 * was called an owner decision rather than a lock's, and reported as an open question.
 *
 * **The owner made that decision on 2026-08-20** — "make sure all the old nonsense is cleaned
 * and nuked, even website". The whole site was moved to `docs/archive/v1-site/`, and later the
 * same day the archive itself was DELETED when the owner overruled archiving in favour of
 * deleting. Its Console citations are out of scope because the files are no longer in the tree
 * at all, not because anything excludes them — HELD_OPEN is empty.
 *
 * The prefix is DROPPED rather than kept. Keeping it is behaviourally identical today (no
 * `site/` exists, and `livingDocs()` only walks `docs/`, `.claude/`, `.cursor/`, CLAUDE.md and
 * AGENTS.md, so a repo-root `site/` was never reachable anyway) — but it would silently carve a
 * *future* Graphite-era site out of this lock on the day someone creates one. A new site should
 * be checked by this lock, not exempt from it.
 */
const OUT_OF_SCOPE_PREFIXES = ['packages/', 'node_modules/', '.git/'];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(md|mdc)$/.test(entry.name)) out.push(p);
  }
  return out;
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

/**
 * Files git actually tracks, as a Set of repo-relative paths.
 *
 * A DOC THAT IS NOT IN THE REPOSITORY IS NOT A LIVING DOCUMENT, and until this
 * existed the walker below could not tell the difference. `.claude/worktrees/`
 * is gitignored and holds a FULL COPY of the tree for every agent worktree, so
 * the moment one session opened a worktree, every other session's docs gate went
 * red on a stale `pnpm --filter @sequence/web` line inside that copy — a file
 * nobody could fix from main, because it is not main's file.
 *
 * `docs-catalog.test.mjs` already reached the same conclusion for the same
 * reason and records it: "`git ls-files` is the right question: a doc becomes
 * part of the repository when it is tracked."
 *
 * This is a definition of SCOPE, not a carve-out, so it deliberately does not go
 * through `HELD_OPEN` — there is no folder being excused, only a rule about what
 * counts as a document. An untracked scratch file was never in scope; the walker
 * just could not say so.
 */
function trackedFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    return new Set(out.split('\0').filter(Boolean));
  } catch {
    /* No git (a tarball export, a sandbox without the binary). Fall back to
       scanning everything rather than silently checking nothing — a gate that
       passes because it found no files is the failure mode this whole file
       exists to prevent. */
    return null;
  }
}

/** Every markdown/mdc file an agent could read as guidance, minus the held-open books. */
function livingDocs() {
  const roots = ['docs', '.claude', '.cursor'].map((d) => path.join(ROOT, d));
  const tracked = trackedFiles();
  const files = roots.flatMap((d) => walk(d)).filter((p) => tracked === null || tracked.has(rel(p)));
  for (const f of ['CLAUDE.md', 'AGENTS.md']) {
    if (exists(f)) files.push(path.join(ROOT, f));
  }
  return files
    .map(rel)
    .filter((r) => !OUT_OF_SCOPE_PREFIXES.some((p) => r.startsWith(p)))
    .filter((r) => !HELD_OPEN.some((h) => r.startsWith(h.prefix)))
    .sort();
}

/* ================================================================== *
 * Guard on the exclusions themselves — so they can never rot into a
 * blanket carve-out after their jailer test is gone.
 *
 * HELD_OPEN is empty as of 2026-08-20, so this loop runs zero times and
 * the test passes vacuously. KEEP IT. It is not asserting about today's
 * repo; it is the toll every FUTURE carve-out has to pay — name a real
 * folder, name a real test that holds it open, or the exclusion fails
 * on the day either one disappears. Deleting it would make the next
 * carve-out free, which is how the last one survived a wave.
 * ================================================================== */

test('the held-open retired-book folders are still genuinely held open', () => {
  for (const { prefix, reason, blocker } of HELD_OPEN) {
    assert.ok(
      exists(prefix),
      `${prefix} is excluded from this lock as "${reason}", but no longer exists.\n` +
        `    Delete its entry from HELD_OPEN so the exclusion cannot hide a real citation.`,
    );
    if (!blocker) continue;
    assert.ok(
      exists(blocker),
      `${prefix} is excluded because ${blocker} holds it open — but that test is gone.\n` +
        `    Nothing is holding it open any more: DELETE the folder and drop the exclusion.\n` +
        `    Git history keeps every byte (\`git log --diff-filter=D\`); the working tree is\n` +
        `    the agent's search space, and a retired folder in it is a wrong turn waiting.`,
    );
  }
});

/* ================================================================== *
 * (a) A1 — no entry point names a retired book as the brand authority
 * ================================================================== */

/**
 * The documents an agent reads *before* it builds. A wrong pointer in any of
 * these is what this whole run exists to stop. `.claude/skills/**\/SKILL.md` and
 * `.cursor/rules/*.mdc` are the sharpest edge: they load AUTOMATICALLY, before
 * any doc is opened, so they hand their pointer over first.
 */
const ENTRY_POINT_FILES = [
  'CLAUDE.md',
  'AGENTS.md',
  'docs/README.md',
  'docs/CANON.md',
  'docs/PIVOT-V2.md',
  'docs/rebuild/README.md',
  'docs/rebuild/inherited-constraints.md',
  'docs/brand/README.md',
  'docs/brand/GRAPHITE-DECISIONS.md',
  'docs/product-final-plan.md',
  'docs/product-principles.md',
  'docs/vision.md',
  'docs/macos-ui.md',
  'docs/design-refs/README.md',
  'docs/HANDOFF.md',
  'docs/HANDOFF-AGENT-RESTART.md',
  'docs/research/v2-architecture-and-gaps.md',
];

/** Auto-loading guidance files are entry points whether or not anyone listed them. */
function entryPoints() {
  const auto = livingDocs().filter(
    (r) => /^\.claude\/skills\/.+\/SKILL\.md$/.test(r) || /^\.cursor\/rules\/.+\.mdc$/.test(r),
  );
  return [...new Set([...ENTRY_POINT_FILES.filter(exists), ...auto])].sort();
}

/**
 * A claim of brand authority. Deliberately narrow, and ASSIGNING rather than
 * merely topical: it must read "X is the source of truth / is canon", not just
 * contain the word "canon". A bare /canon/ matched `docs/rebuild/README.md`'s
 * retirement list — *`Any doc naming either as "active canon" is stale`* — which
 * is the opposite of an authority claim. Keep this regex assigning.
 */
const AUTHORITY =
  /\b(?:brand\s+)?(?:source of truth|SoT)\b|\bis (?:the |now (?:the )?)?canon(?:ical)?\b|\bvisual authority\b|\bbrand book is\b|\bwins every visual\b|\bactive (?:canon|brand book)\b/i;
const GRAPHITE_FROZEN = /brand\/graphite\/v1\b/;
const RETIRED_BOOK = /brand\/(?:console|ledger)\b/;

/**
 * Paragraphs = runs of non-blank lines. A bare `>` (empty blockquote line) and a
 * markdown rule separate paragraphs too, so a blockquote banner splits the way a
 * reader sees it.
 */
function paragraphs(text) {
  const out = [];
  let cur = null;
  text.split('\n').forEach((line, i) => {
    const blank = line.trim() === '' || line.trim() === '>' || /^\s*(-{3,}|\*{3,})\s*$/.test(line);
    if (blank) {
      cur = null;
      return;
    }
    if (!cur) {
      cur = { start: i + 1, text: '' };
      out.push(cur);
    }
    cur.text += line + '\n';
  });
  return out;
}

/**
 * The first paragraph that both claims authority and names a brand book.
 *
 * AUTHORITY is matched against a WHITESPACE-COLLAPSED copy, never the raw paragraph.
 * Its alternatives contain literal spaces — `source of truth`, `active canon` — and a
 * paragraph keeps the newlines markdown wrapped it with, so the raw text of
 *
 *     **3. The frozen book — `../brand/graphite/`.** This is the brand source
 *     of truth; no other book is.
 *
 * reads `source\nof truth` and matches nothing. That is exactly what happened: this
 * assertion reported `docs/rebuild/README.md` as handing agents the retired book,
 * while line 16 of that very file names `graphite/` as the brand source of truth.
 * The lock was asserting where a line happened to wrap.
 *
 * This is a normalisation, not a relaxation — every phrase must still appear in full
 * and in order. The BOOK PATHS are still matched against the raw text, because a path
 * never contains a space and collapsing could only mask a defect there.
 */
const flat = (s) => s.replace(/\s+/g, ' ');
function firstAuthorityParagraph(text) {
  return paragraphs(text).find(
    (p) => AUTHORITY.test(flat(p.text)) && (GRAPHITE_FROZEN.test(p.text) || RETIRED_BOOK.test(p.text)),
  );
}

test('a · every entry-point doc names the FROZEN Graphite book as its brand authority', () => {
  const failures = [];

  for (const file of entryPoints()) {
    const para = firstAuthorityParagraph(read(file));
    if (!para) continue; // claims no brand authority — nothing to get wrong

    const graphiteAt = para.text.search(GRAPHITE_FROZEN);
    const retiredAt = para.text.search(RETIRED_BOOK);

    if (graphiteAt === -1) {
      failures.push(
        `${file}:${para.start} — the first brand-authority claim in this file resolves to a\n` +
          `    RETIRED book and never names \`docs/brand/graphite/\`:\n` +
          para.text
            .trimEnd()
            .split('\n')
            .map((l) => `      | ${l}`)
            .join('\n'),
      );
      continue;
    }
    if (retiredAt !== -1 && retiredAt < graphiteAt) {
      failures.push(
        `${file}:${para.start} — the first brand-authority claim names a RETIRED book\n` +
          `    BEFORE it names \`docs/brand/graphite/\`. A reader takes the first one.\n` +
          para.text
            .trimEnd()
            .split('\n')
            .map((l) => `      | ${l}`)
            .join('\n'),
      );
    }
  }

  assert.equal(
    failures.length,
    0,
    `An entry-point document hands agents the RETIRED brand book.\n\n` +
      failures.join('\n\n') +
      `\n\n  WHAT TO DO INSTEAD:\n    ${FIX_A}\n\n` +
      `  Rewrite the claim so the FIRST authority sentence names \`docs/brand/graphite/\`.\n` +
      `  Name the retired BOOK after it if the signpost is useful ("Console v3.1 is retired") —\n` +
      `  the name is a signpost, a live-looking path is a pointer, and only the pointer hurts.\n` +
      `  Delete the old text from the tree; git history keeps it. There is no docs/archive/ to\n` +
      `  move it to, by owner ruling 2026-08-20: an archive is still a path an agent routes into.\n`,
  );
});

/* ================================================================== *
 * (a) A2 — ratchet: no NEW living citation of a retired book
 * ================================================================== */

/**
 * Frozen 2026-08-20, after the pivot doc sweep. Counts are LINES containing a
 * retired-book path. Every entry is a citation that survives for a stated reason.
 * This list may only ever shrink.
 *
 * IT REACHED ZERO on 2026-08-20, later the same day. When it was frozen it held ten
 * rows and 31 citing lines, and the largest — `docs/README.md`, 20 — existed only
 * because `packages/web/src/product/docsCanonV31.test.ts` required an index row for
 * every living file in the two retired book folders. The owner then ruled the books
 * out of `docs/brand/` entirely. They were moved to
 * `docs/archive/brand-books/{console,ledger}/`; every surviving citation was
 * re-pointed at the archive path, which does not match RETIRED_BOOK because the
 * segment is now `brand-books/console`, not `brand/console`; and the index rows
 * collapsed into two archive rows.
 *
 * ZERO FOR REAL, 2026-08-20 (third state). Until the archive was deleted, "zero" was
 * zero-with-two-carve-outs: `docs/archive/` and `docs/brand/refs/owner-walk-console-v31/`
 * were filtered out of `livingDocs()` before a single line was counted, so the census
 * could be empty while hundreds of retired-book citations sat in the tree. Both folders
 * are now deleted and HELD_OPEN is `[]`, so this census is measured against EVERY
 * markdown file under `docs/`, `.claude/` and `.cursor/` with nothing excluded, and it
 * is still zero. That is a materially stronger statement than the one this comment made
 * an hour earlier, and it is the reason to be suspicious of any future non-empty entry.
 *
 * An EMPTY census is the strong state, not a disabled one. The ratchet still runs:
 * any living doc that gains a `brand/console` or `brand/ledger` path is an `added`
 * failure with no row to absorb it. Do NOT add a row to make a new citation pass —
 * re-point the citation. The one legitimate reason to add a row back is a *quoted
 * historical ruling* that must keep its original path verbatim, and even that was
 * avoidable here (see `.claude/skills/sequence-design/SKILL.md`, which marks the
 * substituted path inline rather than leaving a live-looking pointer).
 */
const CITATION_CENSUS = new Map([]);

test('a · no NEW living doc cites a retired brand book (ratchet)', () => {
  const actual = new Map();
  for (const file of livingDocs()) {
    const hits = lines(file)
      .map((l, i) => ({ n: i + 1, l }))
      .filter(({ l }) => RETIRED_BOOK.test(l));
    if (hits.length) actual.set(file, hits);
  }

  const added = [];
  const grew = [];
  const shrank = [];

  for (const [file, hits] of actual) {
    const allowed = CITATION_CENSUS.get(file);
    if (allowed === undefined) {
      added.push(
        `${file} — ${hits.length} new citation(s) of a RETIRED brand book:\n` +
          hits
            .map(({ n, l }) => `      ${file}:${n}: ${l.trim().slice(0, 150)}`)
            .join('\n'),
      );
    } else if (hits.length > allowed) {
      grew.push(
        `${file} — ${hits.length} citing lines, census allows ${allowed}:\n` +
          hits.map(({ n, l }) => `      ${file}:${n}: ${l.trim().slice(0, 150)}`).join('\n'),
      );
    }
  }
  for (const [file, allowed] of CITATION_CENSUS) {
    const n = actual.get(file)?.length ?? 0;
    if (n < allowed) {
      shrank.push(
        `${file} — ${n} citing line(s), census still says ${allowed}. Set it to ${n}.` +
          (n === 0 ? ' Then delete the row.' : ''),
      );
    }
  }

  assert.equal(
    added.length + grew.length,
    0,
    `A living document gained a citation of a RETIRED brand book.\n\n` +
      [...added, ...grew].join('\n\n') +
      `\n\n  WHAT TO DO INSTEAD:\n    ${FIX_A}\n\n` +
      `  If the citation is a deliberate signpost ("X names the retired book"), it still needs a\n` +
      `  census row in ${rel(fileURLToPath(import.meta.url))} with a one-line reason — the point of\n` +
      `  the census is that every survivor is justified in writing, not merely tolerated.\n`,
  );

  assert.equal(
    shrank.length,
    0,
    `Good news — retired-book citations were removed, but CITATION_CENSUS still budgets for them.\n` +
      `A census that budgets higher than reality is how a wrong citation sneaks back in unnoticed.\n` +
      `Ratchet it down in ${rel(fileURLToPath(import.meta.url))}:\n\n  ` +
      shrank.join('\n  ') +
      '\n',
  );
});

/* ================================================================== *
 * (b) no living build/gate doc instructs building in packages/web
 * ================================================================== */

/**
 * NARROW ON PURPOSE — SAY SO.
 *
 * We cannot reliably separate "build in packages/web" from "packages/web is dead"
 * at the line level, because the doc sweep did NOT rewrite each command line. It
 * put a pivot banner at the top of the file or section and left the commands as
 * historical shape (`docs/release-gate.md` banners at :10 and has commands at
 * :132 — 120 lines apart, so no proximity window works either).
 *
 * So the assertion is per FILE, and only about *executable* commands:
 *   a file containing a runnable `pnpm --filter @sequence/web …` command must
 *   somewhere carry a pivot marker telling the reader that filter names the dead
 *   tree and v2 is gated in `packages/web2`.
 *
 * This does NOT prove no stale instruction survives inside a marked file. It
 * proves no file hands you v1 gate commands with nothing saying they are v1.
 * Read a green run as exactly that much.
 */
const V1_COMMAND = /pnpm\s+(?:-\w+\s+)*--filter\s+@sequence\/web(?![-\w2])/;
const PIVOT_MARKER =
  /(packages\/web2|@sequence\/web2|dead code|awaiting deletion|Wave 7|being deleted|v2 pivot|PIVOT-V2)/i;

/**
 * Round-history records. They log what WAS run in a past round; the commands are
 * evidence, not instructions, and rewriting them would falsify the record
 * ("Never delete a document" / never edit an owner quote). Asserted to still be
 * real below, so this cannot become a blanket carve-out.
 */
const HISTORY_LOGS = new Set(['docs/loop-log.md', 'docs/decisions/r211-autonomous-close.md']);

test('b · no living doc hands out v1 gate commands without saying they are v1', () => {
  for (const file of HISTORY_LOGS) {
    assert.ok(exists(file), `HISTORY_LOGS names ${file}, which does not exist — drop the entry.`);
    assert.ok(
      lines(file).some((l) => V1_COMMAND.test(l)),
      `HISTORY_LOGS exempts ${file}, but it no longer contains any @sequence/web command.\n` +
        `    Drop the entry rather than leaving an exemption that covers nothing.`,
    );
  }

  const failures = [];
  for (const file of livingDocs()) {
    if (HISTORY_LOGS.has(file)) continue;
    const text = read(file);
    const hits = text
      .split('\n')
      .map((l, i) => ({ n: i + 1, l }))
      .filter(({ l }) => V1_COMMAND.test(l));
    if (!hits.length) continue;
    if (PIVOT_MARKER.test(text)) continue;

    failures.push(
      `${file} — ${hits.length} runnable \`@sequence/web\` command(s), and nothing in the file\n` +
        `    says that package is the v1 tree:\n` +
        hits
          .slice(0, 6)
          .map(({ n, l }) => `      ${file}:${n}: ${l.trim().slice(0, 140)}`)
          .join('\n'),
    );
  }

  assert.equal(
    failures.length,
    0,
    `A living document tells an agent to build or gate in \`packages/web\`.\n\n` +
      failures.join('\n\n') +
      `\n\n  WHAT TO DO INSTEAD:\n` +
      `    \`packages/web\` is DEAD CODE awaiting deletion at Wave 7 (\`docs/PIVOT-V2.md\`).\n` +
      `    v2 surfaces are built and gated in \`packages/web2\`: run the same gates as\n` +
      `    \`pnpm --filter @sequence/web2 …\`. The SHAPE of each gate is unchanged\n` +
      `    (\`docs/release-gate.md\` is still binding on what "done" means); only the filter moves.\n` +
      `    Either retarget the commands, or add a package note at the top of the file saying the\n` +
      `    \`@sequence/web\` filter names the tree being deleted.\n`,
  );
});

/* ================================================================== *
 * (c) CLAUDE.md's first reading item points at the frozen book + PIVOT-V2
 * ================================================================== */

test('c · CLAUDE.md opens on the frozen Graphite book and docs/PIVOT-V2.md', () => {
  const all = lines('CLAUDE.md');
  const start = all.findIndex((l) => /^##\s*READ THESE FIRST/i.test(l));
  assert.notEqual(
    start,
    -1,
    'CLAUDE.md has no "## READ THESE FIRST" section. Every agent reads this file first;\n' +
      '    it must open with the reading order. Restore the heading.',
  );

  // The section head through reading item 1 — what an agent takes in before it acts.
  let end = all.findIndex((l, i) => i > start && /^\s*1\.\s/.test(l));
  assert.notEqual(end, -1, 'CLAUDE.md "READ THESE FIRST" has no numbered item 1.');
  end = all.findIndex((l, i) => i > end && /^\s*2\.\s/.test(l));
  if (end === -1) end = all.length;
  const head = all.slice(start, end).join('\n');

  assert.match(
    head,
    /docs\/brand\/graphite\//,
    'CLAUDE.md\'s first reading block does not name the FROZEN brand book.\n' +
      `    ${FIX_A}\n` +
      '    Put `docs/brand/graphite/` in the banner or in reading item 0, before anything else.\n' +
      `--- block read ---\n${head}\n---`,
  );
  assert.match(
    head,
    /docs\/PIVOT-V2\.md/,
    'CLAUDE.md\'s first reading block does not name `docs/PIVOT-V2.md`, the decision of record.\n' +
      '    Without it an agent does not learn the v1 UI is being deleted before it starts building.\n' +
      `--- block read ---\n${head}\n---`,
  );

  // The decision of record must come FIRST, not be buried in the list — but "first" is
  // items 0 and 1, not slot 0 alone. `docs/CANON.md` was added ahead of it on 2026-08-20
  // as the one-page entry (product, competitors, advantage, the laws, the known traps),
  // and PIVOT-V2 reads better immediately after it than before it. Pinning slot 0 to one
  // filename would have made improving the reading order fail the lock.
  const lead = all.slice(start, end).filter((l) => /^\s*[01]\.\s/.test(l));
  assert.ok(
    lead.some((l) => /docs\/PIVOT-V2\.md/.test(l)),
    'CLAUDE.md must name `docs/PIVOT-V2.md` in reading item 0 or 1 — the decision of record\n' +
      '    comes first, not somewhere down the list. An agent that starts building before it\n' +
      '    learns the v1 UI is being deleted builds in the wrong tree.\n' +
      `    Found: ${lead.length ? lead.map((l) => l.trim()).join(' // ') : '(no items 0 or 1)'}`,
  );
  assert.ok(
    lead.some((l) => /docs\/CANON\.md/.test(l)),
    'CLAUDE.md must name `docs/CANON.md` in reading item 0 or 1 — it is the one page that\n' +
      '    states what is true about the product, and it is only useful if it is read first.\n' +
      `    Found: ${lead.length ? lead.map((l) => l.trim()).join(' // ') : '(no items 0 or 1)'}`,
  );

  assert.ok(
    !/^>?\s*\*\*The brand source of truth is\s+`?docs\/brand\/(console|ledger)/im.test(head),
    'CLAUDE.md names a RETIRED book as the brand source of truth.\n    ' + FIX_A,
  );
});

/* ================================================================== *
 * (d) — RETIRED 2026-08-20 WITH THE ARCHIVE IT POLICED
 * ==================================================================
 *
 * `d · every doc archived by the v2 pivot carries the retirement header` stood here,
 * with three constants: PIVOT_ARCHIVE_FOLDER (`docs/archive/v1-ui`), PIVOT_ARCHIVE_FILES
 * (eight named archive entry points) and RETIREMENT_HEADER (the `> **Retired 2026-08-20
 * by the v2 pivot.**` banner regex). It asserted that every doc the pivot moved under
 * `docs/archive/` carried that banner, so a reader who landed on one by grep could tell
 * it was dead.
 *
 * ITS ENTIRE SUBJECT WAS BANNER TEXT ON ARCHIVED DOCS. The owner deleted the archive on
 * 2026-08-20 — *"we want a lean program with current and real information without extra
 * nonsense and possible mistakes and extra routing"* — so there is nothing left to
 * banner. Its own failure message ("Restore them — history is evidence") argued the
 * position the owner overruled: history is in git, and a banner is only needed for a
 * document a grep can still land on.
 *
 * This is retirement, not weakening. Nothing live lost a guard: the test read only paths
 * under `docs/archive/`, every one of which is now deleted, and the assertion that
 * living docs do not cite dead paths belongs to `docsCanonV31.test.ts` G3, which is
 * untouched and is the acceptance signal for the deletion.
 *
 * Do not write a replacement that re-creates an archive to banner. The lock that replaces
 * it is the empty HELD_OPEN above plus the empty CITATION_CENSUS: retired text is not
 * marked, it is gone.
 */
