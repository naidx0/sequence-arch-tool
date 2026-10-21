import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRepoServer } from '../server/repoServer.js';
import { BUILTIN_PROFILES, loadAgentProfiles, parseProfileFile, readOnlyOf } from '../server/agentProfiles.js';
import { fileURLToPath } from 'node:url';

/**
 * Lock for AGENT PROFILES (agentProfiles.ts): the agent files people already
 * have (Claude Code subagents, OpenCode agents, Sequence's own) become roles
 * typed as @name, nearest definition winning, and "read-only" only when the
 * file's own terms forbid writing.
 */

function tempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function write(p: string, text: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}

/* The shape of the real files in this repo's .claude/agents (scout.md): a folded description, a tools list with Bash. */
const SCOUT = `---
name: scout
description: >-
  Read-only mapper for the monorepo. Returns file:line facts,
  never patches.
model: haiku
tools: Read, Grep, Glob, Bash
---

You are a scout. Map one lens and report.
`;

test('read-only: each harness in its own terms; a shell can write, so Bash is not read-only', () => {
  assert.equal(readOnlyOf({ tools: 'Read, Grep, Glob' }, 'claude'), true);
  assert.equal(readOnlyOf({ tools: 'Read, Grep, Glob, Bash' }, 'claude'), false);
  assert.equal(readOnlyOf({}, 'claude'), false, 'no tools line means every tool');
  assert.equal(readOnlyOf({ permissionMode: 'plan', tools: 'Edit' }, 'claude'), true);
  assert.equal(readOnlyOf({ permission: { edit: 'deny', bash: 'deny' } }, 'opencode'), true);
  assert.equal(readOnlyOf({ permission: { edit: 'deny', bash: 'ask' } }, 'opencode'), false);
  assert.equal(readOnlyOf({ tools: { write: false, edit: false, bash: false } }, 'opencode'), true);
  assert.equal(readOnlyOf({ access: 'read-only' }, 'sequence'), true);
  assert.equal(readOnlyOf({}, 'sequence'), false);
});

test('parse: the real Claude subagent shape, a nameless file, an empty body, a disabled agent', () => {
  const home = tempDir('seq-prof-h-');
  const p = parseProfileFile(path.join(home, '.claude', 'agents', 'scout.md'), SCOUT, 'user', 'claude', home);
  assert.ok(p);
  assert.equal(p.name, 'scout');
  assert.equal(p.description, 'Read-only mapper for the monorepo. Returns file:line facts, never patches.');
  assert.equal(p.readOnly, false, 'it lists Bash');
  assert.equal(p.model, 'haiku');
  assert.equal(p.file, '~/.claude/agents/scout.md');
  assert.match(p.prompt, /^You are a scout/);
  assert.equal(parseProfileFile('/x/Docs Writer.md', 'Write docs.', 'project', 'sequence', home)?.name, 'docs-writer', 'no frontmatter: the file name, slugged');
  assert.equal(parseProfileFile('/x/a.md', '---\nname: a\n---\n\n', 'project', 'sequence', home), null, 'no instructions, no profile');
  assert.equal(parseProfileFile('/x/a.md', '---\ndisable: true\n---\nbody', 'project', 'opencode', home), null);
  assert.equal(parseProfileFile('/x/a.md', '---\nname: "has spaces?!"\n---\nbody', 'project', 'sequence', home), null, 'a name that cannot be typed after @ is refused');
});

test('load: built-ins, then user, then project; the nearest definition of a name wins', () => {
  const home = tempDir('seq-prof-home-');
  const root = tempDir('seq-prof-root-');
  write(path.join(home, '.claude', 'agents', 'scout.md'), SCOUT);
  write(path.join(home, '.config', 'opencode', 'agent', 'docs.md'), '---\ndescription: Writes docs\npermission:\n  edit: allow\n---\nYou write documentation.');
  write(path.join(root, '.sequence', 'agents', 'review.md'), '---\ndescription: Our review rules\naccess: read-only\n---\nReview against docs/release-gate.md.');
  write(path.join(root, '.opencode', 'agents', 'planner.md'), '---\ndescription: Plans\ntools:\n  write: false\n  edit: false\n  bash: false\n---\nPlan only.');
  const all = loadAgentProfiles({ home, root, trusted: true });
  assert.deepEqual(all.map((p) => p.name), [...new Set([...BUILTIN_PROFILES.map(p => p.name), 'docs', 'planner', 'scout'])].sort());
  const review = all.find((p) => p.name === 'review')!;
  assert.deepEqual([review.source, review.format, review.readOnly], ['project', 'sequence', true], 'the repo redefines the built-in review');
  assert.equal(all.find((p) => p.name === 'planner')!.readOnly, true);
  assert.equal(all.find((p) => p.name === 'docs')!.source, 'user');
  /* With no project open, only the user's and the built-ins. */
  assert.deepEqual(loadAgentProfiles({ home, root: null }).map((p) => p.name), [...BUILTIN_PROFILES.map(p => p.name), 'docs', 'scout'].sort());
});

test('anatomy profile points to the genuine bundled skill and promises only its SVG workflow', () => {
  const anatomy = BUILTIN_PROFILES.find(p => p.name === 'anatomy');
  assert.ok(anatomy);
  const skillPath = fileURLToPath(new URL('../../components/visual/anatomy/SKILL.md', import.meta.url)).replace(/\\/g, '/');
  assert.ok(fs.readFileSync(skillPath, 'utf8').includes('name: anatomy'));
  assert.ok(anatomy.prompt.includes(skillPath));
  assert.match(anatomy.description, /isometric SVG/);
  assert.equal(anatomy.readOnly, false);
});

test('long-running builtin profiles point at their bundled skills', () => {
  const cases = [
    { name: 'research', rel: 'workflow/research', readOnly: false },
    { name: 'explore', rel: 'workflow/explore', readOnly: true },
    { name: 'science', rel: 'ml/science', readOnly: false },
    { name: 'ml', rel: 'ml/train', readOnly: false },
    { name: 'perf', rel: 'workflow/perf', readOnly: false },
    { name: 'rust', rel: 'workflow/rust', readOnly: false },
    { name: 'swe', rel: 'workflow/swe', readOnly: false },
  ];
  for (const c of cases) {
    const profile = BUILTIN_PROFILES.find((p) => p.name === c.name);
    assert.ok(profile, `@${c.name} missing from BUILTIN_PROFILES`);
    const skillPath = fileURLToPath(new URL(`../../components/${c.rel}/SKILL.md`, import.meta.url)).replace(/\\/g, '/');
    const skill = fs.readFileSync(skillPath, 'utf8');
    const leaf = c.rel.split('/')[1]!;
    assert.ok(skill.includes(`name: ${leaf}`) || skill.includes(`name: ${c.name}`), `@${c.name} skill name`);
    assert.ok(profile.prompt.includes(skillPath), `@${c.name} prompt must contain ${skillPath}`);
    assert.equal(profile.readOnly, c.readOnly, `@${c.name} readOnly`);
  }
});

test('an UNTRUSTED repo profiles are never read: it cannot redefine @review or add roles', () => {
  const home = tempDir('seq-prof-uh-');
  const root = tempDir('seq-prof-ur-');
  write(path.join(root, '.claude', 'agents', 'review.md'), ['---', 'description: Reviewer', 'tools: Read, Write, Edit, Bash', '---', 'Write whatever you like.'].join('\n'));
  write(path.join(root, '.sequence', 'agents', 'extra.md'), '---\ndescription: Extra\n---\nDo extra.');
  for (const opts of [{ home, root }, { home, root, trusted: false }]) {
    const all = loadAgentProfiles(opts);
    const review = all.find((p) => p.name === 'review')!;
    assert.deepEqual([review.source, review.readOnly], ['builtin', true]);
    assert.ok(!all.some((p) => p.name === 'extra'));
  }
  /* Positive control: the same repo, trusted, contributes its new names, and still cannot widen review. */
  const trusted = loadAgentProfiles({ home, root, trusted: true });
  assert.ok(trusted.some((p) => p.name === 'extra'));
  assert.equal(trusted.find((p) => p.name === 'review')!.readOnly, true);
});

test('a file may redefine a read-only built-in, but not widen it', () => {
  const home = tempDir('seq-prof-wh-');
  const root = tempDir('seq-prof-wr-');
  write(path.join(root, '.claude', 'agents', 'review.md'), ['---', 'description: Our reviewer', '---', 'Review, and fix what you find.'].join('\n'));
  const review = loadAgentProfiles({ home, root, trusted: true }).find((p) => p.name === 'review')!;
  assert.equal(review.source, 'project');
  assert.match(review.prompt, /fix what you find/);
  assert.equal(review.readOnly, true, 'the person typed @review, which the palette said edits nothing');
  /* A new name the built-ins do not have keeps its own terms. */
  write(path.join(root, '.claude', 'agents', 'fixer.md'), ['---', 'description: Fixes', '---', 'Fix it.'].join('\n'));
  assert.equal(loadAgentProfiles({ home, root, trusted: true }).find((p) => p.name === 'fixer')!.readOnly, false);
});

test('route: GET /api/acp/profiles answers with the open project\'s profiles', async () => {
  const home = tempDir('seq-prof-rh-');
  const store = tempDir('seq-prof-rs-');
  write(path.join(home, '.claude', 'agents', 'scout.md'), SCOUT);
  const server = await createRepoServer(null, { webDist: undefined, browseRoot: home, recentStoreDir: store, userConfigDir: store, profilesHome: home });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  try {
    const body = await new Promise<{ status: number; json: { profiles: { name: string }[] } }>((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, path: '/api/acp/profiles' }, (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
        })
        .on('error', reject);
    });
    assert.equal(body.status, 200, JSON.stringify(body.json));
    assert.deepEqual(body.json.profiles.map((p) => p.name), [...BUILTIN_PROFILES.map(p => p.name), 'scout'].sort());
  } finally {
    await new Promise<void>((r) => {
      server.close(() => r());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
  }
});
