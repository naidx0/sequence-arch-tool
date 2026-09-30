/**
 * `new X(...)` IS A CALL — and the env read inside it is evidence.
 *
 * Both halves of this were invisible until 2026-09-04, and each hid the other:
 *
 *   1. `extractCallJs` read only the `function` field, which a new_expression
 *      does not have (it uses `constructor`), and the walker never dispatched
 *      new_expression anyway — so `new Pool({...})` produced NO call fact.
 *   2. `evalJs` had no `object` case, so a NESTED object literal evaluated to a
 *      bare hole — hiding `headers: { authorization: `Bearer ${process.env.X}` }`
 *      one level below an argument that was already read correctly.
 *
 * Measured on the shopfront fixture, fixing either one alone still left 13 of
 * 14 declared service inputs observed; both together give 14 of 14 with zero
 * reads that no declaration covers. The first fix also added the one edge the
 * shopfront graph was missing — `payments -> postgres [db_access]`, which every
 * other service in that fixture already had, because payments is the only one
 * whose connection is constructed with `new`.
 *
 * These tests fail on the pre-fix extractor. That is the point of them.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { Lang } from '../types.js';
import { extractFacts } from '../parse/facts.js';
import { initParser } from '../parse/treesitter.js';

const envNames = (src: string, lang: Lang = 'ts', file = 'x.ts'): string[] => {
  const ff = extractFacts(src, file, lang);
  const out: string[] = [];
  for (const [, parts] of ff.assignments) for (const p of parts ?? []) if (p.t === 'env') out.push(p.name);
  for (const c of ff.calls ?? []) {
    for (const a of c.args ?? []) for (const p of a ?? []) if (p.t === 'env') out.push(p.name);
    for (const k of Object.keys(c.kwargs ?? {}))
      for (const p of c.kwargs[k] ?? []) if (p.t === 'env') out.push(p.name);
  }
  return out;
};

test('new_expression is collected as a call, keeping its `new ` prefix', async () => {
  await initParser();
  const ff = extractFacts('const pool = new Pool({ connectionString: process.env.DATABASE_URL });', 'db.js', 'ts');
  const call = ff.calls.find((c) => c.callee === 'new Pool');
  assert.ok(call, `expected a "new Pool" call fact, got: ${JSON.stringify(ff.calls.map((c) => c.callee))}`);
  // The prefix is not decoration: a bare `Pool` would be indistinguishable from
  // invoking a function named Pool, and these are different facts.
  assert.deepEqual(call.kwargs.connectionString, [{ t: 'env', name: 'DATABASE_URL' }]);
  assert.equal(call.line, 1);
});

test('an env read inside a NESTED object literal is a fact, not a hole', async () => {
  await initParser();
  const src = "fetch('https://api.stripe.com/v1/charges', {\n  headers: { authorization: `Bearer ${process.env.STRIPE_KEY}` },\n});";
  assert.deepEqual(envNames(src), ['STRIPE_KEY']);
});

test('an object literal with no env read still evaluates to a hole', async () => {
  await initParser();
  // The Part stream is reassembled into strings by the URL and host detectors.
  // An object must not start contributing its literals to a reconstructed URL
  // that never existed in the source.
  const ff = extractFacts("f({ path: '/orders', port: 8080 });", 'x.ts', 'ts');
  const call = ff.calls.find((c) => c.callee === 'f');
  assert.ok(call);
  assert.deepEqual(call.args[0], [{ t: 'hole' }]);
});

test('constructed clients across languages: Go struct literal and JS new both carry the env read', async () => {
  await initParser();
  assert.deepEqual(
    envNames('c := redis.NewClient(&redis.Options{Addr: os.Getenv("REDIS_ADDR")})', 'go', 'x.go'),
    ['REDIS_ADDR'],
  );
  assert.deepEqual(envNames('const r = new Redis(process.env.REDIS_URL);'), ['REDIS_URL']);
});

test('an env read in a ternary CONDITION survives', async () => {
  await initParser();
  /*
   * Hoppscotch: `envPrefix: process.env.HOPP_ALLOW_RUNTIME_ENV ? 'VITE_BUILDTIME_' : 'VITE_'`
   * in two vite configs. The read is the condition, and it was discarded with
   * the branches — six services accused of never reading a variable read on
   * line 24 of a file the scan had already parsed.
   */
  // Verbatim shape from packages/hoppscotch-selfhost-web/vite.config.ts:22-23.
  // The first draft of this test used a bare `export default { ... }`, which is
  // neither an assignment nor a call and so carries no facts at all — the test
  // was wrong, not the extractor. Mirror the source, not a convenient shape.
  const viteConfig = [
    'export default defineConfig({',
    "  envPrefix: process.env.HOPP_ALLOW_RUNTIME_ENV ? 'VITE_BUILDTIME_' : 'VITE_',",
    '});',
  ].join('\n');
  assert.deepEqual(envNames(viteConfig), ['HOPP_ALLOW_RUNTIME_ENV']);
});

test('a ternary with no env read is still a hole, not a joined string', async () => {
  await initParser();
  // It evaluates to ONE branch; handing both to the URL detectors would
  // reconstruct a string that never existed in the source.
  const ff = extractFacts("f(cond ? '/a' : '/b');", 'x.ts', 'ts');
  assert.deepEqual(ff.calls.find((c) => c.callee === 'f')?.args[0], [{ t: 'hole' }]);
});

/* ------------------------------------------------ destructuring from env -- */

test('a destructured env read survives a default and a rename', async () => {
  await initParser();
  /*
   * THE PLANTED CASES, red before this. Only the bare shorthand was read, so the
   * two idioms that appear whenever a variable is optional or its name is ugly
   * produced no fact at all:
   *
   *   const { PORT = '3000' } = process.env       // a default
   *   const { DATABASE_URL: dsn } = process.env   // renamed
   *
   * The research lane measured the consequence: on this repository the fact pass
   * saw 3 of 37 env names, and the operand forms were the gap.
   */
  assert.deepEqual(envNames("const { PORT = '3000' } = process.env;"), ['PORT']);
  assert.deepEqual(envNames('const { DATABASE_URL: dsn } = process.env;'), ['DATABASE_URL']);
  assert.deepEqual(envNames("const { DATABASE_URL: dsn = 'x' } = process.env;"), ['DATABASE_URL']);
  assert.deepEqual(envNames("const { A_ONE, B_TWO = '2', C_THREE: c } = process.env;"), [
    'A_ONE',
    'B_TWO',
    'C_THREE',
  ]);
});

test('a renamed destructure records the ENV name, never the local one', async () => {
  await initParser();
  /* `{ DATABASE_URL: dsn }` binds `dsn` locally and reads DATABASE_URL. Recording
     `dsn` would name a variable no manifest declares — an invented input. */
  const ff = extractFacts('const { DATABASE_URL: dsn } = process.env;', 'x.ts', 'ts');
  const parts = ff.assignments.get('dsn');
  assert.ok(parts, 'the LOCAL name is what the file later refers to');
  assert.deepEqual(parts, [{ t: 'env', name: 'DATABASE_URL' }]);
  assert.equal(ff.assignments.get('DATABASE_URL'), undefined);
});

test('a default is kept as the fallback, the same field `x || y` fills', async () => {
  await initParser();
  const ff = extractFacts("const { PORT = '3000' } = process.env;", 'x.ts', 'ts');
  const parts = ff.assignments.get('PORT');
  assert.equal(parts?.[0].t, 'env');
  assert.ok(
    (parts?.[0] as { fallback?: unknown }).fallback !== undefined,
    'a variable with a default is one the app runs without — the card wants to say so',
  );
});

test('a lowercase or two-letter destructured name is not an env read', async () => {
  await initParser();
  /* The SCREAMING_SNAKE convention is the only thing separating `{ PORT }` from
     `{ id }` in a pattern; without the floor every destructure is an env read. */
  assert.deepEqual(envNames('const { port, id, db } = process.env;'), []);
});
