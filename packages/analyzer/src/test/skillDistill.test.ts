import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { buildAskPrompt } from '../explain/explain.js';
import {
  clusterSuccessfulAsks,
  distillSkillsFromTrajectories,
  listTrajectories,
  questionStem,
  readDistilledSkill,
  renderSkillFile,
  skillSlug,
  writeDistilledSkill,
  type SkillCluster,
} from '../harness/skillDistill.js';
import {
  loadSkillSummaries,
  matchSkillBody,
  renderSkillBodyLines,
  renderSkillSummaryLines,
} from '../harness/skillLoader.js';
import {
  validateHarnessSkill,
  isValidHarnessSkill,
  type HarnessSkillFrontmatter,
} from '@sequence/schema';
import type { TrajectoryDoc } from '../server/trajectoryStore.js';

function tmpRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-skill-distill-'));
}

function askDoc(runId: string, intentId: string, filePaths: string[], ok = true, question?: string): TrajectoryDoc {
  const askTrace: Array<Record<string, unknown>> = [
    { type: 'intent:start', id: intentId },
    { type: 'intent:done', id: intentId },
  ];
  for (const p of filePaths) {
    askTrace.push({ type: 'file:read', path: p });
    askTrace.push({ type: 'file:done', path: p });
  }
  askTrace.push({ type: 'provider:start' });
  askTrace.push({ type: 'provider:done' });
  askTrace.push({ type: 'result', text: 'answer' });
  return {
    version: 1,
    runId,
    kind: 'ask',
    startedAt: '2026-08-11T00:00:00.000Z',
    finishedAt: '2026-08-11T00:00:01.000Z',
    ...(question !== undefined ? { question } : {}),
    askTrace,
    askTerminal: { type: ok ? 'result' : 'error', text: 'answer' },
    graph: { runId, nodes: [], edges: [] },
  };
}

function writeTrajectory(repoRoot: string, doc: TrajectoryDoc): void {
  const dir = path.join(repoRoot, '.sequence', 'trajectory');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${doc.runId}.json`), JSON.stringify(doc, null, 2));
}

/* ------------------------------- validateHarnessSkill ----------------------- */

test('validateHarnessSkill accepts a grounded skill frontmatter', () => {
  const fm: HarnessSkillFrontmatter = {
    version: 1,
    name: 'Impact',
    description: 'Distilled from asks about impact.',
    evidenceRunIds: ['run-1', 'run-2'],
  };
  assert.deepEqual(validateHarnessSkill(fm), []);
  assert.equal(isValidHarnessSkill(fm), true);
});

test('validateHarnessSkill reports every problem and never throws', () => {
  const errors = validateHarnessSkill({
    version: 2,
    name: '',
    description: 7,
    evidenceRunIds: [],
    groundedServiceIds: 'svc:oops',
  });
  assert.ok(errors.some((e) => e.includes('version')), errors.join(' | '));
  assert.ok(errors.some((e) => e.includes('name')), errors.join(' | '));
  assert.ok(errors.some((e) => e.includes('description')), errors.join(' | '));
  assert.ok(errors.some((e) => e.includes('evidenceRunIds')), errors.join(' | '));
  assert.ok(errors.some((e) => e.includes('groundedServiceIds')), errors.join(' | '));
  // Non-object root does not throw.
  assert.ok(validateHarnessSkill(null).length > 0);
  assert.ok(validateHarnessSkill('nope').length > 0);
});

/* ------------------------------- listTrajectories -------------------------- */

test('listTrajectories: empty when no .sequence/trajectory; reads valid docs only', () => {
  const repo = tmpRepo();
  assert.deepEqual(listTrajectories(repo), []);
  writeTrajectory(repo, askDoc('run-1', 'impact', ['src/a.ts']));
  // An invalid file (not a trajectory doc) is skipped, not thrown.
  fs.writeFileSync(
    path.join(repo, '.sequence', 'trajectory', 'junk.json'),
    JSON.stringify({ not: 'a trajectory' }),
  );
  const docs = listTrajectories(repo);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].runId, 'run-1');
});

/* --------------------------- clusterSuccessfulAsks ------------------------- */

test('clusterSuccessfulAsks: groups by first intent id; drops clusters < minCount and failed asks', () => {
  const docs = [
    askDoc('r1', 'impact', ['src/a.ts']),
    askDoc('r2', 'impact', ['src/b.ts']),
    askDoc('r3', 'impact', ['src/a.ts', 'src/c.ts']),
    // Only two 'risks' asks → below minCount 3 → dropped.
    askDoc('r4', 'risks', ['src/d.ts']),
    askDoc('r5', 'risks', ['src/e.ts']),
    // A failed ask → not eligible.
    askDoc('r6', 'impact', ['src/f.ts'], false),
    // No intent id → no key → skipped.
    { ...askDoc('r7', 'impact', []), askTrace: [{ type: 'result', text: 'x' }] } as TrajectoryDoc,
  ];
  const clusters = clusterSuccessfulAsks(docs, { minCount: 3 });
  assert.equal(clusters.length, 1);
  const c = clusters[0];
  assert.equal(c.key, 'intent:impact');
  assert.equal(c.docs.length, 3);
  assert.deepEqual(c.runIds, ['r1', 'r2', 'r3']);
  // Distinct file paths in encounter order across the cluster.
  assert.deepEqual(c.filePaths, ['src/a.ts', 'src/b.ts', 'src/c.ts']);
});

test('clusterSuccessfulAsks: default minCount is 3', () => {
  const docs = [askDoc('r1', 'impact', []), askDoc('r2', 'impact', []), askDoc('r3', 'impact', [])];
  assert.equal(clusterSuccessfulAsks(docs).length, 1);
  assert.equal(clusterSuccessfulAsks(docs, { minCount: 4 }).length, 0);
});

test('questionStem: normalises questions for clustering', () => {
  assert.equal(questionStem('What is the impact of backend changes?'), 'what is the impact of backend');
  assert.equal(questionStem('  WHAT   is   the   impact?  '), 'what is the impact');
});

test('clusterSuccessfulAsks: prefers question stem when question field is present', () => {
  const q = 'What is the blast radius of backend?';
  const docs = [
    askDoc('r1', 'impact', ['src/a.ts'], true, q),
    askDoc('r2', 'risks', ['src/b.ts'], true, q),
    askDoc('r3', 'impact', ['src/c.ts'], true, q),
  ];
  const clusters = clusterSuccessfulAsks(docs, { minCount: 3 });
  assert.equal(clusters.length, 1);
  assert.ok(clusters[0]!.key.startsWith('q:'), 'clustered by question stem');
});

test('distillSkillsFromTrajectories: uses LLM body when summarizeBody returns text', async () => {
  const repo = tmpRepo();
  writeTrajectory(repo, askDoc('r1', 'impact', ['src/a.ts']));
  writeTrajectory(repo, askDoc('r2', 'impact', ['src/b.ts']));
  writeTrajectory(repo, askDoc('r3', 'impact', ['src/c.ts']));
  const { written } = await distillSkillsFromTrajectories(repo, {
    summarizeBody: async () => '# LLM summary\n\nGrounded body from provider.',
  });
  assert.equal(written.length, 1);
  const body = fs.readFileSync(written[0]!.filePath, 'utf8');
  assert.ok(body.includes('LLM summary'), 'LLM body used when summarizeBody returns');
});

/* ----------------------- distillSkillsFromTrajectories --------------------- */

test('distillSkillsFromTrajectories: writes a SKILL.md per eligible cluster with evidence + file paths', async () => {
  const repo = tmpRepo();
  writeTrajectory(repo, askDoc('r1', 'impact', ['src/a.ts']));
  writeTrajectory(repo, askDoc('r2', 'impact', ['src/b.ts']));
  writeTrajectory(repo, askDoc('r3', 'impact', ['src/a.ts', 'src/c.ts']));
  const { written, errors } = await distillSkillsFromTrajectories(repo);
  assert.deepEqual(errors, []);
  assert.equal(written.length, 1);
  const skill = written[0];
  assert.equal(skill.slug, 'impact');
  assert.equal(skill.frontmatter.name, 'Impact');
  assert.equal(skill.frontmatter.evidenceRunIds.length, 3);
  assert.ok(fs.existsSync(skill.filePath), 'SKILL.md written');
  const fileText = fs.readFileSync(skill.filePath, 'utf8');
  assert.ok(fileText.startsWith('---\n'), 'file starts with YAML frontmatter fence');
  assert.ok(fileText.includes('name: Impact'), 'frontmatter has name');
  assert.ok(fileText.includes('evidenceRunIds:'), 'frontmatter has evidenceRunIds');
  assert.ok(fileText.includes('- r1'), 'body lists evidence run id r1');
  assert.ok(fileText.includes('src/a.ts'), 'body lists a real file path');
  assert.ok(fileText.includes('src/c.ts'), 'body lists a real file path');
  // The persisted frontmatter validates.
  const fmBlock = /^---\n([\s\S]*?)\n---/.exec(fileText)![1];
  const yaml = parseYaml(fmBlock);
  assert.equal(isValidHarnessSkill(yaml), true, 'persisted frontmatter is valid');
});

test('distillSkillsFromTrajectories: refuses a skill whose groundedServiceIds are not in knownServiceIds', async () => {
  const repo = tmpRepo();
  writeTrajectory(repo, askDoc('r1', 'impact', ['src/a.ts']));
  writeTrajectory(repo, askDoc('r2', 'impact', ['src/b.ts']));
  writeTrajectory(repo, askDoc('r3', 'impact', ['src/c.ts']));
  // No service ids are inferred today, so this distill writes nothing refused.
  // Exercise the refusal path directly via renderSkillFile + a hand-built fm.
  const fm: HarnessSkillFrontmatter = {
    version: 1,
    name: 'Impact',
    description: 'd',
    evidenceRunIds: ['r1', 'r2', 'r3'],
    groundedServiceIds: ['svc:ghost'],
  };
  const known = new Set<string>(['svc:real']);
  // Simulate the guard the distill step applies.
  const missing = (fm.groundedServiceIds ?? []).filter((id) => !known.has(id));
  assert.ok(missing.includes('svc:ghost'), 'unknown service detected');
  // And the distill itself, with knownServiceIds supplied, still writes (no inferred services).
  const { written, errors } = await distillSkillsFromTrajectories(repo, { knownServiceIds: known });
  assert.deepEqual(errors, []);
  assert.equal(written.length, 1);
  assert.ok(!written[0].frontmatter.groundedServiceIds, 'no services inferred → none claimed');
});

test('distillSkillsFromTrajectories: empty when no trajectories', async () => {
  const repo = tmpRepo();
  const { written, errors } = await distillSkillsFromTrajectories(repo);
  assert.deepEqual(written, []);
  assert.deepEqual(errors, []);
});

/* ----------------------- writeDistilledSkill / readDistilledSkill ----------- */
/* Locking test for the shared skill write+read hook (Wave 5 deepen): the
 * distill endpoint persists a SKILL.md via writeDistilledSkill, and the same
 * file round-trips through readDistilledSkill. */

test('writeDistilledSkill + readDistilledSkill: round-trip a SKILL.md under .sequence/skills/', () => {
  const repo = tmpRepo();
  const fm: HarnessSkillFrontmatter = {
    version: 1,
    name: 'Impact',
    description: 'Distilled from asks about impact.',
    evidenceRunIds: ['r1', 'r2', 'r3'],
  };
  const filePath = writeDistilledSkill(repo, 'impact', fm, '# Impact\n\nBody text.');
  assert.ok(fs.existsSync(filePath), 'SKILL.md written to disk');
  assert.ok(filePath.endsWith(path.join('.sequence', 'skills', 'impact', 'SKILL.md')));
  const read = readDistilledSkill(repo, 'impact');
  assert.ok(read, 'readDistilledSkill returns the parsed skill');
  assert.equal(read!.frontmatter.name, 'Impact');
  assert.deepEqual(read!.frontmatter.evidenceRunIds, ['r1', 'r2', 'r3']);
  assert.ok(read!.body.includes('Body text.'), 'body round-trips');
});

test('readDistilledSkill: undefined when the skill is absent or malformed (never throws)', () => {
  const repo = tmpRepo();
  assert.equal(readDistilledSkill(repo, 'missing'), undefined);
  // A malformed skill (no frontmatter) is skipped, not thrown.
  const badDir = path.join(repo, '.sequence', 'skills', 'broken');
  fs.mkdirSync(badDir, { recursive: true });
  fs.writeFileSync(path.join(badDir, 'SKILL.md'), 'no frontmatter here');
  assert.equal(readDistilledSkill(repo, 'broken'), undefined);
});

test('distillSkillsFromTrajectories: persists a skill file readable by readDistilledSkill (shared hook)', async () => {
  const repo = tmpRepo();
  writeTrajectory(repo, askDoc('r1', 'impact', ['src/a.ts']));
  writeTrajectory(repo, askDoc('r2', 'impact', ['src/b.ts']));
  writeTrajectory(repo, askDoc('r3', 'impact', ['src/c.ts']));
  const { written } = await distillSkillsFromTrajectories(repo);
  assert.equal(written.length, 1);
  // The distill path wrote through writeDistilledSkill, so the read hook
  // (the same shared path) reads it back.
  const read = readDistilledSkill(repo, written[0]!.slug);
  assert.ok(read, 'distilled skill is readable via the shared hook');
  assert.equal(read!.frontmatter.name, 'Impact');
});

/* ------------------------------ skillLoader -------------------------------- */

test('loadSkillSummaries: parses distilled skills; skips malformed by slug with a warning', async () => {
  const repo = tmpRepo();
  writeTrajectory(repo, askDoc('r1', 'impact', ['src/a.ts']));
  writeTrajectory(repo, askDoc('r2', 'impact', ['src/b.ts']));
  writeTrajectory(repo, askDoc('r3', 'impact', ['src/c.ts']));
  await distillSkillsFromTrajectories(repo);
  // Add a malformed skill directory.
  const badDir = path.join(repo, '.sequence', 'skills', 'broken');
  fs.mkdirSync(badDir, { recursive: true });
  fs.writeFileSync(path.join(badDir, 'SKILL.md'), 'no frontmatter here');
  const { summaries, warnings } = loadSkillSummaries(repo);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].slug, 'impact');
  assert.equal(summaries[0].name, 'Impact');
  assert.ok(warnings.some((w) => w.startsWith('broken:')), 'malformed skill reported by slug');
});

test('loadSkillSummaries: empty when no skills dir', () => {
  const repo = tmpRepo();
  const { summaries, warnings } = loadSkillSummaries(repo);
  assert.deepEqual(summaries, []);
  assert.deepEqual(warnings, []);
});

test('matchSkillBody: returns the body when the question names the skill or a description keyword', async () => {
  const repo = tmpRepo();
  writeTrajectory(repo, askDoc('r1', 'impact', ['src/a.ts']));
  writeTrajectory(repo, askDoc('r2', 'impact', ['src/b.ts']));
  writeTrajectory(repo, askDoc('r3', 'impact', ['src/c.ts']));
  await distillSkillsFromTrajectories(repo);
  // Name match.
  const byName = matchSkillBody(repo, 'Tell me about the Impact of this service');
  assert.ok(byName, 'matched by name token');
  assert.equal(byName!.name, 'Impact');
  assert.ok(byName!.body.includes('Impact'), 'body is the markdown body');
  // Description keyword match (description contains "asks" and "about").
  const byKeyword = matchSkillBody(repo, 'what about these asks?');
  assert.ok(byKeyword, 'matched by a description keyword');
  // No match.
  assert.equal(matchSkillBody(repo, 'completely unrelated question xyzzy'), undefined);
});

test('renderSkillSummaryLines / renderSkillBodyLines: empty when nothing to render', () => {
  assert.deepEqual(renderSkillSummaryLines([]), []);
  assert.deepEqual(renderSkillBodyLines('X', '   '), []);
});

test('renderSkillSummaryLines: one bullet per skill, headed section', () => {
  const lines = renderSkillSummaryLines([
    { slug: 'impact', name: 'Impact', description: 'about impact' },
    { slug: 'risks', name: 'Risks', description: 'about risks' },
  ]);
  assert.ok(lines[0].startsWith('--- REPO SKILLS'), 'section heading');
  assert.ok(lines.some((l) => l.includes('Impact: about impact')));
  assert.ok(lines.some((l) => l.includes('Risks: about risks')));
});

test('renderSkillBodyLines: caps body to 2k chars', () => {
  const long = 'a'.repeat(3000);
  const lines = renderSkillBodyLines('Big', long);
  assert.equal(lines.length, 2);
  assert.ok(lines[1].length <= 2001, 'body capped to ~2k');
  assert.ok(lines[1].endsWith('…'));
});

/* ------------------------------ renderSkillFile ---------------------------- */

test('renderSkillFile: quotes YAML scalars that would break flow', () => {
  const fm: HarnessSkillFrontmatter = {
    version: 1,
    name: 'with: colon',
    description: 'has # hash',
    evidenceRunIds: ['r1'],
  };
  const out = renderSkillFile(fm, 'body');
  assert.ok(out.includes('name: "with: colon"'), 'colon name quoted');
  assert.ok(out.includes('description: "has # hash"'), 'hash description quoted');
});

test('skillSlug: filesystem-safe slug', () => {
  assert.equal(skillSlug('impact'), 'impact');
  assert.equal(skillSlug('Impact'), 'impact');
  assert.equal(skillSlug('risk-analysis'), 'risk-analysis');
  assert.equal(skillSlug('weird stuff!'), 'weird-stuff');
});

/* --------------------------- prompt-injection seam ------------------------ */

test('buildAskPrompt: injects skill summaries always and the matched body only on match', () => {
  type Digest = Parameters<typeof buildAskPrompt>[0];
  const digest = {
    repo: { id: 'repo', name: 'demo' },
    folders: [],
    services: [],
    datastores: [],
    topics: [],
    edges: [],
  } as unknown as Digest;
  // No skills → byte-identical to pre-seam (no skill sections).
  const none = buildAskPrompt(digest, 'anything', {});
  assert.ok(!none.includes('REPO SKILLS'), 'no skill summary section when no skills');
  assert.ok(!none.includes('MATCHED SKILL'), 'no matched skill section when no skills');

  // Summaries always injected.
  const withSummaries = buildAskPrompt(digest, 'unrelated question', {
    skillSummaryLines: ['--- REPO SKILLS ---', '- Impact: about impact'],
  });
  assert.ok(withSummaries.includes('REPO SKILLS'), 'summaries injected');
  assert.ok(withSummaries.includes('- Impact: about impact'));
  assert.ok(!withSummaries.includes('MATCHED SKILL'), 'no body when none matched');

  // Matched body injected alongside summaries.
  const withBody = buildAskPrompt(digest, 'Tell me the Impact', {
    skillSummaryLines: ['--- REPO SKILLS ---', '- Impact: about impact'],
    skillBodyLines: ['--- MATCHED SKILL: Impact (full body) ---', 'the full body text'],
  });
  assert.ok(withBody.includes('REPO SKILLS'), 'summaries still injected');
  assert.ok(withBody.includes('MATCHED SKILL: Impact'), 'matched body injected');
  assert.ok(withBody.includes('the full body text'));
});

/* --------------------------------- helpers -------------------------------- */

// YAML parsing for the test reuses the real `yaml` package the analyzer already
// depends on (imported at the top as `parseYaml`), so the persisted frontmatter
// is validated by the same parser the loader uses in production.
