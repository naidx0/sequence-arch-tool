/**
 * The REA install routine, its registration in .sequence/mcp.json, the MCP contract Sequence relies on, and the
 * /api/rea routes. The subject is the REAL routine (real git, real npm, real node) pointed at a LOCAL BARE CLONE of a
 * small fixture repository: no network, no real REA. The fixture's server speaks REA's tool shapes (the captured
 * catalog), so the contract checks run Sequence's own MCP client against it.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { REA_CATALOG } from '../components/reaCatalog.js';
import {
  REA_PIN,
  installRea,
  isInstalled,
  npmCliPath,
  reaAgentServer,
  reaEntry,
  reaInstallDir,
  reaRegistration,
  reaStatus,
  registerRea,
  removeRea,
  resolveOnPath,
  unregisterRea,
  type ProgressEvent,
  type RunResult,
  type Runner,
  sealedEnv,
  systemRunner,
} from '../components/reaInstall.js';
import { REA_READ_ONLY_TOOLS, reaAgentToolNames } from '../components/reaTools.js';
import { callMcpTool, listMcpTools, loadMcpConfigFromFile } from '../server/mcpClient.js';
import { createRepoServer } from '../server/repoServer.js';
import { setRepoTrust } from '../server/repoTrust.js';
import { userStoreDir } from '../server/store.js';

const FIXTURE_VERSION = 'fixture-1';
const tmp = (label: string): string => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `sequence-rea-${label}-`)));

/** The fixture's `scripts/rea.mjs`: `--version`, and a stdio MCP server that answers with REA's captured tool shapes. */
function fakeReaSource(): string {
  const catalog = REA_CATALOG.map((t) => ({ name: t.name, surface: t.surface, required: t.required, effects: t.effects }));
  return `import readline from 'node:readline';
const VERSION = ${JSON.stringify(FIXTURE_VERSION)};
const CATALOG = ${JSON.stringify(catalog)};
if (process.argv[2] === '--version') { console.log(VERSION); process.exit(0); }
if (process.argv[2] === 'doctor') {
  /* like the real doctor: on Windows without the native files it says so, and it exits 1 while any engine is missing */
  const fs = await import('node:fs'); const path = await import('node:path'); const url = await import('node:url');
  const here = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
  const native = process.platform !== 'win32' || fs.existsSync(path.join(here, 'native', 'windows', 'build', 'manifest.json'));
  const checks = [
    { name: 'node', ok: true, classification: 'healthy', detail: process.versions.node },
    { name: 'hopper', ok: false, classification: 'missing_analysis_engine' },
    { name: 'ghidra', ok: false, classification: 'missing_analysis_engine' },
    { name: 'ida-registration', ok: false, classification: 'missing_analysis_engine' },
    { name: 'jadx', ok: false, classification: 'missing_dependency', ...(native ? {} : { detail: 'REA Windows native controls are unavailable: Missing packaged Windows native file native/windows/build/manifest.json (ENOENT).' }) },
  ];
  console.log(JSON.stringify({ healthy: false, environment_healthy: false, checks, scope_checks: checks }));
  process.exit(1);
}
if (process.argv[2] !== 'mcp') process.exit(2);
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n');
const text = (t, isError = false) => ({ content: [{ type: 'text', text: JSON.stringify(t) }], ...(isError ? { isError: true } : {}) });
const groups = () => {
  const by = new Map();
  for (const t of CATALOG) { const k = t.surface + '|' + t.effects.join(','); const g = by.get(k) ?? { names: [], surface: t.surface, effects: t.effects, available: true, reason: 'available' }; g.names.push(t.name); by.set(k, g); }
  return [...by.values()];
};
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.id === undefined) return;
  if (m.method === 'initialize') return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {}, prompts: {} }, serverInfo: { name: 'rea', version: VERSION } } });
  if (m.method === 'tools/list') return send({ jsonrpc: '2.0', id: m.id, result: { tools: CATALOG.map((t) => ({ name: t.name, description: t.name, inputSchema: { type: 'object', properties: Object.fromEntries(t.required.map((r) => [r, { type: 'string' }])), required: t.required } })) } });
  if (m.method !== 'tools/call') return send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'no such method' } });
  const { name, arguments: a = {} } = m.params;
  const tool = CATALOG.find((t) => t.name === name);
  if (!tool) return send({ jsonrpc: '2.0', id: m.id, error: { code: -32602, message: 'Tool ' + name + ' not found' } });
  const missing = tool.required.filter((r) => a[r] === undefined);
  if (missing.length) return send({ jsonrpc: '2.0', id: m.id, result: { isError: true, content: [{ type: 'text', text: 'Input validation error: Invalid arguments for tool ' + name + ': missing ' + missing.join(', ') }] } });
  if (name === 'binary_session') return send({ jsonrpc: '2.0', id: m.id, result: text({ result: { open: false, tool_availability: { groups: groups() }, server_identity: { name: 'rea', version: VERSION } } }) });
  if (name === 'open_binary') return send({ jsonrpc: '2.0', id: m.id, result: text({ result: { path: a.path, format: 'asar', kind: 'archive', sha256: 'f'.repeat(64), architecture: null } }) });
  return send({ jsonrpc: '2.0', id: m.id, result: text({ error: { code: 'capability_unavailable', category: 'unsupported_provider', message: 'This analysis is unavailable for the current target.', retryable: false } }, true) });
});
`;
}

interface Fixture {
  url: string;
  commit: string;
  root: string;
}

/** A tiny repository with REA's layout (package.json, a lockfile, scripts/rea.mjs, a compile script), cloned bare. */
function makeFixture(opts: { build?: string; postinstallMarker?: boolean } = {}): Fixture {
  const root = tmp('fixture');
  const work = path.join(root, 'work');
  fs.mkdirSync(path.join(work, 'scripts'), { recursive: true });
  const scripts: Record<string, string> = {
    compile: 'node build.mjs',
    ...(opts.postinstallMarker ? { postinstall: 'node mark.mjs', prepare: 'node mark.mjs' } : {}),
  };
  fs.writeFileSync(path.join(work, 'package.json'), JSON.stringify({ name: 'rea-fixture', version: '6.5.0', private: true, type: 'module', scripts }, null, 2));
  fs.writeFileSync(path.join(work, 'package-lock.json'), JSON.stringify({ name: 'rea-fixture', version: '6.5.0', lockfileVersion: 3, requires: true, packages: { '': { name: 'rea-fixture', version: '6.5.0' } } }, null, 2));
  fs.writeFileSync(path.join(work, 'build.mjs'), opts.build ?? "import fs from 'node:fs'; fs.mkdirSync('dist/mcp', { recursive: true }); fs.writeFileSync('dist/mcp/main.js', '// built\\n');\n");
  fs.writeFileSync(path.join(work, 'mark.mjs'), "import fs from 'node:fs'; fs.writeFileSync('SCRIPT_RAN', '1');\n");
  fs.writeFileSync(path.join(work, 'scripts', 'rea.mjs'), fakeReaSource());
  const git = (cwd: string, ...args: string[]): string => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  git(work, 'init', '-q');
  git(work, 'add', '-A');
  git(work, 'commit', '-q', '-m', 'fixture');
  const commit = git(work, 'rev-parse', 'HEAD');
  const bare = path.join(root, 'bare.git');
  git(root, 'clone', '-q', '--bare', work, bare);
  return { url: pathToFileURL(bare).href, commit, root };
}

const events = (): { list: ProgressEvent[]; on: (e: ProgressEvent) => void } => {
  const list: ProgressEvent[] = [];
  return { list, on: (e) => list.push(e) };
};

test('install: the real routine against a local bare clone builds, verifies and moves into <commit>', async () => {
  const fx = makeFixture({ postinstallMarker: true });
  const userDir = tmp('user');
  const ev = events();
  const r = await installRea({ userDir, repo: fx.url, commit: fx.commit, version: FIXTURE_VERSION, onProgress: ev.on });
  assert.equal(r.ok, true, r.ok ? '' : `${r.step}: ${r.error}`);
  if (!r.ok) return;
  const dir = reaInstallDir(userDir, fx.commit);
  assert.equal(r.installDir, dir);
  assert.equal(path.relative(userDir, dir).split(path.sep).join('/'), `components/rea/${fx.commit}`, 'under the user store, in components/rea/<commit>');
  assert.equal(r.manifest.commit, fx.commit);
  assert.equal(r.manifest.version, FIXTURE_VERSION);
  assert.equal(r.manifest.source, fx.url);
  assert.ok(fs.existsSync(reaEntry(dir)) && fs.existsSync(path.join(dir, 'dist', 'mcp', 'main.js')));
  assert.ok(!fs.existsSync(path.join(dir, '.git')), 'the git folder is dropped');
  assert.deepEqual(fs.readdirSync(path.join(userDir, 'components', 'rea')), [fx.commit], 'no .partial-* folder is left behind');
  assert.deepEqual(ev.list.filter((e) => e.state === 'done').map((e) => e.step), ['fetch', 'install', 'build', 'prune', 'verify', 'doctor']);
  assert.equal(r.doctor?.ran, true, 'the doctor ran after the move and its answer was read');
  assert.equal(isInstalled(userDir, fx.commit), true);
  /* --ignore-scripts: neither the postinstall nor the prepare hook of the fetched project ran */
  assert.equal(fs.existsSync(path.join(dir, 'SCRIPT_RAN')), false, "a dependency or project install script ran; --ignore-scripts did not hold");
});

test('install: asking again is a no-op that says so, and removeRea deletes only that commit folder', async () => {
  const fx = makeFixture();
  const userDir = tmp('user');
  const first = await installRea({ userDir, repo: fx.url, commit: fx.commit, version: FIXTURE_VERSION });
  assert.ok(first.ok && !first.alreadyInstalled);
  let calls = 0;
  const counting: Runner = (c, a, o) => (calls++, systemRunner(c, a, o));
  const again = await installRea({ userDir, repo: fx.url, commit: fx.commit, version: FIXTURE_VERSION, run: counting });
  assert.ok(again.ok && again.alreadyInstalled);
  assert.equal(calls, 0, 'nothing external ran');
  assert.equal(removeRea(userDir, '../../etc'), false, 'a path-shaped commit is refused');
  assert.equal(removeRea(userDir, fx.commit), true);
  assert.equal(fs.existsSync(path.join(userDir, 'components', 'rea', fx.commit)), false);
  assert.equal(removeRea(userDir, fx.commit), false, 'already gone');
});

test('install: a commit the repository does not have fails at fetch and leaves nothing installed', async () => {
  const fx = makeFixture();
  const userDir = tmp('user');
  const ev = events();
  const r = await installRea({ userDir, repo: fx.url, commit: 'a'.repeat(40), version: FIXTURE_VERSION, onProgress: ev.on });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.step, 'fetch');
  assert.equal(isInstalled(userDir, 'a'.repeat(40)), false);
  assert.deepEqual(fs.readdirSync(path.join(userDir, 'components', 'rea')), [], 'the partial folder is removed');
  assert.ok(ev.list.some((e) => e.step === 'fetch' && e.state === 'failed'));
  assert.ok(!ev.list.some((e) => e.step === 'install'), 'no later step started');
});

test('install: a checkout that is not the pinned commit is refused even when git says success', async () => {
  const fx = makeFixture();
  const userDir = tmp('user');
  const lying: Runner = async (c, a, o) => (c === 'git' && a[0] === 'rev-parse' ? ({ code: 0, stdout: `${'b'.repeat(40)}\n`, stderr: '' } satisfies RunResult) : systemRunner(c, a, o));
  const r = await installRea({ userDir, repo: fx.url, commit: fx.commit, version: FIXTURE_VERSION, run: lying });
  assert.ok(!r.ok && r.step === 'fetch' && /not the pinned/.test(r.error), JSON.stringify(r));
  assert.equal(isInstalled(userDir, fx.commit), false);
});

test('install: a build that makes no server, and a server that reports another version, are each thrown away', async () => {
  const noServer = makeFixture({ build: "console.log('built nothing');\n" });
  const u1 = tmp('user');
  const r1 = await installRea({ userDir: u1, repo: noServer.url, commit: noServer.commit, version: FIXTURE_VERSION });
  assert.ok(!r1.ok && r1.step === 'verify' && /dist\/mcp\/main\.js is missing/.test(r1.error), JSON.stringify(r1));
  assert.deepEqual(fs.readdirSync(path.join(u1, 'components', 'rea')), []);

  const wrongVersion = makeFixture();
  const u2 = tmp('user');
  const r2 = await installRea({ userDir: u2, repo: wrongVersion.url, commit: wrongVersion.commit, version: '9.9.9' });
  assert.ok(!r2.ok && r2.step === 'verify' && /not the pinned 9\.9\.9/.test(r2.error), JSON.stringify(r2));
  assert.equal(isInstalled(u2, wrongVersion.commit), false);

  const failingBuild = makeFixture({ build: 'process.exit(3);\n' });
  const u3 = tmp('user');
  const r3 = await installRea({ userDir: u3, repo: failingBuild.url, commit: failingBuild.commit, version: FIXTURE_VERSION });
  assert.ok(!r3.ok && r3.step === 'build' && /exit 3/.test(r3.error), JSON.stringify(r3));
});

test('install: a commit that is not a full hash never reaches git', async () => {
  let ran = 0;
  const r = await installRea({ userDir: tmp('user'), commit: 'main', run: async () => (ran++, { code: 0, stdout: '', stderr: '' }) });
  assert.ok(!r.ok && r.step === 'setup');
  assert.equal(ran, 0);
});

test('install: the pinned default is a full hash from github.com/morluto/rea and costs no admin rights (a user-store path)', () => {
  assert.match(REA_PIN.commit, /^[0-9a-f]{40}$/);
  assert.equal(REA_PIN.repo, 'https://github.com/morluto/rea');
  assert.ok(reaInstallDir('/home/x/.sequence').replace(/\\/g, '/').endsWith(`/home/x/.sequence/components/rea/${REA_PIN.commit}`));
});

test('runner: npm runs through its own cli script (no shell, so no .cmd refusal and no shell-args warning)', async () => {
  const found = npmCliPath();
  assert.ok(found, 'npm is installed beside node on this machine');
  assert.ok(fs.existsSync(found.cli) && path.isAbsolute(found.node));
  assert.equal(npmCliPath({ PATH: '' }), null, 'no node on PATH: nothing to find');
  const r = await systemRunner('npm', ['--version'], { env: sealedEnv() });
  assert.equal(r.code, 0);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+/);
  assert.doesNotMatch(r.stderr, /DEP0190/);
});

test('runner: the environment every external step gets turns scripts off and git prompts off', () => {
  const env = sealedEnv({ PATH: 'x', npm_config_ignore_scripts: 'false' });
  assert.equal(env.npm_config_ignore_scripts, 'true', "overrides a person's own setting");
  assert.equal(env.npm_config_audit, 'false');
  assert.equal(env.npm_config_fund, 'false');
  assert.equal(env.HUSKY, '0');
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(env.PATH, 'x');
});

/* ---- registration and the MCP contract, on one real install of the fixture ---- */

async function installedFixture(): Promise<{ fx: Fixture; userDir: string; repo: string; installDir: string }> {
  const fx = makeFixture();
  const userDir = tmp('user');
  const r = await installRea({ userDir, repo: fx.url, commit: fx.commit, version: FIXTURE_VERSION });
  assert.ok(r.ok, r.ok ? '' : r.error);
  const repo = tmp('project');
  return { fx, userDir, repo, installDir: reaInstallDir(userDir, fx.commit) };
}

test('register: writes a pinned absolute entry beside the person\'s own servers, and unregister removes only ours', async () => {
  const { fx, userDir, repo, installDir } = await installedFixture();
  fs.mkdirSync(path.join(repo, '.sequence'));
  fs.writeFileSync(path.join(repo, '.sequence', 'mcp.json'), JSON.stringify({ servers: { mine: { command: 'node', args: ['mine.js'] } } }));
  const node = resolveOnPath('node');
  assert.ok(node && path.isAbsolute(node));
  assert.equal(reaRegistration(repo, userDir).state, 'absent');
  const done = registerRea(repo, userDir, installDir, node);
  assert.deepEqual(done, { ok: true, path: '.sequence/mcp.json' });
  const servers = loadMcpConfigFromFile(repo).config.servers;
  assert.deepEqual(Object.keys(servers).sort(), ['mine', 'rea']);
  assert.equal(servers.rea!.command, node);
  assert.deepEqual(servers.rea!.args, [reaEntry(installDir), 'mcp']);
  assert.deepEqual(servers.mine, { command: 'node', args: ['mine.js'] });
  assert.equal(reaRegistration(repo, userDir).state, 'ours');
  assert.equal(reaStatus(repo, userDir, fx.commit).registration, 'ours');
  assert.equal(unregisterRea(repo, userDir), true);
  assert.deepEqual(Object.keys(loadMcpConfigFromFile(repo).config.servers), ['mine']);
  assert.equal(unregisterRea(repo, userDir), false, 'nothing of ours left to remove');
});

test('register: a server the person named rea themselves is never replaced or removed', async () => {
  const { userDir, repo, installDir } = await installedFixture();
  fs.mkdirSync(path.join(repo, '.sequence'));
  const theirs = { command: 'my-rea', args: ['serve'] };
  fs.writeFileSync(path.join(repo, '.sequence', 'mcp.json'), JSON.stringify({ servers: { rea: theirs } }));
  assert.equal(reaRegistration(repo, userDir).state, 'other');
  const done = registerRea(repo, userDir, installDir, 'node');
  assert.equal(done.ok, false);
  assert.equal(unregisterRea(repo, userDir), false);
  assert.deepEqual(loadMcpConfigFromFile(repo).config.servers.rea, theirs);
});

test('agent server: absent until Add REA registered it; then only the read-only tools are pre-approved', async () => {
  const { fx, userDir, repo, installDir } = await installedFixture();
  assert.equal(reaAgentServer(repo, userDir, fx.commit), null, 'installed but not added: the agent gets nothing');
  assert.ok(registerRea(repo, userDir, installDir, 'node').ok);
  const s = reaAgentServer(repo, userDir, fx.commit)!;
  assert.equal(s.name, 'rea');
  assert.deepEqual(s.args, [reaEntry(installDir), 'mcp']);
  assert.deepEqual(s.allowTools, reaAgentToolNames());
  assert.equal(s.allowTools.length, REA_READ_ONLY_TOOLS.length);
  assert.ok(!s.allowTools.includes('mcp__rea__instrument_with_frida'));
  assert.equal(reaAgentServer(null, userDir, fx.commit), null, 'no project, no server');
  removeRea(userDir, fx.commit);
  assert.equal(reaAgentServer(repo, userDir, fx.commit), null, 'registered but the install is gone');
});

test('contract: Sequence\'s MCP client lists REA\'s 207 tools through the registered entry and reads their effects from binary_session', async () => {
  const { userDir, repo, installDir } = await installedFixture();
  assert.ok(registerRea(repo, userDir, installDir, resolveOnPath('node')!).ok);
  const listed = await listMcpTools(repo);
  assert.deepEqual(listed.errors, []);
  assert.equal(listed.tools.length, 207);
  assert.ok(listed.tools.every((t) => t.server === 'rea'));
  const live = new Set(listed.tools.map((t) => t.name));
  for (const t of REA_CATALOG) assert.ok(live.has(t.name), `${t.name} is in the catalog but the server does not list it`);

  /* the effects Sequence derives the read-only set from arrive the way REA sends them: binary_session -> tool_availability.groups */
  const bs = await callMcpTool(repo, 'rea', 'binary_session', {});
  assert.notEqual(bs.isError, true);
  const body = JSON.parse((bs.content as { text: string }[])[0]!.text) as { result: { tool_availability: { groups: { names: string[]; effects: string[] }[] } } };
  const fromServer = body.result.tool_availability.groups.flatMap((g) => g.names.map((name) => ({ name, surface: 's', required: [], effects: g.effects as never })));
  const { readOnlyToolsOf } = await import('../components/reaTools.js');
  assert.deepEqual(readOnlyToolsOf(fromServer), [...REA_READ_ONLY_TOOLS], 'the live server and the shipped catalog agree on the read-only set');
});

test('contract: open_binary returns REA\'s result shape; a call missing required input is an isError validation answer; an unavailable provider is a coded error', async () => {
  const { userDir, repo, installDir } = await installedFixture();
  assert.ok(registerRea(repo, userDir, installDir, resolveOnPath('node')!).ok);
  const open = await callMcpTool(repo, 'rea', 'open_binary', { path: '/a/tiny-notes.asar' });
  assert.notEqual(open.isError, true);
  assert.deepEqual(JSON.parse((open.content as { text: string }[])[0]!.text), { result: { path: '/a/tiny-notes.asar', format: 'asar', kind: 'archive', sha256: 'f'.repeat(64), architecture: null } });

  const bad = await callMcpTool(repo, 'rea', 'analyze_javascript_application', {});
  assert.equal(bad.isError, true);
  assert.match((bad.content as { text: string }[])[0]!.text, /Input validation error[\s\S]*input_path/);

  const unavailable = await callMcpTool(repo, 'rea', 'analyze_javascript_application', { input_path: '/a/tiny-notes.asar' });
  assert.equal(unavailable.isError, true);
  assert.equal((JSON.parse((unavailable.content as { text: string }[])[0]!.text) as { error: { code: string } }).error.code, 'capability_unavailable');
});

test('contract: the catalog\'s required inputs are what the server enforces (derived for every tool, not hand-listed)', async () => {
  const { userDir, repo, installDir } = await installedFixture();
  assert.ok(registerRea(repo, userDir, installDir, resolveOnPath('node')!).ok);
  const listed = await listMcpTools(repo);
  const withRequired = REA_CATALOG.filter((t) => t.required.length > 0);
  assert.ok(withRequired.length > 50);
  for (const t of withRequired) {
    const schema = listed.tools.find((x) => x.name === t.name)!.inputSchema as { required?: string[] };
    assert.deepEqual(schema.required, [...t.required], t.name);
  }
});

/* ---- the routes ---- */

async function withRoutes<T>(fx: Fixture, fn: (base: string, repo: string, userDir: string) => Promise<T>, extra: Record<string, unknown> = {}): Promise<T> {
  const dir = tmp('route');
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const a = 1;\n');
  setRepoTrust(userStoreDir(), repo, true);
  const userConfigDir = tmp('cfg');
  const server = await createRepoServer(repo, { webDist: undefined, userConfigDir, rea: { repo: fx.url, commit: fx.commit, version: FIXTURE_VERSION, addon: null, ...extra } as never });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  try {
    return await fn(`http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`, repo, userConfigDir);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
}

const json = { 'content-type': 'application/json' };

test('routes: REA is off by default (a GET installs nothing), the plan names the download, and install needs the exact commit and a confirm', async () => {
  const fx = makeFixture();
  await withRoutes(fx, async (base, _repo, userDir) => {
    const plain = (await (await fetch(`${base}/api/rea`)).json()) as { status: { installed: boolean; registration: string }; job: { state: string }; pin: { repo: string; commit: string; downloadMb: number; diskMb: number } };
    assert.equal(plain.status.installed, false);
    assert.equal(plain.status.registration, 'absent');
    assert.equal(plain.job.state, 'idle');
    assert.equal(fs.existsSync(path.join(userDir, 'components')), false, 'nothing was created by asking');

    const withPlan = (await (await fetch(`${base}/api/rea?plan=1`)).json()) as { plan: { steps: { id: string; label: string; command: string }[]; requirements: { name: string; ok: boolean }[]; limitations: string[]; ready: boolean; installDir: string } };
    assert.deepEqual(withPlan.plan.steps.map((s) => s.id), ['fetch', 'install', 'build', 'prune', 'verify']);
    assert.match(withPlan.plan.steps[0]!.label, new RegExp(`${fx.commit.slice(0, 7)}`));
    assert.deepEqual(withPlan.plan.requirements.map((r) => r.name), ['git', 'node', 'npm']);
    assert.ok(withPlan.plan.steps.find((s) => s.id === 'install')!.command.includes('--ignore-scripts'));
    assert.ok(withPlan.plan.limitations.some((l) => /Hopper, Ghidra or IDA/.test(l)));
    assert.equal(withPlan.plan.installDir, reaInstallDir(userDir, fx.commit));

    const post = (body: unknown) => fetch(`${base}/api/rea/install`, { method: 'POST', headers: json, body: JSON.stringify(body) });
    assert.equal((await post({})).status, 400);
    assert.equal((await post({ confirm: true })).status, 400);
    assert.equal((await post({ confirm: true, commit: 'c'.repeat(40) })).status, 400, 'a different commit than the plan showed');
    assert.equal((await post({ confirm: 'yes', commit: fx.commit })).status, 400);
    assert.equal((await fetch(`${base}/api/rea/install`, { method: 'POST', body: '{}' })).status, 415, 'not JSON');
    assert.equal(fs.existsSync(path.join(userDir, 'components')), false, 'every refusal installed nothing');
  });
});

test('routes: install, poll, Add REA, see it in /api/mcp, then remove it', async () => {
  const fx = makeFixture();
  await withRoutes(fx, async (base, repo, userDir) => {
    const post = (p: string, body: unknown = {}) => fetch(`${base}${p}`, { method: 'POST', headers: json, body: JSON.stringify(body) });
    assert.equal((await post('/api/rea/register')).status, 409, 'cannot add what is not installed');
    const started = await post('/api/rea/install', { confirm: true, commit: fx.commit });
    assert.equal(started.status, 202);
    let state = '';
    for (let i = 0; i < 300 && state !== 'done' && state !== 'failed'; i++) {
      const v = (await (await fetch(`${base}/api/rea`)).json()) as { job: { state: string; error?: string } };
      state = v.job.state;
      if (state === 'failed') assert.fail(v.job.error);
      if (state !== 'done') await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(state, 'done');
    const after = (await (await fetch(`${base}/api/rea`)).json()) as { status: { installed: boolean; version: string; registration: string; sizeMb: number }; job: { steps: Record<string, string> } };
    assert.equal(after.status.installed, true);
    assert.equal(after.status.version, FIXTURE_VERSION);
    assert.equal(after.status.registration, 'absent', 'installed but not added to the project');
    assert.deepEqual(Object.values(after.job.steps), ['done', 'done', 'done', 'done', 'done', 'done']);

    const reg = await post('/api/rea/register');
    assert.equal(reg.status, 200);
    assert.equal(reaRegistration(repo, userDir).state, 'ours');
    const mcp = (await (await fetch(`${base}/api/mcp`)).json()) as { document: { servers: Record<string, { command: string; args: string[] }> } };
    assert.ok(mcp.document.servers.rea, 'the Settings MCP editor reads the same entry');
    const tools = (await (await fetch(`${base}/api/mcp/tools`)).json()) as { tools: { server: string; name: string }[]; errors: string[] };
    assert.deepEqual(tools.errors, []);
    assert.equal(tools.tools.filter((t) => t.server === 'rea').length, 207);

    const gone = (await (await fetch(`${base}/api/rea`, { method: 'DELETE', headers: json, body: '{}' })).json()) as { removed: boolean; unregistered: boolean; status: { installed: boolean; registration: string } };
    assert.deepEqual([gone.removed, gone.unregistered, gone.status.installed, gone.status.registration], [true, true, false, 'absent']);
    assert.deepEqual(Object.keys(loadMcpConfigFromFile(repo).config.servers), []);
  });
});

test('routes: a failed install says which step failed, installs nothing, and a retry is allowed', async () => {
  const fx = makeFixture({ build: 'process.exit(5);\n' });
  await withRoutes(fx, async (base, _repo, userDir) => {
    const post = () => fetch(`${base}/api/rea/install`, { method: 'POST', headers: json, body: JSON.stringify({ confirm: true, commit: fx.commit }) });
    assert.equal((await post()).status, 202);
    let v: { job: { state: string; failedStep?: string; error?: string }; status: { installed: boolean } } = { job: { state: 'running' }, status: { installed: false } };
    for (let i = 0; i < 300 && v.job.state === 'running'; i++) {
      v = (await (await fetch(`${base}/api/rea`)).json()) as typeof v;
      if (v.job.state === 'running') await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(v.job.state, 'failed');
    assert.equal(v.job.failedStep, 'build');
    assert.match(v.job.error ?? '', /exit 5/);
    assert.equal(v.status.installed, false);
    assert.equal(isInstalled(userDir, fx.commit), false);
    assert.equal((await post()).status, 202, 'after a failure the install can be tried again');
    for (let i = 0; i < 300 && ((await (await fetch(`${base}/api/rea`)).json()) as typeof v).job.state === 'running'; i++) await new Promise((r) => setTimeout(r, 100));
  });
});
