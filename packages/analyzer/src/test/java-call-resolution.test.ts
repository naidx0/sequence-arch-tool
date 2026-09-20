/**
 * U33 — A JAVA REPO RESOLVED AS N ISLANDS.
 *
 * Measured on `main` over the real corpus: `spring-petclinic-monolith` produced
 * 182 function nodes, 33 call edges and TWO cross-file call edges; `spring-boot`
 * the same shape at scale. Both reported `stemPlays: false` and told the user
 * *"the scan recorded no calls out of it, and no other file in this scan has one
 * either"* over repos that are nothing but controllers calling repositories.
 *
 * Two independent gaps, both in what we read:
 *   1. `resolveImport` resolves no Java import, so `resolveCalleeCrossFile`
 *      never had a target file to look in.
 *   2. A Java callee is recorded through its RECEIVER (`this.owners.loadById`),
 *      so it never equals the bare method name `fn.name === callee` compares to.
 *
 * Every test below is written against the shape the report named — a Spring
 * entry class, a controller, a repository — and the negative tests are the
 * point as much as the positive ones: this must not manufacture an edge from
 * `@SpringBootApplication` to anything, because that wiring is not in the code.
 */
import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initParser } from '../parse/treesitter.js';
import { extractFacts } from '../parse/facts.js';
import { buildFunctionGraph, type FunctionGraphFileInput } from '../functions/buildFunctionGraph.js';
import { buildJavaTypeIndex, resolveJavaType } from '../functions/javaResolve.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FX = path.resolve(here, '..', '..', 'test', 'fixtures', 'java-spring-entry');

const ROOT = 'src/main/java/com/example/petclinic';
const FILES = [
  `${ROOT}/PetClinicApplication.java`,
  `${ROOT}/owner/OwnerController.java`,
  `${ROOT}/owner/OwnerRepository.java`,
  `${ROOT}/owner/Owner.java`,
  `${ROOT}/owner/VisitController.java`,
  `${ROOT}/util/EntityUtils.java`,
];

async function inputs(): Promise<FunctionGraphFileInput[]> {
  await initParser();
  return FILES.map((rel) => {
    const facts = extractFacts(fs.readFileSync(path.join(FX, rel), 'utf8'), rel, 'java');
    return {
      file: rel,
      lang: 'java',
      functions: facts.functions,
      calls: facts.calls,
      // `resolveImport` returns undefined for every Java import — the inputs
      // here carry exactly what the real pipeline carries: a raw FQN and no
      // resolved path.
      imports: facts.imports.map((imp) => ({ raw: imp.raw, line: imp.line })),
      loc: facts.loc,
      varTypes: facts.varTypes,
    };
  });
}

/** `a.java -> b.java` for every call edge, sources and targets as file paths. */
async function edgePairs(): Promise<string[]> {
  const g = buildFunctionGraph(await inputs());
  const label = new Map(g.nodes.map((n) => [n.id, `${n.file}#${n.name}`]));
  return g.edges.map((e) => `${label.get(e.srcId)} -> ${label.get(e.dstId)}`);
}

test('the parser records a Java name\'s DECLARED type', async () => {
  await initParser();
  const facts = extractFacts(
    fs.readFileSync(path.join(FX, `${ROOT}/owner/OwnerController.java`), 'utf8'),
    'OwnerController.java',
    'java'
  );
  const varTypes = facts.varTypes;
  assert.ok(varTypes, 'Java facts must carry varTypes');
  assert.strictEqual(varTypes!.get('owners'), 'OwnerRepository', 'field declaration');
  assert.strictEqual(varTypes!.get('owner'), 'Owner', 'local declaration');
  assert.strictEqual(varTypes!.get('ownerId'), 'Integer', 'formal parameter');
});

test('a name declared with two types resolves to NOTHING, not to the first', async () => {
  await initParser();
  const facts = extractFacts(
    fs.readFileSync(path.join(FX, `${ROOT}/owner/VisitController.java`), 'utf8'),
    'VisitController.java',
    'java'
  );
  assert.strictEqual(
    facts.varTypes!.get('target'),
    null,
    '`target` is an OwnerRepository in one method and an Owner in another'
  );
});

test('a call through a typed receiver reaches the file that declares the type', async () => {
  const pairs = await edgePairs();
  assert.ok(
    pairs.includes(
      `${ROOT}/owner/OwnerController.java#showOwner -> ${ROOT}/owner/OwnerRepository.java#loadById`
    ),
    `this.owners.loadById must resolve through the field's declared type: ${JSON.stringify(pairs, null, 1)}`
  );
  assert.ok(
    pairs.includes(
      `${ROOT}/owner/OwnerController.java#showOwner -> ${ROOT}/owner/OwnerRepository.java#recordVisit`
    ),
    'the same field without `this.` resolves identically'
  );
  assert.ok(
    pairs.includes(`${ROOT}/owner/OwnerController.java#showOwner -> ${ROOT}/owner/Owner.java#addPet`),
    'a local declaration types its receiver too'
  );
});

test('a type-qualified call resolves through a single-type import', async () => {
  const pairs = await edgePairs();
  assert.ok(
    pairs.includes(
      `${ROOT}/owner/OwnerController.java#showOwner -> ${ROOT}/util/EntityUtils.java#render`
    ),
    'EntityUtils.render is reached by `import com.example.petclinic.util.EntityUtils`'
  );
});

test('`this.method(...)` resolves inside the caller\'s own file', async () => {
  const pairs = await edgePairs();
  assert.ok(
    pairs.includes(
      `${ROOT}/owner/OwnerController.java#listOwners -> ${ROOT}/owner/OwnerController.java#showOwner`
    ),
    'a `this.`-qualified own method is still a real call'
  );
});

test('THE SPRING ENTRY STILL HAS NO OUTBOUND EDGE — no invented framework hop', async () => {
  const g = buildFunctionGraph(await inputs());
  const entryIds = new Set(
    g.nodes.filter((n) => n.file.endsWith('PetClinicApplication.java')).map((n) => n.id)
  );
  assert.ok(entryIds.size > 0, 'the fixture declares main()');
  const out = g.edges.filter((e) => entryIds.has(e.srcId));
  assert.deepStrictEqual(
    out,
    [],
    'SpringApplication.run lands in a dependency this scan does not read; ' +
      'the flow the user gets must come from real code, not from a fabricated edge'
  );
});

test('ambiguous receivers, chained receivers and overloads resolve to nothing', async () => {
  const pairs = await edgePairs();
  const from = (fn: string) => pairs.filter((p) => p.startsWith(`${ROOT}/owner/VisitController.java#${fn} `));

  assert.deepStrictEqual(from('first'), [], 'a name declared with two types is not resolved');
  assert.deepStrictEqual(from('second'), [], 'the other declaration is not resolved either');
  // `repo.loadById(1).addPet("x")` is TWO calls. The inner one has a typed
  // receiver (`repo`, a parameter) and is a real edge. The outer one's receiver
  // is `repo.loadById(1)` — nothing in this file says what that returned — so
  // it resolves to nothing rather than to `Owner#addPet`.
  assert.deepStrictEqual(
    from('chained'),
    [`${ROOT}/owner/VisitController.java#chained -> ${ROOT}/owner/OwnerRepository.java#loadById`],
    'the inner call resolves; the chained outer call must not'
  );
  assert.deepStrictEqual(
    from('ambiguousMethod'),
    [],
    '`overloaded` is declared twice — unique or nothing, the rule every resolver here uses'
  );
});

test('a type resolves through its own package, and never across one without an import', () => {
  const index = buildJavaTypeIndex(FILES);
  assert.strictEqual(
    resolveJavaType('OwnerRepository', `${ROOT}/owner/OwnerController.java`, [], index),
    `${ROOT}/owner/OwnerRepository.java`,
    'a same-directory type needs no import — Java package IS its directory'
  );
  assert.strictEqual(
    resolveJavaType('EntityUtils', `${ROOT}/owner/OwnerController.java`, [], index),
    undefined,
    'a type in another package with no import naming it resolves to nothing'
  );
  assert.strictEqual(
    resolveJavaType('SpringApplication', `${ROOT}/PetClinicApplication.java`, ['org.springframework.boot.SpringApplication'], index),
    undefined,
    'an import of a type no file in the scan declares resolves to nothing'
  );
  assert.strictEqual(
    resolveJavaType('EntityUtils', `${ROOT}/owner/OwnerController.java`, ['com.example.petclinic.util.*'], index),
    undefined,
    'a wildcard import names no type'
  );
});

test('no OTHER language gained a varTypes fact or changed resolution', async () => {
  await initParser();
  for (const [src, file, lang] of [
    ['def a():\n    b()\n', 'a.py', 'py'],
    ['function a(){ b(); }\n', 'a.ts', 'ts'],
    ['package main\nfunc a() { b() }\n', 'a.go', 'go'],
  ] as const) {
    const facts = extractFacts(src, file, lang);
    assert.strictEqual(facts.varTypes, undefined, `${lang} must not gain a Java-only fact`);
  }
});
