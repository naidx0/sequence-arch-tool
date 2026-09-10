import assert from 'node:assert';
import { test } from 'node:test';

import { checkAnswerClaims, checkQuestionPremise } from '../moat/claimCheck.js';
import type { ArchGraph } from '@sequence/schema';

/**
 * THE LIE DETECTOR, AND THE ANSWER THAT MADE IT A ROW.
 *
 * The first real answer this product ever gave contained a fabrication the
 * graph could have refuted on the spot: it said the system used "MySQL
 * databases" when zero files mention MySQL and `db.py` calls
 * `sqlite3.connect`. Nothing checked. A confident false sentence reads exactly
 * like a true one, and a grounded tool that ships one is worse than no tool —
 * it spends the credibility that grounding was supposed to earn.
 *
 * THIS ONLY CHECKS WHAT THE GRAPH CAN ACTUALLY REFUTE. Most of what a model
 * writes is prose, opinion or summary, and a checker that flagged those would
 * produce noise nobody reads. Two categories are genuinely CLOSED WORLDS:
 *
 *   1. datastore technology — the scan enumerates what it found, so a named
 *      technology that is absent is refutable;
 *   2. cited file paths — the scan holds every file it read, so a citation that
 *      resolves to nothing is refutable.
 *
 * A finding is a FLAG, never a verdict. "The answer says MySQL; the scan found
 * sqlite" is a fact worth putting in front of a reader. "The answer is wrong"
 * is a judgement this module is not entitled to make — the model may be
 * contrasting, quoting the user, or discussing a migration.
 */

function g(over: Partial<ArchGraph>): ArchGraph {
  return {
    version: 1,
    mode: 'scan',
    scannedAt: '2026-08-22T00:00:00.000Z',
    repoRoot: '/repo',
    repoName: 'fixture',
    nodes: [],
    edges: [],
    warnings: [],
    ...over,
  } as unknown as ArchGraph;
}

/** The shape of the answer that started this. */
const SQLITE_GRAPH = g({
  nodes: [
    { id: 'svc:api', label: 'api', kind: 'service' },
    { id: 'ds:db', label: 'Database', kind: 'datastore', meta: { tech: 'sqlite' } },
    { id: 'file:app/db.py', label: 'db.py', kind: 'file', path: 'app/db.py' },
    { id: 'file:app/main.py', label: 'main.py', kind: 'file', path: 'app/main.py' },
  ],
} as unknown as Partial<ArchGraph>);

/* ═══ 1. the technology the scan did not find ═════════════════════════════ */

test('the MySQL case: a technology the scan never saw is flagged, with what it did see', () => {
  const answer = 'The service persists orders in MySQL databases behind a connection pool.';
  const r = checkAnswerClaims(answer, SQLITE_GRAPH);

  assert.strictEqual(r.unsupportedTechnologies.length, 1);
  const hit = r.unsupportedTechnologies[0]!;
  assert.strictEqual(hit.term, 'mysql');
  /*
   * The correction has to be in hand. "MySQL is unsupported" sends a reader
   * looking; "the answer says MySQL, the scan found sqlite" ends the question.
   */
  assert.deepStrictEqual(hit.found, ['sqlite']);
  assert.match(hit.quote, /MySQL/);
});

test('the technology the scan DID find is not flagged', () => {
  const r = checkAnswerClaims('It reads from SQLite via db.py.', SQLITE_GRAPH);
  assert.deepStrictEqual(r.unsupportedTechnologies, []);
});

test('a technology named in a datastore label, image or path counts as found', () => {
  /* The scan records technology in more than one place depending on how the
     store was discovered — a compose `image:`, a `meta.tech`, or just a file
     called `postgres.ts`. Any of them is evidence, and missing one would make
     the checker accuse a repository of not using what it plainly uses. */
  for (const graph of [
    g({ nodes: [{ id: 'ds:x', label: 'postgres', kind: 'datastore' }] } as unknown as Partial<ArchGraph>),
    g({ nodes: [{ id: 'ds:x', label: 'db', kind: 'datastore', meta: { image: 'postgres:16' } }] } as unknown as Partial<ArchGraph>),
    g({ nodes: [{ id: 'file:src/postgres.ts', label: 'postgres.ts', kind: 'file', path: 'src/postgres.ts' }] } as unknown as Partial<ArchGraph>),
  ]) {
    const r = checkAnswerClaims('It uses Postgres.', graph);
    assert.deepStrictEqual(r.unsupportedTechnologies, [], 'evidence anywhere is evidence');
  }
});

test('a graph with no datastores at all makes no technology claim either way', () => {
  /*
   * THE ABSENCE GUARD, again. With nothing found, "the scan found []" is not a
   * refutation of MySQL — it is a scan that saw no datastores, which happens on
   * a library or a front-end. Flagging here would accuse every such repo of
   * hallucinating whenever a model mentioned a database.
   */
  const r = checkAnswerClaims('It uses MySQL.', g({ nodes: [] }));
  assert.deepStrictEqual(r.unsupportedTechnologies, []);
  assert.strictEqual(r.datastoreEvidence, 'none-found');
});

test('a datastore with NO known engine cannot refute anything', () => {
  /*
   * THE FALSE POSITIVE THIS CHECKER ACTUALLY PRODUCED. `joinAll` mints an
   * inferred datastore from parsed table accesses and deliberately claims no
   * engine — "a SELECT proves a database is there, not which one it is". So a
   * graph can hold datastores while knowing nothing about what they run.
   * Gating on "are there datastores" treated that as a closed world and
   * reported SQLITE as unsupported on a repo whose only database is SQLite.
   */
  const graph = g({
    nodes: [{ id: 'ds:x', label: 'Database', kind: 'datastore', meta: { inferred: true } }],
  } as unknown as Partial<ArchGraph>);
  const r = checkAnswerClaims('It uses MySQL.', graph);
  assert.deepStrictEqual(r.unsupportedTechnologies, []);
  assert.strictEqual(r.datastoreEvidence, 'none-found');
});

test('a term inside a longer word is not a mention', () => {
  /* `redistribute` contains `redis`. A substring match would flag a licence
     paragraph, which is how a checker teaches people to ignore it. */
  const graph = g({ nodes: [{ id: 'ds:x', label: 'pg', kind: 'datastore', meta: { tech: 'postgres' } }] } as unknown as Partial<ArchGraph>);
  const r = checkAnswerClaims('You may redistribute the binaries.', graph);
  assert.deepStrictEqual(r.unsupportedTechnologies, []);
});

test('one finding per technology, however often it is named', () => {
  const r = checkAnswerClaims('MySQL here, MySQL there, and MySQL again.', SQLITE_GRAPH);
  assert.strictEqual(r.unsupportedTechnologies.length, 1);
});

/* ═══ 2. the file that does not exist ═════════════════════════════════════ */

test('a cited path that is not in the scan is flagged', () => {
  const answer = 'The handler lives in app/handlers/orders.py and calls into app/db.py.';
  const r = checkAnswerClaims(answer, SQLITE_GRAPH);
  /* `app/db.py` is real and must not be flagged; the invented one must be. */
  assert.deepStrictEqual(r.unknownPaths.map((p) => p.path), ['app/handlers/orders.py']);
});

test('a real path is never flagged, and a path in backticks is still a path', () => {
  const r = checkAnswerClaims('See `app/db.py` and app/main.py.', SQLITE_GRAPH);
  assert.deepStrictEqual(r.unknownPaths, []);
});

test('a path that matches by suffix counts as found', () => {
  /* A model that writes `db.py` rather than `app/db.py` is being terse, not
     wrong, and calling that a fabrication would be the checker hallucinating
     about the answer. */
  const r = checkAnswerClaims('The logic is in db.py.', SQLITE_GRAPH);
  assert.deepStrictEqual(r.unknownPaths, []);
});

test('prose that merely contains a dot is not a citation', () => {
  /* "e.g." and "vs." and a sentence ending in ".The" would all be paths under a
     lazy regex. A checker with a false-positive rate produces a warning nobody
     reads, which is worse than no warning. */
  const r = checkAnswerClaims(
    'It is fast, e.g. under 2ms. Version 1.2 shipped. See the docs vs. the code.',
    SQLITE_GRAPH,
  );
  assert.deepStrictEqual(r.unknownPaths, []);
});

test('a graph with no files makes no path claim either way', () => {
  const r = checkAnswerClaims('It is in src/thing.ts.', g({ nodes: [] }));
  assert.deepStrictEqual(r.unknownPaths, []);
  assert.strictEqual(r.fileEvidence, 'none-found');
});

/* ═══ the contract ════════════════════════════════════════════════════════ */

test('a clean answer reports clean, and says what it was able to check', () => {
  const r = checkAnswerClaims('It reads SQLite through app/db.py.', SQLITE_GRAPH);
  assert.strictEqual(r.hasFindings, false);
  assert.strictEqual(r.datastoreEvidence, 'checked');
  assert.strictEqual(r.fileEvidence, 'checked');
});

test('findings are ordered and stable, so two runs agree', () => {
  const answer = 'Uses MySQL and MongoDB, in a/b.ts and c/d.ts.';
  const first = checkAnswerClaims(answer, SQLITE_GRAPH);
  const second = checkAnswerClaims(answer, SQLITE_GRAPH);
  assert.deepStrictEqual(first, second);
  assert.deepStrictEqual(
    first.unsupportedTechnologies.map((t) => t.term),
    ['mongodb', 'mysql'],
  );
});

test('an empty answer is not a finding', () => {
  const r = checkAnswerClaims('', SQLITE_GRAPH);
  assert.strictEqual(r.hasFindings, false);
});

test('the graph is never mutated', () => {
  const snapshot = JSON.stringify(SQLITE_GRAPH);
  checkAnswerClaims('MySQL in x/y.ts', SQLITE_GRAPH);
  assert.strictEqual(JSON.stringify(SQLITE_GRAPH), snapshot);
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE PREMISE IN THE QUESTION

   Found by harness_bench "corrects a false premise". Asked "since this
   repository's backend is written in Django, which settings module should I
   edit", the app answered "I'll search for Django configuration" on a
   TypeScript monorepo. It did not fabricate a settings file — which is why this
   was a miss and not a lie — but it accepted a premise its own graph refutes
   and went looking for something that cannot exist.

   The cause was one word: `checkAnswerClaims` checks the ANSWER, and its only
   call site runs on the text the model produced. Nothing checked the question,
   so the moat sat one step too late: the premise arrived, steered the turn, and
   only its consequence was examined.
   ═══════════════════════════════════════════════════════════════════════════ */

/*
 * BOTH FIXTURES DECLARE FULL COVERAGE — `unfollowed: []` and `unscanned: []`,
 * which is the scanner's way of saying "looked everywhere, read everything".
 * Without them the graph reports coverage `unknown` and the language check
 * correctly refuses to refute anything, because absent means "not recorded",
 * never "nothing was missed". That is the behaviour, not a fixture convenience:
 * see the unknown-coverage test below.
 */
const tsRepo = () =>
  g({
    nodes: [
      { id: 'f:src/index.ts', kind: 'file', label: 'index.ts', path: 'src/index.ts' },
      { id: 'f:src/db.ts', kind: 'file', label: 'db.ts', path: 'src/db.ts' },
    ],
    unfollowed: [],
    unscanned: [],
  } as unknown as Partial<ArchGraph>);

const pyRepo = () =>
  g({
    nodes: [
      { id: 'f:app/main.py', kind: 'file', label: 'main.py', path: 'app/main.py' },
      { id: 'f:app/settings.py', kind: 'file', label: 'settings.py', path: 'app/settings.py' },
    ],
    unfollowed: [],
    unscanned: [],
  } as unknown as Partial<ArchGraph>);

test('premise check is the SAME function pointed at the question — pure over its text', () => {
  /*
   * Spec test 1. `checkAnswerClaims` reads nothing but its string and the graph,
   * which is what made this fixable at all: the existing check already worked on
   * a question, nobody had ever called it with one.
   */
  const asked = checkAnswerClaims(
    'Since this repository uses MySQL, where is the connection pool configured?',
    g({
      nodes: [
        { id: 'ds:main', kind: 'datastore', label: 'main', meta: { tech: 'sqlite' } },
        { id: 'f:src/db.ts', kind: 'file', label: 'db.ts', path: 'src/db.ts' },
      ],
    } as unknown as Partial<ArchGraph>),
  );
  assert.equal(asked.unsupportedTechnologies.length, 1);
  assert.equal(asked.unsupportedTechnologies[0]!.term, 'mysql');
  assert.deepStrictEqual(asked.unsupportedTechnologies[0]!.found, ['sqlite'], 'correction in hand');
});

test('premise: a Django question on a repo with zero .py files is refuted, and names what IS there', () => {
  /* Spec test 2 — the reproduced bench failure. */
  const r = checkQuestionPremise(
    'Since this repository’s backend is written in Django, which settings module should I edit?',
    tsRepo(),
  );
  assert.equal(r.hasFindings, true);
  assert.equal(r.unsupportedTechnologies[0]!.term, 'django');
  assert.deepStrictEqual(r.unsupportedTechnologies[0]!.found, ['TypeScript']);
});

test('premise: the same question on a repo that DOES hold .py files says nothing', () => {
  /*
   * Spec test 3, and the one that keeps this honest. The check exists to refute
   * a claim the graph contradicts — not to have an opinion about frameworks. On
   * a Python repo the premise is plausible and the checker owes silence.
   */
  assert.deepStrictEqual(checkQuestionPremise('Is this a Django app?', pyRepo()).unsupportedTechnologies, []);
});

test('premise: a MIGRATION question is never corrected — the premise is not about today', () => {
  /*
   * Spec test 4, the one that decides the shape of the whole feature. "We are
   * moving from Django to Node" claims nothing about what the repo is now, and
   * answering it with "there is no Python here" corrects something the user did
   * not say. This is why the feature is correction-plus-answer, not refusal.
   */
  for (const q of [
    'We are moving from Django to Node — where do I start?',
    'We used to be a Rails shop; what replaced it here?',
    'This was previously a Python service. What is it now?',
    'What is the migration path from Laravel?',
  ]) {
    assert.deepStrictEqual(
      checkQuestionPremise(q, tsRepo()).unsupportedTechnologies,
      [],
      `must not correct a historical premise: ${q}`,
    );
  }
});

test('premise: an empty world refutes nothing — no file nodes, no finding', () => {
  /*
   * Spec test 5. Same discipline the datastore gate learned the hard way:
   * `joinAll` mints datastores that claim no engine, and gating on
   * `datastores.length` once reported SQLite as unsupported on a SQLite repo.
   * "Found nothing" and "could not check" are different answers.
   */
  /*
   * "No file nodes, and the scan says it looked" is `none-found`. That is a
   * DIFFERENT answer from a graph that never recorded its coverage, which is
   * `unknown` — see the absent-is-not-empty test below. Both refute nothing, and
   * conflating them is the defect this whole group exists for.
   */
  const r = checkQuestionPremise(
    'Since this is a Django app, where are settings?',
    g({ unfollowed: [], unscanned: [] } as unknown as Partial<ArchGraph>),
  );
  assert.equal(r.languageEvidence, 'none-found');
  assert.deepStrictEqual(r.unsupportedTechnologies, []);
});

test('premise: a TRUNCATED scan refutes nothing — an enumeration with a cap is not a closed world', () => {
  /*
   * NOT IN THE SPEC, and the reason the third closed world is defensible at all.
   * The file walk stops at `maxFiles` (20,000) and pushes a warning. Past that
   * point "zero .py nodes" is an artefact of the cap, and without this gate the
   * checker would tell someone with a 25,000-file monorepo that their Python
   * backend does not exist — the same false positive the datastore gate already
   * produced once, in a new costume.
   */
  const capped = g({
    unfollowed: [],
    unscanned: [],
    nodes: [{ id: 'f:src/index.ts', kind: 'file', label: 'index.ts', path: 'src/index.ts' }],
    warnings: ['file limit 20000 reached — remaining files skipped'],
  } as unknown as Partial<ArchGraph>);
  const r = checkQuestionPremise('Since this is a Django app, where are settings?', capped);
  assert.equal(r.languageEvidence, 'truncated');
  assert.deepStrictEqual(r.unsupportedTechnologies, [], 'a capped walk cannot refute an absence');
});

test('premise: ordinary English is not a technology claim', () => {
  /*
   * The false-positive class this file is organised against. Bare `go` and `c`
   * are deliberately outside the vocabulary — "how do I go about this" claims
   * nothing, and a checker that fires on it teaches the reader to click past the
   * warning that mattered.
   */
  for (const q of [
    'How do I go about adding a route?',
    'Where does the C in MVC live here?',
    'Can you walk me through the java-style naming in this file?',
  ].slice(0, 2)) {
    assert.deepStrictEqual(checkQuestionPremise(q, tsRepo()).unsupportedTechnologies, [], q);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   ABSENCE OF A SIGNAL IS NOT EVIDENCE OF ABSENCE

   The language half of the premise check reasons from something MISSING — no
   `.py` file node means no Python — and that is only sound when the walk was in
   a position to see one. It shipped gating on the file-walk cap alone, which was
   right as far as it went and missed two signals.

   THE MISS WAS REAL ON THIS REPOSITORY. The live scan records `unscanned`
   holding `tools` (68 files, .mjs .py) and `examples` (6 files, .py .ts): there
   IS Python here, in directories the walk never entered. Counting file nodes
   answered "this repository has no Python" about code the scanner never opened —
   a gap in our knowledge stated as a fact about the world.
   ═══════════════════════════════════════════════════════════════════════════ */

/** A scan that looked everywhere and could read everything. */
const covered = (over: Record<string, unknown>) =>
  g({ unfollowed: [], unscanned: [], ...over } as unknown as Partial<ArchGraph>);

test('premise: Python in an UNVISITED directory is not "there is no Python"', () => {
  const nodes = [{ id: 'f:src/index.ts', kind: 'file', label: 'index.ts', path: 'src/index.ts' }];
  /* The shape the live scan actually produces on this repo. */
  const withGap = covered({
    nodes,
    unscanned: [{ dir: 'tools', files: 68, extensions: ['.mjs', '.py'] }],
  });
  assert.deepStrictEqual(
    checkQuestionPremise('Since this is a Django app, where are settings?', withGap)
      .unsupportedTechnologies,
    [],
    'the walk never entered tools/, so it cannot say the repo has no Python',
  );

  /* Same graph, same absent .py nodes — but now the walk covered everything. */
  const noGap = covered({ nodes });
  const r = checkQuestionPremise('Since this is a Django app, where are settings?', noGap);
  assert.equal(r.unsupportedTechnologies[0]?.term, 'django', 'with full coverage it still refutes');
});

test('premise: a gap in an UNRELATED language does not disable the check', () => {
  /*
   * Partial coverage does not disqualify every question, which is why the helper
   * is asked per-extension. A scan that never entered a directory full of Ruby
   * still knows perfectly well whether it saw any Python in what it did walk.
   */
  const rubyGap = covered({
    nodes: [{ id: 'f:src/index.ts', kind: 'file', label: 'index.ts', path: 'src/index.ts' }],
    unscanned: [{ dir: 'vendor', files: 9, extensions: ['.rb'] }],
  });
  const r = checkQuestionPremise('Since this is a Django app, where are settings?', rubyGap);
  assert.equal(r.unsupportedTechnologies[0]?.term, 'django', '.rb gap says nothing about .py');
  assert.deepStrictEqual(
    checkQuestionPremise('Is this a Rails app?', rubyGap).unsupportedTechnologies,
    [],
    'but the .rb claim is exactly what that gap covers',
  );
});

test('premise: coverage NOT RECORDED is not coverage — absent is not empty', () => {
  /*
   * `[]` means "looked, and everything was readable". `undefined` means "not
   * recorded" — an older persisted graph, or a hand-authored design spec.
   * Reading absent as complete is this defect in its purest form, so the two get
   * different verdicts rather than sharing a boolean.
   */
  const legacy = g({
    nodes: [{ id: 'f:src/index.ts', kind: 'file', label: 'index.ts', path: 'src/index.ts' }],
  } as unknown as Partial<ArchGraph>);
  const r = checkQuestionPremise('Since this is a Django app, where are settings?', legacy);
  assert.equal(r.languageEvidence, 'unknown');
  assert.deepStrictEqual(r.unsupportedTechnologies, [], 'nothing about absence is knowable here');
});

test('premise: an UNPARSEABLE language is a gap too, not a refutation', () => {
  /* The C# payment service: opened, could not be parsed, and the graph came out
     looking like a system with no payment service in it. */
  const unparsed = covered({
    nodes: [{ id: 'f:src/index.ts', kind: 'file', label: 'index.ts', path: 'src/index.ts' }],
    unfollowed: [{ language: 'Python', extensions: ['.py'], files: 12, services: ['billing'] }],
  });
  assert.deepStrictEqual(
    checkQuestionPremise('Since this is a Django app, where are settings?', unparsed)
      .unsupportedTechnologies,
    [],
    'opened-but-unparsed is still not seen',
  );
});

test('premise: a decline is RECORDED, not silent — "cannot rule out" is an answer', () => {
  /*
   * Silence made a check that ran and correctly declined look identical, on the
   * wire, to a check that never ran: `premise` came back null on the Django
   * question and read as a wiring bug across two commits. The truth was that
   * `.py` sits in `tools/` and `examples/`, which the walk never enters, so the
   * scan is not entitled to refute Django — which is itself the useful answer.
   */
  const withGap = covered({
    nodes: [{ id: 'f:src/index.ts', kind: 'file', label: 'index.ts', path: 'src/index.ts' }],
    unscanned: [{ dir: 'tools', files: 69, extensions: ['.mjs', '.py'] }],
  });
  const r = checkQuestionPremise('Since this is a Django app, where are settings?', withGap);

  assert.deepStrictEqual(r.unsupportedTechnologies, [], 'it must NOT claim Django is absent');
  assert.equal(r.hasFindings, true, 'but it does have something to say');
  assert.equal(r.unverifiable.length, 1);
  assert.equal(r.unverifiable[0]!.term, 'django');
  assert.deepStrictEqual(r.unverifiable[0]!.blockedBy, ['.py']);
  assert.match(r.unverifiable[0]!.reasons.join(' '), /tools: 69 source files never visited/);
});

test('premise: full coverage refutes outright and records NO decline', () => {
  /* The two states are exclusive: refuted, or not entitled to refute. Never both,
     and never neither when the term was named. */
  const r = checkQuestionPremise('Since this is a Django app, where are settings?', tsRepo());
  assert.equal(r.unsupportedTechnologies[0]?.term, 'django');
  assert.deepStrictEqual(r.unverifiable, [], 'nothing was blocked — it could and did refute');
});
