import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../scan.js';
import { buildDigest } from '../explain/explain.js';
import { resolveInRepo } from '../server/jail.js';
import {
  ASK_DISPATCHABLE_TOOLS,
  ASK_TOOL_ALLOWLIST,
  executeAskTool,
  permissionSubjects,
} from '../server/askTools.js';
import { runAskPipeline, type AskPipelineInput, type AskStreamEvent } from '../server/askPipeline.js';
import {
  DEFAULT_DENY_STREAK,
  PERMISSIONS_FILE,
  PermissionCircuitBreaker,
  emptyPermissionDocument,
  evaluatePermission,
  formatPermissionRule,
  loadPermissionPolicy,
  matchPathSpecifier,
  parsePermissionRule,
  parsePermissionsDocument,
  permissionsFilePath,
  serializePermissionsDocument,
  writePermissionsDocument,
  type PermissionDocument,
  type PermissionPolicy,
} from '../server/permissionRules.js';
import { setRepoTrust } from '../server/repoTrust.js';
import { userStoreDir } from '../server/store.js';

/**
 * P3 PHASE 2 LOCKS — the permission rule algebra.
 *
 * The named lock for this item is at the bottom: **a rule denying a path causes
 * a REAL tool call to be refused with a reason the model can read, and the
 * serialized file round-trips.** Everything above it exists so that when that
 * one fails, the failure names which part of the algebra broke.
 *
 * DETERMINISM NOTE, and it is the same hazard CANON names for
 * `~/.sequence/ai.json`: `loadPermissionPolicy` reads a USER-scope file out of
 * the real home directory. Every test here that asserts an ALLOW passes
 * `userDir` at an empty temp dir, so a permissions file on the developer's
 * machine cannot turn a green into a red. The one test that loads from the real
 * home is the pipeline test, and it asserts a DENY — which no home file can
 * undo, because deny wins over everything by construction.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const SHOPFRONT = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'shopfront');

function tmpDir(tag: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `sequence-perm-${tag}-`));
}

/**
 * THE TRUST BOUNDARY IS WHY THIS IS HERE.
 *
 * `.sequence/permissions.json` is repo-provided config, and `run_command`
 * spawns the repo's code, so both are refused on an untrusted repository
 * (`server/repoTrust.ts`). These tests are ABOUT what a repo's rules do and
 * what a command run does, so their fixture repo is trusted explicitly —
 * which is the honest spelling: a test that executes in a repository is a
 * test that consented to that repository.
 */
function trust(root: string): string {
  setRepoTrust(userStoreDir(), root, true);
  return root;
}

function shopfrontRepo(): string {
  const repo = path.join(tmpDir('repo'), 'repo');
  fs.cpSync(SHOPFRONT, repo, { recursive: true });
  return trust(repo);
}

/** A policy built from literal rule lists, with both other sources silenced. */
function policyFrom(doc: Partial<PermissionDocument>, repoRoot?: string): PermissionPolicy {
  const root = trust(repoRoot ?? tmpDir('policy'));
  writePermissionsDocument(root, { ...emptyPermissionDocument(), ...doc });
  const policy = loadPermissionPolicy(root, {
    knownTools: ASK_TOOL_ALLOWLIST,
    userDir: tmpDir('nouser'),
    managedRaw: '',
  });
  // A test whose rule string did not parse is a test that proves nothing, and
  // this helper is used by twelve of them. Caught one already: `*.env` is not a
  // rule (a rule is `tool` or `tool(specifier)`), and without this line the
  // propose_files test below asserted a deny against an EMPTY ruleset.
  assert.deepStrictEqual(policy.warnings, [], 'the fixture rules must all parse');
  return policy;
}

function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/* ═══════════════════════════════════════════════════ 1. the rule string ═════ */

test('rule strings: bare tool, tool with specifier, and the canonical round-trip', () => {
  assert.deepStrictEqual(parsePermissionRule('git_status'), { tool: 'git_status' });
  assert.deepStrictEqual(parsePermissionRule('read_file(/src/**)'), {
    tool: 'read_file',
    specifier: '/src/**',
  });
  assert.deepStrictEqual(parsePermissionRule('  run_command( pnpm * ) '), {
    tool: 'run_command',
    specifier: 'pnpm *',
  });
  assert.strictEqual(formatPermissionRule({ tool: 'read_file', specifier: '/src/**' }), 'read_file(/src/**)');
  assert.strictEqual(formatPermissionRule({ tool: 'git_status' }), 'git_status');
});

test('rule strings: `*` is a whole-tool wildcard and NEVER carries a specifier', () => {
  assert.deepStrictEqual(parsePermissionRule('*'), { tool: '*' });
  // A `*` specifier would have to mean a path glob for read_file and a command
  // glob for run_command in the same breath. Refused by name, not guessed at.
  assert.strictEqual(parsePermissionRule('*(src/**)'), null);
});

test('rule strings: an empty specifier is a typo, not the bare tool', () => {
  // Reading `read_file()` as `read_file` would silently WIDEN the rule the user
  // wrote from one path to every path.
  assert.strictEqual(parsePermissionRule('read_file()'), null);
  assert.strictEqual(parsePermissionRule('read_file(   )'), null);
  assert.strictEqual(parsePermissionRule(''), null);
  assert.strictEqual(parsePermissionRule('read file'), null);
  assert.strictEqual(parsePermissionRule('read_file(/a/**'), null);
});

/* ══════════════════════════════════ 2. the four path-anchoring forms ════════ */

test('path form 1 of 4 — `/glob` is anchored at the REPO ROOT', () => {
  assert.ok(matchPathSpecifier('/src/**', 'src/a/b.ts'));
  // The whole point of the leading slash: it is THIS repo's src, not any src.
  assert.ok(!matchPathSpecifier('/src/**', 'packages/web2/src/a.ts'));
});

test('path form 2 of 4 — `//glob` is anchored at the FILESYSTEM', () => {
  const root = fs.realpathSync(tmpDir('abs'));
  const absGlob = `//${toPosix(root).replace(/^\/+/, '')}/**`;
  assert.ok(matchPathSpecifier(absGlob, 'secrets/key.pem', root));
  // Same repo-relative subject, a different absolute root ⇒ no match.
  const other = fs.realpathSync(tmpDir('abs2'));
  assert.ok(!matchPathSpecifier(absGlob, 'secrets/key.pem', other));
});

test('path form 3 of 4 — `~/glob` is anchored at the USER HOME', () => {
  const home = toPosix(os.homedir()).replace(/\/+$/, '');
  const repo = `${home}/proj`;
  assert.ok(matchPathSpecifier('~/proj/**', 'src/a.ts', repo));
  assert.ok(!matchPathSpecifier('~/elsewhere/**', 'src/a.ts', repo));
});

test('path form 4 of 4 — a bare glob is UNANCHORED: root and any depth', () => {
  assert.ok(matchPathSpecifier('*.env', '.env'), 'matches at the root');
  assert.ok(matchPathSpecifier('*.env', 'packages/gateway/.env'), 'matches at depth');
  // And this is what makes form 4 distinct from form 1 rather than decorative:
  assert.ok(matchPathSpecifier('/.env', '.env'));
  assert.ok(!matchPathSpecifier('/.env', 'packages/gateway/.env'));
});

test('path forms: `//` and `~/` are UNEVALUABLE without a repo root, and say no', () => {
  // A rule that cannot be evaluated must never read as satisfied.
  assert.ok(!matchPathSpecifier('//etc/**', 'etc/passwd'));
  assert.ok(!matchPathSpecifier('~/.ssh/**', '.ssh/id_rsa'));
});

test('path globs: `*` stops at a separator, `**` crosses it', () => {
  assert.ok(matchPathSpecifier('/src/*.ts', 'src/a.ts'));
  assert.ok(!matchPathSpecifier('/src/*.ts', 'src/deep/a.ts'));
  assert.ok(matchPathSpecifier('/src/**/*.ts', 'src/deep/a.ts'));
});

/* ═════════════════════════════ 3. command and mcp specifiers ═══════════════ */

test('command specifier: `*` spans spaces, because a command is not a path', () => {
  const policy = policyFrom({ deny: ['run_command(pnpm *)'] });
  const denied = evaluatePermission(policy, {
    tool: 'run_command',
    subjects: [{ kind: 'command', value: 'pnpm run build' }],
  });
  assert.strictEqual(denied.decision, 'deny', 'a path-style matcher would stop at the first space');
  const other = evaluatePermission(policy, {
    tool: 'run_command',
    subjects: [{ kind: 'command', value: 'npm test' }],
  });
  assert.strictEqual(other.decision, 'allow');
});

test('mcp specifier: a bare server name covers every tool on that server', () => {
  const policy = policyFrom({ deny: ['call_mcp(github)'], allow: ['call_mcp(linear:*)'] });
  assert.strictEqual(
    evaluatePermission(policy, { tool: 'call_mcp', subjects: [{ kind: 'mcp', value: 'github:create_issue' }] })
      .decision,
    'deny',
  );
  assert.strictEqual(
    evaluatePermission(policy, { tool: 'call_mcp', subjects: [{ kind: 'mcp', value: 'linear:list' }] }).decision,
    'allow',
  );
});

test('call_plugin subjects honour deny(plugin) like MCP', () => {
  const policy = policyFrom({ deny: ['call_plugin(demo)'], allow: ['call_plugin(other:*)'] });
  assert.strictEqual(
    evaluatePermission(policy, {
      tool: 'call_plugin',
      subjects: [{ kind: 'plugin', value: 'demo:ping' }],
    }).decision,
    'deny',
  );
  assert.strictEqual(
    evaluatePermission(policy, {
      tool: 'call_plugin',
      subjects: [{ kind: 'plugin', value: 'other:ping' }],
    }).decision,
    'allow',
  );
});

/* ════════════════════════════════════════ 4. subject extraction ════════════ */

test('permissionSubjects: the tools that expose a path expose it, one per file', () => {
  assert.deepStrictEqual(permissionSubjects('read_file', { path: 'a.ts' }), [{ kind: 'path', value: 'a.ts' }]);
  assert.deepStrictEqual(permissionSubjects('git_diff', { path: 'a.ts' }), [{ kind: 'path', value: 'a.ts' }]);
  assert.deepStrictEqual(
    permissionSubjects('propose_files', { files: [{ path: 'a.ts', content: '' }, { path: 'b.ts', content: '' }] }),
    [{ kind: 'path', value: 'a.ts' }, { kind: 'path', value: 'b.ts' }],
  );
  assert.deepStrictEqual(permissionSubjects('run_command', { cmd: 'pnpm test' }), [
    { kind: 'command', value: 'pnpm test' },
  ]);
  assert.deepStrictEqual(permissionSubjects('call_mcp', { server: 'gh', tool: 'x' }), [
    { kind: 'mcp', value: 'gh:x' },
  ]);
  assert.deepStrictEqual(permissionSubjects('call_plugin', { plugin: 'demo', tool: 'ping' }), [
    { kind: 'plugin', value: 'demo:ping' },
  ]);
});

test('permissionSubjects: search_files and git_status expose NOTHING, and that is the truth', () => {
  // search_files OPENS AND GREPS every file under the jail; the glob only
  // filters what comes back. A `search_files(/src/**)` rule would promise a
  // containment the tool does not honour.
  assert.deepStrictEqual(permissionSubjects('search_files', { glob: '**/*.ts', query: 'x' }), []);
  assert.deepStrictEqual(permissionSubjects('git_status', {}), []);
});

test('a specifier rule cannot match a call with no subject — it does not match vacuously', () => {
  const policy = policyFrom({ deny: ['search_files(/src/**)'] });
  const v = evaluatePermission(policy, { tool: 'search_files', subjects: [] });
  assert.strictEqual(v.decision, 'allow', 'a specifier with nothing to match must not fire');
  const bare = policyFrom({ deny: ['search_files'] });
  assert.strictEqual(evaluatePermission(bare, { tool: 'search_files', subjects: [] }).decision, 'deny');
});

/* ══════════════════════════════════════════ 5. the precedence order ════════ */

test('precedence: deny > ask > allow > default, and SPECIFICITY DOES NOT BREAK TIES', () => {
  const policy = policyFrom({
    // The allow is strictly more specific than the deny. It still loses.
    deny: ['read_file(/src/**)'],
    allow: ['read_file(/src/config/app.ts)'],
  });
  const v = evaluatePermission(policy, {
    tool: 'read_file',
    subjects: [{ kind: 'path', value: 'src/config/app.ts' }],
  });
  assert.strictEqual(v.decision, 'deny');
  assert.strictEqual(v.rule, 'read_file(/src/**)');
});

test('precedence: an ask beats an allow on the same path', () => {
  const policy = policyFrom({ ask: ['run_command(pnpm publish*)'], allow: ['run_command(pnpm *)'] });
  const v = evaluatePermission(policy, {
    tool: 'run_command',
    subjects: [{ kind: 'command', value: 'pnpm publish --access public' }],
  });
  assert.strictEqual(v.decision, 'ask');
});

test('precedence: rules UNION across sources — a user-file deny beats a project-file allow', () => {
  const repo = trust(tmpDir('src-precedence'));
  const userDir = tmpDir('userscope');
  writePermissionsDocument(repo, { ...emptyPermissionDocument(), allow: ['read_file(/secrets/**)'] });
  fs.writeFileSync(
    path.join(userDir, PERMISSIONS_FILE),
    serializePermissionsDocument({ ...emptyPermissionDocument(), deny: ['read_file(/secrets/**)'] }),
    'utf8',
  );
  const policy = loadPermissionPolicy(repo, { userDir, managedRaw: '', knownTools: ASK_TOOL_ALLOWLIST });
  assert.deepStrictEqual(policy.sources, ['project', 'user']);
  const v = evaluatePermission(policy, {
    tool: 'read_file',
    subjects: [{ kind: 'path', value: 'secrets/key.pem' }],
  });
  // A refusal must survive being included from somewhere weaker.
  assert.strictEqual(v.decision, 'deny');
  assert.strictEqual(v.source, 'user');
});

test('precedence: SCALARS take the strongest source that actually SET them', () => {
  const repo = trust(tmpDir('scalars'));
  const userDir = tmpDir('scalars-user');
  // Project sets `default` but says nothing about denyStreak.
  fs.mkdirSync(path.dirname(permissionsFilePath(repo)), { recursive: true });
  fs.writeFileSync(permissionsFilePath(repo), JSON.stringify({ default: 'deny' }), 'utf8');
  fs.writeFileSync(
    path.join(userDir, PERMISSIONS_FILE),
    JSON.stringify({ default: 'allow', denyStreak: 7 }),
    'utf8',
  );
  const policy = loadPermissionPolicy(repo, { userDir, managedRaw: '', knownTools: ASK_TOOL_ALLOWLIST });
  assert.strictEqual(policy.default, 'deny', 'project set it, project wins');
  assert.strictEqual(policy.denyStreak, 7, 'project did NOT set it, so it must not overwrite the user value');
});

test('precedence: managed (env-shaped) outranks both files on a scalar', () => {
  const repo = tmpDir('managed');
  writePermissionsDocument(repo, { ...emptyPermissionDocument(), default: 'allow', denyStreak: 9 });
  const policy = loadPermissionPolicy(repo, {
    userDir: tmpDir('managed-user'),
    managedRaw: JSON.stringify({ default: 'deny', denyStreak: 1, deny: ['run_command'] }),
    knownTools: ASK_TOOL_ALLOWLIST,
  });
  assert.strictEqual(policy.default, 'deny');
  assert.strictEqual(policy.denyStreak, 1);
  assert.strictEqual(policy.sources[0], 'managed');
});

test('precedence: nothing matched ⇒ the document default, and it names itself', () => {
  const open = policyFrom({});
  const v1 = evaluatePermission(open, { tool: 'read_file', subjects: [{ kind: 'path', value: 'a.ts' }] });
  assert.strictEqual(v1.decision, 'allow');
  assert.strictEqual(v1.source, 'default');
  assert.strictEqual(v1.rule, undefined);

  const closed = policyFrom({ default: 'deny', allow: ['read_file(/src/**)'] });
  const v2 = evaluatePermission(closed, { tool: 'read_file', subjects: [{ kind: 'path', value: 'other/a.ts' }] });
  assert.strictEqual(v2.decision, 'deny', 'an allowlist-only posture is one line in the file');
  assert.match(v2.reason, /"default": "deny"/);
  const v3 = evaluatePermission(closed, { tool: 'read_file', subjects: [{ kind: 'path', value: 'src/a.ts' }] });
  assert.strictEqual(v3.decision, 'allow');
});

test('precedence: `*` denies every tool, including ones with no subject', () => {
  const policy = policyFrom({ deny: ['*'] });
  for (const tool of ASK_TOOL_ALLOWLIST) {
    assert.strictEqual(evaluatePermission(policy, { tool }).decision, 'deny', tool);
  }
});

test('propose_files: ONE denied path among four allowed ones denies the whole call', () => {
  const policy = policyFrom({ deny: ['propose_files(*.env)'] });
  const v = evaluatePermission(policy, {
    tool: 'propose_files',
    subjects: permissionSubjects('propose_files', {
      files: [
        { path: 'src/a.ts', content: '' },
        { path: 'src/b.ts', content: '' },
        { path: 'gateway/.env', content: '' },
        { path: 'src/c.ts', content: '' },
      ],
    }),
  });
  // A partially-applied proposal is not a thing this tool can produce, so the
  // only honestly reportable answer is to refuse the whole set.
  assert.strictEqual(v.decision, 'deny');
  assert.strictEqual(v.subject, 'gateway/.env');
});

/* ═════════════════════════════════════ 6. serialization, round-trip ════════ */

test('the file round-trips: serialize → parse → serialize is byte-identical', () => {
  const doc: PermissionDocument = {
    version: 1,
    default: 'ask',
    denyStreak: 2,
    deny: ['read_file(**/*.env)', 'call_mcp(github)'],
    ask: ['run_command(pnpm *)'],
    allow: ['read_file(/src/**)', 'git_status'],
  };
  const text = serializePermissionsDocument(doc);
  const { doc: back, warnings } = parsePermissionsDocument(text, 'round-trip', ASK_TOOL_ALLOWLIST);
  assert.deepStrictEqual(warnings, []);
  assert.strictEqual(serializePermissionsDocument(back), text, 'round-trip must be byte-identical');
  assert.deepStrictEqual(back, { ...doc, deny: [...doc.deny].sort(), allow: [...doc.allow].sort() });
});

test('the file is written to be REVIEWED: precedence key order, sorted lists, trailing newline', () => {
  const text = serializePermissionsDocument({
    ...emptyPermissionDocument(),
    deny: ['read_file(/z)', 'read_file(/a)'],
  });
  const keys = Object.keys(JSON.parse(text) as Record<string, unknown>);
  assert.deepStrictEqual(keys, ['$schema', 'version', 'default', 'denyStreak', 'deny', 'ask', 'allow'],
    'the file reads top to bottom in the order it is evaluated');
  assert.ok(text.endsWith('\n'));
  assert.ok(text.includes('  "deny": [\n    "read_file(/a)",\n    "read_file(/z)"\n  ]'),
    'lists sorted, so two people adding the same rule produce the same diff');
});

test('a rule that does not parse is a NAMED WARNING, never a silent drop', () => {
  const { doc, warnings } = parsePermissionsDocument(
    JSON.stringify({ deny: ['read_file(', 'read_file()', 42, 'read_file(/ok)'] }),
    'test.json',
    ASK_TOOL_ALLOWLIST,
  );
  assert.deepStrictEqual(doc.deny, ['read_file(/ok)']);
  assert.strictEqual(warnings.length, 3);
  assert.ok(warnings.some((w) => w.includes('"read_file(" in "deny" is not a rule')));
  assert.ok(warnings.every((w) => w.startsWith('test.json:')));
});

test('a rule naming a tool that does not exist is a warning — it could never fire', () => {
  const { doc, warnings } = parsePermissionsDocument(
    JSON.stringify({ deny: ['read_files(/src/**)'] }),
    'test.json',
    ASK_TOOL_ALLOWLIST,
  );
  assert.deepStrictEqual(doc.deny, ['read_files(/src/**)'], 'kept — the user wrote it');
  assert.ok(warnings.some((w) => w.includes('names a tool that does not exist')));
  assert.ok(warnings.some((w) => w.includes('read_file')), 'the warning lists the real names');
});

test('a malformed file loses NO rules quietly — it says it loaded none', () => {
  const { doc, warnings } = parsePermissionsDocument('{not json', 'broken.json');
  assert.deepStrictEqual(doc, emptyPermissionDocument());
  assert.ok(warnings[0].includes('NO RULES LOADED'));
});

test('no permissions file anywhere ⇒ the empty policy, and nothing changes', () => {
  const policy = loadPermissionPolicy(tmpDir('nofile'), { userDir: tmpDir('nofile-user'), managedRaw: '' });
  assert.deepStrictEqual(policy.rules, []);
  assert.deepStrictEqual(policy.sources, []);
  assert.strictEqual(policy.default, 'allow');
  assert.strictEqual(policy.denyStreak, DEFAULT_DENY_STREAK);
});

test('writePermissionsDocument round-trips through the real filesystem', () => {
  const repo = trust(tmpDir('write'));
  const doc = { ...emptyPermissionDocument(), deny: ['read_file(**/*.env)'], denyStreak: 5 };
  const file = writePermissionsDocument(repo, doc);
  assert.strictEqual(file, permissionsFilePath(repo));
  assert.ok(fs.existsSync(file));
  const policy = loadPermissionPolicy(repo, { userDir: tmpDir('write-user'), managedRaw: '' });
  assert.strictEqual(policy.denyStreak, 5);
  assert.strictEqual(policy.rules.length, 1);
  assert.strictEqual(policy.rules[0].text, 'read_file(**/*.env)');
  assert.strictEqual(policy.rules[0].source, 'project');
});

/* ═════════════════════════════════════════ 7. the circuit breaker ══════════ */

test('circuit breaker: trips on N consecutive non-allow verdicts', () => {
  const b = new PermissionCircuitBreaker(3);
  assert.ok(!b.record('deny'));
  assert.ok(!b.record('ask'));
  assert.ok(b.record('deny'), 'three in a row trips it');
  assert.strictEqual(b.consecutive, 3);
});

test('circuit breaker: an ALLOWED call breaks the streak', () => {
  const b = new PermissionCircuitBreaker(3);
  b.record('deny');
  b.record('deny');
  b.record('allow');
  assert.ok(!b.record('deny'));
  assert.strictEqual(b.consecutive, 1);
});

test('circuit breaker: `0` disables it', () => {
  const b = new PermissionCircuitBreaker(0);
  for (let i = 0; i < 20; i++) assert.ok(!b.record('deny'));
});

/* ══════════════════ 8. THE NAMED LOCK — a real tool call is refused ════════ */

test('THE LOCK: a deny rule REFUSES a real read_file, and the reason names the rule and the file', async () => {
  const repo = fs.realpathSync(shopfrontRepo());
  const target = 'gateway/src/routes/orders.ts';
  const ctx = {
    resolveReadable: (rel: string) => resolveInRepo(repo, rel),
    repoRoot: repo,
    designMode: false,
  };

  // CONTROL: with no rule, the very same call reads the very same real bytes.
  const control = await executeAskTool('read_file', { path: target }, {
    ...ctx,
    permissions: policyFrom({}, tmpDir('lock-control')),
  });
  assert.strictEqual(control.ok, true, 'CONTROL: unrestricted, the read succeeds');
  assert.ok((control.content ?? '').includes('ordersRouter'), 'CONTROL: real file body');

  // THE LOCK: one line in .sequence/permissions.json, and the same call is refused.
  const denied = await executeAskTool('read_file', { path: target }, {
    ...ctx,
    permissions: policyFrom({ deny: ['read_file(/gateway/**)'] }, tmpDir('lock-deny')),
  });
  assert.strictEqual(denied.ok, false);
  assert.strictEqual(denied.content, undefined, 'not one byte of a denied file reaches the prompt');
  assert.strictEqual(denied.permission?.decision, 'deny');
  // The reason is not "refused". It is everything the model needs to act.
  assert.ok(denied.evidence.includes('read_file(/gateway/**)'), `rule text absent from: ${denied.evidence}`);
  assert.ok(denied.evidence.includes(target), 'the subject that was refused');
  assert.ok(denied.evidence.includes(`.sequence/${PERMISSIONS_FILE}`), 'WHICH file to open');
  assert.ok(/do not retry/i.test(denied.evidence), 'a retry costs a whole provider round');
});

test('THE LOCK, other half: `ask` refuses too, because no approval channel is open', async () => {
  const repo = fs.realpathSync(shopfrontRepo());
  const r = await executeAskTool('run_command', { cmd: 'pnpm test' }, {
    resolveReadable: (rel: string) => resolveInRepo(repo, rel),
    repoRoot: repo,
    designMode: false,
    permissions: policyFrom({ ask: ['run_command(pnpm *)'] }, tmpDir('lock-ask')),
  });
  // Treating `ask` as `allow` would be the surface asserting a consent the
  // engine never collected.
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.permission?.decision, 'ask');
  assert.strictEqual(r.commandLog, undefined, 'nothing was spawned');
  assert.ok(/approval/i.test(r.evidence), r.evidence);
  assert.ok(r.evidence.includes('run_command(pnpm *)'));
});

test('an ALLOW rule runs the tool for real and records that a rule said yes', async () => {
  const repo = fs.realpathSync(shopfrontRepo());
  const r = await executeAskTool('read_file', { path: 'gateway/src/routes/orders.ts' }, {
    resolveReadable: (rel: string) => resolveInRepo(repo, rel),
    repoRoot: repo,
    designMode: false,
    permissions: policyFrom({ default: 'deny', allow: ['read_file(/gateway/**)'] }, tmpDir('lock-allow')),
  });
  assert.strictEqual(r.ok, true);
  assert.ok((r.content ?? '').includes('ordersRouter'));
  // "a rule said yes" and "no rule matched" are different states.
  assert.strictEqual(r.permission?.decision, 'allow');
  assert.strictEqual(r.permission?.rule, 'read_file(/gateway/**)');
});

/* ═══════════════ 9. THE MODEL IS TOLD — end to end through the pipeline ════ */

function makeProviderScript(
  scripts: { text: string; toolRequests?: ReadonlyArray<{ id: string; name: string; args?: Record<string, unknown> }> }[],
): { calls: string[]; callProvider: AskPipelineInput['callProvider'] } {
  const calls: string[] = [];
  let i = 0;
  const callProvider: AskPipelineInput['callProvider'] = async (_cfg, prompt) => {
    calls.push(prompt);
    const canned = scripts[Math.min(i, scripts.length - 1)];
    i++;
    return { text: canned.text, ...(canned.toolRequests ? { toolRequests: canned.toolRequests } : {}) };
  };
  return { calls, callProvider };
}

async function makeAttachedInput(
  repo: string,
  callProvider: AskPipelineInput['callProvider'],
): Promise<AskPipelineInput> {
  const root = fs.realpathSync(repo);
  const graph = await scanRepo(repo, { cluster: true });
  return {
    question: 'How does the gateway route orders in the source code?',
    intents: [],
    scopeLines: [],
    surface: undefined,
    deictic: false,
    design: undefined,
    designMode: false,
    askMode: 'implementation',
    graph,
    digest: buildDigest(graph),
    cfg: { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test' },
    resolveReadable: (rel) => resolveInRepo(root, rel),
    repoRoot: root,
    callProvider,
  };
}

test('THE LOCK, end to end: the pipeline loads .sequence/permissions.json off disk and TELLS the model', async () => {
  const repo = shopfrontRepo();
  // A real file, written by the real writer, in the real place.
  writePermissionsDocument(repo, {
    ...emptyPermissionDocument(),
    deny: ['read_file(**/*.env)', 'read_file(/gateway/**)'],
  });

  const { calls, callProvider } = makeProviderScript([
    {
      text: 'Reading the orders route.',
      toolRequests: [{ id: 't1', name: 'read_file', args: { path: 'gateway/src/routes/orders.ts' } }],
    },
    { text: 'I could not read that file — your rules deny it.' },
  ]);
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(await makeAttachedInput(repo, callProvider), (e) => events.push(e));

  assert.strictEqual(calls.length, 2, 'the loop still runs a second round');
  // THE REFUSAL IS IN THE PROMPT THE MODEL COMPOSED ROUND 2 WITH.
  assert.ok(calls[1].includes('read_file(/gateway/**)'), 'the rule text reached the model');
  assert.ok(calls[1].includes('DENIED'), 'the model is told it was denied, not that the tool errored');
  // NOT ONE BYTE OF THE DENIED FILE REACHED THE PROMPT — BY EITHER DOOR.
  //
  // Asserting `!calls[1].includes('ordersRouter')` looked like the right check
  // and is a LIE: the symbol is also in the graph digest, so that assertion
  // fails on a correct implementation and would have been "fixed" by weakening
  // it. The honest invariant is that the denied read added NOTHING — the
  // round-2 prompt carries exactly what round 1 carried.
  //
  // The `### <path>` assertion is the one that found the real defect. That
  // header is emitted by BOTH `executeReadFile` and FILE RESEARCH, and file
  // research reads bodies automatically before the model asks for anything. It
  // was present here on the first run: the tool was refused and the file was
  // delivered anyway, one section higher in the same prompt. Both doors are now
  // gated on the same `resolveReadable`; the CONTROL below proves the header
  // IS there without the rule, so this is not a string that never appears.
  assert.ok(!calls[0].includes('### gateway/src/routes/orders.ts'), 'file research did not deliver it either');
  assert.ok(!calls[1].includes('### gateway/src/routes/orders.ts'), 'no read_file body section');
  assert.strictEqual(
    count(calls[1], 'ordersRouter'),
    count(calls[0], 'ordersRouter'),
    'the denied read contributed zero new mentions of the file it was denied',
  );

  const toolDone = events.find((e) => e.type === 'tool:done') as { evidence?: string } | undefined;
  assert.ok(toolDone, 'tool:done still emitted — a refusal is not silence');
  assert.ok((toolDone.evidence ?? '').includes('read_file(/gateway/**)'), toolDone.evidence);

  assert.strictEqual(result.text, 'I could not read that file — your rules deny it.');
});

test('THE BREAKER, end to end: three refusals in a row stop the loop and the answer SAYS SO', async () => {
  const repo = shopfrontRepo();
  writePermissionsDocument(repo, {
    ...emptyPermissionDocument(),
    deny: ['read_file'],
    denyStreak: 3,
  });
  // The model asks for three denied reads in one round, then would keep going.
  const { calls, callProvider } = makeProviderScript([
    {
      text: '',
      toolRequests: [
        { id: 't1', name: 'read_file', args: { path: 'gateway/src/routes/orders.ts' } },
        { id: 't2', name: 'read_file', args: { path: 'gateway/src/index.ts' } },
        { id: 't3', name: 'read_file', args: { path: 'package.json' } },
      ],
    },
    { text: 'never reached' },
  ]);
  const result = await runAskPipeline(await makeAttachedInput(repo, callProvider), () => {});

  assert.strictEqual(calls.length, 1, 'the breaker stopped the loop before a second provider round');
  assert.match(result.text, /stopped early/i);
  assert.match(result.text, /3 tool calls in a row were refused/);
  assert.ok(result.text.includes(`.sequence/${PERMISSIONS_FILE}`), 'names the file to open');
});

test('THE BREAKER: it does not fire on tool failures that are not permission events', async () => {
  const repo = shopfrontRepo();
  // No permissions file at all. Three reads that all fail on their own terms.
  const { calls, callProvider } = makeProviderScript([
    {
      text: '',
      toolRequests: [
        { id: 't1', name: 'read_file', args: { path: 'nope-a.ts' } },
        { id: 't2', name: 'read_file', args: { path: 'nope-b.ts' } },
        { id: 't3', name: 'read_file', args: { path: 'nope-c.ts' } },
      ],
    },
    { text: 'Those files do not exist.' },
  ]);
  const result = await runAskPipeline(await makeAttachedInput(repo, callProvider), () => {});
  assert.strictEqual(calls.length, 2, 'a permissions breaker must not trip on ENOENT');
  assert.strictEqual(result.text, 'Those files do not exist.');
  assert.ok(!/stopped early/i.test(result.text));
});

test('CONTROL for the two doors: with no rule, BOTH deliver the same file', async () => {
  const repo = shopfrontRepo();
  // No permissions file. Same question, same repo, same request.
  const { calls, callProvider } = makeProviderScript([
    {
      text: 'Reading the orders route.',
      toolRequests: [{ id: 't1', name: 'read_file', args: { path: 'gateway/src/routes/orders.ts' } }],
    },
    { text: 'The gateway proxies orders via ordersRouter.' },
  ]);
  await runAskPipeline(await makeAttachedInput(repo, callProvider), () => {});
  // If this ever goes false, the assertions in the lock above become vacuous —
  // they would be asserting the absence of a string that is never present.
  const anyHeader = calls.some((c) => c.includes('### gateway/src/routes/orders.ts'));
  assert.ok(anyHeader, 'unrestricted, the file body IS delivered — so the deny above removed something real');
  assert.ok(calls[1].includes('### gateway/src/routes/orders.ts'), 'the tool door delivers it');
});

test('THE BREAKER: a stopped run says so even when the model DID write words', async () => {
  const repo = shopfrontRepo();
  writePermissionsDocument(repo, { ...emptyPermissionDocument(), deny: ['read_file'], denyStreak: 3 });
  // The red-proof found this gap: every other breaker test has the model return
  // an EMPTY final text, so the "always ends in words" funnel wrote the note
  // either way and reverting the append to a replace stayed GREEN. A model that
  // narrates and THEN gets refused is the case that separates them — and it is
  // the dangerous one, because the user reads a confident paragraph with no
  // sign that the agent was cut off.
  const { callProvider } = makeProviderScript([
    {
      text: 'Here is what I have so far from the graph.',
      toolRequests: [
        { id: 't1', name: 'read_file', args: { path: 'gateway/src/routes/orders.ts' } },
        { id: 't2', name: 'read_file', args: { path: 'gateway/src/index.ts' } },
        { id: 't3', name: 'read_file', args: { path: 'package.json' } },
      ],
    },
    { text: 'never reached' },
  ]);
  const result = await runAskPipeline(await makeAttachedInput(repo, callProvider), () => {});
  assert.ok(result.text.includes('Here is what I have so far'), "the model's own words are kept");
  assert.match(result.text, /stopped early/i, 'and the harness says the run was cut short');
});

test('a DENY on one write tool also covers the other write tool', () => {
  /*
   * THE SECOND WRITE DOOR. `propose_files` was the only way the agent could change
   * a file, so an owner who wrote `deny propose_files(/secrets/**)` meant "the agent
   * cannot write there". `edit_file` opened a second door the same rule cannot name,
   * and nobody re-reads their permission file because a new tool shipped — the deny
   * would have kept passing while the protection silently lapsed.
   */
  const policy = policyFrom({ deny: ['propose_files(/secrets/**)'] });
  const viaEdit = evaluatePermission(policy, {
    tool: 'edit_file',
    subjects: [{ kind: 'path', value: '/secrets/keys.ts' }],
  });
  assert.strictEqual(viaEdit.decision, 'deny', 'edit_file must not walk through a propose_files deny');

  /* And the reverse, so neither door is the privileged one. */
  const reverse = policyFrom({ deny: ['edit_file(/secrets/**)'] });
  assert.strictEqual(
    evaluatePermission(reverse, {
      tool: 'propose_files',
      subjects: [{ kind: 'path', value: '/secrets/keys.ts' }],
    }).decision,
    'deny',
  );

  /* A path the rule does not name is untouched — the widening is about WHICH TOOL,
     never about which path. */
  assert.notStrictEqual(
    evaluatePermission(policy, {
      tool: 'edit_file',
      subjects: [{ kind: 'path', value: '/src/app.ts' }],
    }).decision,
    'deny',
  );
});

test('an ALLOW is NOT widened across write tools', () => {
  /*
   * The same aliasing pointed the other way would GRANT more than the reader wrote:
   * "allow propose_files(/src/**)" means proposals are reviewable, and must not silently
   * become "and direct edits too". Deny widens; allow does not.
   *
   * Asserted on WHICH RULE DECIDED, not on the decision: the empty-policy default is
   * already "allow", so a decision check here would pass without the aliasing ever
   * being consulted and would prove nothing.
   */
  const policy = policyFrom({ allow: ['propose_files(/src/**)'] });
  const viaEdit = evaluatePermission(policy, {
    tool: 'edit_file',
    subjects: [{ kind: 'path', value: '/src/app.ts' }],
  });
  assert.strictEqual(
    viaEdit.rule,
    undefined,
    'the propose_files allow must not be the rule that decided an edit_file call',
  );

  /* The same call against its OWN tool does match the rule — so the fixture is live. */
  const viaPropose = evaluatePermission(policy, {
    tool: 'propose_files',
    subjects: [{ kind: 'path', value: '/src/app.ts' }],
  });
  assert.strictEqual(viaPropose.rule, 'propose_files(/src/**)');
});

/* ═══════════ 10. G2 — EVERY dispatch path passes the gate, not just one ════ */

/*
 * Harness-checklist audit G2. `executeAskTool` evaluated the rules AFTER five
 * early-return branches — the canvas writers, the story route, the Work-mode
 * `run_command` refusal, `fetch_url`, and design mode — and every one of them
 * dispatched (or refused on its own terms) before the gate ran. The reported
 * shape: `deny fetch_url(*)` parsed, validated against `knownTools`, produced
 * no warning, and never fired. Each test below is a path that used to walk
 * past the gate, with a CONTROL proving the same call runs without the rule.
 */

/** The url `netFetchUrl` lets through under the loopback escape hatch the existing fetch_url tests use. */
const G2_LOOPBACK_URL = 'http://127.0.0.1:9/doc';

function stubFetch(): { calls: () => number; restore: () => void } {
  let n = 0;
  const prevFetch = globalThis.fetch;
  const prevEnv = process.env.SEQUENCE_RESEARCH_ALLOW_LOOPBACK;
  process.env.SEQUENCE_RESEARCH_ALLOW_LOOPBACK = G2_LOOPBACK_URL;
  globalThis.fetch = async () => {
    n++;
    return new Response('<html><body><p>Hello web</p></body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
  };
  return {
    calls: () => n,
    restore: () => {
      globalThis.fetch = prevFetch;
      if (prevEnv === undefined) delete process.env.SEQUENCE_RESEARCH_ALLOW_LOOPBACK;
      else process.env.SEQUENCE_RESEARCH_ALLOW_LOOPBACK = prevEnv;
    },
  };
}

test('G2 LOCK, the reported shape: `deny fetch_url(*)` REFUSES a real fetch_url and nothing is fetched', async () => {
  const net = stubFetch();
  try {
    const ctx = { resolveReadable: () => null, repoRoot: null, designMode: true };
    // CONTROL: no rule, the same call goes to the (stubbed) network and succeeds.
    const control = await executeAskTool('fetch_url', { url: G2_LOOPBACK_URL }, {
      ...ctx,
      permissions: policyFrom({}, tmpDir('g2-fetch-control')),
    });
    assert.strictEqual(control.ok, true, `CONTROL: ${control.evidence}`);
    assert.strictEqual(net.calls(), 1, 'CONTROL: the fetch stub was really called');
    assert.ok((control.content ?? '').includes('Hello web'), 'CONTROL: real body delivered');

    const denied = await executeAskTool('fetch_url', { url: G2_LOOPBACK_URL }, {
      ...ctx,
      permissions: policyFrom({ deny: ['fetch_url(*)'] }, tmpDir('g2-fetch-deny')),
    });
    assert.strictEqual(denied.ok, false, 'deny fetch_url(*) must refuse — it used to dispatch before the gate');
    assert.strictEqual(net.calls(), 1, 'a denied fetch must not touch the network');
    assert.strictEqual(denied.content, undefined, 'not one byte of a denied page reaches the prompt');
    assert.strictEqual(denied.permission?.decision, 'deny');
    assert.ok(denied.evidence.includes('fetch_url(*)'), `rule text absent from: ${denied.evidence}`);
    assert.ok(denied.evidence.includes(G2_LOOPBACK_URL), 'the url that was refused');
    assert.ok(/do not retry/i.test(denied.evidence));

    // THE BREAKER SEES IT. `applyAskToolRoundResult` feeds exactly this
    // expression to the breaker; a bypassed call carried no verdict and so
    // read as `allow`, RESETTING a deny streak the user's rules had built.
    const breaker = new PermissionCircuitBreaker(2);
    breaker.record('deny');
    assert.ok(
      breaker.record(denied.permission?.decision ?? 'allow'),
      'a denied fetch_url counts toward the streak instead of clearing it',
    );
  } finally {
    net.restore();
  }
});

test('G2 LOCK: `deny *` refuses a canvas.write_* tool, and `"default": "deny"` covers it', async () => {
  /*
   * The canvas branch was the FIRST early return in `executeAskTool`, so a
   * `"default": "deny"` file — the allowlist-only posture the module promises
   * is "one line" — still let the model write blocks to the canvas. The rules
   * here are `*` and the default rather than the tool's name because
   * `RULE_RE` accepts snake_case only and cannot spell `canvas.write_markdown`
   * (see the test after next); the gate is the same either way.
   */
  const ctx = { resolveReadable: () => null, repoRoot: null, designMode: true, canvasToolsEnabled: true };
  const args = { content: '# Plan\n\nStep 1.' };

  const control = await executeAskTool('canvas.write_markdown', args, {
    ...ctx,
    permissions: policyFrom({}, tmpDir('g2-canvas-control')),
  });
  assert.strictEqual(control.ok, true, `CONTROL: ${control.evidence}`);
  assert.strictEqual(control.canvasBlock?.type, 'markdown', 'CONTROL: a block was produced');

  const denied = await executeAskTool('canvas.write_markdown', args, {
    ...ctx,
    permissions: policyFrom({ deny: ['*'] }, tmpDir('g2-canvas-deny')),
  });
  assert.strictEqual(denied.ok, false, 'the canvas branch used to return before the gate');
  assert.strictEqual(denied.canvasBlock, undefined, 'no block reaches the canvas');
  assert.strictEqual(denied.permission?.decision, 'deny');
  assert.ok(denied.evidence.includes('canvas.write_markdown is DENIED'), denied.evidence);

  // An allowlist-only file must be allowlist-only for the canvas too.
  const closed = await executeAskTool('canvas.write_markdown', args, {
    ...ctx,
    permissions: policyFrom({ default: 'deny' }, tmpDir('g2-canvas-closed')),
  });
  assert.strictEqual(closed.ok, false);
  assert.strictEqual(closed.canvasBlock, undefined);
  assert.strictEqual(closed.permission?.decision, 'deny');
  assert.match(closed.evidence, /"default": "deny"/);
});

test('G2 LOCK: the story route is a policy subject too', async () => {
  const ctx = { resolveReadable: () => null, repoRoot: null, designMode: true, canvasToolsEnabled: true };
  const denied = await executeAskTool('canvas.set_story_route', { title: 'Tour', steps: [] }, {
    ...ctx,
    permissions: policyFrom({ deny: ['*'] }, tmpDir('g2-story-deny')),
  });
  assert.strictEqual(denied.ok, false);
  assert.strictEqual(denied.storyRoute, undefined);
  assert.strictEqual(denied.permission?.decision, 'deny');
  assert.ok(denied.evidence.includes('canvas.set_story_route is DENIED'), denied.evidence);
});

test('G2 LOCK: the design-mode branch dispatches propose_topology THROUGH the gate', async () => {
  const ctx = { resolveReadable: () => null, repoRoot: null, designMode: true };
  const args = { title: 'Sketch', nodes: [], edges: [] };

  // CONTROL: no rule decided it. Whether the sketch is accepted is the tool's
  // business; what matters here is that no verdict was attached.
  const control = await executeAskTool('propose_topology', args, {
    ...ctx,
    permissions: policyFrom({}, tmpDir('g2-design-control')),
  });
  assert.strictEqual(control.permission, undefined, 'CONTROL: no rule matched');
  assert.ok(!/DENIED/.test(control.evidence), control.evidence);

  const denied = await executeAskTool('propose_topology', args, {
    ...ctx,
    permissions: policyFrom({ deny: ['propose_topology'] }, tmpDir('g2-design-deny')),
  });
  assert.strictEqual(denied.ok, false, 'the design-mode branch used to dispatch before the gate');
  assert.strictEqual(denied.topology, undefined, 'no proposal reaches the board');
  assert.strictEqual(denied.permission?.decision, 'deny');
  assert.ok(denied.evidence.includes('propose_topology'), denied.evidence);
});

test('G2 LOCK: the Work-mode run_command branch sits below the gate — `deny run_command(*)` is a permission verdict', async () => {
  /*
   * REVIEW (tests): the audit named five bypassing paths and the lock section
   * covered four. The fifth was the Work-mode run_command branch, which used to
   * refuse with its own "not a Work-mode default" text BEFORE the policy ran —
   * so a deny rule never fired and the breaker never counted it. Under a
   * policy the verdict now wins; with no matching rule the mode gate still
   * refuses on its own terms and claims no permission event it did not have.
   */
  const ctx = { resolveReadable: () => null, repoRoot: tmpDir('g2-work-root'), designMode: false, jobMode: 'work' as const };
  const denied = await executeAskTool('run_command', { cmd: 'pnpm test' }, {
    ...ctx,
    permissions: policyFrom({ deny: ['run_command(*)'] }, tmpDir('g2-work-deny')),
  });
  assert.strictEqual(denied.ok, false);
  assert.strictEqual(denied.permission?.decision, 'deny', 'the policy, not the mode text, is the refusal');
  assert.ok(denied.evidence.includes('run_command(*)'), `rule text absent from: ${denied.evidence}`);
  assert.ok(!denied.commandLog, 'nothing ran');

  const modeOnly = await executeAskTool('run_command', { cmd: 'pnpm test' }, {
    ...ctx,
    permissions: policyFrom({}, tmpDir('g2-work-control')),
  });
  assert.strictEqual(modeOnly.ok, false);
  assert.match(modeOnly.evidence, /Work-mode/, 'no rule matched ⇒ the mode gate speaks');
  assert.notStrictEqual(modeOnly.permission?.decision, 'deny', 'a code-level refusal is not a deny the breaker should count');
});

test('G2: an unknown tool is still "unknown", not a permission event', async () => {
  // The gate runs only for names `executeAskTool` can dispatch. A typo must
  // not read as a deny — the breaker would count it, and the model would be
  // told a rule the user never wrote refused it.
  const r = await executeAskTool('read_files', { path: 'a.ts' }, {
    resolveReadable: () => null,
    repoRoot: null,
    designMode: true,
    permissions: policyFrom({ deny: ['*'] }, tmpDir('g2-unknown')),
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.permission, undefined);
  assert.match(r.evidence, /unknown tool "read_files"/);
});

test('G2: the gate covers every dispatchable name, and a rule that cannot NAME one says so out loud', () => {
  // Everything `executeAskTool` dispatches sits behind the one gate — the
  // allowlist plus the dotted canvas names the allowlist never carried.
  for (const tool of ASK_TOOL_ALLOWLIST) assert.ok(ASK_DISPATCHABLE_TOOLS.includes(tool), tool);
  assert.ok(ASK_DISPATCHABLE_TOOLS.includes('canvas.write_markdown'));
  assert.ok(ASK_DISPATCHABLE_TOOLS.includes('canvas.set_story_route'));
  // The rule grammar is snake_case only, so a canvas tool cannot be named by a
  // rule yet — and that is a NAMED warning, not a rule that quietly never
  // fires. If this assertion ever flips, the parser learned to spell the dot
  // and the two canvas locks above should switch from `*` to the tool name.
  const { doc, warnings } = parsePermissionsDocument(
    JSON.stringify({ deny: ['canvas.write_html'] }),
    'test.json',
    ASK_DISPATCHABLE_TOOLS,
  );
  assert.deepStrictEqual(doc.deny, []);
  assert.strictEqual(warnings.length, 1);
  assert.ok(warnings[0].includes('"canvas.write_html" in "deny" is not a rule'), warnings[0]);
});

test('G2 BREAKER, end to end: three denied fetch_url calls trip the breaker instead of resetting it', async () => {
  const repo = shopfrontRepo();
  writePermissionsDocument(repo, {
    ...emptyPermissionDocument(),
    deny: ['fetch_url(*)'],
    denyStreak: 3,
  });
  const net = stubFetch();
  try {
    const { calls, callProvider } = makeProviderScript([
      {
        text: '',
        toolRequests: [
          // Loopback urls, so that even WITHOUT the fix (where these dispatched)
          // the SSRF guard refuses them before any socket opens — the mutation
          // proof of this lock never touches DNS or the network either way.
          { id: 't1', name: 'fetch_url', args: { url: 'http://127.0.0.1:9/a' } },
          { id: 't2', name: 'fetch_url', args: { url: 'http://127.0.0.1:9/b' } },
          { id: 't3', name: 'fetch_url', args: { url: 'http://127.0.0.1:9/c' } },
        ],
      },
      { text: 'never reached' },
    ]);
    const result = await runAskPipeline(await makeAttachedInput(repo, callProvider), () => {});
    assert.strictEqual(net.calls(), 0, 'no denied url was fetched');
    assert.strictEqual(calls.length, 1, 'the breaker stopped the loop before a second provider round');
    assert.match(result.text, /stopped early/i);
    assert.match(result.text, /3 tool calls in a row were refused/);
  } finally {
    net.restore();
  }
});
