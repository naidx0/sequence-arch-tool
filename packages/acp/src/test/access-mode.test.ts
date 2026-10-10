import assert from 'node:assert';
import { allowsTool } from '../planMode.js';
import { test } from 'node:test';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  AccessModeRefusedError,
  AcpClient,
  agentKindOf,
  claudeOptionsFor,
  cliArgsFor,
  codexOptionsFor,
  sessionModeIdsFor,
  AGENT_MODES,
  planRefuses,
  codexDeveloperInstructionsFor,
  PLAN_ASK_INSTRUCTION,
  codexThreadInstructionsFor,
  DRAW_INSTRUCTION,
} from '../index.js';
import type { AgentMode } from '../index.js';

/**
 * ACCESS MODES REACH THE AGENT UNCHANGED.
 *
 * The build spec's table, one row per Sequence label. Every row is checked
 * against Claude Code (ACP `_meta.claudeCode.options` and the plain CLI flags)
 * and Codex (approval policy + sandbox, as CLI flags and as codex-acp config
 * overrides). The table is the contract; the functions are checked against it,
 * never the other way round.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(here, '..', '..');
const MOCK_AGENT = path.join(PKG_ROOT, 'src', 'test', 'fixtures', 'mock-agent.mjs');
const FAKE_CODEX = path.join(PKG_ROOT, 'src', 'test', 'fixtures', 'fake-codex.mjs');

interface Row {
  label: string;
  claude: { permissionMode: string; allowDangerouslySkipPermissions?: true };
  claudeCli: string[];
  codex: { approvalPolicy: string; sandbox: string };
  codexCli: string[];
  codexAcp: string[];
  sessionModes: string[];
  /** An edit escalation is declined at once, with no card (owner ruling: Plan makes no changes). */
  refusesEdit: boolean;
  /** Ask the person through request_user_input: codex's thread carries the line (Plan only). */
  asksThroughTool: boolean;
}

/*
 * Keyed by AgentMode, so a mode without a row does not compile, and every
 * loop below walks AGENT_MODES (the set), never this table's own keys.
 */
const TABLE: Record<AgentMode, Row> = {
  /* Plan: Ask's codex dials (on-request + read-only). Live 2026-10-06, `untrusted`
     put every harmless read in front of the person (lab/codex-live-gate.md). */
  plan: {
    label: 'Plan',
    claude: { permissionMode: 'plan' },
    claudeCli: ['--permission-mode', 'plan'],
    codex: { approvalPolicy: 'on-request', sandbox: 'read-only' },
    codexCli: ['-c', 'approval_policy=on-request', '--sandbox', 'read-only'],
    codexAcp: ['-c', 'approval_policy=on-request', '-c', 'sandbox_mode=read-only'],
    sessionModes: ['plan', 'read-only'],
    refusesEdit: true,
    asksThroughTool: true,
  },
  propose: {
    label: 'Ask',
    claude: { permissionMode: 'default' },
    claudeCli: ['--permission-mode', 'default'],
    codex: { approvalPolicy: 'on-request', sandbox: 'read-only' },
    codexCli: ['-c', 'approval_policy=on-request', '--sandbox', 'read-only'],
    codexAcp: ['-c', 'approval_policy=on-request', '-c', 'sandbox_mode=read-only'],
    sessionModes: ['default', 'read-only'],
    refusesEdit: false,
    asksThroughTool: false,
  },
  autoEdit: {
    label: 'Auto-edit',
    claude: { permissionMode: 'acceptEdits' },
    claudeCli: ['--permission-mode', 'acceptEdits'],
    codex: { approvalPolicy: 'on-request', sandbox: 'workspace-write' },
    codexCli: ['-c', 'approval_policy=on-request', '--sandbox', 'workspace-write'],
    codexAcp: ['-c', 'approval_policy=on-request', '-c', 'sandbox_mode=workspace-write'],
    sessionModes: ['acceptEdits', 'auto'],
    refusesEdit: false,
    asksThroughTool: false,
  },
  full: {
    label: 'Full access',
    claude: { permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true },
    claudeCli: ['--dangerously-skip-permissions'],
    codex: { approvalPolicy: 'never', sandbox: 'danger-full-access' },
    codexCli: ['-c', 'approval_policy=never', '--sandbox', 'danger-full-access'],
    codexAcp: ['-c', 'approval_policy=never', '-c', 'sandbox_mode=danger-full-access'],
    sessionModes: ['bypassPermissions', 'full-access'],
    refusesEdit: false,
    asksThroughTool: false,
  },
};

/** One row per mode in AGENT_MODES, in the ladder's order: derived from the set. */
const ROWS: (Row & { mode: AgentMode })[] = AGENT_MODES.map((mode) => ({ ...TABLE[mode], mode }));

test('access table: the rows are exactly AGENT_MODES (derived, not hand-listed)', () => {
  assert.deepStrictEqual(Object.keys(TABLE).sort(), [...AGENT_MODES].sort(), 'a row for every mode, and no row for a mode that does not exist');
  assert.ok(ROWS.length >= 4, `the set is the modes the product ships (${ROWS.length})`);
});

for (const row of ROWS) {
  test(`access table: ${row.label} (${row.mode}) maps to the exact Claude and Codex options`, () => {
    assert.deepStrictEqual(claudeOptionsFor(row.mode), row.claude, 'Claude ACP options');
    assert.deepStrictEqual(cliArgsFor('claude-cli', row.mode), row.claudeCli, 'claude CLI flags');
    assert.deepStrictEqual(codexOptionsFor(row.mode), row.codex, 'Codex policy');
    assert.deepStrictEqual(cliArgsFor('codex-cli', row.mode), row.codexCli, 'codex CLI flags');
    assert.deepStrictEqual(cliArgsFor('codex-acp', row.mode), row.codexAcp, 'codex-acp overrides');
    // A Claude ACP adapter takes its mode through _meta, never through argv.
    assert.deepStrictEqual(cliArgsFor('claude-acp', row.mode), [], 'claude-acp argv untouched');
    assert.deepStrictEqual(sessionModeIdsFor(row.mode), row.sessionModes, 'session/set_mode ids');
    for (const kind of ['edit', 'delete', 'move', 'execute', 'other', 'some_future_kind']) assert.strictEqual(planRefuses(row.mode, kind), row.refusesEdit, `a ${kind} escalation is refused outright in Plan alone`);
    assert.strictEqual(codexDeveloperInstructionsFor(row.mode), row.asksThroughTool ? PLAN_ASK_INSTRUCTION : null, "the request_user_input line, Plan's alone");
    /* Reads and Claude's exit-plan card keep the mode's own handling. */
    for (const kind of ['read', 'fetch', 'search', 'think', 'switch_mode']) assert.strictEqual(planRefuses(row.mode, kind), false, `${kind} is not refused outright`);
    /* A kind-less request (codex-acp sandbox escalations, MCP elicitations) is refused in Plan alone. */
    for (const kind of [null, undefined, '']) assert.strictEqual(planRefuses(row.mode, kind), row.refusesEdit, `a kind-less (${String(kind)}) request is refused in Plan alone`);
  });
}

test("Plan asks codex for exactly what Ask does; only codex's own plan mode (codexAppServer.ts) tells them apart", () => {
  assert.deepStrictEqual(codexOptionsFor('plan'), codexOptionsFor('propose'));
  assert.notStrictEqual(codexOptionsFor('plan').approvalPolicy, 'untrusted', 'untrusted asks before every read (live gate, 2026-10-06)');
  assert.strictEqual(codexOptionsFor('plan').sandbox, 'read-only', 'the sandbox is what keeps a plan from writing');
});

test('agentKindOf tells a Claude ACP adapter, codex-acp, and the plain CLIs apart', () => {
  assert.strictEqual(agentKindOf({ command: 'claude-agent-acp' }), 'claude-acp');
  assert.strictEqual(agentKindOf({ command: 'npx', args: ['-y', '@zed-industries/claude-code-acp'] }), 'claude-acp');
  assert.strictEqual(agentKindOf({ command: 'C:/tools/codex-acp.exe' }), 'codex-acp');
  assert.strictEqual(agentKindOf({ command: 'claude' }), 'claude-cli');
  assert.strictEqual(agentKindOf({ command: 'C:\\npm\\claude.cmd' }), 'claude-cli');
  assert.strictEqual(agentKindOf({ command: 'codex' }), 'codex-cli');
  assert.strictEqual(agentKindOf({ command: process.execPath, args: [MOCK_AGENT] }), 'other');
  assert.deepStrictEqual(cliArgsFor('other', 'full'), [], 'an unknown agent gets no guessed flags');
});

/*
 * THE FLAGS MUST PARSE, NOT JUST MATCH THE TABLE. The table above once said
 * `--ask-for-approval`, and the real codex 0.153.4 rejected every launch with
 * exit 2: that flag is top-level only and `codex exec` does not take it. The
 * fake binary has the real grammar, and the argv is built the way client.ts
 * builds it: the configured args first, the mode flags appended after.
 */
for (const row of ROWS) {
  test(`codex exec accepts the ${row.label} flags and lands on the table's policy`, () => {
    const configured = ['exec', 'Create a file named hello.txt'];
    const r = spawnSync(process.execPath, [FAKE_CODEX, ...configured, ...cliArgsFor('codex-cli', row.mode)], {
      encoding: 'utf8',
    });
    assert.strictEqual(r.status, 0, `codex exec rejected the ${row.label} argv: ${r.stderr.trim()}`);
    const seen = JSON.parse(r.stdout) as { approval_policy: string; sandbox_mode: string };
    assert.strictEqual(seen.approval_policy, row.codex.approvalPolicy, 'approval policy');
    assert.strictEqual(seen.sandbox_mode, row.codex.sandbox, 'sandbox');
  });
}

test('the fake codex rejects what the real one rejects (positive and negative control)', () => {
  const bad = spawnSync(process.execPath, [FAKE_CODEX, 'exec', 'p', '--ask-for-approval', 'never'], { encoding: 'utf8' });
  assert.strictEqual(bad.status, 2);
  assert.match(bad.stderr, /unexpected argument '--ask-for-approval' found/);
  /* top-level, before exec, the real binary accepts it */
  const top = spawnSync(process.execPath, [FAKE_CODEX, '--ask-for-approval', 'never', 'exec', 'p'], { encoding: 'utf8' });
  assert.strictEqual(top.status, 0);
});

/* ---------------- end to end against the conformant mock agent ---------------- */

function client(mode: AgentMode, env: Record<string, string> = {}): AcpClient {
  return new AcpClient({
    command: process.execPath,
    args: [MOCK_AGENT],
    killGraceMs: 500,
    accessMode: mode,
    env: { ...process.env, ...env },
  });
}

function accessOf(text: string): { meta: unknown; setModes: string[]; argv: string[] } {
  const m = /access=(.*)$/s.exec(text);
  assert.ok(m, `the mock reported what reached it; got ${text}`);
  return JSON.parse(m![1]!);
}

for (const row of ROWS) {
  test(`session/new carries _meta.claudeCode.options for ${row.label}, and set_mode switches it`, async () => {
    const c = client(row.mode, { MOCK_AGENT_MODES: 'default,acceptEdits,plan,bypassPermissions' });
    try {
      await c.start();
      await c.newSession();
      const r = await c.prompt('ACCESS');
      const seen = accessOf(r.text);
      assert.deepStrictEqual(seen.meta, { claudeCode: { options: row.claude } });
      // The agent starts in `default`; only a different mode needs a switch.
      const expectSwitch = row.sessionModes[0] === 'default' ? [] : [row.sessionModes[0]];
      assert.deepStrictEqual(seen.setModes, expectSwitch);
    } finally {
      await c.dispose();
    }
  });
}

test('set_mode uses the codex-acp mode ids when that is what the agent offers', async () => {
  const c = client('full', { MOCK_AGENT_MODES: 'read-only,auto,full-access' });
  try {
    await c.start();
    await c.newSession();
    const seen = accessOf((await c.prompt('ACCESS')).text);
    assert.deepStrictEqual(seen.setModes, ['full-access']);
  } finally {
    await c.dispose();
  }
});

test('setAccessMode switches a live session with session/set_mode', async () => {
  const c = client('propose', { MOCK_AGENT_MODES: 'default,acceptEdits,plan,bypassPermissions' });
  try {
    await c.start();
    await c.newSession();
    await c.setAccessMode('autoEdit');
    await c.setAccessMode('autoEdit'); // already there: no second call
    const seen = accessOf((await c.prompt('ACCESS')).text);
    assert.deepStrictEqual(seen.setModes, ['acceptEdits']);
  } finally {
    await c.dispose();
  }
});

test('full access allows every permission request; Ask still denies an edit', async () => {
  const full = client('full');
  const ask = client('propose');
  try {
    await full.start();
    assert.match((await full.prompt('PERMISSION')).text, /permission=allow-1/);
    await ask.start();
    assert.match((await ask.prompt('PERMISSION')).text, /permission=reject-1/);
  } finally {
    await full.dispose();
    await ask.dispose();
  }
});

test("a bypass refusal from the agent is surfaced with the agent's own reason, never downgraded", async () => {
  const reason = '--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons';
  const c = client('full', { MOCK_AGENT_REFUSE_BYPASS: reason });
  try {
    await c.start();
    await assert.rejects(
      () => c.newSession(),
      (e: unknown) => {
        assert.ok(e instanceof AccessModeRefusedError, `expected AccessModeRefusedError, got ${String(e)}`);
        assert.strictEqual(e.mode, 'full');
        assert.ok(e.reason.includes(reason), `reason passed through: ${e.reason}`);
        return true;
      }
    );
    // Not silently downgraded: no session was opened behind the caller's back.
    assert.strictEqual(c.currentSessionId, undefined);
  } finally {
    await c.dispose();
  }
});

test('an agent that offers modes but no bypass mode refuses full access with a named reason', async () => {
  const c = client('full', { MOCK_AGENT_MODES: 'default,acceptEdits,plan' });
  try {
    await c.start();
    await assert.rejects(
      () => c.newSession(),
      (e: unknown) =>
        e instanceof AccessModeRefusedError && /IS_SANDBOX/.test(e.reason) && /disableBypassPermissionsMode/.test(e.reason)
    );
  } finally {
    await c.dispose();
  }
});

test('a codex-acp launch gets its approval and sandbox overrides on argv', async () => {
  // Spawn the mock under a codex-acp-looking command name by recording the args
  // the client would launch with; the mock reports its argv back.
  const c = new AcpClient({
    command: process.execPath,
    args: [MOCK_AGENT],
    killGraceMs: 500,
    accessMode: 'full',
    agentKind: 'codex-acp',
  });
  try {
    await c.start();
    const seen = accessOf((await c.prompt('ACCESS')).text);
    assert.deepStrictEqual(seen.argv, ['-c', 'approval_policy=never', '-c', 'sandbox_mode=danger-full-access']);
  } finally {
    await c.dispose();
  }
});

test('planRefuses covers exactly the kinds allowsTool refuses in Plan (bar the exit card)', () => {
  for (const kind of ['read', 'fetch', 'search', 'think', 'edit', 'delete', 'move', 'execute', 'other', 'x', undefined]) {
    assert.strictEqual(planRefuses('plan', kind), !allowsTool('plan', kind), String(kind));
  }
});

test('Plan refuses a permission request with no kind; only an explicit switch_mode passes', () => {
  assert.strictEqual(allowsTool('plan', undefined), false);
  assert.strictEqual(planRefuses('plan', undefined), true);
  assert.strictEqual(planRefuses('plan', null), true);
  assert.strictEqual(planRefuses('plan', 'switch_mode'), false);
  for (const m of ['propose', 'autoEdit', 'full'] as const) assert.strictEqual(planRefuses(m, undefined), false, m);
});

test('every agent is told it can draw svg and html in the chat (lane visual)', () => {
  for (const m of AGENT_MODES) assert.ok(codexThreadInstructionsFor(m).includes(DRAW_INSTRUCTION), `codex ${m} carries the drawing line`);
  assert.ok(codexThreadInstructionsFor('plan').startsWith(PLAN_ASK_INSTRUCTION), "Plan's own line comes first");
  assert.strictEqual(codexThreadInstructionsFor('propose'), DRAW_INSTRUCTION);
  assert.match(DRAW_INSTRUCTION, /```svg/);
  assert.match(DRAW_INSTRUCTION, /```html/);
  assert.match(DRAW_INSTRUCTION, /no network/);
  assert.match(DRAW_INSTRUCTION, /call the visual tool \(list:true names the components, help:"line" gives a spec\), then show it with a ```visual block holding \{"id":"d5"\}/);
  assert.match(DRAW_INSTRUCTION, /without the tool write \{"component":"line","spec":\{\.\.\.\}\} in the ```visual block/);
  assert.ok(DRAW_INSTRUCTION.length < 1500, `the drawing instruction is ${DRAW_INSTRUCTION.length} characters`);
});
