/**
 * Built-in skills (be-ambitious): discovered from the shipped directory, listed with the repo's own, matched only by name,
 * run as a workflow node, and run one-shot through the route the composer's "Rewrite" action calls. No model is reached:
 * every executor here is a stub.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { applyWorkflowOps, compileWorkflow, freshWorkflowBlocks, runProgram, type NodeExecutor, type ProgramNode } from '@sequence/schema';
import { builtinSkillsRoot, loadBuiltinSkills, parseBuiltinSkill } from '../harness/builtinSkills.js';
import { loadListedSkills, loadSkillBody, matchSkillBody } from '../harness/skillLoader.js';
import { buildSkillPrompt, withSkillNodes } from '../harness/skillNodes.js';
import { createRepoServer } from '../server/repoServer.js';
import { setRepoTrust } from '../server/repoTrust.js';
import { userStoreDir } from '../server/store.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(here, '..', '..', '..', '..');
const TICKETING = path.join(REPO_ROOT, 'examples', 'ticketing-scaffold');
const FENCED_ANSWER = 'Field: SRE.\n\n1. ...\n\n```\nStart from the raw logs and the deploy diff; reproduce, then measure p95 before and after.\n```\n\nWant me to run it?';
const DEEP = 'Start from the raw logs and the deploy diff; reproduce, then measure p95 before and after.';

test('discovery: be-ambitious is found in the shipped built-in directory and its frontmatter parses', () => {
  const root = builtinSkillsRoot();
  assert.ok(root && fs.existsSync(path.join(root, 'be-ambitious', 'SKILL.md')), `no built-in root found (${root})`);
  const { skills, warnings } = loadBuiltinSkills(root);
  assert.deepEqual(warnings, []);
  const ba = skills.find((s) => s.slug === 'be-ambitious');
  assert.ok(ba);
  assert.equal(ba.name, 'be-ambitious');
  assert.match(ba.description, /deeper version of itself/);
  assert.match(ba.body, /Rewrite/);
  /* The folded `>` scalar is one line, so a list row never carries a newline. */
  assert.equal(/\n/.test(ba.description), false);
});

test('discovery: every built-in directory parses and carries its licence (derived from the directory, not hand-listed)', () => {
  const root = builtinSkillsRoot()!;
  const dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  assert.ok(dirs.length >= 1);
  const loaded = loadBuiltinSkills(root);
  assert.deepEqual(loaded.skills.map((s) => s.slug), [...dirs].sort());
  const notices = fs.readFileSync(path.join(REPO_ROOT, 'docs', 'THIRD-PARTY-NOTICES.md'), 'utf8');
  for (const slug of dirs) {
    assert.ok(fs.existsSync(path.join(root, slug, 'LICENSE')), `${slug} ships no LICENSE`);
    assert.ok(notices.includes(slug), `${slug} is not credited in docs/THIRD-PARTY-NOTICES.md`);
  }
});

test('parser: negative controls (no fence, bad YAML, no name, no description) are each named, never thrown', () => {
  assert.deepEqual(parseBuiltinSkill('# no frontmatter'), { error: 'no YAML frontmatter fence' });
  assert.match((parseBuiltinSkill('---\nname: [oops\n---\nx') as { error: string }).error, /not parseable/);
  assert.match((parseBuiltinSkill('---\ndescription: d\n---\nx') as { error: string }).error, /name/);
  assert.match((parseBuiltinSkill('---\nname: n\n---\nx') as { error: string }).error, /description/);
  const ok = parseBuiltinSkill('---\r\nname: n\r\ndescription: d\r\n---\r\nbody');
  assert.deepEqual(ok, { name: 'n', description: 'd', body: 'body' });
});

test('listing: a built-in shows with no repo at all, and a repo skill with the same slug replaces it', () => {
  const none = loadListedSkills(null);
  assert.ok(none.skills.some((s) => s.slug === 'be-ambitious' && s.builtin === true));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-builtin-list-'));
  const dir = path.join(repo, '.sequence', 'skills', 'be-ambitious');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dir + '/SKILL.md', '---\nversion: 1\nname: Mine\ndescription: My own.\nevidenceRunIds: [r1]\n---\nMy body.\n');
  const merged = loadListedSkills(repo).skills.filter((s) => s.slug === 'be-ambitious');
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.name, 'Mine');
  assert.equal(merged[0]!.builtin, undefined);
  assert.equal(loadSkillBody(repo, 'be-ambitious')!.body.trim(), 'My body.');
});

const EMPTY_REPO = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-builtin-empty-'));

test('matching: a built-in runs when named, and its description words never hijack an ordinary question', () => {
  assert.ok(matchSkillBody(EMPTY_REPO, '/be-ambitious summarise the research'));
  assert.ok(matchSkillBody(EMPTY_REPO, 'please be-ambitious about this'));
  assert.equal(matchSkillBody(EMPTY_REPO, 'rewrite this task and prompt so the version is deeper'), undefined);
  assert.equal(matchSkillBody(EMPTY_REPO, 'not-be-ambitious-enough'), undefined);
});

const nodeById = (id: string, nodes: ProgramNode[]): ProgramNode => nodes.find((n) => n.id === id)!;
const okCmd: NodeExecutor = async () => ({ ok: true, value: { exitCode: 0, output: '' } });

test('workflow node: Deepen prompt runs the skill, writes the fenced prompt, and the next Agent block receives it', async () => {
  const blocks = applyWorkflowOps({ name: 'w', blocks: freshWorkflowBlocks() }, [
    { op: 'add', kind: 'deepen', at: 0, id: 'dp', prompt: 'Find out why checkout got slower.' },
    { op: 'remove', id: 'b2' },
  ]).blocks;
  const program = compileWorkflow({ id: 'w1', name: 'w', blocks });
  assert.equal(nodeById('dp', program.nodes).agent!.skill, 'be-ambitious');
  const prompts: Record<string, string> = {};
  const stub: NodeExecutor = async (node) => {
    prompts[node.id] = node.agent!.prompt;
    return node.id === 'dp' ? { ok: true, value: { stopReason: 'end_turn', text: FENCED_ANSWER } } : { ok: true, value: [] };
  };
  const result = await runProgram(program, withSkillNodes({ agent: stub, command: okCmd }, { repoRoot: null }));
  assert.equal(result.status, 'completed', JSON.stringify(result.nodeResults));
  /* the skill node was sent the skill's own words and the author's task */
  assert.match(prompts['dp']!, /top professional/);
  assert.match(prompts['dp']!, /Task:\nFind out why checkout got slower\./);
  /* its value is the fenced block, not the whole answer, and it is in state */
  assert.equal(result.finalState['deepPrompt'], DEEP);
  /* the Agent block after it got the original prompt plus the deepened task */
  assert.ok(prompts['b1']!.endsWith(`Task:\n${DEEP}`), prompts['b1']);
  assert.ok(prompts['b1']!.startsWith('Make the change the task asks for'));
});

test('workflow node: an answer with no fenced block is the node honest error, and the next block never runs', async () => {
  const blocks = applyWorkflowOps({ name: 'w', blocks: freshWorkflowBlocks() }, [{ op: 'add', kind: 'deepen', at: 0, id: 'dp', prompt: 'Do a thing.' }]).blocks;
  const ran: string[] = [];
  const stub: NodeExecutor = async (node) => {
    ran.push(node.id);
    return { ok: true, value: { stopReason: 'end_turn', text: 'I would rather chat about it.' } };
  };
  const result = await runProgram(compileWorkflow({ id: 'w1', name: 'w', blocks }), withSkillNodes({ agent: stub, command: stub }, { repoRoot: null }));
  assert.equal(result.status, 'failed');
  assert.match(result.nodeResults['dp']!.error ?? '', /without a fenced prompt/);
  assert.deepEqual(ran, ['dp']);
});

test('workflow node: a skill that does not exist errors by name before any executor is reached', async () => {
  const program = compileWorkflow({ id: 'w1', name: 'w', blocks: applyWorkflowOps({ name: 'w', blocks: freshWorkflowBlocks() }, [{ op: 'add', kind: 'deepen', at: 0, id: 'dp' }]).blocks });
  program.nodes.find((n) => n.id === 'dp')!.agent!.skill = 'no-such-skill';
  let reached = false;
  const stub: NodeExecutor = async () => {
    reached = true;
    return { ok: true, value: '' };
  };
  const result = await runProgram(program, withSkillNodes({ agent: stub, command: stub }, { repoRoot: null }));
  assert.equal(result.status, 'failed');
  assert.match(result.nodeResults['dp']!.error ?? '', /no-such-skill/);
  assert.equal(reached, false);
});

test('prompt: the skill prompt carries the skill body, an instruction not to do the task, and the task last', () => {
  const p = buildSkillPrompt({ name: 'be-ambitious', body: 'BODY' }, '  my task  ');
  assert.ok(p.startsWith('BODY'));
  assert.match(p, /Do not do the task itself/);
  assert.ok(p.endsWith('Task:\nmy task'));
});

async function withServer<T>(opts: Record<string, unknown>, fn: (base: string, repo: string) => Promise<T>): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-builtin-route-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(TICKETING, repo, { recursive: true });
  setRepoTrust(userStoreDir(), repo, true);
  const userConfigDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-builtin-user-')));
  const server = await createRepoServer(repo, { webDist: undefined, userConfigDir, ...opts });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  try {
    return await fn(`http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, repo);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

test('route: GET /api/skills lists be-ambitious as built in, in a repo with no skills of its own', async () => {
  await withServer({}, async (base) => {
    const body = (await (await fetch(`${base}/api/skills`)).json()) as { skills: { slug: string; name: string; builtin?: boolean; scope?: string }[]; warnings: string[] };
    const ba = body.skills.find((s) => s.slug === 'be-ambitious');
    assert.ok(ba);
    assert.equal(ba.builtin, true);
    assert.equal(ba.scope, 'builtin');
    assert.deepEqual(body.warnings, []);
  });
});

test('route: POST /api/skills/be-ambitious/run returns the fenced prompt, on the chat agent and model, and writes nothing', async () => {
  const seen: ProgramNode[] = [];
  const makeProgramExecutors = () => ({
    executors: {
      agent: (async (node: ProgramNode) => {
        seen.push(node);
        return { ok: true as const, value: { stopReason: 'end_turn', text: FENCED_ANSWER } };
      }) as NodeExecutor,
      command: (async () => ({ ok: false as const, error: 'no commands' })) as NodeExecutor,
    },
  });
  await withServer({ makeProgramExecutors }, async (base, repo) => {
    const before = fs.readdirSync(repo).sort();
    const res = await fetch(`${base}/api/skills/be-ambitious/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: 'Find out why checkout got slower.', agentId: 'claude', model: 'm-1' }),
    });
    assert.equal(res.status, 200);
    const json = (await res.json()) as { slug: string; prompt: string };
    assert.equal(json.slug, 'be-ambitious');
    assert.equal(json.prompt, DEEP);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.agent!.runtime, 'acp');
    assert.equal(seen[0]!.agent!.acp!.agentRef, 'claude');
    assert.equal(seen[0]!.agent!.acp!.model, 'm-1');
    assert.equal(seen[0]!.agent!.intent, 'ask');
    assert.match(seen[0]!.agent!.prompt, /top professional/);
    assert.deepEqual(fs.readdirSync(repo).sort(), before);
  });
});

test('route: refuses an empty input, an unknown skill, and answers 502 with the cause when the model gives no fenced block', async () => {
  const makeProgramExecutors = () => ({
    executors: {
      agent: (async () => ({ ok: true as const, value: 'prose only' })) as NodeExecutor,
      command: (async () => ({ ok: false as const, error: 'x' })) as NodeExecutor,
    },
  });
  await withServer({ makeProgramExecutors }, async (base) => {
    const post = (slug: string, body: unknown) => fetch(`${base}/api/skills/${slug}/run`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post('be-ambitious', { input: '   ' })).status, 400);
    assert.equal((await post('no-such', { input: 'x' })).status, 404);
    const nofence = await post('be-ambitious', { input: 'x' });
    assert.equal(nofence.status, 502);
    assert.match(((await nofence.json()) as { error: string }).error, /without a fenced prompt/);
  });
});

test('listing: every skill names its scope (APP-43), a repo skill project and a shipped one builtin', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-scope-list-'));
  const dir = path.join(repo, '.sequence', 'skills', 'mine-only');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(dir + '/SKILL.md', '---\nversion: 1\nname: Mine\ndescription: My own.\nevidenceRunIds: [r1]\n---\nBody.\n');
  const listed = loadListedSkills(repo).skills;
  assert.ok(listed.length > 1);
  assert.equal(listed.find((s) => s.slug === 'mine-only')!.scope, 'project');
  for (const s of listed.filter((x) => x.builtin)) assert.equal(s.scope, 'builtin', s.slug);
  for (const s of listed) assert.ok(s.scope === 'builtin' || s.scope === 'project', s.slug);
});
