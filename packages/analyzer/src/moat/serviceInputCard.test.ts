/**
 * THE SERVICE-INPUT CARD.
 *
 * The card's whole value is that it distinguishes three sentences a careless
 * version would collapse into one:
 *
 *   "nothing reads this"          — a finding
 *   "we did not look there"       — a coverage gap
 *   "this is not ours to read"    — noise, excluded and listed
 *
 * Most of what follows checks that the second and third never get reported as
 * the first. But the first test that matters is the opposite one: a card that
 * CANNOT accuse is not a card, so `never-read` has to fire when the scan really
 * did cover the service. That is the FIRST LAW applied to a claim rather than a
 * gate — an accusation you cannot trigger proves nothing when it stays silent.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import type { ScanCoverage } from '@sequence/schema';

import type { ServiceInfo } from '../types.js';

import {
  buildServiceInputCard,
  renderServiceInputCard,
  type CardInput,
} from './serviceInputCard.js';
import { serviceInputCardForRepo } from './serviceInputCardScan.js';

const complete: ScanCoverage = {
  verdict: 'complete',
  truncated: false,
  unvisitedExtensions: new Set(),
  unparsedExtensions: new Set(),
  reasons: [],
};

const svc = (over: Partial<ServiceInfo> = {}): ServiceInfo => ({
  name: 'api',
  dir: 'services/api',
  env: { DATABASE_URL: 'postgres://x' },
  dependsOn: [],
  role: 'app',
  ...over,
});

const input = (over: Partial<CardInput> = {}): CardInput => ({
  services: [svc()],
  reads: [],
  filesScannedByService: { api: 12 },
  configLibrariesByService: { api: [] },
  languageByService: { api: 'ts' },
  coverage: complete,
  unscanned: [],
  ...over,
});

test('a covered service with no read IS accused — the card can say never', () => {
  const card = buildServiceInputCard(input());
  assert.equal(card.totals.neverRead, 1);
  assert.equal(card.totals.notScanned, 0);
  assert.equal(card.services[0].rows[0].verdict, 'never-read');
});

test('a read makes it a read, with the file and line as evidence', () => {
  const card = buildServiceInputCard(
    input({ reads: [{ service: 'api', name: 'DATABASE_URL', file: 'services/api/db.ts', line: 3 }] }),
  );
  assert.equal(card.totals.read, 1);
  assert.equal(card.totals.neverRead, 0);
  assert.deepEqual(card.services[0].rows[0].evidence, { file: 'services/api/db.ts', line: 3 });
});

// ---------------------------------------------------------------------------
// The gate: every way a "never" is really a "we did not look".
// ---------------------------------------------------------------------------

test('NOT-SCANNED, not never-read, when the service sits in a region the walk never entered', () => {
  /*
   * This is the scanner's own repository, in miniature. `sequence` does not walk
   * `tools/`, so nothing declared for something living there can be refuted —
   * only reported as uncovered. Getting this wrong is how a card accuses a
   * service of dead wiring on the strength of a directory it never opened.
   */
  const card = buildServiceInputCard(
    input({
      services: [svc({ name: 'bench', dir: 'tools' })],
      filesScannedByService: { bench: 0 },
      configLibrariesByService: { bench: [] },
      languageByService: { bench: 'ts' },
      coverage: {
        ...complete,
        verdict: 'partial',
        reasons: ['tools: 31 source files never visited'],
      },
      unscanned: [{ dir: 'tools', files: 31, extensions: ['.mjs', '.ts'] }],
    }),
  );
  const row = card.services[0].rows[0];
  assert.equal(row.verdict, 'not-scanned');
  assert.match(row.because ?? '', /tools/);
  assert.equal(card.totals.neverRead, 0, 'an unwalked directory must never produce an accusation');
  assert.deepEqual(card.coverage.unscannedDirs, ['tools']);
});

test('NOT-SCANNED when the scan never recorded its coverage at all', () => {
  const card = buildServiceInputCard(
    input({ coverage: { ...complete, verdict: 'unknown' } }),
  );
  assert.equal(card.services[0].rows[0].verdict, 'not-scanned');
  assert.equal(card.totals.neverRead, 0);
});

test('NOT-SCANNED when the file walk was truncated', () => {
  const card = buildServiceInputCard(
    input({ coverage: { ...complete, verdict: 'partial', truncated: true } }),
  );
  assert.equal(card.services[0].rows[0].verdict, 'not-scanned');
  assert.match(card.services[0].rows[0].because ?? '', /limit/);
});

test("NOT-SCANNED when the service's own language sits in a coverage gap", () => {
  /* Asked per extension on purpose: a scan that could not parse the Go files
     still knows perfectly well what its TypeScript services read. */
  const goGap: ScanCoverage = {
    ...complete,
    verdict: 'partial',
    unparsedExtensions: new Set(['.go']),
  };
  const gapped = buildServiceInputCard(
    input({ languageByService: { api: 'go' }, coverage: goGap }),
  );
  assert.equal(gapped.services[0].rows[0].verdict, 'not-scanned');

  const unaffected = buildServiceInputCard(
    input({ languageByService: { api: 'ts' }, coverage: goGap }),
  );
  assert.equal(
    unaffected.services[0].rows[0].verdict,
    'never-read',
    'a gap in Go must not silence a question about TypeScript',
  );
});

test('a service with zero parsed files is never accused', () => {
  const card = buildServiceInputCard(input({ filesScannedByService: { api: 0 } }));
  assert.equal(card.services[0].scanned, false);
  assert.equal(card.services[0].rows[0].verdict, 'not-scanned');
});

// ---------------------------------------------------------------------------
// Exclusions: applied AND listed. An exclusion nobody can see is a bug.
// ---------------------------------------------------------------------------

test('base-image keys are excluded and listed with what they matched', () => {
  const card = buildServiceInputCard(
    input({
      services: [
        svc({
          name: 'postgres',
          dir: undefined,
          image: 'postgres:16',
          role: 'datastore',
          env: { POSTGRES_DB: 'shop', POSTGRES_USER: 'app' },
        }),
      ],
      filesScannedByService: {},
      configLibrariesByService: {},
    }),
  );
  assert.equal(card.totals.excluded, 2);
  assert.equal(card.totals.neverRead, 0);
  const rule = card.exclusions.find((e) => e.rule === 'base-image');
  assert.deepEqual(rule?.matched, ['postgres.POSTGRES_DB', 'postgres.POSTGRES_USER']);
});

test('build-time public keys are excluded — the shipped source need never name them', () => {
  const card = buildServiceInputCard(
    input({ services: [svc({ env: { VITE_API_URL: 'x', NEXT_PUBLIC_URL: 'y', SECRET: 'z' } })] }),
  );
  assert.equal(card.totals.excluded, 2);
  assert.equal(card.totals.neverRead, 1, 'a non-public key beside them is still accusable');
  assert.equal(card.exclusions.find((e) => e.rule === 'spa-public-key')?.matched.length, 2);
});

test('a service reading config through a library cannot be accused', () => {
  const card = buildServiceInputCard(input({ configLibrariesByService: { api: ['dotenv'] } }));
  assert.equal(card.services[0].rows[0].verdict, 'excluded');
  assert.equal(card.totals.neverRead, 0);
  assert.match(card.exclusions[0].why, /does not name variables/);
});

// ---------------------------------------------------------------------------
// The other half: reads with no declaration.
// ---------------------------------------------------------------------------

test('an inferred or test-only read may confirm a declaration but never invent one', () => {
  /*
   * Measured on this repository: unfiltered, `Number.POSITIVE_INFINITY` and an
   * exit-code map's `EXIT.CANCELLED` were reported as environment variables a
   * deployment forgot to declare. 37 accusations became 4 when the derivation
   * was allowed to travel with the read.
   */
  const card = buildServiceInputCard(
    input({
      reads: [
        { service: 'api', name: 'POSITIVE_INFINITY', file: 'a.ts', line: 1, byConvention: true },
        { service: 'api', name: 'SEQUENCE_AI_KEY', file: 'a.test.ts', line: 2, fromTest: true },
        { service: 'api', name: 'REAL_ONE', file: 'b.ts', line: 3 },
        // The declared name, seen only through the convention: still a read.
        { service: 'api', name: 'DATABASE_URL', file: 'c.ts', line: 4, byConvention: true },
      ],
    }),
  );
  assert.deepEqual(
    (card.undeclared ?? []).map((u) => u.name),
    ['REAL_ONE'],
  );
  assert.deepEqual(card.notAccused, { byConvention: 1, fromTest: 1, osProvided: 0, weakPosition: 0 });
  assert.equal(card.services[0].rows[0].verdict, 'read', 'confirming a declared name is allowed');
});

test('the strongest evidence is the one cited', () => {
  const card = buildServiceInputCard(
    input({
      reads: [
        { service: 'api', name: 'DATABASE_URL', file: 'weak.ts', line: 1, byConvention: true },
        { service: 'api', name: 'DATABASE_URL', file: 'real.ts', line: 9 },
      ],
    }),
  );
  assert.equal(card.services[0].rows[0].evidence?.file, 'real.ts');
});

// ---------------------------------------------------------------------------
// THIRD LAW: denominators travel with the number.
// ---------------------------------------------------------------------------

test('every rendered count carries its denominator, and coverage is always stated', () => {
  const lines = renderServiceInputCard(buildServiceInputCard(input()));
  const counted = lines.filter((l) => /^(service inputs|declared, never read|not scanned|excluded as noise)/.test(l));
  assert.equal(counted.length, 4);
  for (const l of counted) assert.match(l, / of \d+/, `no denominator on: ${l}`);
  assert.ok(lines.some((l) => l.startsWith('coverage:')), 'coverage is stated whether or not anything was missed');
});

// ---------------------------------------------------------------------------
// End to end, where grep is the truth.
// ---------------------------------------------------------------------------

test('shopfront: 14 of 17 declared inputs are read, and every citation points at the read', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fixture = path.resolve(here, '..', '..', 'test', 'fixtures', 'shopfront');
  const card = await serviceInputCardForRepo(fixture);

  assert.equal(card.totals.declared, 17);
  assert.equal(card.totals.read, 14);
  assert.equal(card.totals.neverRead, 0, 'every declared app input is read — grep agrees');
  assert.equal(card.totals.notScanned, 0);
  assert.equal(card.totals.excluded, 3, "postgres's own three keys");
  assert.equal((card.undeclared ?? []).length, 0);
  assert.equal(card.coverage.verdict, 'complete');

  for (const s of card.services) {
    for (const r of s.rows) {
      if (r.verdict !== 'read') continue;
      const abs = path.join(fixture, r.evidence!.file);
      const line = fs.readFileSync(abs, 'utf8').split(/\r?\n/)[r.evidence!.line! - 1] ?? '';
      assert.ok(
        line.includes(r.name),
        `${s.service}.${r.name} cites ${r.evidence!.file}:${r.evidence!.line}, which does not contain it`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Found by running on Hoppscotch (1,124 files). Each of these produced false
// accusations there — 64 of them, every one hand-labelled against the source.
// ---------------------------------------------------------------------------

test('a config accessor naming the variable is a read', () => {
  /* `configService.get('TRUST_PROXY')` — Hoppscotch reads TRUST_PROXY and
     WHITELISTED_ORIGINS this way, and both were accused of never being read. */
  const card = buildServiceInputCard(
    input({
      services: [svc({ env: { TRUST_PROXY: 'false' } })],
      reads: [{ service: 'api', name: 'TRUST_PROXY', file: 'src/main.ts', line: 84 }],
    }),
  );
  assert.equal(card.totals.read, 1);
  assert.equal(card.totals.neverRead, 0);
});

test('toolchain variables an image bakes in are excluded, and listed', () => {
  /* Six Hoppscotch services share `build.context: .` and each inherited the Go
     toolchain's env from the Dockerfile — sixty accusations from one image. */
  const card = buildServiceInputCard(
    input({ services: [svc({ env: { GOPATH: '/go', GOBIN: '/go/bin', PATH: '/usr/bin', APP_KEY: 'x' } })] }),
  );
  assert.equal(card.totals.excluded, 3);
  assert.equal(card.totals.neverRead, 1, 'a real application input beside them is still accusable');
  assert.equal(card.exclusions.find((e) => e.rule === 'toolchain')?.matched.length, 3);
});

test('a root service in a monorepo is judged against every service’s reads', () => {
  /*
   * `excludedPrefixesFor` gives a nested app's files to the DEEPER service, so a
   * service whose build context is the repo root keeps almost none of its own
   * source. Hoppscotch's six root services were each accused of never reading
   * DATABASE_URL, which the repo reads in a directory owned by another service.
   */
  const card = buildServiceInputCard(
    input({
      services: [svc({ name: 'aio', dir: '.' }), svc({ name: 'backend', dir: 'packages/backend', env: {} })],
      filesScannedByService: { aio: 2, backend: 40 },
      configLibrariesByService: { aio: [], backend: [] },
      languageByService: { aio: 'ts', backend: 'ts' },
      reads: [
        { service: 'backend', name: 'DATABASE_URL', file: 'packages/backend/prisma.ts', line: 15 },
      ],
    }),
  );
  const root = card.services.find((s) => s.service === 'aio')!;
  assert.equal(root.rows[0].verdict, 'read');
  assert.equal(root.rows[0].evidence?.file, 'packages/backend/prisma.ts');
});

test('a root service is NOT aggregated when it is the only app', () => {
  /* The rule exists because deeper services took the files. With no deeper
     service there is nothing to have taken them, and the accusation is honest. */
  const card = buildServiceInputCard(input({ services: [svc({ dir: '.' })] }));
  assert.equal(card.services[0].rows[0].verdict, 'never-read');
});

// ---------------------------------------------------------------------------
// Repository scope: `.env.example` is how an app without compose declares.
// ---------------------------------------------------------------------------

test('repository-scope declarations are read when ANY service reads them', () => {
  const card = buildServiceInputCard(
    input({
      services: [svc({ env: {} })],
      repoDeclared: [{ name: 'DATABASE_URL', source: '.env.example' }],
      reads: [{ service: 'api', name: 'DATABASE_URL', file: 'src/db.ts', line: 3 }],
    }),
  );
  assert.equal(card.repo?.counts.read, 1);
  assert.equal(card.repo?.counts.neverRead, 0);
});

test('a repository-wide key is NOT-SCANNED when any extension went unparsed', () => {
  /*
   * Per service the gate is per extension, because a gap in Go says nothing
   * about a TypeScript service. At repository scope there is no such narrowing:
   * the key belongs to the whole app, so any unparsed file type can hide its
   * only read. Hoppscotch's `.rs` is the real case.
   */
  const card = buildServiceInputCard(
    input({
      services: [svc({ env: {} })],
      repoDeclared: [{ name: 'DATA_ENCRYPTION_KEY', source: '.env.example' }],
      coverage: { ...complete, verdict: 'partial', unparsedExtensions: new Set(['.rs']) },
    }),
  );
  assert.equal(card.repo?.rows[0].verdict, 'not-scanned');
  assert.match(card.repo?.rows[0].because ?? '', /\.rs/);
  assert.equal(card.repo?.counts.neverRead, 0);
});

test("the scanner's own repository: a repo-wide key over tools/ reads NOT SCANNED", () => {
  /*
   * THE ACCEPTANCE CASE. `sequence` does not walk `tools/`, `examples/` or
   * `docs/` — measured, not assumed: a scan of this repository reports exactly
   * those three regions. A repository-wide key could be read in any of them, so
   * the only honest verdict is that we did not look.
   */
  const card = buildServiceInputCard(
    input({
      services: [svc({ name: 'analyzer', dir: 'packages/analyzer', env: {} })],
      filesScannedByService: { analyzer: 900 },
      configLibrariesByService: { analyzer: [] },
      languageByService: { analyzer: 'ts' },
      repoDeclared: [{ name: 'SEQUENCE_AI_KEY', source: '.env.example' }],
      coverage: { ...complete, verdict: 'partial', reasons: ['tools: 31 source files never visited'] },
      unscanned: [
        { dir: 'tools', files: 31, extensions: ['.mjs'] },
        { dir: 'examples', files: 12, extensions: ['.ts'] },
        { dir: 'docs', files: 3, extensions: ['.ts'] },
      ],
    }),
  );
  assert.equal(card.repo?.rows[0].verdict, 'not-scanned');
  assert.match(card.repo?.rows[0].because ?? '', /tools/);
  assert.equal(card.repo?.counts.neverRead, 0, 'an unwalked directory must never produce an accusation');
});

test('an OS-provided variable is read, not missing a declaration', () => {
  /*
   * Measured on this repository: `web2.LOCALAPPDATA` was accused of being read
   * but never declared, from a test helper locating the Playwright browser
   * cache. The accusation is wrong — nobody declares LOCALAPPDATA, and the
   * variable has no manifest to be missing from.
   *
   * Kept separate from the toolchain rule because the claims differ: a toolchain
   * variable IS declared, by the image build, and simply is not an application
   * input; an OS variable is never declared by anyone.
   */
  const card = buildServiceInputCard(
    input({
      services: [svc({ env: { A_DECLARED_ONE: 'x' } })],
      reads: [
        { service: 'api', name: 'A_DECLARED_ONE', file: 'src/a.ts', line: 1 },
        { service: 'api', name: 'LOCALAPPDATA', file: 'e2e/chromium.mjs', line: 65 },
        { service: 'api', name: 'MY_REAL_INPUT', file: 'src/a.ts', line: 3 },
      ],
    }),
  );
  assert.deepEqual((card.undeclared ?? []).map((u) => u.name), ['MY_REAL_INPUT']);
  assert.equal(card.notAccused.osProvided, 1);
});

test('one undeclared row per NAME, not per site', () => {
  /*
   * `readIndex` is keyed by service AND name, so a variable two services read was
   * listed twice and the count said "2 undeclared" for ONE missing declaration.
   * A missing declaration is a fact about the name; every service reading it is
   * evidence for the same finding, not another one.
   */
  const card = buildServiceInputCard(
    input({
      services: [
        svc({ name: 'api', env: { A_DECLARED_ONE: 'x' } }),
        svc({ name: 'worker', dir: 'services/worker', env: {} }),
      ],
      filesScannedByService: { api: 5, worker: 5 },
      configLibrariesByService: { api: [], worker: [] },
      languageByService: { api: 'ts', worker: 'ts' },
      reads: [
        { service: 'api', name: 'SHARED_SECRET', file: 'a.ts', line: 1 },
        { service: 'worker', name: 'SHARED_SECRET', file: 'b.ts', line: 2 },
        { service: 'api', name: 'ONLY_API', file: 'c.ts', line: 3 },
      ],
    }),
  );
  assert.deepEqual((card.undeclared ?? []).map((u) => u.name).sort(), ['ONLY_API', 'SHARED_SECRET']);
  assert.equal((card.undeclared ?? []).length, 2, 'two names, not three sites');
  const shared = (card.undeclared ?? []).find((u) => u.name === 'SHARED_SECRET');
  assert.deepEqual(shared?.services, ['api', 'worker'], 'and every reader is kept — the fixer needs them');
});

test('an OS variable is excluded when DECLARED too, not only when read', () => {
  /*
   * A compose file that pins TMPDIR or USERNAME declares something the OS already
   * supplies. The undeclared path had excluded these since they were added; the
   * declared path had not, so the same variable was noise on one side of the card
   * and an accusation on the other.
   */
  const card = buildServiceInputCard(
    input({ services: [svc({ env: { TMPDIR: '/tmp', USERNAME: 'app', APP_SECRET: 'x' } })] }),
  );
  assert.equal(card.totals.excluded, 2);
  assert.equal(card.totals.neverRead, 1, 'a real application input beside them is still accusable');
  const rule = card.exclusions.find((e) => e.rule === 'os-provided');
  assert.deepEqual(rule?.matched, ['api.TMPDIR', 'api.USERNAME']);
  assert.match(rule?.why ?? '', /operating system supplies/);
});

/* ------------------------------------- the expression-position slot's contract -- */

test('a name read ONLY inside a condition counts as read, with the position as the reason', () => {
  /*
   * `if (process.env.SEQUENCE_DISABLE_ACP)` is a read. A card that called it
   * "declared, never read" would be wrong in exactly the way this lane exists to
   * prevent — and the reason is printed so a reader can disagree with it.
   */
  const card = buildServiceInputCard(
    input({
      services: [svc({ env: { FEATURE_FLAG: 'x' } })],
      reads: [
        { service: 'api', name: 'FEATURE_FLAG', file: 'src/server.ts', line: 12, position: 'condition' },
      ],
    }),
  );
  assert.equal(card.totals.read, 1);
  assert.equal(card.totals.neverRead, 0);
  assert.match(card.services[0].rows[0].because ?? '', /in a condition at src\/server\.ts:12/);
});

test('a condition-only read of an UNDECLARED name is not accused, and is counted', () => {
  /*
   * The asymmetry the design specified: such a read may CONFIRM a declared name
   * and may never INVENT one. `if (process.env.NODE_TEST_CONTEXT)` is a switch a
   * harness flips, not something an operator sets.
   */
  const card = buildServiceInputCard(
    input({
      services: [svc({ env: { A_DECLARED_ONE: 'x' } })],
      reads: [
        { service: 'api', name: 'A_DECLARED_ONE', file: 'src/a.ts', line: 1 },
        { service: 'api', name: 'NODE_TEST_CONTEXT', file: 'src/store.ts', line: 243, position: 'condition' },
        { service: 'api', name: 'REAL_INPUT', file: 'src/db.ts', line: 3, position: 'assigned' },
      ],
    }),
  );
  assert.deepEqual((card.undeclared ?? []).map((u) => u.name), ['REAL_INPUT']);
  assert.equal(card.notAccused.weakPosition, 1, 'set aside, and said so');
});

test('a strong read is cited in preference to a weak one for the same name', () => {
  const card = buildServiceInputCard(
    input({
      reads: [
        { service: 'api', name: 'DATABASE_URL', file: 'flagcheck.ts', line: 1, position: 'condition' },
        { service: 'api', name: 'DATABASE_URL', file: 'db.ts', line: 9, position: 'assigned' },
      ],
    }),
  );
  assert.equal(card.services[0].rows[0].evidence?.file, 'db.ts');
});

test('the fixture is unchanged by the slot: still 14 of 17 read, 0 never-read', async () => {
  /*
   * The slot adds recall. If it also moved the fixture's verdicts, it would be
   * changing what the card SAYS about a repository whose truth is settled by
   * grep — and that would be a regression wearing a feature's clothes.
   */
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fixture = path.resolve(here, '..', '..', 'test', 'fixtures', 'shopfront');
  const card = await serviceInputCardForRepo(fixture);
  assert.equal(card.totals.declared, 17);
  assert.equal(card.totals.read, 14);
  assert.equal(card.totals.neverRead, 0);
  assert.equal((card.undeclared ?? []).length, 0);
});

/* ------------------------------ nothing to declare against is not zero accusations -- */

test('with a declaration source, the card reports as it always did', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fixture = path.resolve(here, '..', '..', 'test', 'fixtures', 'shopfront');
  const card = await serviceInputCardForRepo(fixture);
  assert.equal(card.declarationSource.found, true);
  assert.ok(card.declarationSource.kinds.length > 0);
  assert.ok(card.undeclared !== undefined, 'the comparison is reportable');
  assert.equal(card.undeclared.length, 0);
  assert.equal(card.totals.read, 14);
});

test('THE RED CASE: with the manifest removed, the card refuses to accuse', async () => {
  /*
   * Measured on this repository: the accusation count went from 4 to 18 purely
   * because the extractor got better at finding reads. Nothing was declared
   * either time, so every read was unmatched BY CONSTRUCTION and the number said
   * nothing about the repository — while inviting someone to act on it.
   */
  const fs = await import('node:fs');
  const os = await import('node:os');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fixture = path.resolve(here, '..', '..', 'test', 'fixtures', 'shopfront');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-nodecl-'));
  try {
    fs.cpSync(fixture, tmp, { recursive: true });
    for (const leaf of fs.readdirSync(tmp)) {
      if (/^docker-compose.*\.ya?ml$/.test(leaf) || /^\.env/.test(leaf)) {
        fs.rmSync(path.join(tmp, leaf), { force: true });
      }
    }
    const card = await serviceInputCardForRepo(tmp);
    assert.equal(card.declarationSource.found, false);
    assert.equal(card.undeclared, undefined, 'the column is ABSENT, not zero and not eighteen');
    assert.ok(
      card.declarationSource.lookedFor.some((l) => /env\.example/.test(l)),
      'and the card says what it looked for, so a reader can add one',
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the rendered card says it found no source, and does not print a count', () => {
  const card = buildServiceInputCard(input({ services: [svc({ env: {} })] }));
  const lines = renderServiceInputCard(card).join('\n');
  assert.match(lines, /no declaration source found in this repository/);
  assert.match(lines, /looked for:/);
  assert.match(lines, /n\/a — nothing declares anything here/);
});

test('a manifest listing only images declares nothing', () => {
  /* A compose file with services but no environment: block is not a declaration
     source — there is still nothing on the left-hand side. */
  const card = buildServiceInputCard(
    input({
      services: [svc({ name: 'redis', dir: undefined, image: 'redis:7', role: 'broker', env: {} })],
      filesScannedByService: {},
      configLibrariesByService: {},
    }),
  );
  assert.equal(card.declarationSource.found, false);
});
