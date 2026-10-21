import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createProviderProbe,
  parseClaudeStatus,
  parseCodexStatus,
  parseVersion,
  type ProviderStatus,
  CLAUDE_ACP_PACKAGE,
  spawnBinAsync,
} from '../server/providerProbe.js';

/**
 * Lock for the first-run provider probe. Every binary here is a FAKE this test
 * writes into its own temp dir: a tiny node script answering fixed output per
 * argv, behind a `.cmd` shim on Windows (which also exercises the cmd.exe
 * fallback a real npm shim needs) or a `sh` wrapper elsewhere. The real
 * `claude` / `codex` on the machine are never run, because the PATH searched
 * is the temp dir alone.
 */

interface FakeReply {
  stdout?: string;
  stderr?: string;
  code?: number;
  delayMs?: number;
}

const FAKE_SCRIPT = `import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const [name, ...args] = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(here, name + '.json'), 'utf8'));
const r = cfg[args.join(' ')] ?? { stderr: 'unknown command', code: 2 };
setTimeout(() => {
  process.stdout.write(r.stdout ?? '');
  process.stderr.write(r.stderr ?? '');
  process.exitCode = r.code ?? 0;
}, r.delayMs ?? 0);
`;

/*
 * THE CAP IS NOT WHAT THESE TESTS MEASURE. Each fake answers in milliseconds,
 * but under a loaded full suite spawning a node shim can take seconds, and the
 * production 3 s cap then returned 'checking' (seen 2026-10-05). The cap
 * itself is proven by the hung-fake test below, with its own short cap.
 */
const FAKE_CAP_MS = 15_000;

function tempDir(prefix: string): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** Write a fake `name` binary into `dir` that answers `replies[argv.join(' ')]`. */
function fakeBin(dir: string, name: string, replies: Record<string, FakeReply>): void {
  fs.writeFileSync(path.join(dir, 'fake.mjs'), FAKE_SCRIPT);
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(replies));
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(dir, `${name}.cmd`), `@"${process.execPath}" "%~dp0fake.mjs" ${name} %*\r\n`);
  } else {
    const p = path.join(dir, name);
    fs.writeFileSync(p, `#!/bin/sh\nexec "${process.execPath}" "${path.join(dir, 'fake.mjs')}" ${name} "$@"\n`);
    fs.chmodSync(p, 0o755);
  }
}

const CLAUDE_SIGNED_IN: Record<string, FakeReply> = {
  '--version': { stdout: '9.9.1 (Claude Code)\n' },
  'auth status --json': {
    stdout: JSON.stringify({
      loggedIn: true,
      authMethod: 'claude.ai',
      apiProvider: 'firstParty',
      email: 'someone@example.com',
      orgName: 'someone@example.com Org',
      subscriptionType: 'max',
    }),
  },
};

const CODEX_SIGNED_IN: Record<string, FakeReply> = {
  '--version': { stdout: 'codex-cli 7.8.9\n' },
  // Measured: codex can print the status on stderr.
  'login status': { stderr: 'Logged in using ChatGPT\n' },
};

function byId(list: ProviderStatus[], id: string): ProviderStatus {
  const p = list.find((x) => x.id === id);
  assert.ok(p, `provider ${id} present`);
  return p;
}

test('round 7 (A4): Claude signed in WITHOUT its ACP bridge is "adapter", with the install command, not ready', async () => {
  const dir = tempDir('seq-probe-nobridge-');
  fakeBin(dir, 'claude', CLAUDE_SIGNED_IN);
  const { providers } = await createProviderProbe({ pathValue: dir, extraDirs: [], capMs: FAKE_CAP_MS }).get();
  const claude = byId(providers, 'claude');
  assert.strictEqual(claude.state, 'adapter');
  assert.strictEqual(claude.adapterInstall, `npm install -g ${CLAUDE_ACP_PACKAGE}`);
  /* The older bridge bin counts too. */
  fakeBin(dir, 'claude-code-acp', {});
  assert.strictEqual(byId((await createProviderProbe({ pathValue: dir, extraDirs: [], capMs: FAKE_CAP_MS }).get()).providers, 'claude').state, 'ready');
});

test('round 13: a signed-OUT Claude without its bridge reports both up front (one flow)', async () => {
  const dir = tempDir('seq-probe-signedout-nobridge-');
  fakeBin(dir, 'claude', {
    '--version': { stdout: '9.9.1 (Claude Code)\n' },
    'auth status --json': { stdout: JSON.stringify({ loggedIn: false }) },
  });
  const probe = () => createProviderProbe({ pathValue: dir, extraDirs: [], capMs: FAKE_CAP_MS }).get();
  const out = byId((await probe()).providers, 'claude');
  assert.strictEqual(out.state, 'signIn');
  assert.strictEqual(out.bridgeMissing, true);
  assert.strictEqual(out.adapterInstall, `npm install -g ${CLAUDE_ACP_PACKAGE}`);
  /* With the bridge on PATH the same signed-out Claude is only a sign-in. */
  fakeBin(dir, 'claude-agent-acp', {});
  const withBridge = byId((await probe()).providers, 'claude');
  assert.strictEqual(withBridge.state, 'signIn');
  assert.strictEqual(withBridge.bridgeMissing, undefined);
});

test('UX study 2026-10-09: a signed-OUT Claude without its bridge reports the bridge too (signIn + adapterInstall), so the card can offer one step', async () => {
  const dir = tempDir('seq-probe-out-nobridge-');
  fakeBin(dir, 'claude', {
    '--version': { stdout: '9.9.1 (Claude Code)\n' },
    'auth status --json': { stdout: '{"loggedIn": false, "authMethod": "none"}', code: 1 },
  });
  fakeBin(dir, 'codex', { '--version': { stdout: 'codex-cli 7.8.9\n' }, 'login status': { stdout: 'Not logged in\n', code: 1 } });
  const { providers } = await createProviderProbe({ pathValue: dir, extraDirs: [], capMs: FAKE_CAP_MS }).get();
  const claude = byId(providers, 'claude');
  assert.strictEqual(claude.state, 'signIn');
  assert.strictEqual(claude.adapterInstall, `npm install -g ${CLAUDE_ACP_PACKAGE}`);
  /* Codex has no bridge: nothing to report. */
  assert.strictEqual(byId(providers, 'codex').adapterInstall, undefined);
  /* With the bridge on PATH a signed-out Claude needs sign-in only. */
  fakeBin(dir, 'claude-agent-acp', {});
  const again = byId((await createProviderProbe({ pathValue: dir, extraDirs: [], capMs: FAKE_CAP_MS }).get()).providers, 'claude');
  assert.deepStrictEqual({ state: again.state, adapterInstall: again.adapterInstall }, { state: 'signIn', adapterInstall: undefined });
});

test('installed and signed in: version, ready, plan label; the email never leaves the probe', async () => {
  const dir = tempDir('seq-probe-in-');
  fakeBin(dir, 'claude', CLAUDE_SIGNED_IN);
  fakeBin(dir, 'claude-agent-acp', {});
  fakeBin(dir, 'codex', CODEX_SIGNED_IN);
  const { providers } = await createProviderProbe({ pathValue: dir, extraDirs: [], capMs: FAKE_CAP_MS }).get();
  const claude = byId(providers, 'claude');
  assert.deepStrictEqual(
    { installed: claude.installed, version: claude.version, state: claude.state, plan: claude.plan },
    { installed: true, version: '9.9.1', state: 'ready', plan: 'Claude Max' },
  );
  assert.strictEqual(claude.signInCommand, 'claude auth login');
  assert.match(claude.installHint, /npm install -g @anthropic-ai\/claude-code/);
  const codex = byId(providers, 'codex');
  assert.deepStrictEqual(
    { installed: codex.installed, version: codex.version, state: codex.state, plan: codex.plan },
    { installed: true, version: '7.8.9', state: 'ready', plan: 'ChatGPT' },
  );
  assert.strictEqual(codex.signInCommand, 'codex login');
  assert.ok(!JSON.stringify(providers).includes('example.com'), 'no email in the response');
});

test('NEGATIVE: not installed -> installed:false, state install, no version', async () => {
  const dir = tempDir('seq-probe-none-');
  const { providers } = await createProviderProbe({ pathValue: dir, extraDirs: [], capMs: FAKE_CAP_MS }).get();
  for (const id of ['claude', 'codex']) {
    const p = byId(providers, id);
    assert.deepStrictEqual({ installed: p.installed, version: p.version, state: p.state }, { installed: false, version: null, state: 'install' });
  }
});

test('NEGATIVE: signed out -> state signIn (claude exits 1 with loggedIn:false; codex "Not logged in")', async () => {
  const dir = tempDir('seq-probe-out-');
  fakeBin(dir, 'claude', {
    '--version': { stdout: '9.9.1 (Claude Code)\n' },
    'auth status --json': { stdout: '{"loggedIn": false, "authMethod": "none", "apiProvider": "firstParty"}', code: 1 },
  });
  fakeBin(dir, 'codex', { '--version': { stdout: 'codex-cli 7.8.9\n' }, 'login status': { stdout: 'Not logged in\n', code: 1 } });
  const { providers } = await createProviderProbe({ pathValue: dir, extraDirs: [], capMs: FAKE_CAP_MS }).get();
  assert.strictEqual(byId(providers, 'claude').state, 'signIn');
  assert.strictEqual(byId(providers, 'claude').plan, undefined);
  assert.strictEqual(byId(providers, 'codex').state, 'signIn');
  assert.strictEqual(byId(providers, 'codex').installed, true);
});

test('a status command that answers nonsense -> attention (installed, not guessed)', async () => {
  const dir = tempDir('seq-probe-att-');
  fakeBin(dir, 'claude', { '--version': { stdout: '9.9.1\n' }, 'auth status --json': { stderr: 'boom', code: 3 } });
  const { providers } = await createProviderProbe({ pathValue: dir, extraDirs: [], capMs: FAKE_CAP_MS }).get();
  const claude = byId(providers, 'claude');
  assert.deepStrictEqual({ installed: claude.installed, state: claude.state }, { installed: true, state: 'attention' });
});

test('a binary only in an extra install dir (~/.local/bin style) is found', async () => {
  const empty = tempDir('seq-probe-path-');
  const extra = tempDir('seq-probe-extra-');
  fakeBin(extra, 'claude', CLAUDE_SIGNED_IN);
  fakeBin(extra, 'claude-agent-acp', {});
  const { providers } = await createProviderProbe({ pathValue: empty, extraDirs: [extra], capMs: FAKE_CAP_MS }).get();
  assert.strictEqual(byId(providers, 'claude').state, 'ready');
  // Control: without the extra dir it is not installed.
  const without = await createProviderProbe({ pathValue: empty, extraDirs: [], capMs: FAKE_CAP_MS }).get();
  assert.strictEqual(byId(without.providers, 'claude').state, 'install');
});

test('results are cached until refresh=true', async () => {
  const dir = tempDir('seq-probe-cache-');
  fakeBin(dir, 'claude', CLAUDE_SIGNED_IN);
  fakeBin(dir, 'claude-agent-acp', {});
  const probe = createProviderProbe({ pathValue: dir, extraDirs: [], capMs: FAKE_CAP_MS });
  assert.strictEqual(byId((await probe.get()).providers, 'claude').state, 'ready');
  fakeBin(dir, 'claude', { ...CLAUDE_SIGNED_IN, 'auth status --json': { stdout: '{"loggedIn":false}', code: 1 } });
  assert.strictEqual(byId((await probe.get()).providers, 'claude').state, 'ready', 'served from cache');
  assert.strictEqual(byId((await probe.get(true)).providers, 'claude').state, 'signIn', 'refresh re-probes');
});

test('a hung status command is cut off at the cap; the answer comes back in bounded time', async () => {
  const dir = tempDir('seq-probe-hang-');
  fakeBin(dir, 'claude', { '--version': { stdout: '9.9.1\n' }, 'auth status --json': { stdout: '{"loggedIn":true}', delayMs: 20_000 } });
  const t0 = Date.now();
  const { providers } = await createProviderProbe({ pathValue: dir, extraDirs: [], capMs: 1500 }).get();
  const ms = Date.now() - t0;
  assert.ok(ms < 4000, `bounded: ${ms}ms`);
  const claude = byId(providers, 'claude');
  assert.ok(claude.state === 'attention' || claude.state === 'checking', `not ready: ${claude.state}`);
});

test('parsers: versions, claude JSON fields whitelisted, codex plan', () => {
  assert.strictEqual(parseVersion('2.1.280 (Claude Code)'), '2.1.280');
  assert.strictEqual(parseVersion('codex-cli 0.153.4'), '0.153.4');
  assert.strictEqual(parseVersion('no digits'), null);
  assert.deepStrictEqual(parseClaudeStatus('{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}'), { loggedIn: true });
  assert.deepStrictEqual(parseClaudeStatus('{"loggedIn":true,"apiProvider":"bedrock"}'), { loggedIn: true, plan: 'Bedrock' });
  assert.deepStrictEqual(parseClaudeStatus('{"loggedIn":true,"subscriptionType":"a@b.c"}'), { loggedIn: true });
  assert.strictEqual(parseClaudeStatus('not json'), null);
  assert.strictEqual(parseClaudeStatus('{"other":1}'), null);
  // The masked key fragment and the email never make it into the plan label.
  assert.deepStrictEqual(parseCodexStatus('Logged in using an API key - sk-proj-***abc\n', ''), { loggedIn: true, plan: 'API key' });
  assert.deepStrictEqual(parseCodexStatus('Logged in using ChatGPT (me@x.io)', ''), { loggedIn: true, plan: 'ChatGPT' });
  assert.deepStrictEqual(parseCodexStatus('Logged in using something-new 2.0', ''), { loggedIn: true });
  assert.deepStrictEqual(parseCodexStatus('', 'Not logged in'), { loggedIn: false });
  assert.strictEqual(parseCodexStatus('error: something', ''), null);
});

test('Windows probe fallback runs the shim by its absolute path, never the bare name cmd.exe would look up in the current folder', async (t) => {
  if (process.platform === 'win32') return t.skip('simulated on POSIX; a real Windows run starts the shim directly');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-w1-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  /* A planted claude.bat in the folder the app was started from, and an a shim elsewhere whose target cannot be read. */
  fs.writeFileSync(path.join(dir, 'claude.bat'), '@echo planted');
  const shim = path.join(dir, 'bin dir', 'claude.cmd');
  /* Stand-ins: the platform reads win32; the shim path is not on disk, so the direct spawn fails to start
     (ENOENT, as a .cmd does on Windows) and no shim target can be read; ComSpec is echo, so the fallback's
     argv comes back as stdout. */
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const realComSpec = process.env.ComSpec;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  process.env.ComSpec = '/bin/echo';
  try {
    const fallback = await spawnBinAsync(shim, 'claude', ['--version'], process.env, 5000);
    assert.ok(fallback.started, 'the fallback started');
    assert.ok(fallback.stdout.includes(shim), `cmd line names the shim by absolute path: ${fallback.stdout}`);
    assert.ok(!/(^|\s)claude(\s|$)/.test(fallback.stdout.replace(shim, '')), `no bare "claude" for cmd to resolve: ${fallback.stdout}`);
  } finally {
    Object.defineProperty(process, 'platform', realPlatform);
    if (realComSpec === undefined) delete process.env.ComSpec;
    else process.env.ComSpec = realComSpec;
  }
});

/*
 * Handoff 019 item 11: an API key already in the environment makes the
 * provider Ready without a pasted key. The probe reports only WHERE the key
 * came from (`keySource`), never the value, and the response body never
 * carries it. The key comes from the `keyEnv` seam, so tests never read the
 * machine's real environment.
 */
test('019-11: ANTHROPIC_API_KEY in the environment makes a signed-OUT Claude Ready, source env, no key in the body', async () => {
  const dir = tempDir('seq-probe-envkey-claude-');
  fakeBin(dir, 'claude', {
    '--version': { stdout: '9.9.1 (Claude Code)\n' },
    'auth status --json': { stdout: JSON.stringify({ loggedIn: false }) },
  });
  fakeBin(dir, 'claude-agent-acp', {});
  const FAKE_KEY = 'sk-test-fake';
  const response = await createProviderProbe({ pathValue: dir, extraDirs: [], capMs: FAKE_CAP_MS, keyEnv: { ANTHROPIC_API_KEY: FAKE_KEY } }).get();
  const claude = byId(response.providers, 'claude');
  assert.strictEqual(claude.keySource, 'env');
  assert.strictEqual(claude.state, 'ready');
  assert.ok(!JSON.stringify(response).includes(FAKE_KEY), 'the response body never carries the key value');
});

test('019-11: OPENAI_API_KEY in the environment reports Codex key source env, and the body has no key value', async () => {
  const dir = tempDir('seq-probe-envkey-codex-');
  fakeBin(dir, 'codex', CODEX_SIGNED_IN);
  const FAKE_KEY = 'sk-test-fake-openai';
  const response = await createProviderProbe({ pathValue: dir, extraDirs: [], capMs: FAKE_CAP_MS, keyEnv: { OPENAI_API_KEY: FAKE_KEY } }).get();
  assert.strictEqual(byId(response.providers, 'codex').keySource, 'env');
  assert.strictEqual(byId(response.providers, 'claude').keySource, 'none');
  assert.ok(!JSON.stringify(response).includes(FAKE_KEY), 'the response body never carries the key value');
});

test('019-11: with neither key variable set, no provider reports a key from the environment', async () => {
  const dir = tempDir('seq-probe-nokey-');
  fakeBin(dir, 'claude', {
    '--version': { stdout: '9.9.1 (Claude Code)\n' },
    'auth status --json': { stdout: JSON.stringify({ loggedIn: false }) },
  });
  const { providers } = await createProviderProbe({ pathValue: dir, extraDirs: [], capMs: FAKE_CAP_MS, keyEnv: {} }).get();
  const claude = byId(providers, 'claude');
  assert.strictEqual(claude.keySource, 'none');
  assert.strictEqual(claude.state, 'signIn', 'a signed-out Claude with no key stays signed out');
  assert.strictEqual(byId(providers, 'codex').keySource, 'none');
});
