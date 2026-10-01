#!/usr/bin/env node
/**
 * THE COUNTING GATE — did every test file we found actually run?
 *
 *   node tools/ci/counting-gate.mjs          # all packages
 *   node tools/ci/counting-gate.mjs analyzer # one
 *
 * `pnpm -r test` prints a lot of green. What it does not say is whether the
 * green covers the files that exist. A package whose glob stopped matching, a
 * file that throws at import and is skipped, a build that did not produce the
 * directory the script points at — all three print a healthy summary over a
 * smaller denominator, and the denominator is the thing nobody reads.
 *
 * ── ONE DISCOVERY DRIVES BOTH THE COUNT AND THE RUN ───────────────────────
 *
 * The list of files this counts is THE SAME ARRAY it hands to the runner. Not a
 * second glob that ought to agree with the first — that is the shape of every
 * gate in this repository that turned out to be measuring itself. `discovered`
 * is `files.length`; `ran` is the number of distinct files that emitted at least
 * one test event out of `run({ files })`. There is no path where the two are
 * computed from different sources.
 *
 * ── AND THE PUSH READS THE EXIT CODE, NEVER THE OUTPUT ────────────────────
 *
 * Exit 0 only when `ran === discovered` for every package and nothing failed;
 * exit 2 when a file was found and did not run; exit 1 when a test failed. A
 * caller that greps this output for "ok" is doing something the exit code
 * already answers, and greppable output is how a red run gets pushed. The
 * numbers below are for a person; the exit code is for a script.
 */
import fs from 'node:fs';
import path from 'node:path';
import { run } from 'node:test';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
/*
 * THE ROOT IS AN INPUT, and the default is a guess this script gets to make
 * about itself rather than about anybody else's repository.
 *
 *   node counting-gate.mjs                  # the repo two levels up (Sequence)
 *   node counting-gate.mjs --root <path>    # any repository
 *   node counting-gate.mjs <package>        # one package, as before
 *
 * `HERE/../..` was the only thing that made this file Sequence's. It is still
 * the default, because that is where it lives here; it is no longer the only
 * possibility, because a stranger who drops it anywhere else got a repo root two
 * levels above wherever they put it and no error at all.
 */
const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const ROOT = rootFlag >= 0 ? path.resolve(argv[rootFlag + 1] ?? '.') : path.resolve(HERE, '..', '..');
const only = argv.filter((a, i) => a !== '--root' && i !== rootFlag + 1 && !a.startsWith('--'))[0] ?? null;

/** One separator, so a Windows path and a POSIX one compare. */
const slash = (s) => s.split('\\').join('/');

/**
 * What each package DECLARES it tests, taken from its own `test` script.
 *
 * Read from package.json rather than listed here, so a package that changes its
 * globs is counted against its new declaration and not against a copy of the old
 * one that lives in this file.
 */
function declaration(pkgDir) {
  const pkgPath = path.join(pkgDir, 'package.json');
  if (!fs.existsSync(pkgPath)) return null;
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  /*
   * WHICH SCRIPT, DECLARED BY THE PACKAGE — `test` unless it says otherwise.
   *
   *   "countingGate": { "script": "test:ci" }
   *
   * A repository whose node tests are not under `test` was invisible to this
   * gate, and this repository was the example: every one of tools/ci's own
   * cases — including the eight that test the gate itself — ran under `test:ci`
   * and was counted by nothing. The gate could not count itself.
   *
   * Declared rather than guessed. Teaching the gate to try `test:ci` after
   * `test` would put a Sequence script name back inside a file whose whole point
   * is that it holds none.
   */
  const scriptName = typeof pkg.countingGate?.script === 'string' ? pkg.countingGate.script : 'test';
  const script = pkg.scripts?.[scriptName];
  if (typeof script !== 'string') return null;
  /* The last `&&` segment is the one that runs the tests; earlier segments are
     build prerequisites (gateway compiles a test tsconfig first). */
  const segment = script.split('&&').map((s) => s.trim()).pop();
  if (!segment.startsWith('node ')) return null; // vitest and friends are not this gate's job
  const parts = segment.split(/\s+/).slice(1);
  const testAt = parts.indexOf('--test');
  if (testAt < 0) return null;
  return { execArgv: parts.slice(0, testAt), globs: parts.slice(testAt + 1), script };
}

/** Expand `dist/test/*.test.js` against the real tree. No globbing library. */
function expand(pkgDir, glob) {
  const star = glob.lastIndexOf('*');
  if (star < 0) return fs.existsSync(path.join(pkgDir, glob)) ? [glob] : [];
  const dir = glob.slice(0, glob.lastIndexOf('/'));
  const pattern = glob.slice(glob.lastIndexOf('/') + 1);
  const abs = path.join(pkgDir, dir);
  if (!fs.existsSync(abs)) return [];
  const re = new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return fs
    .readdirSync(abs)
    .filter((f) => re.test(f))
    .sort()
    .map((f) => `${dir}/${f}`);
}

/**
 * Where this repository keeps its packages, DISCOVERED rather than assumed.
 *
 * `readdirSync(ROOT/'packages')` threw outright on any repository without that
 * directory — a flat repo, a `src/` repo, a Python repo — which is most of them.
 * The order below is the order a person would look in: what the root package.json
 * declares, then pnpm's workspace file, then a `packages/` directory if there
 * happens to be one, and finally the root itself as a single package.
 *
 * Returns absolute directories. The last fallback is what makes a one-package
 * repository work at all, and it is the case a stranger meets first.
 */
function discoverPackageDirs(root) {
  const dirsUnder = (rel) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs)) return [];
    return fs
      .readdirSync(abs, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(abs, e.name));
  };
  /* A workspace glob is read for its DIRECTORY prefix only: `packages/*` means
     "the directories under packages". No glob library, and a pattern this does
     not understand is skipped rather than guessed at. */
  const fromGlobs = (globs) => {
    const out = [];
    for (const g of globs) {
      if (typeof g !== 'string') continue;
      const star = g.indexOf('*');
      if (star < 0) {
        if (fs.existsSync(path.join(root, g))) out.push(path.join(root, g));
        continue;
      }
      const prefix = g.slice(0, star).replace(/\/$/, '');
      if (prefix !== '') out.push(...dirsUnder(prefix));
    }
    return out;
  };

  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const ws = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).workspaces;
      const globs = Array.isArray(ws) ? ws : Array.isArray(ws?.packages) ? ws.packages : [];
      const found = fromGlobs(globs);
      if (found.length > 0) return found;
    } catch {
      /* an unreadable package.json is not a workspace declaration */
    }
  }
  const wsYaml = path.join(root, 'pnpm-workspace.yaml');
  if (fs.existsSync(wsYaml)) {
    const globs = fs
      .readFileSync(wsYaml, 'utf8')
      .split(/\r?\n/)
      .map((l) => /^\s*-\s*['"]?([^'"#]+?)['"]?\s*$/.exec(l)?.[1])
      .filter((g) => typeof g === 'string');
    const found = fromGlobs(globs);
    if (found.length > 0) return found;
  }
  const conventional = dirsUnder('packages');
  if (conventional.length > 0) return conventional;
  /* One package, which is the shape of most repositories on earth. */
  return fs.existsSync(pkgPath) ? [root] : [];
}

/*
 * THE ROOT IS ALWAYS A CANDIDATE, not only when nothing else is found.
 *
 * Workspace discovery answers "where are the packages"; it does not answer
 * "does the root itself declare tests". Sequence's does — tools/ci — and a
 * monorepo that keeps its own harness at the top is the ordinary case, not a
 * special one. Deduplicated, so a flat repository is still one package and not
 * two.
 */
const packageDirs = [
  ...new Set([
    ...discoverPackageDirs(ROOT),
    /*
     * ONLY IF THE ROOT IS ACTUALLY A PACKAGE. Added unconditionally at first,
     * which made an EMPTY DIRECTORY report one package found and killed the
     * "no package was found" refusal outright — case 5b failed the moment the
     * gate first counted its own tests, which is the whole argument for making
     * it count them.
     */
    ...(fs.existsSync(path.join(ROOT, 'package.json')) ? [ROOT] : []),
  ]),
]
  .filter((d) => (only === null ? true : path.basename(d) === only))
  .sort();
const packages = packageDirs.map((d) => path.basename(d));

const rows = [];
for (const pkgDir of packageDirs) {
  const name = path.basename(pkgDir);
  const decl = declaration(pkgDir);
  if (decl === null) {
    rows.push({ name, skipped: 'no `node --test` test script' });
    continue;
  }
  /* ONE list. It is counted, and it is what runs. */
  const files = decl.globs.flatMap((g) => expand(pkgDir, g));

  /*
   * ── AND THE FILES NO GLOB REACHES ────────────────────────────────────────
   *
   * `ran === discovered` holds BY CONSTRUCTION for anything the glob misses,
   * because both sides come from the glob. That is not a gate, it is a tautology
   * with a denominator.
   *
   * Measured: `packages/schema/src/programs/catalogue.test.ts` compiles to
   * `dist/programs/`, which schema's glob did not cover, so it had NEVER RUN.
   * When run, two of its three tests failed — the catalogue had grown from five
   * templates to seven with nothing saying so, and `build-architecture-full`
   * emitted duplicate node and edge ids, a shipped template `validateProgram`
   * rejects. The file-level count reported 37 of 37 green over 38 files.
   *
   * So the tree is walked independently of the declaration, and a built test file
   * that no glob reaches is exit 2 with its name.
   */
  const reachable = new Set(files.map((f) => slash(path.join(pkgDir, f))));
  const onDisk = [];
  const walkTests = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) walkTests(f);
      else if (e.name.endsWith('.test.js')) onDisk.push(slash(f));
    }
  };
  /*
   * THE WALK'S ROOTS COME FROM THE DECLARATION, not from two literals.
   *
   * This was `walkTests(pkgDir/'dist')` and `walkTests(pkgDir/'dist-test')` —
   * Sequence's own build directories, hardcoded. A stranger whose tests live in
   * `test/` got a walk over directories that do not exist, so it found nothing,
   * so `built test files no glob reaches 0` was printed by a check that had
   * examined NO FILES. The most valuable half of this gate was silently inert
   * outside this repository, and it printed a zero that looked like an answer.
   *
   * Derived from each declared glob's top directory instead: `dist/test/*.test.js`
   * walks `dist`, `dist-test/test/*.test.js` walks `dist-test`, `test/*.test.js`
   * walks `test`. Here that yields exactly the two literals it replaces —
   * checked, not assumed — and elsewhere it yields whatever that repository
   * actually uses.
   */
  const walkRoots = new Set(
    decl.globs
      .map((g) => slash(g).split('/')[0])
      .filter((seg) => seg !== '' && seg !== '.' && seg !== '..' && !seg.includes('*')),
  );
  for (const seg of walkRoots) walkTests(path.join(pkgDir, seg));
  const unmatched = onDisk.filter((f) => !reachable.has(f)).map((f) => path.relative(pkgDir, f).split(path.sep).join('/'));
  const ran = new Set();
  let pass = 0;
  let fail = 0;
  const failures = [];
  const emptyFiles = [];
  if (files.length > 0) {
    /*
     * A FILE THAT "RAN" IS ONE THAT EMITTED A REAL TEST, not one that finished.
     *
     * The first version counted any pass/fail event's `file`, and could not fail:
     * node emits a WRAPPER event per file — `name` is the file path, `nesting` 0
     * — so a file containing no tests at all still reported as ran, and so did
     * one that threw on import (that arrives as a wrapper `test:fail`).
     * Verified by dropping a test-less `zz-empty.test.js` into a package: the
     * gate said "discovered 18, ran 18" and exited 0. A counting gate that
     * cannot count to less than its input is not a gate.
     *
     * So the wrapper is identified and excluded, and files that produced ONLY a
     * wrapper are reported separately — discovered, executed, and contributed
     * nothing, which is the case worth knowing about.
     */
    const sawTest = new Set();
    const sawWrapper = new Set();
    const isWrapper = (d) =>
      typeof d.name === 'string' &&
      typeof d.file === 'string' &&
      slash(d.file).endsWith(slash(d.name));
    /*
     * ABSOLUTE, AND NOT LEFT TO `cwd` TO RESOLVE.
     *
     * `expand` returns paths RELATIVE to the package, so `run()` could only
     * find them by way of the `cwd` option below — and `cwd` was not added to
     * `node:test`'s `run()` until Node 22. On Node 20 it is accepted and
     * IGNORED, the relative paths resolve against this process's directory
     * instead, no file matches, and `run()` yields no events at all. The gate
     * then reports `discovered 2  ran 0` about a package whose tests are fine.
     *
     * Measured 2026-09-10: that is exactly what CI did, on a Node 20 runner,
     * while the same commit passed on the Node 24 this is developed against.
     * `engines` says `>=20`, so the instrument that decides whether tests ran
     * has to work there — the floor is the claim, and an instrument that
     * quietly needs a newer runtime than the project claims is measuring a
     * different project.
     *
     * `cwd` stays: on the versions that honour it, it is still what puts the
     * test process in the package. It is simply no longer load-bearing for
     * FINDING the files.
     */
    const absFiles = files.map((f) => path.resolve(pkgDir, f));
    for await (const ev of run({ files: absFiles, cwd: pkgDir, execArgv: decl.execArgv, concurrency: 4 })) {
      if (ev.type !== 'test:pass' && ev.type !== 'test:fail') continue;
      const d = ev.data;
      if (!d.file) continue;
      if (isWrapper(d)) {
        sawWrapper.add(d.file);
        if (ev.type === 'test:fail' && failures.length < 5) {
          failures.push(`${path.basename(d.file)}: the FILE failed (import or top-level throw)`);
        }
        continue;
      }
      sawTest.add(d.file);
      ran.add(d.file);
      if (ev.type === 'test:pass') pass += 1;
      else {
        fail += 1;
        if (failures.length < 5) failures.push(`${path.basename(d.file)}: ${d.name}`);
      }
    }
    for (const f of sawWrapper) if (!sawTest.has(f)) emptyFiles.push(path.basename(f));
  }
  /*
   * ── AND THE COMPILED TESTS WHOSE SOURCE IS GONE ──────────────────────────
   *
   * `tsc` writes output and NEVER deletes it, so a compiled test outlives the
   * source it came from. Switch a branch, or delete a `.ts`, and its `.js`
   * stays in the build directory — where this gate finds it, runs it against a
   * tree that no longer contains it, and reports failures nobody can locate.
   *
   * MEASURED 2026-09-10: two tests built on a feature branch survived a switch
   * back to `main` and produced SIX failures on a green tree. Another lane read
   * them as "main is red" and reported it, and the tests it named do not exist
   * on main. That is worse than a false negative: it sends a reader looking for
   * a defect in code that is not there.
   *
   * ANCHORED ON THE SOURCE MAP, not on a naming convention. `tsc` emits
   * `<file>.js.map` whose `sources` name the real input, so the question "does
   * this compiled file still have a source" is answered by evidence the build
   * itself produced. A file with no map is SKIPPED rather than guessed at —
   * this gate runs on stranger repositories and must not invent a layout.
   */
  const orphaned = [];
  for (const rel of files) {
    /*
     * ABSOLUTE, AGAINST pkgDir. `expand` returns paths RELATIVE to the package,
     * and the first cut of this block read `${f}.map` straight — resolving
     * against process.cwd() instead, where nothing exists. Every read threw,
     * every throw was caught as "no map", and the check passed on a planted
     * orphan while reporting zero. A path bug became a silent pass, inside a
     * check written against silent passes. It was caught by planting one.
     */
    const abs = path.join(pkgDir, rel);
    const mapPath = `${abs}.map`;
    /* No map at all is the honest skip: nothing to check against, nothing
       claimed. A map that EXISTS and cannot be read is not that, and must not
       be swallowed by the same branch. */
    if (!fs.existsSync(mapPath)) continue;
    let map;
    try {
      map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    } catch (e) {
      console.log(`        UNREADABLE SOURCE MAP: ${rel}.map — ${(e && e.message) || e}`);
      continue;
    }
    const sources = Array.isArray(map.sources) ? map.sources : [];
    if (sources.length === 0) continue;
    const resolved = sources.map((src) => path.resolve(path.dirname(abs), src));
    if (resolved.some((src) => fs.existsSync(src))) continue;
    orphaned.push(rel);
  }

  rows.push({
    name,
    orphaned,
    globs: decl.globs,
    discovered: files.length,
    ran: ran.size,
    pass,
    fail,
    failures,
    emptyFiles,
    unmatched,
    missing: files.filter((f) => ![...ran].some((r) => r.endsWith(path.basename(f)))).slice(0, 8),
  });
  const r = rows[rows.length - 1];
  const mark = r.discovered === r.ran ? ' ok ' : 'DIFF';
  console.log(
    `${mark}  ${name.padEnd(11)} declared ${decl.globs.join(' ')}\n        discovered ${r.discovered}  ran ${r.ran}  tests ${pass} pass ${fail} fail`,
  );
  if (r.unmatched.length > 0) console.log(`        BUILT BUT NO GLOB REACHES IT: ${r.unmatched.join(', ')}`);
  if (r.orphaned.length > 0)
    console.log(`        COMPILED BUT ITS SOURCE IS GONE: ${r.orphaned.join(', ')}`);
  if (r.emptyFiles.length > 0) console.log(`        discovered but contributed NO test: ${r.emptyFiles.join(', ')}`);
  if (r.missing.length > 0) console.log(`        found but did NOT run: ${r.missing.join(', ')}`);
  for (const f of r.failures) console.log(`        FAILED: ${f}`);
}

const counted = rows.filter((r) => r.skipped === undefined);
const mismatched = counted.filter((r) => r.discovered !== r.ran);
const failed = counted.filter((r) => r.fail > 0);
const empty = counted.filter((r) => r.discovered === 0);
const unreached = counted.filter((r) => r.unmatched.length > 0);

console.log('');
/*
 * NOT COUNTED, NAMED AS A NUMBER — never silent.
 *
 * This gate counts node's runner and nothing else. Here two packages are vitest
 * and we know it, so a quiet skip was survivable. In a stranger's repository the
 * WHOLE TREE can be uncountable — a vitest monorepo, a Python repo — and the
 * old summary printed "every discovered file ran" over a count of nothing. That
 * is this gate's own defect one layer up: a green that describes no tree.
 */
const uncountable = rows.filter((r) => r.skipped !== undefined);
console.log(`packages with a node --test script   ${counted.length}`);
console.log(
  `  NOT COUNTED (other runner / no tests) ${uncountable.length}` +
    (uncountable.length ? `: ${uncountable.map((r) => r.name).join(', ')}` : ''),
);
console.log(`discovered files                     ${counted.reduce((a, r) => a + r.discovered, 0)}`);
console.log(`files that ran                       ${counted.reduce((a, r) => a + r.ran, 0)}`);
console.log(`tests                                ${counted.reduce((a, r) => a + r.pass, 0)} pass, ${counted.reduce((a, r) => a + r.fail, 0)} fail`);
console.log(`packages where ran < discovered      ${mismatched.length}`);
console.log(`built test files no glob reaches   ${counted.reduce((a, r) => a + r.unmatched.length, 0)}`);
console.log(
  `compiled tests with no source        ${counted.reduce((a, r) => a + (r.orphaned?.length ?? 0), 0)}`,
);
console.log(`packages discovering NOTHING         ${empty.length}${empty.length ? ` (${empty.map((r) => r.name).join(', ')})` : ''}`);

/*
 * The record goes where the SCRIPT lives, not where the tree under test is. A
 * gate run against somebody else's repository must not write a directory into
 * it — the first thing a stranger's tool does should never be to litter.
 */
fs.mkdirSync(path.join(HERE, 'out'), { recursive: true });
fs.writeFileSync(
  path.join(HERE, 'out', 'counting-gate.json'),
  `${JSON.stringify({ rows, mismatched: mismatched.length, failed: failed.length }, null, 2)}\n`,
);

/*
 * The exit code is the whole interface. 2 is the counting failure specifically —
 * distinct from 1 (a test failed) because they mean different things and a
 * caller that conflates them cannot act differently.
 */
/*
 * A COUNT OF NOTHING IS NOT A PASS, and this is the line that makes the gate
 * safe to hand to somebody else.
 *
 * Two shapes reach it. No package was found at all — the root is wrong, or the
 * repository has no package.json. Or packages were found and NONE of them could
 * be counted, because every one uses a runner this gate does not read. Both used
 * to print the happy summary and exit 0, which told a stranger their run
 * described their tree when it had measured none of it.
 */
if (packageDirs.length === 0) {
  console.error(
    `\nCOUNTING FAILURE: no package was found under ${ROOT}. ` +
      'Looked for package.json workspaces, pnpm-workspace.yaml, a packages/ directory, ' +
      'then the root itself. Pass --root <path> if this is the wrong tree. Exit 2.',
  );
  process.exit(2);
}
if (counted.length === 0) {
  console.error(
    `\nCOUNTING FAILURE: ${rows.length} package(s) found and NONE could be counted — ` +
      `every one uses a runner this gate does not read (${uncountable.map((r) => r.name).join(', ')}). ` +
      'Nothing was measured, so nothing is green. Exit 2.',
  );
  process.exit(2);
}
/*
 * AN ORPHAN IS A COUNTING FAILURE, NOT A TEST FAILURE, and it exits 2 for that
 * reason: the tree was not measured correctly, so whatever the tests said about
 * it cannot be trusted either way. Reporting the number without failing on it
 * would leave exactly the situation this check exists to end — a green summary
 * above a run that executed code the repository no longer contains.
 */
const orphans = counted.filter((r) => (r.orphaned?.length ?? 0) > 0);
if (orphans.length > 0) {
  console.error(
    `
COUNTING FAILURE: ${orphans.reduce((a, r) => a + r.orphaned.length, 0)} compiled test file(s) ` +
      'have no source in this tree. `tsc` never deletes, so these outlived the `.ts` they came from — ' +
      'a branch switch or a deleted test. They were RUN, against a tree that does not contain them. ' +
      'Delete them, or rebuild the package cleanly. Exit 2.',
  );
  for (const r of orphans) console.error(`  ${r.name}: ${r.orphaned.join(', ')}`);
  process.exit(2);
}
if (mismatched.length > 0 || empty.length > 0 || unreached.length > 0) {
  console.error(
    `\nCOUNTING FAILURE: ${mismatched.length} package(s) ran fewer files than were found` +
      `${empty.length ? `, ${empty.length} discovered none at all` : ''}. Exit 2.`,
  );
  process.exit(2);
}
if (failed.length > 0) {
  console.error(`\n${failed.length} package(s) had failing tests. Exit 1.`);
  process.exit(1);
}
console.log('\nevery discovered file ran. Exit 0.');
