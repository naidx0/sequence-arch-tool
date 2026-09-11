import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE REACHABILITY TRIPWIRE — a declared action that nothing dispatches
 * tools/ci/reachability.test.mjs
 *
 * This repository's documented dominant failure mode is BUILT BUT NOT REACHED:
 * complete, tested, correct code that no code path calls. It is not a
 * hypothetical and it is not rare — the competitive-gaps register had to be
 * rewritten after an audit because rank after rank was "a reducer arm and no
 * dispatcher", "three finished panels with no chrome", "a decision layer that
 * is complete, correct and tested with zero production callers".
 *
 * Every one of those had passing tests. That is the point: the tests exercised
 * the pieces on either side of the seam rather than the seam.
 *
 * ── WHAT THIS CHECKS, AND WHY THAT SHAPE ─────────────────────────────────
 *
 * One mechanical instance of the failure, chosen because it is exact rather
 * than heuristic: an action declared as a member of a reducer's discriminated
 * union, handled by a `case`, and never constructed anywhere in production
 * source. A store action is the ONLY way state changes in web2 — the canvas
 * reducer's own header says so ("the host dispatches and never poked a
 * setter") — so an action nobody constructs is a state transition the product
 * cannot perform.
 *
 * Colon-delimited ask-stream events are in scope too. They are a declared wire
 * contract crossing api-types -> analyzer producer -> web2 consumer; losing
 * either end is the same built-but-not-reached failure across a package seam.
 *
 * It catches the real ones. Run against the tree the day it was written it
 * found ten, including `canvas/proposal` — the whole "an agent proposes
 * architecture, you Accept or Deny it" feature, fourteen tests, unreachable.
 * Historically it would also have caught `session/hydrated` (the transcript
 * never came back after a reload) and `rail/reveal` (the rail never followed
 * the board), both of which shipped marked DONE.
 *
 * ── A RATCHET, NOT A MUTE ────────────────────────────────────────────────
 *
 * Ten pre-existing orphans would make a plain gate red on day one, and a gate
 * that is red on day one is a gate people learn to skip. So the accepted set
 * lives in `reachability-baseline.json` WITH A REASON PER ENTRY, and this file
 * fails in both directions:
 *
 *   • an orphan that is not in the baseline      → a new dead action
 *   • a baseline entry that is no longer orphaned → wired; delete the row
 *
 * The second direction is the half that usually gets left out, and it is the
 * half that keeps the baseline from becoming a graveyard nobody prunes. It is
 * the same shape as `sequence policy --baseline`, deliberately.
 *
 * Accepted entries are PRINTED on every run. A suppression nobody sees is a
 * suppression nobody revisits.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const SRC = path.join(ROOT, 'packages', 'web2', 'src');
const ASK_EVENT_CONTRACT = path.join(ROOT, 'packages', 'api-types', 'src', 'ask.ts');
const ASK_EVENT_PRODUCERS = [
  path.join(ROOT, 'packages', 'analyzer', 'src', 'server', 'askPipeline.ts'),
  path.join(ROOT, 'packages', 'analyzer', 'src', 'server', 'askTools.ts'),
  path.join(ROOT, 'packages', 'analyzer', 'src', 'server', 'repoServer.ts'),
];
const ASK_EVENT_CONSUMER = path.join(SRC, 'state', 'store.ts');
const BASELINE = path.join(here, 'reachability-baseline.json');

/** Every `.ts`/`.tsx` under web2's source. */
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Test material is not production source.
 *
 * A test dispatching an action proves the reducer works and proves nothing
 * about whether a person can get there — which is the entire distinction this
 * file exists to draw. Specimens, previews and fixtures are excluded for the
 * same reason: they are how a surface is looked at, not how it is reached.
 */
const isTestMaterial = (rel) =>
  /\.test\.tsx?$/.test(rel) || /(^|\/)(fixtures|specimen|preview)\.[a-z]+$/.test(rel);

/**
 * Give the small regex scanners a lexical view, not raw prose.
 *
 * Comments become whitespace (newlines and offsets stay intact), and `code`
 * marks which characters are outside comments and string bodies. The opening
 * quote remains code so a real `type: 'x'` or `fetch('/api/x')` literal is
 * visible; a lookalike embedded inside quoted prose is not. This is deliberately
 * a three-state lexer, not a TypeScript parser: the monitored constructs all
 * begin in code and their values are themselves string literals.
 */
function lexicalView(source) {
  const normalized = source.split('\r\n').join('\n');
  const text = [...normalized];
  const code = new Uint8Array(text.length);
  let state = 'code';
  let quote = '';

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (state === 'line-comment') {
      if (char === '\n') state = 'code';
      else text[i] = ' ';
      continue;
    }
    if (state === 'block-comment') {
      if (char === '*' && next === '/') {
        text[i] = ' ';
        text[i + 1] = ' ';
        i += 1;
        state = 'code';
      } else if (char !== '\n') {
        text[i] = ' ';
      }
      continue;
    }
    if (state === 'string') {
      if (char === '\\') {
        i += 1;
        continue;
      }
      if (char === quote) {
        state = 'code';
        quote = '';
      }
      continue;
    }

    if (char === '/' && next === '/') {
      text[i] = ' ';
      text[i + 1] = ' ';
      i += 1;
      state = 'line-comment';
      continue;
    }
    if (char === '/' && next === '*') {
      text[i] = ' ';
      text[i + 1] = ' ';
      i += 1;
      state = 'block-comment';
      continue;
    }

    code[i] = 1;
    if (char === "'" || char === '"' || char === '`') {
      state = 'string';
      quote = char;
    }
  }

  return { text: text.join(''), code };
}

function matchesInCode(view, pattern) {
  return [...view.text.matchAll(pattern)].filter((match) => view.code[match.index ?? 0]);
}
/*
 * THE LEXER'S OWN TESTS.
 *
 * Everything below this line depends on `lexicalView` telling code from commentary. Three separate
 * agents defeated an earlier version of this gate by writing `// type: 'canvas/zoom-at'` in a
 * comment: the scanner saw a construction, the baseline row could be retired, and the feature was
 * still unreachable. The lexer was then written to close that, and for a while nothing checked it.
 *
 * A mutation that stopped the lexer stripping line comments left this whole file green, because no
 * source in the tree happens to contain a commented-out action. The gate that guards reachability
 * was itself unguarded. These tests are the guard.
 */
describe('the lexical view', () => {
  const CONSTRUCTION = /type:\s*'([a-z][a-zA-Z]*\/[a-z-]+)'/g;
  const found = (source) => matchesInCode(lexicalView(source), CONSTRUCTION).map((m) => m[1]);

  it('sees a real construction', () => {
    assert.deepEqual(found("dispatch({ type: 'canvas/zoom-at', at });"), ['canvas/zoom-at']);
  });

  it('does not see a construction that is commented out with //', () => {
    assert.deepEqual(found("// dispatch({ type: 'canvas/zoom-at' });"), []);
  });

  it('does not see a construction inside a block comment', () => {
    assert.deepEqual(found("/* was: type: 'canvas/zoom-at' */\nconst x = 1;"), []);
  });

  it('does not see a construction quoted inside prose', () => {
    assert.deepEqual(found('const help = "press Z for type: ' + "'canvas/zoom-at'" + '";'), []);
  });

  it('keeps the code that follows a comment on the same line', () => {
    assert.deepEqual(
      found("/* off: type: 'canvas/gone' */ dispatch({ type: 'canvas/zoom-at' });"),
      ['canvas/zoom-at'],
    );
  });

  it('does not let an escaped quote end a string early', () => {
    // A string containing \" must stay a string, or everything after it is misread as code and a
    // construction inside prose becomes visible again.
    const bs = String.fromCharCode(92);
    const source = 'const s = "he said ' + bs + '"type: ' + "'canvas/zoom-at'" + bs + '"";';
    assert.deepEqual(found(source), []);
  });

  it('leaves line and column positions intact so offsets stay comparable', () => {
    // Comments are blanked in place rather than removed; a shorter view would shift every later
    // index and the declaration-vs-construction comparison is index-based.
    const source = "// hidden\nconst x = 1;";
    assert.equal(lexicalView(source).text.length, source.length);
  });
});


function sourceFiles(root) {
  return walk(root).map((file) => ({
    rel: path.relative(root, file).split(path.sep).join('/'),
    text: fs.readFileSync(file, 'utf8').split('\r\n').join('\n'),
  }));
}

/* CRLF ON READ — core.autocrlf=true here, and every pattern below is written
   against \n. This repository's own trap list names it. */
const files = sourceFiles(SRC);

const production = files.filter((f) => !isTestMaterial(f.rel));

const STORE_ACTION_ID = '[a-z][a-zA-Z]*\\/[a-z-]+';
const STREAM_EVENT_ID = '[a-z][a-z-]*(?::[a-z-]+)?';

function scannerPatterns(identity) {
  return {
    /** `| { type: 'a/b'` — a discriminated union member. */
    declaration: new RegExp(`\\|\\s*\\{\\s*type:\\s*'(${identity})'`, 'g'),
    /** `type: 'a/b'` anywhere — a construction, unless it IS the declaration. */
    construction: new RegExp(`type:\\s*'(${identity})'`, 'g'),
    /** `case 'a/b'` — the reducer/consumer arm that handles it. */
    caseArm: new RegExp(`case\\s+'(${identity})'`, 'g'),
  };
}

const STORE_PATTERNS = scannerPatterns(STORE_ACTION_ID);
const STREAM_PATTERNS = scannerPatterns(STREAM_EVENT_ID);

function scan(sourceFiles = production, patterns = STORE_PATTERNS) {
  const declared = new Map();
  const constructed = new Map();
  const handled = new Set();

  for (const file of sourceFiles) {
    const view = lexicalView(file.text);
    const declarationStarts = new Set();
    for (const m of matchesInCode(view, patterns.declaration)) {
      if (!declared.has(m[1])) declared.set(m[1], file.rel);
      declarationStarts.add((m.index ?? 0) + m[0].lastIndexOf('type:'));
    }
    for (const m of matchesInCode(view, patterns.caseArm)) handled.add(m[1]);
    for (const m of matchesInCode(view, patterns.construction)) {
      /* Compare exact offsets instead of a 40-character look-behind. A comment
         may legally sit between the union brace and its discriminant. */
      if (declarationStarts.has(m.index ?? 0)) continue;
      if (!constructed.has(m[1])) constructed.set(m[1], new Set());
      constructed.get(m[1]).add(file.rel);
    }
  }

  const orphans = [];
  for (const [action, declaredIn] of declared) {
    if ((constructed.get(action) ?? new Set()).size === 0) {
      orphans.push({ action, declaredIn, handled: handled.has(action) });
    }
  }
  orphans.sort((a, b) => a.action.localeCompare(b.action));
  return { declared, constructed, handled, orphans };
}

const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
const accepted = new Map(baseline.accepted.map((entry) => [entry.action, entry]));

function assertExactVocabulary(actual, expected, label) {
  const actualNames = [...actual].sort();
  assert.ok(
    Array.isArray(expected),
    `reachability-baseline.json must anchor the exact ${label} by name. Current scan:\n` +
      JSON.stringify(actualNames, null, 2),
  );
  const sortedExpected = [...new Set(expected)].sort();
  assert.deepEqual(expected, sortedExpected, `${label} inventory must be sorted and contain no duplicates`);

  const actualSet = new Set(actualNames);
  const expectedSet = new Set(expected);
  const missing = expected.filter((name) => !actualSet.has(name));
  const unexpected = actualNames.filter((name) => !expectedSet.has(name));
  assert.deepEqual(
    { missing, unexpected },
    { missing: [], unexpected: [] },
    `${label} changed. Update the named inventory only for a deliberate contract change; ` +
      'a missing name means the scanner may have partially died.',
  );
}

describe('reachability — a declared action nothing dispatches', () => {
  const { declared, orphans } = scan();

  it('COMMENT ATTACK — comments and quoted prose cannot construct an action', () => {
    const synthetic = [
      { rel: 'reducer.ts', text: "export type Action =\n  | { type: 'demo/action' };\ncase 'demo/action':" },
      {
        rel: 'decoys.ts',
        text:
          "// type: 'demo/action'\n" +
          "/* type: 'demo/action' */\n" +
          'const note = "type: \'demo/action\'";\n',
      },
    ];

    assert.deepEqual(scan(synthetic).orphans.map((entry) => entry.action), ['demo/action']);
  });

  it('STREAM ATTACK — a colon-delimited stream event is monitored', () => {
    const synthetic = [
      {
        rel: 'contract.ts',
        text: "export type Event =\n  | { type: 'topology:proposal' };\ncase 'topology:proposal':",
      },
    ];

    assert.deepEqual(scan(synthetic, STREAM_PATTERNS).orphans.map((entry) => entry.action), [
      'topology:proposal',
    ]);
  });

  it('SHRINK ATTACK — the exact action vocabulary is checked in by name', () => {
    assertExactVocabulary(declared.keys(), baseline.vocabulary?.actions, 'action vocabulary');
  });

  it('a generic-union refactor hiding five actions is rejected by name', () => {
    const hidden = [
      'doc/add-edge',
      'doc/add-node',
      'doc/delete-edge',
      'doc/delete-node',
      'doc/rename-node',
    ];
    const attacked = [...declared.keys()].filter((name) => !hidden.includes(name));
    assert.throws(
      () => assertExactVocabulary(attacked, baseline.vocabulary.actions, 'action vocabulary'),
      (error) => {
        assert.deepEqual(error.actual, { missing: hidden, unexpected: [] });
        return true;
      },
    );
  });

  it('NO NEW DEAD ACTION — every orphan is accepted, with a reason', () => {
    const unexplained = orphans.filter((o) => !accepted.has(o.action));
    if (unexplained.length > 0) {
      const lines = unexplained.map(
        (o) => `  ${o.action}  (declared in ${o.declaredIn}${o.handled ? ', handled by a case' : ''})`,
      );
      assert.fail(
        'These actions are declared, handled, and constructed by NOTHING in production source.\n' +
          'That is a state transition the product cannot perform — the BUILT BUT NOT REACHED\n' +
          'failure, caught before it ships.\n\n' +
          lines.join('\n') +
          '\n\nEither wire it to a real user gesture, delete it, or add it to\n' +
          'tools/ci/reachability-baseline.json WITH THE REASON it is tolerated.',
      );
    }
  });

  it('NO STALE SUPPRESSION — a baseline entry that got wired must be deleted', () => {
    /*
     * The half that is usually left out, and the half that stops the baseline
     * becoming a graveyard. An entry that no longer fires is a row somebody
     * should remove, and saying so is cheap here and free nowhere else.
     */
    const stillOrphaned = new Set(orphans.map((o) => o.action));
    const wired = [...accepted.keys()].filter((action) => !stillOrphaned.has(action));
    assert.deepEqual(
      wired,
      [],
      `these baseline entries are now dispatched — delete their rows from ` +
        `tools/ci/reachability-baseline.json: ${wired.join(', ')}`,
    );
  });

  it('every accepted entry actually carries a reason', () => {
    /* A baseline row with an empty reason is a mute wearing a ratchet's name. */
    for (const entry of baseline.accepted) {
      assert.ok(
        typeof entry.reason === 'string' && entry.reason.trim().length > 40,
        `${entry.action} is suppressed without a real reason`,
      );
    }
  });

  it('prints what is being tolerated, so nobody has to go looking', () => {
    /* Not an assertion — a report. A suppression nobody sees is a suppression
       nobody revisits. */
    console.log(`\n  reachability: ${declared.size} actions declared, ${orphans.length} unreached`);
    for (const o of orphans) {
      const reason = accepted.get(o.action)?.reason ?? '';
      const first = reason.split('. ')[0];
      console.log(`    ${o.action.padEnd(22)} ${first.slice(0, 96)}`);
    }
    console.log('');
    assert.ok(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   THE SECOND ARM — a route the client never asks for
   ══════════════════════════════════════════════════════════════════════════

   The same failure one layer out. `GET /api/search` is the standing example:
   correct, security-gated, jailed to the same choke point as `GET /api/file`
   so a search cannot become a wider door — and no client fetches it, because
   the results surface it was built for was never written.

   AN UNREFERENCED ROUTE IS NOT AUTOMATICALLY A DEFECT, and that is why the
   baseline carries a VERDICT and not just a reason. This repository ships a
   CLI, an MCP server, an ACP lane and an Electron shell; a route serving one of
   those is working exactly as intended. The four verdicts are:

     GAP        it exists for a web surface nobody built    (22 today)
     DEAD       nothing anywhere calls it                   (9)
     BY DESIGN  a non-web consumer really uses it           (4)
     PREFIX     an authorization guard, not a handler       (4)

   Twenty-two of seventy served routes are GAP. That is the honest measure of
   how far the engine is ahead of the surfaces, and it is why this arm reports
   the counts on every run rather than only failing.

   Classified by an independent read (gpt-5.6-sol at xhigh, read-only) whose
   brief was to REFUTE the assumption that they are all defects, then checked
   against the tree.
   ══════════════════════════════════════════════════════════════════════════ */

const SERVER = path.join(ROOT, 'packages', 'analyzer', 'src', 'server', 'repoServer.ts');

/** `pathname === '/api/x'` and `pathname.startsWith('/api/x/')`, with kind retained. */
function servedRoutes(source = fs.readFileSync(SERVER, 'utf8').split('\r\n').join('\n')) {
  const view = lexicalView(source);
  const out = new Map();
  const add = (route, kind) => {
    if (!out.has(route)) out.set(route, new Set());
    out.get(route).add(kind);
  };
  for (const m of matchesInCode(view, /pathname\s*===\s*'(\/api\/[a-zA-Z0-9\-_/]*)'/g)) {
    add(m[1], 'exact');
  }
  for (const m of matchesInCode(view, /pathname\.startsWith\('(\/api\/[a-zA-Z0-9\-_/]*)'\)/g)) {
    add(m[1], 'prefix');
  }
  return out;
}

/** Every `/api/...` the client mentions, literal or as a template head. */
function clientRoutes(sourceFiles = production) {
  const out = new Set();
  for (const file of sourceFiles) {
    const view = lexicalView(file.text);
    for (const m of matchesInCode(view, /['"`](\/api\/[a-zA-Z0-9\-_/]*)/g)) out.add(m[1]);
  }
  return out;
}

function reachesRoute(route, kinds, referenced) {
  if (referenced.has(route)) return true;
  if (!kinds.has('prefix')) return false;
  const segmentPrefix = route.endsWith('/') ? route : `${route}/`;
  return [...referenced].some((reference) => reference.startsWith(segmentPrefix));
}

function servedVocabulary(served) {
  return [...served].flatMap(([route, kinds]) => [...kinds].map((kind) => `${kind} ${route}`));
}

describe('reachability — a served route the client never asks for', () => {
  const served = servedRoutes();
  const referenced = clientRoutes();
  /* A reference to a longer path counts as reaching the prefix it extends —
     `/api/program/runs/:id` reaches `/api/program/runs/`. */
  const unreferenced = [...served]
    .filter(([route, kinds]) => !reachesRoute(route, kinds, referenced))
    .map(([route]) => route)
    .sort();
  const accepted = new Map((baseline.routes ?? []).map((entry) => [entry.route, entry]));

  it('COMMENT ATTACK — a route named only in comments stays unreached', () => {
    const syntheticServed = servedRoutes("if (pathname === '/api/search') {}\n");
    const syntheticReferenced = clientRoutes([
      {
        rel: 'ConnectedSearch.tsx',
        text: "// fetch('/api/search')\n/* request('/api/search') */\n",
      },
    ]);
    const syntheticUnreached = [...syntheticServed]
      .filter(([route, kinds]) => !reachesRoute(route, kinds, syntheticReferenced))
      .map(([route]) => route);

    assert.deepEqual(syntheticUnreached, ['/api/search']);
  });

  it('SEGMENT ATTACK — sibling and child routes do not reach exact routes', () => {
    assert.deepEqual(
      {
        sibling: reachesRoute('/api/program/run', new Set(['exact']), new Set(['/api/program/runs'])),
        child: reachesRoute('/api/ask', new Set(['exact']), new Set(['/api/ask/stream'])),
      },
      { sibling: false, child: false },
    );
    assert.equal(
      reachesRoute(
        '/api/program/runs/',
        new Set(['prefix']),
        new Set(['/api/program/runs/real-run-id']),
      ),
      true,
    );
  });

  it('SHRINK ATTACK — the exact served-route vocabulary is checked in by name', () => {
    assertExactVocabulary(servedVocabulary(served), baseline.vocabulary?.routes, 'served-route vocabulary');
  });

  it('a routeIs refactor hiding one served route is rejected by name', () => {
    const attacked = servedVocabulary(served).filter((route) => route !== 'exact /api/board');
    assert.throws(
      () => assertExactVocabulary(attacked, baseline.vocabulary.routes, 'served-route vocabulary'),
      (error) => {
        assert.deepEqual(error.actual, { missing: ['exact /api/board'], unexpected: [] });
        return true;
      },
    );
  });

  it('found the client reference surface at all', () => {
    /* Server anti-vacuity is the exact named vocabulary above. Keep a separate
       guard for the independent client-literal scanner. */
    assert.ok(referenced.size > 10, `only ${referenced.size} client references found`);
  });

  it('NO NEW UNREACHED ROUTE — every one is classified, with a reason', () => {
    const unexplained = unreferenced.filter((r) => !accepted.has(r));
    assert.deepEqual(
      unexplained,
      [],
      'These routes are served and the web client never asks for them. Either build the ' +
        'surface, delete the route, or classify it in tools/ci/reachability-baseline.json ' +
        'with a verdict (GAP / DEAD / BY DESIGN / PREFIX) and the reason.',
    );
  });

  it('NO STALE ROUTE SUPPRESSION — one the client now fetches must be deleted', () => {
    const stillUnreferenced = new Set(unreferenced);
    const nowFetched = [...accepted.keys()].filter((r) => !stillUnreferenced.has(r));
    assert.deepEqual(
      nowFetched,
      [],
      `the client now fetches these — delete their rows from the baseline: ${nowFetched.join(', ')}`,
    );
  });

  it('every classified route carries a verdict and a real reason', () => {
    for (const entry of baseline.routes ?? []) {
      assert.ok(
        ['GAP', 'DEAD', 'BY DESIGN', 'PREFIX'].includes(entry.verdict),
        `${entry.route} has no valid verdict`,
      );
      assert.ok(
        typeof entry.reason === 'string' && entry.reason.trim().length > 30,
        `${entry.route} is classified without a real reason`,
      );
    }
  });

  it('prints how far the engine is ahead of the surfaces', () => {
    const by = (v) => (baseline.routes ?? []).filter((r) => r.verdict === v).length;
    console.log(
      `\n  routes: ${served.size} served, ${unreferenced.length} unreferenced by web2 ` +
        `(${by('GAP')} gap · ${by('DEAD')} dead · ${by('BY DESIGN')} by design · ${by('PREFIX')} prefix)`,
    );
    for (const entry of (baseline.routes ?? []).filter((r) => r.verdict === 'GAP')) {
      console.log(`    GAP  ${entry.route}`);
    }
    console.log('');
    assert.ok(true);
  });
});

/* Ask-stream events cross three packages: api-types declares the wire contract,
   analyzer produces it, and web2 consumes it. They belong here because losing
   either end leaves a declared, tested feature unreachable while both packages
   can remain locally green. Unlike store-action orphans, there is no accepted
   dead set: every public stream event must be both produced and consumed. */
const askContractSource = fs.readFileSync(ASK_EVENT_CONTRACT, 'utf8').split('\r\n').join('\n');
const askContractStart = askContractSource.indexOf('export type AskStreamEvent =');
const askContractEnd = askContractSource.indexOf('\nexport ', askContractStart + 1);
assert.notEqual(askContractStart, -1, 'AskStreamEvent contract not found');
assert.notEqual(askContractEnd, -1, 'end of AskStreamEvent contract not found');
const askEventContract = [
  {
    rel: 'api-types/src/ask.ts#AskStreamEvent',
    text: askContractSource.slice(askContractStart, askContractEnd),
  },
];
const askEventProducers = ASK_EVENT_PRODUCERS.map((file) => ({
  rel: path.relative(ROOT, file).split(path.sep).join('/'),
  text: fs.readFileSync(file, 'utf8').split('\r\n').join('\n'),
}));
const askEventConsumers = [
  {
    rel: 'web2/src/state/store.ts',
    text: fs.readFileSync(ASK_EVENT_CONSUMER, 'utf8').split('\r\n').join('\n'),
  },
];

function scanStreamEvents(
  contractFiles = askEventContract,
  producerFiles = askEventProducers,
  consumerFiles = askEventConsumers,
) {
  const contract = scan(contractFiles, STREAM_PATTERNS);
  const producers = scan(producerFiles, STREAM_PATTERNS);
  const consumers = scan(consumerFiles, STREAM_PATTERNS);
  const events = [...contract.declared.keys()].sort();
  return {
    events,
    unproduced: events.filter((name) => !producers.constructed.has(name)),
    unconsumed: events.filter((name) => !consumers.handled.has(name)),
  };
}

describe('reachability — an ask-stream event crosses its package seams', () => {
  const { events, unproduced, unconsumed } = scanStreamEvents();

  it('STREAM ATTACK — every declared event is produced and consumed', () => {
    assert.deepEqual(
      { unproduced, unconsumed },
      { unproduced: [], unconsumed: [] },
      'An ask-stream contract member has lost its analyzer producer or web2 consumer.',
    );
  });

  it('SHRINK ATTACK — the exact stream-event vocabulary is checked in by name', () => {
    assertExactVocabulary(events, baseline.vocabulary?.streamEvents, 'stream-event vocabulary');
  });

  it('producer deletion is rejected by the same scanner used on the tree', () => {
    const contract = [{ rel: 'contract.ts', text: "type Event = | { type: 'topology:proposal' };" }];
    const consumers = [{ rel: 'consumer.ts', text: "case 'topology:proposal':" }];
    const attacked = scanStreamEvents(contract, [], consumers);
    assert.deepEqual(attacked.unproduced, ['topology:proposal']);
  });
});
