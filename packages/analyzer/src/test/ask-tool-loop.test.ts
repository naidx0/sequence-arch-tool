import assert from 'node:assert';
import childProcess from 'node:child_process';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanRepo } from '../scan.js';
import { buildDigest } from '../explain/explain.js';
import { resolveInRepo } from '../server/jail.js';
import {
  ASK_TOOL_ALLOWLIST,
  ASK_TOOL_COMPACT_TOPOLOGY_MAX_NODES,
  ASK_TOOL_EVIDENCE_LEDGER_CAP_BYTES,
  ASK_TOOL_PROPOSE_MAX_FILES,
  ASK_TOOL_WRITE_CALLS_PER_TURN,
  DESIGN_DRAW_ASK_TOOL_ROUNDS,
  DESIGN_SHORT_PATH_EVIDENCE_LEDGER_CAP_BYTES,
  MAX_ASK_TOOL_ROUNDS,
  UNPRODUCTIVE_ROUND_LIMIT,
  EXPLORE_UNPRODUCTIVE_ROUND_LIMIT,
  executeAskTool,
  isAskToolCacheable,
  isDetailedTopologyAsk,
  mergeToolRequests,
  parseAllToolRequests,
  parseFencedSeqdProposals,
  parseFencedToolRequests,
  permissionSubjects,
  resolveAskEvidenceLedgerCap,
  resolveAskRoundCap,
  salvageBareSeqdProposals,
  salvageBareToolRequests,
  selectCarriedEvidence,
  renderAskToolHintSection,
  renderToolResultsSection,
  stableAskToolCacheKey,
  topologyWhatItDoesCoverage,
  DETAILED_TOPOLOGY_WHAT_IT_DOES_MIN,
  type AskEvidenceEntry,
} from '../server/askTools.js';
import { runAskPipeline, computeAskInstructionHash, hashAskInstructionBelt, renderAskInstructionBelt, TEACH_MODE_INSTRUCTIONS, type AskPipelineInput, type AskStreamEvent } from '../server/askPipeline.js';
import { parseAskArgs } from '../askCli.js';
import { setRepoTrust } from '../server/repoTrust.js';
import { userStoreDir } from '../server/store.js';
import {
  emptyPermissionDocument,
  loadPermissionPolicy,
  writePermissionsDocument,
} from '../server/permissionRules.js';
import {
  loadAskHonestyFixture,
  wrapFencedSeqd,
  wrapProse,
} from './ask-honesty-corpus.js';

/**
 * Wave 1 locking tests — mid-turn read/search tool loop in the ask pipeline.
 * The loop runs entirely in-process: a mocked `callProvider` returns tool
 * requests on the first round and a final answer on the second, and the
 * pipeline executes the allowlisted tools through the SAME jail as
 * GET /api/file. No fabricated topology, no silent shell.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const ANALYZER_ROOT = path.resolve(here, '..', '..');
const SHOPFRONT = path.join(ANALYZER_ROOT, 'test', 'fixtures', 'shopfront');

function shopfrontRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-ask-tool-loop-'));
  const repo = path.join(dir, 'repo');
  fs.cpSync(SHOPFRONT, repo, { recursive: true });
  /*
   * TRUSTED, BECAUSE THIS FILE IS ABOUT THE TOOL LOOP, NOT THE BOUNDARY.
   *
   * `run_command` (and the harness's own post-write syntax check) refuses
   * everything under an untrusted repository — see `server/repoTrust.ts`. A
   * fixture that stayed untrusted would answer every assertion below with the
   * trust refusal instead of the behaviour under test. The boundary itself is
   * locked in `repo-trust.test.ts`, including the untrusted half.
   */
  setRepoTrust(userStoreDir(), fs.realpathSync(repo), true);
  return repo;
}

/**
 * A shopfront copy that is also a real git repo (init + initial commit). The
 * bare fixture has no `.git`; the git_status / git_diff tools need a working
 * tree with a HEAD to diff against, so the git tests use this helper.
 */
function shopfrontGitRepo(): string {
  const repo = shopfrontRepo();
  childProcess.spawnSync('git', ['init', '-q'], { cwd: repo, shell: false });
  childProcess.spawnSync('git', ['config', 'user.email', 'test@sequence.local'], { cwd: repo, shell: false });
  childProcess.spawnSync('git', ['config', 'user.name', 'Sequence Test'], { cwd: repo, shell: false });
  childProcess.spawnSync('git', ['add', '-A'], { cwd: repo, shell: false });
  childProcess.spawnSync('git', ['commit', '-q', '-m', 'initial'], { cwd: repo, shell: false });
  return repo;
}

interface CannedProvider {
  text: string;
  usage?: { inputTokens: number; outputTokens: number; estimated: boolean };
  toolRequests?: ReadonlyArray<{
    id: string;
    name: string;
    args?: Record<string, unknown>;
    evidence?: string;
  }>;
}

function makeProviderScript(scripts: CannedProvider[]): {
  calls: string[];
  callProvider: AskPipelineInput['callProvider'];
} {
  const calls: string[] = [];
  let i = 0;
  const callProvider: AskPipelineInput['callProvider'] = async (_cfg, prompt) => {
    calls.push(prompt);
    const canned = scripts[Math.min(i, scripts.length - 1)];
    i++;
    return {
      text: canned.text,
      ...(canned.usage ? { usage: canned.usage } : {}),
      ...(canned.toolRequests ? { toolRequests: canned.toolRequests } : {}),
    };
  };
  return { calls, callProvider };
}

async function makeAttachedInput(
  repo: string,
  callProvider: AskPipelineInput['callProvider'],
): Promise<AskPipelineInput> {
  const root = fs.realpathSync(repo);
  const graph = await scanRepo(repo, { cluster: true });
  const digest = buildDigest(graph);
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
    digest,
    cfg: { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test' },
    resolveReadable: (rel) => resolveInRepo(root, rel),
    repoRoot: root,
    callProvider,
  };
}

function collect(events: AskStreamEvent[]): {
  types: string[];
  byType: Record<string, AskStreamEvent[]>;
} {
  const byType: Record<string, AskStreamEvent[]> = {};
  for (const e of events) {
    (byType[e.type] ??= []).push(e);
  }
  return { types: events.map((e) => e.type), byType };
}

/* ============================================================ askTools unit ===== */

/**
 * THE BELT, PINNED EXACTLY — and it is meant to be annoying.
 *
 * Every entry here is a capability handed to a model running against someone's
 * repository, so widening the list must be a deliberate act with a reason, not
 * a diff that slips through because the assertion said "contains". Adding a
 * tool turns this test red on purpose.
 *
 * `propose_topology` was added 2026-08-23. It is the ARCHITECTURE half of
 * `propose_files`: the board's ghost layer — a proposed service drawn dashed,
 * Accept running back through `docEdit`, Deny dropping the layer — shipped
 * complete with fourteen tests and could not be entered, because
 * `canvas/proposal` was dispatched by nothing and the prompt asked the model
 * for a fenced seqd block that no code parsed. It writes nothing to disk and
 * is in `ASK_MUTATING_TOOLS` anyway, so plan mode refuses it.
 */
test('ASK_TOOL_ALLOWLIST is exactly these sixteen, and widening it is deliberate', () => {
  /*
   * THREE WERE ADDED, AND EACH CLOSES A MEASURED GAP:
   *
   *   `edit_file` — until it existed the only way to change a file was
   *   `propose_files`, which needs the WHOLE new body. Changing one line in a
   *   1,800-line file meant re-emitting 1,800 lines, from a `read_file` that
   *   had only shown the model the first 12,000 bytes of it.
   *
   *   `read_topology` — the ask prompt now ships an orientation INDEX of the
   *   digest rather than the whole thing (measured: ~23,300 → ~9,000 tokens on
   *   this monorepo). This is how the model gets a service back in full.
   *
   *   `who_calls` — Sequence exports twelve grounded graph tools to OTHER
   *   agents over MCP and gave its own model none of them. Asked what breaks if
   *   a function changes, the in-app agent was grepping.
   *
   *   `locate_symbol` — a six-question battery about this repository, every answer
   *   grep-checkable, scored 0/6 with a local model. All six named an identifier the
   *   index resolves with no model at all; the harness routed each through model
   *   reasoning anyway. "Where is X defined" is decidable, so it is now answered
   *   rather than reasoned about: 6/6 in ~110ms each, definition ranked above call
   *   sites, the declaring line returned as the proof.
   *
   *   `propose_chart` — the model names a chart KIND and fills a data contract;
   *   Sequence renders it (packages/schema/src/chart.ts). Measured on 54 graded
   *   teach conversations: visuals asked for in prose alone landed 13.8% of the
   *   time. A drawing tool the harness can VALIDATE (every nodeId must exist)
   *   is how a picture becomes as grounded as a sentence.
   *
   *   `propose_plan` — added 2026-09-05. The teach contract demands ONE concept
   *   per turn and the pipeline could supply none: `TeachTurnContext.concept`
   *   was read by the belt and written by nobody. Measured on 20 graded teach
   *   conversations, 17 of 47 turns never became lessons and 10 of those were
   *   "continue to the next point". A concept queue can be cut from the graph
   *   for a lesson about files — but 12 of those 20 asks name no node and are
   *   not sequence-shaped ("teach me what a bigram is", an attached law primer),
   *   and no edge-walk will order those. So the model writes the plan ONCE, at
   *   the opening turn, validated on exactly the terms a chart is: a concept may
   *   carry a nodeId, and if it does the id must be real. Refused whole when one
   *   is invented, because half a plan is a queue the learner cannot see, half
   *   of which points at nothing.
   */
  assert.deepStrictEqual([...ASK_TOOL_ALLOWLIST], [
    'read_file',
    'edit_file',
    'search_files',
    'read_topology',
    'locate_symbol',
    'who_calls',
    'propose_files',
    'propose_topology',
    'propose_chart',
    'propose_plan',
    'run_command',
    'git_status',
    'git_diff',
    'call_mcp',
    'call_plugin',
    'fetch_url',
  ]);
});

test('executeAskTool read_file: returns real capped body through the jail', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const rel = 'gateway/src/routes/orders.ts';
  const result = await executeAskTool('read_file', { path: rel }, {
    resolveReadable: (p) => resolveInRepo(root, p),
    repoRoot: root,
    designMode: false,
  });
  assert.ok(result.ok, result.evidence);
  assert.match(result.evidence!, /^read gateway\/src\/routes\/orders\.ts/);
  assert.ok(result.content?.includes('ordersRouter'), 'real file body present');
  assert.ok(result.content!.includes('untrusted_repo_content'), 'body wrapped as untrusted');
});

test('executeAskTool read_file: refuses jail escape and reserved dirs', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  fs.mkdirSync(path.join(repo, '.sequence'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.sequence', 'ai.json'), '{"apiKey":"secret"}');
  const ctx = {
    resolveReadable: (p: string) => {
      const abs = resolveInRepo(root, p);
      if (!abs) return null;
      if (p.startsWith('.sequence/') && !p.startsWith('.sequence/decisions/')) return null;
      return abs;
    },
    repoRoot: root,
    designMode: false,
  };
  const escaped = await executeAskTool('read_file', { path: '../../../etc/passwd' }, ctx);
  assert.ok(!escaped.ok);
  assert.match(escaped.evidence, /not readable/);
  const reserved = await executeAskTool('read_file', { path: '.sequence/ai.json' }, ctx);
  assert.ok(!reserved.ok);
  assert.match(reserved.evidence, /not readable/);
});

test('parseFencedSeqdProposals: strips valid seqd fences and returns topology', () => {
  const body = JSON.stringify({
    version: 1,
    kind: 'service-sequence',
    title: 'Travel insurer',
    grounded: { graphId: 'chat:proposal', origin: 'design' },
    nodes: [{ id: 'proposal:ceo', label: 'CEO', kind: 'service' }],
    edges: [],
  });
  const text = `Here is the plan.\n\n\`\`\`json\n${body}\n\`\`\`\n`;
  const parsed = parseFencedSeqdProposals(text);
  assert.strictEqual(parsed.proposals.length, 1);
  assert.strictEqual(parsed.proposals[0]!.nodes[0]!.label, 'CEO');
  assert.ok(!parsed.stripped.includes('proposal:ceo'));
});

test('parseFencedSeqdProposals: coerces invented kind process-sequence', () => {
  const body = JSON.stringify({
    kind: 'process-sequence',
    title: 'Local agent harness',
    nodes: [
      { id: 'proposal:core', label: 'Harness Core', kind: 'service' },
      { id: 'proposal:ollama', label: 'Ollama', kind: 'service' },
    ],
    edges: [
      { id: 'e1', from: 'proposal:core', to: 'proposal:ollama', family: 'call' },
    ],
  });
  const text = `\`\`\`json\n${body}\n\`\`\``;
  const parsed = parseFencedSeqdProposals(text);
  assert.strictEqual(parsed.proposals.length, 1);
  assert.strictEqual(parsed.proposals[0]!.title, 'Local agent harness');
  assert.ok(!parsed.stripped.includes('process-sequence'));
});

test('salvageBareSeqdProposals: strips unfenced process-sequence JSON', () => {
  const bare = JSON.stringify({
    kind: 'process-sequence',
    title: 'Local agent harness',
    nodes: [
      { id: 'proposal:core', label: 'Harness Core', kind: 'service' },
      { id: 'proposal:ollama', label: 'Ollama', kind: 'service' },
    ],
    edges: [
      { id: 'e1', from: 'proposal:core', to: 'proposal:ollama', family: 'call' },
    ],
  });
  const text = `Here is the shape:\n${bare}\nThat covers it.`;
  const { proposals, stripped } = salvageBareSeqdProposals(text);
  assert.strictEqual(proposals.length, 1);
  assert.strictEqual(proposals[0]!.nodes.length, 2);
  assert.ok(!stripped.includes('process-sequence'));
  assert.ok(stripped.includes('Here is the shape'));
  assert.ok(stripped.includes('That covers it'));
});

test('salvageBareToolRequests: synthesizes id when missing', () => {
  const bare =
    '{"name":"propose_topology","args":{"title":"Org",' +
    '"nodes":[{"id":"proposal:a","label":"A","kind":"service"}],"edges":[]}}';
  const { requests, stripped } = salvageBareToolRequests(`Dump:\n${bare}\nok`);
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0]!.name, 'propose_topology');
  assert.strictEqual(requests[0]!.id, 'propose_topology');
  assert.ok(!stripped.includes('propose_topology'));
});

test('executeAskTool: refuses file tools in design mode but allows scoped propose_topology', async () => {
  const ctx = {
    resolveReadable: () => null,
    repoRoot: null,
    designMode: true,
    question: 'compact overview on the board',
  };
  const r = await executeAskTool('read_file', { path: 'any.ts' }, ctx);
  assert.ok(!r.ok);
  assert.match(r.evidence, /attached repo/);
  const topo = await executeAskTool(
    'propose_topology',
    {
      title: 'Test',
      nodes: [{ id: 'proposal:a', label: 'A', kind: 'service' }],
      edges: [],
    },
    ctx,
  );
  assert.ok(topo.ok, topo.evidence);
  assert.ok(topo.topology);
});

test('isDetailedTopologyAsk / coverage helpers (A5.1)', () => {
  assert.equal(isDetailedTopologyAsk('draw a detailed architecture'), true);
  assert.equal(isDetailedTopologyAsk('compact overview please'), false);
  assert.equal(topologyWhatItDoesCoverage([{ detail: { whatItDoes: 'Charges orders.' } }, {}]), 0.5);
  assert.ok(DETAILED_TOPOLOGY_WHAT_IT_DOES_MIN >= 0.8);
});

test('executeAskTool: an unscoped draw ask lands a COMPACT board, it is not refused', async () => {
  const ctx = {
    resolveReadable: () => null,
    repoRoot: null,
    designMode: true,
    question: 'show me the breakdown on the board',
  };
  const r = await executeAskTool(
    'propose_topology',
    {
      title: 'Harness',
      nodes: [{ id: 'proposal:a', label: 'A', kind: 'service' }],
      edges: [],
    },
    ctx,
  );
  assert.ok(r.ok, 'a small unscoped draw lands rather than dead-ending on a clarifying question');
});

test('executeAskTool: an unscoped draw ask over the compact budget is sent back for a compact one', async () => {
  const ctx = {
    resolveReadable: () => null,
    repoRoot: null,
    designMode: true,
    question: 'show me the breakdown on the board',
  };
  const nodes = Array.from({ length: ASK_TOOL_COMPACT_TOPOLOGY_MAX_NODES + 1 }, (_v, i) => ({
    id: `proposal:n${i}`,
    label: `N${i}`,
    kind: 'service',
  }));
  const r = await executeAskTool('propose_topology', { title: 'Harness', nodes, edges: [] }, ctx);
  assert.ok(!r.ok);
  assert.match(r.evidence, /COMPACT overview/i);
  assert.match(r.evidence, /ask for the detailed diagram/i, 'the refusal tells the model to offer detail');
});

test('executeAskTool: detailed ask soft-warns when whatItDoes coverage is thin (A5.1)', async () => {
  const ctx = {
    resolveReadable: () => null,
    repoRoot: null,
    designMode: true,
    question: 'draw a detailed diagram of checkout',
  };
  const thin = await executeAskTool(
    'propose_topology',
    {
      title: 'Checkout',
      nodes: [
        { id: 'proposal:a', label: 'API', kind: 'service' },
        { id: 'proposal:b', label: 'DB', kind: 'datastore' },
        {
          id: 'proposal:c',
          label: 'Worker',
          kind: 'service',
          detail: { whatItDoes: 'Processes jobs.' },
        },
      ],
      edges: [],
    },
    ctx,
  );
  assert.ok(thin.ok, thin.evidence);
  assert.match(thin.evidence, /soft warn/i);
  assert.match(thin.evidence, /whatItDoes/);

  const rich = await executeAskTool(
    'propose_topology',
    {
      title: 'Checkout',
      nodes: [
        {
          id: 'proposal:a',
          label: 'API',
          kind: 'service',
          detail: { whatItDoes: 'Accepts checkout.' },
        },
        {
          id: 'proposal:b',
          label: 'DB',
          kind: 'datastore',
          detail: { whatItDoes: 'Stores orders.' },
        },
      ],
      edges: [],
    },
    ctx,
  );
  assert.ok(rich.ok, rich.evidence);
  assert.ok(!/soft warn/i.test(rich.evidence));
});

test('executeAskTool: unknown tool name refused', async () => {
  const ctx = { resolveReadable: () => null, repoRoot: '/tmp', designMode: false };
  const r = await executeAskTool('write_file', { path: 'x' }, ctx);
  assert.ok(!r.ok);
  assert.match(r.evidence, /unknown tool/);
});

test('executeAskTool read_file: missing path refused', async () => {
  const ctx = { resolveReadable: () => null, repoRoot: '/tmp', designMode: false };
  const r = await executeAskTool('read_file', {}, ctx);
  assert.ok(!r.ok);
  assert.match(r.evidence, /missing "path"/);
});

test('executeAskTool search_files: query match returns real path:line snippet', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const result = await executeAskTool('search_files', { query: 'ordersRouter' }, {
    resolveReadable: (p) => resolveInRepo(root, p),
    repoRoot: root,
    designMode: false,
  });
  assert.ok(result.ok, result.evidence);
  assert.ok((result.content ?? '').includes('orders.ts'), 'matching path in results');
  assert.ok((result.content ?? '').includes('ordersRouter'), 'matching snippet in results');
});

test('executeAskTool search_files: glob-only match returns paths without bodies', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const result = await executeAskTool('search_files', { glob: '**/orders.ts' }, {
    resolveReadable: (p) => resolveInRepo(root, p),
    repoRoot: root,
    designMode: false,
  });
  assert.ok(result.ok, result.evidence);
  assert.ok((result.content ?? '').includes('orders.ts'));
  assert.ok(!(result.content ?? '').includes('ordersRouter'), 'glob-only does not read bodies');
});

test('executeAskTool search_files: no query and no glob refused', async () => {
  const ctx = { resolveReadable: () => null, repoRoot: '/tmp', designMode: false };
  const r = await executeAskTool('search_files', {}, ctx);
  assert.ok(!r.ok);
  assert.match(r.evidence, /needs "query" or "glob"/);
});

test('parseFencedToolRequests: parses JSON block and strips it from text', () => {
  const text =
    'Let me read the orders route.\n\n```sequence-tool\n{"id":"t1","name":"read_file","args":{"path":"gateway/src/routes/orders.ts"}}\n```\n\nDone.';
  const { requests, stripped } = parseFencedToolRequests(text);
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].name, 'read_file');
  assert.strictEqual(
    (requests[0].args as { path: string }).path,
    'gateway/src/routes/orders.ts',
  );
  assert.ok(!stripped.includes('sequence-tool'), 'fence stripped');
  assert.ok(!stripped.includes('"name":"read_file"'), 'json payload stripped');
  assert.ok(stripped.includes('Let me read the orders route.'), 'surrounding text kept');
  assert.ok(stripped.includes('Done.'), 'trailing text kept');
});

test('parseFencedToolRequests: malformed block dropped, not executed', () => {
  const text = '```sequence-tool\n{not json}\n```\nkeep me';
  const { requests, stripped } = parseFencedToolRequests(text);
  assert.strictEqual(requests.length, 0);
  assert.ok(!stripped.includes('sequence-tool'));
  assert.ok(stripped.includes('keep me'));
});

test('salvageBareToolRequests: strips bare propose_topology JSON and returns the tool', () => {
  const bare =
    '{"id":"d1","name":"propose_topology","args":{"title":"Hermes local agent hub",' +
    '"nodes":[{"id":"proposal:hermes","label":"Hermes orchestrator","kind":"agent"}],' +
    '"edges":[{"id":"e1","from":"proposal:hermes","to":"proposal:hermes","family":"call","label":"loop"}]}}';
  const text = `Got it — no more questions. Here is the shape:\n\n${bare}\n\nThat is the whole loop.`;
  const { requests, stripped } = salvageBareToolRequests(text);
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0]!.name, 'propose_topology');
  assert.strictEqual((requests[0]!.args as { title: string }).title, 'Hermes local agent hub');
  assert.ok(!stripped.includes('propose_topology'), 'bare JSON stripped from transcript');
  assert.ok(stripped.includes('Got it — no more questions.'), 'leading prose kept');
  assert.ok(stripped.includes('That is the whole loop.'), 'trailing prose kept');
});

test('salvageBareToolRequests: strips bare canvas.write_* JSON', () => {
  const bare = '{"id":"c1","name":"canvas.write_svg","args":{"title":"TUI","svg":"<svg/>"}}';
  const { requests, stripped } = salvageBareToolRequests(`Sketch:\n${bare}\nok`);
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0]!.name, 'canvas.write_svg');
  assert.ok(!stripped.includes('canvas.write_svg'));
});

/* ============================================================ A3 honesty corpus ===== */

test('renderAskToolHintSection: attached-repo topology belt forbids bare JSON dumps', () => {
  const joined = renderAskToolHintSection('work', 'propose').join('\n');
  assert.match(joined, /NEVER paste bare/i);
  assert.match(joined, /sequence-tool/);
  assert.match(joined, /propose_topology/);
});

test('A3 corpus: fenced seqd salvage strips diagram JSON from prose', () => {
  const body = loadAskHonestyFixture('fenced-seqd');
  const text = wrapFencedSeqd(body);
  const parsed = parseFencedSeqdProposals(text);
  assert.strictEqual(parsed.proposals.length, 1);
  assert.strictEqual(parsed.proposals[0]!.nodes[0]!.label, 'CEO');
  assert.ok(!parsed.stripped.includes('proposal:ceo'));
  assert.ok(parsed.stripped.includes('Here is the plan'));
});

test('A3 corpus: bare process-sequence salvage strips and returns topology', () => {
  const bare = loadAskHonestyFixture('process-sequence-bare');
  const text = wrapProse(bare);
  const { proposals, stripped } = salvageBareSeqdProposals(text);
  assert.strictEqual(proposals.length, 1);
  assert.strictEqual(proposals[0]!.title, 'Local agent harness');
  assert.ok(!stripped.includes('process-sequence'));
  assert.ok(!stripped.includes('proposal:core'));
  assert.ok(stripped.includes('Here is the shape'));
});

test('A3 corpus: bare propose_topology envelope salvage strips tool JSON', () => {
  const bare = loadAskHonestyFixture('propose-topology-bare');
  const text = wrapProse(bare, 'Got it — no more questions.', 'That is the whole loop.');
  const { requests, stripped } = salvageBareToolRequests(text);
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0]!.name, 'propose_topology');
  assert.strictEqual((requests[0]!.args as { title: string }).title, 'Hermes local agent hub');
  assert.ok(!stripped.includes('propose_topology'));
  assert.ok(!stripped.includes('Hermes orchestrator'));
});

test('A3 corpus: bare nodes JSON salvage strips topology-shaped dump', () => {
  const bare = loadAskHonestyFixture('bare-nodes');
  const text = wrapProse(bare);
  const { proposals, stripped } = salvageBareSeqdProposals(text);
  assert.strictEqual(proposals.length, 1);
  assert.strictEqual(proposals[0]!.nodes.length, 2);
  assert.ok(!stripped.includes('proposal:core'));
  assert.ok(!stripped.includes('Harness Core'));
});

test('parseAllToolRequests: fenced wins over bare on same id', () => {
  const text =
    '```sequence-tool\n{"id":"d1","name":"propose_topology","args":{"title":"Fenced","nodes":[{"id":"proposal:a","label":"A","kind":"service"}],"edges":[]}}\n```\n' +
    '{"id":"d1","name":"propose_topology","args":{"title":"Bare","nodes":[{"id":"proposal:b","label":"B","kind":"service"}],"edges":[]}}';
  const { requests, stripped } = parseAllToolRequests(text);
  assert.strictEqual(requests.length, 1);
  assert.strictEqual((requests[0]!.args as { title: string }).title, 'Fenced');
  assert.ok(!stripped.includes('Bare'));
  assert.ok(!stripped.includes('Fenced'));
});

test('mergeToolRequests: fenced wins on id collision and supplies args', () => {
  const merged = mergeToolRequests(
    [{ id: 't1', name: 'read_file' }],
    [{ id: 't1', name: 'read_file', args: { path: 'a.ts' } }],
  );
  assert.strictEqual(merged.length, 1);
  assert.ok(merged[0].args);
  assert.strictEqual((merged[0].args as { path: string }).path, 'a.ts');
});

test('mergeToolRequests: structured without args kept when no fenced override', () => {
  const merged = mergeToolRequests([{ id: 't1', name: 'read_file' }], []);
  assert.strictEqual(merged.length, 1);
  assert.strictEqual(merged[0].args, undefined);
});

test('renderToolResultsSection: empty when no results', () => {
  assert.deepStrictEqual(renderToolResultsSection([]), []);
});

test('renderToolResultsSection: header + bodies when present', () => {
  const section = renderToolResultsSection(['### a.ts\n```x```']);
  assert.ok(section[0].includes('TOOL RESULTS'));
  assert.ok(section[1].includes('a.ts'));
});

test('resolveAskRoundCap: draw questions clamp below MAX_ASK_TOOL_ROUNDS (B1.2 — attached too)', () => {
  assert.strictEqual(
    resolveAskRoundCap({
      designMode: true,
      repoRoot: null,
      question: 'Draw a travel insurer architecture on the board',
    }),
    DESIGN_DRAW_ASK_TOOL_ROUNDS,
  );
  assert.strictEqual(
    resolveAskRoundCap({
      designMode: false,
      repoRoot: '/tmp/repo',
      question: 'Draw a diagram of the gateway',
    }),
    DESIGN_DRAW_ASK_TOOL_ROUNDS,
  );
  assert.strictEqual(
    resolveAskRoundCap({
      maxRounds: 16,
      designMode: true,
      repoRoot: null,
      question: 'Sketch the org chart',
    }),
    DESIGN_DRAW_ASK_TOOL_ROUNDS,
  );
  assert.strictEqual(
    resolveAskRoundCap({
      designMode: false,
      repoRoot: '/tmp/repo',
      question: 'How does the gateway route orders?',
    }),
    MAX_ASK_TOOL_ROUNDS,
  );
});

test('stableAskToolCacheKey: same args hash identically regardless of key order', () => {
  const a = stableAskToolCacheKey('read_file', { path: 'a.ts', extra: 1 });
  const b = stableAskToolCacheKey('read_file', { extra: 1, path: 'a.ts' });
  assert.strictEqual(a, b);
  assert.ok(isAskToolCacheable('read_file'));
  assert.ok(!isAskToolCacheable('propose_topology'));
});

function evidenceEntry(round: number, tag: string, bytes: number): AskEvidenceEntry {
  return { round, body: `${tag}:${'x'.repeat(Math.max(0, bytes - tag.length - 1))}` };
}

test('selectCarriedEvidence: design short-path cap is smaller than explore path', () => {
  const entries: AskEvidenceEntry[] = [];
  for (let i = 1; i <= 4; i++) entries.push(evidenceEntry(1, `r${i}`, 15_000));
  entries.push(evidenceEntry(2, 'current', 100));

  const designCap = resolveAskEvidenceLedgerCap({
    designMode: true,
    repoRoot: null,
    question: 'Draw a travel insurer architecture on the board',
  });
  const exploreCap = resolveAskEvidenceLedgerCap({
    designMode: false,
    repoRoot: '/tmp/repo',
    question: 'How does the gateway route orders?',
  });

  assert.strictEqual(designCap, DESIGN_SHORT_PATH_EVIDENCE_LEDGER_CAP_BYTES);
  assert.strictEqual(exploreCap, ASK_TOOL_EVIDENCE_LEDGER_CAP_BYTES);
  assert.ok(designCap < exploreCap);

  const designCarried = selectCarriedEvidence(entries, 2, designCap).join('\n');
  const exploreCarried = selectCarriedEvidence(entries, 2, exploreCap).join('\n');
  const earlierBytes = (text: string): number =>
    text
      .split('\n')
      .filter((line) => /^r\d:/.test(line))
      .reduce((n, line) => n + line.length, 0);

  assert.ok(
    earlierBytes(designCarried) < earlierBytes(exploreCarried),
    'design short-path must carry fewer earlier-round bytes than explore',
  );
  assert.ok(designCarried.includes('dropped to stay'), 'design path drops more aggressively');
});

test('askPipeline: two read_file in one round batch — both complete, starts before dones', async () => {
  const repo = shopfrontRepo();
  const pathA = 'gateway/src/routes/orders.ts';
  const pathB = 'gateway/src/routes/invoices.ts';

  const { calls, callProvider } = makeProviderScript([
    {
      text: 'read both',
      toolRequests: [
        { id: 't1', name: 'read_file', args: { path: pathA } },
        { id: 't2', name: 'read_file', args: { path: pathB } },
      ],
    },
    { text: 'Both routes read.' },
  ]);
  const input = await makeAttachedInput(repo, callProvider);
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));

  const startT1 = events.findIndex((e) => e.type === 'tool:start' && e.id === 't1');
  const startT2 = events.findIndex((e) => e.type === 'tool:start' && e.id === 't2');
  const doneT1 = events.findIndex((e) => e.type === 'tool:done' && e.id === 't1');
  const doneT2 = events.findIndex((e) => e.type === 'tool:done' && e.id === 't2');

  assert.ok(startT1 >= 0 && startT2 >= 0 && doneT1 >= 0 && doneT2 >= 0);
  assert.ok(
    startT1 < doneT1 && startT2 < doneT1 && startT1 < doneT2,
    'parallel batch emits every tool:start before any tool:done',
  );
  assert.ok(calls[1].includes('ordersRouter'));
  assert.ok(calls[1].includes('invoicesRouter'));
  assert.strictEqual(
    stableAskToolCacheKey('read_file', { path: pathA }),
    stableAskToolCacheKey('read_file', { path: pathA }),
  );
  assert.strictEqual(result.text, 'Both routes read.');
});

/* ============================================================ A0.3 / B1.2 speed caps ===== */

test('askPipeline: draw intent early-exits after successful propose_topology (B1.2)', async () => {
  const node = { id: 'proposal:hub', label: 'Hub', kind: 'service' };
  const topoRound = (id: string) => ({
    text: 'Here is the diagram.',
    toolRequests: [
      {
        id,
        name: 'propose_topology',
        args: { title: 'Hub', nodes: [node], edges: [] },
      },
    ],
  });
  const { calls, callProvider } = makeProviderScript([
    topoRound('d1'),
    topoRound('d2'),
    { text: 'Should not reach a third provider call.' },
  ]);
  const input: AskPipelineInput = {
    question: 'Draw me a travel insurer architecture on the board',
    intents: [],
    scopeLines: [],
    surface: undefined,
    deictic: false,
    design: { title: 'Travel', outline: 'Insurer org' },
    designMode: true,
    askMode: 'research',
    graph: null,
    digest: undefined,
    cfg: { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test' },
    resolveReadable: () => null,
    repoRoot: null,
    callProvider,
  };
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));

  assert.ok(result.metrics, 'result carries ask metrics');
  assert.strictEqual(result.metrics!.intent, 'draw');
  assert.strictEqual(result.metrics!.rounds, 1, 'one tool round after board lands');
  assert.strictEqual(result.metrics!.stopReason, 'complete', 'early-exit is a clean complete, not ceiling');
  assert.strictEqual(calls.length, 1, 'no second provider call after successful draw');
  assert.ok(events.some((e) => e.type === 'topology:proposal'));
  assert.strictEqual(result.text, 'Here is the diagram.');
});

test('askPipeline: draw questions without a landed diagram still hit the short round ceiling', async () => {
  const { calls, callProvider } = makeProviderScript([
    {
      text: 'looking',
      toolRequests: [{ id: 'r1', name: 'read_file', args: { path: 'missing.ts' } }],
    },
    {
      text: 'still looking',
      toolRequests: [{ id: 'r2', name: 'read_file', args: { path: 'also-missing.ts' } }],
    },
    {
      text: 'and again',
      toolRequests: [{ id: 'r3', name: 'read_file', args: { path: 'third.ts' } }],
    },
    /* Reused for the FORCED DRAW round (Wave 7b): a draw turn that hit the
       ceiling with nothing landed gets exactly one demand to draw. This entry
       still refuses, so the harness's own empty-canvas note must appear. */
    { text: 'Even when forced: prose, no drawing.' },
  ]);
  const input: AskPipelineInput = {
    question: 'Draw me a travel insurer architecture on the board',
    intents: [],
    scopeLines: [],
    surface: undefined,
    deictic: false,
    design: { title: 'Travel', outline: 'Insurer org' },
    designMode: true,
    askMode: 'research',
    graph: null,
    digest: undefined,
    cfg: { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test' },
    resolveReadable: () => null,
    repoRoot: null,
    callProvider,
  };
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));

  assert.ok(result.metrics, 'result carries ask metrics');
  assert.strictEqual(result.metrics!.designMode, true);
  /* +1 everywhere below: the draw contract (Wave 7b) spends ONE forced round
     when a draw turn ends with nothing on the board — metered and counted,
     never free. */
  assert.strictEqual(result.metrics!.rounds, DESIGN_DRAW_ASK_TOOL_ROUNDS + 1);
  assert.strictEqual(result.metrics!.stopReason, 'ceiling');
  assert.strictEqual(result.metrics!.intent, 'draw');
  assert.strictEqual(calls.length, DESIGN_DRAW_ASK_TOOL_ROUNDS + 2);
  assert.ok(
    calls[calls.length - 1].includes('YOU HAVE NOT DRAWN ANYTHING'),
    'the last call is the forced draw demand',
  );
  const toolStarts = (events.filter((e) => e.type === 'tool:start') ?? []).length;
  assert.strictEqual(toolStarts, DESIGN_DRAW_ASK_TOOL_ROUNDS);
  assert.ok(result.text.includes('Nothing landed on the canvas'), 'empty canvas named');
});

test('askPipeline: identical read_file in a later round is served from the per-turn cache', async () => {
  const repo = shopfrontRepo();
  const rel = 'gateway/src/routes/orders.ts';
  const { calls, callProvider } = makeProviderScript([
    {
      text: 'read',
      toolRequests: [{ id: 't1', name: 'read_file', args: { path: rel } }],
    },
    {
      text: 'read again',
      toolRequests: [{ id: 't2', name: 'read_file', args: { path: rel } }],
    },
    { text: 'Done after one disk read.' },
  ]);
  const input = await makeAttachedInput(repo, callProvider);
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));
  const { byType } = collect(events);

  const readToolDone = (byType['tool:done'] ?? []) as Array<{ evidence?: string }>;
  const ordersReads = readToolDone.filter((t) =>
    (t.evidence ?? '').includes('gateway/src/routes/orders.ts'),
  );
  assert.strictEqual(ordersReads.length, 2, 'two read_file rounds in the loop');
  assert.ok(
    ordersReads.some((t) => (t.evidence ?? '').startsWith('(cached)')),
    'second identical read is labelled cached',
  );
  assert.ok(
    ordersReads.some((t) => !(t.evidence ?? '').startsWith('(cached)')),
    'first read still hits disk',
  );
  assert.ok(calls[1].includes('TOOL RESULTS'));
  assert.strictEqual(result.text, 'Done after one disk read.');
});

test('askPipeline: one propose_topology per turn — second call refused, one board ghost', async () => {
  const node = { id: 'proposal:a', label: 'A', kind: 'service' };
  const { calls, callProvider } = makeProviderScript([
    {
      text: 'two proposals',
      toolRequests: [
        {
          id: 'd1',
          name: 'propose_topology',
          args: { title: 'First', nodes: [node], edges: [] },
        },
        {
          id: 'd2',
          name: 'propose_topology',
          args: { title: 'Second', nodes: [node], edges: [] },
        },
      ],
    },
    { text: 'Should not reach — draw early-exits after first success (B1.2).' },
  ]);
  const input: AskPipelineInput = {
    question: 'Draw the org on the architecture board',
    intents: [],
    scopeLines: [],
    surface: undefined,
    deictic: false,
    design: { title: 'Org', outline: 'Two-tier' },
    designMode: true,
    askMode: 'research',
    graph: null,
    digest: undefined,
    cfg: { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test' },
    resolveReadable: () => null,
    repoRoot: null,
    callProvider,
  };
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));
  const { byType } = collect(events);

  assert.strictEqual((byType['topology:proposal'] ?? []).length, 1);
  const doneD2 = (byType['tool:done'] ?? []).find((e) => (e as { id?: string }).id === 'd2') as
    | { evidence?: string }
    | undefined;
  assert.ok(
    doneD2?.evidence?.includes('already placed one topology proposal') ||
      doneD2?.evidence?.toLowerCase().includes('once') ||
      (byType['tool:done'] ?? []).some((e) =>
        String((e as { evidence?: string }).evidence ?? '').includes(
          'already placed one topology proposal',
        ),
      ),
    'second propose_topology refused in the same round',
  );
  assert.strictEqual(calls.length, 1, 'B1.2 draw early-exit — no synth tool round');
  assert.strictEqual(result.text, 'two proposals');
});

/* ============================================================ pipeline loop ===== */

test('askPipeline: read_file tool loop — executes, emits tool/file events, calls provider twice', async () => {
  const repo = shopfrontRepo();
  const { calls, callProvider } = makeProviderScript([
    {
      text: 'I need to read the orders route.',
      usage: { inputTokens: 100, outputTokens: 10, estimated: false },
      toolRequests: [{ id: 't1', name: 'read_file', args: { path: 'gateway/src/routes/orders.ts' } }],
    },
    {
      text: 'The gateway proxies orders via ordersRouter.',
      usage: { inputTokens: 200, outputTokens: 30, estimated: false },
    },
  ]);
  const input = await makeAttachedInput(repo, callProvider);
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));
  const { types, byType } = collect(events);

  assert.strictEqual(calls.length, 2, 'provider called once per round');
  assert.ok(calls[1].includes('TOOL RESULTS'), 'tool results appended to prompt');
  assert.ok(calls[1].includes('ordersRouter'), 'real file body fed back into round 2');

  assert.ok(types.includes('provider:start'));
  assert.ok(types.includes('provider:done'));
  assert.ok(types.includes('tool:start'), 'tool:start emitted');
  assert.ok(types.includes('tool:done'), 'tool:done emitted');
  assert.ok(types.includes('file:read'), 'file:read emitted for read_file');
  assert.ok(types.includes('file:done'), 'file:done emitted for read_file');
  assert.ok(types.includes('usage'), 'usage emitted');
  assert.ok(types.includes('result'), 'result emitted');

  const toolDone = byType['tool:done'][0] as { evidence?: string };
  assert.match(toolDone.evidence ?? '', /^read gateway\/src\/routes\/orders\.ts/);

  const usage = byType['usage'][0] as { inputTokens: number; outputTokens: number };
  assert.strictEqual(usage.inputTokens, 300);
  assert.strictEqual(usage.outputTokens, 40);

  assert.strictEqual(result.text, 'The gateway proxies orders via ordersRouter.');
  assert.strictEqual(result.source, 'provider');
  assert.ok(result.usage);
  assert.strictEqual(result.usage!.inputTokens, 300);
});

test('askPipeline: fenced sequence-tool block drives the loop without structured toolRequests', async () => {
  const repo = shopfrontRepo();
  const fenced =
    '```sequence-tool\n{"id":"t1","name":"read_file","args":{"path":"gateway/src/routes/orders.ts"}}\n```';
  const { calls, callProvider } = makeProviderScript([
    { text: `Reading.\n\n${fenced}` },
    { text: 'Final answer after reading.' },
  ]);
  const input = await makeAttachedInput(repo, callProvider);
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));
  const { types } = collect(events);

  assert.strictEqual(calls.length, 2);
  assert.ok(types.includes('tool:start'));
  assert.ok(types.includes('file:read'));
  assert.ok(calls[1].includes('TOOL RESULTS'));
  assert.ok(!result.text.includes('sequence-tool'));
  assert.strictEqual(result.text, 'Final answer after reading.');
});

test('askPipeline: bare propose_topology JSON lands on the board (owner Hermes dump)', async () => {
  const bare =
    '{"id":"d1","name":"propose_topology","args":{"title":"Hermes hub",' +
    '"nodes":[{"id":"proposal:hermes","label":"Hermes","kind":"agent"},' +
    '{"id":"proposal:memory","label":"Memory","kind":"datastore"}],' +
    '"edges":[{"id":"e1","from":"proposal:hermes","to":"proposal:memory","family":"db","label":"read/write"}]}}';
  const { callProvider } = makeProviderScript([
    { text: `Got it — no more questions.\n\n${bare}\n\nThat is the loop.` },
    { text: 'Diagram is on the board.' },
  ]);
  const input: AskPipelineInput = {
    question: 'Just show me on the board — Hermes agent hub.',
    intents: [],
    scopeLines: [],
    surface: undefined,
    deictic: false,
    design: { title: 'Blank', outline: 'Hermes hub' },
    designMode: true,
    askMode: 'research',
    graph: null,
    digest: undefined,
    cfg: { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test' },
    resolveReadable: () => null,
    repoRoot: null,
    callProvider,
  };
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));
  const { types, byType } = collect(events);

  assert.ok(types.includes('topology:proposal'), 'bare JSON must become a board proposal');
  const topo = byType['topology:proposal']![0] as {
    title?: string;
    nodes: { id: string }[];
  };
  assert.strictEqual(topo.title, 'Hermes hub');
  assert.strictEqual(topo.nodes.length, 2);
  assert.ok(!result.text.includes('propose_topology'), 'bare tool JSON stripped from answer');
  assert.ok(!result.text.includes('"name":"propose_topology"'));
});

test('askPipeline: no tool requests → single provider call, no tool events', async () => {
  const repo = shopfrontRepo();
  const { calls, callProvider } = makeProviderScript([
    { text: 'Direct answer.', usage: { inputTokens: 50, outputTokens: 5, estimated: true } },
  ]);
  const input = await makeAttachedInput(repo, callProvider);
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));
  const { types } = collect(events);

  assert.strictEqual(calls.length, 1);
  assert.ok(!types.includes('tool:start'));
  assert.ok(!types.includes('tool:done'), 'no tool:done when provider requests no tools');
  assert.ok(types.includes('usage'));
  assert.strictEqual(result.text, 'Direct answer.');
  assert.strictEqual(result.usage?.estimated, true);
});

/*
 * WHAT THIS TEST MEASURES CHANGED WHEN THE CAP DID, AND THE FIXTURE IS WHY.
 *
 * All three scripted rounds ask for the SAME file. Under a fixed cap of 3 that
 * ran to the cap and this asserted the cap held. The loop now spends its budget
 * on progress: round 1 brings the file back, rounds 2 and 3 bring back bytes
 * already in the ledger, and it stops — so this fixture demonstrates the
 * NO-PROGRESS ending, which is the more common one in practice.
 *
 * The ceiling is still tested, with a fixture that genuinely reaches it (eight
 * distinct files, every round novel), in `ask-round-budget.test.ts`.
 */
test('askPipeline: stops re-reading one file rather than spending the whole budget on it', async () => {
  const repo = shopfrontRepo();
  const { callProvider } = makeProviderScript([
    {
      text: 'more',
      toolRequests: [{ id: 't1', name: 'read_file', args: { path: 'gateway/src/routes/orders.ts' } }],
    },
    {
      text: 'more',
      toolRequests: [{ id: 't2', name: 'read_file', args: { path: 'gateway/src/routes/orders.ts' } }],
    },
    {
      text: 'more',
      toolRequests: [{ id: 't3', name: 'read_file', args: { path: 'gateway/src/routes/orders.ts' } }],
    },
    { text: 'final after cap' },
  ]);
  const input = await makeAttachedInput(repo, callProvider);
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));
  const { byType } = collect(events);

  const toolStarts = byType['tool:start'] ?? [];
  assert.strictEqual(
    toolStarts.length,
    1 + UNPRODUCTIVE_ROUND_LIMIT,
    'one productive round, then the unproductive budget, then stop',
  );
  assert.strictEqual(result.text, 'final after cap');
});

test('B1.3 askPipeline: explore intent tolerates one extra unproductive round', async () => {
  const repo = shopfrontRepo();
  const { callProvider } = makeProviderScript([
    {
      text: 'more',
      toolRequests: [{ id: 't1', name: 'read_file', args: { path: 'gateway/src/routes/orders.ts' } }],
    },
    {
      text: 'more',
      toolRequests: [{ id: 't2', name: 'read_file', args: { path: 'gateway/src/routes/orders.ts' } }],
    },
    {
      text: 'more',
      toolRequests: [{ id: 't3', name: 'read_file', args: { path: 'gateway/src/routes/orders.ts' } }],
    },
    {
      text: 'more',
      toolRequests: [{ id: 't4', name: 'read_file', args: { path: 'gateway/src/routes/orders.ts' } }],
    },
    { text: 'explore final' },
  ]);
  const input = await makeAttachedInput(repo, callProvider);
  input.question = 'What calls the gateway and how does orders work?';
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));
  const { byType } = collect(events);

  assert.strictEqual(result.metrics!.intent, 'explore');
  const toolStarts = byType['tool:start'] ?? [];
  assert.strictEqual(
    toolStarts.length,
    1 + EXPLORE_UNPRODUCTIVE_ROUND_LIMIT,
    'explore digs one more dead-end round than chat/draw',
  );
  assert.strictEqual(result.text, 'explore final');
});

test('askPipeline: a turn always ends in words, even when the last round is tool calls only', async () => {
  // B2.1 locking test — canned provider emits tools only, then empty prose at the cap.
  // The pipeline must inject an honest harness-voice final answer, never silence.
  const repo = shopfrontRepo();
  const toolOnly = (id: string) => ({
    text: '',
    toolRequests: [
      { id, name: 'read_file', args: { path: 'gateway/src/routes/orders.ts' } },
    ],
  });
  const { callProvider } = makeProviderScript([
    toolOnly('t1'),
    toolOnly('t2'),
    toolOnly('t3'),
    toolOnly('t4'), // the at-cap round: tool blocks, no prose
  ]);
  const input = await makeAttachedInput(repo, callProvider);
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));

  assert.ok(
    result.text.trim().length > 0,
    'the turn ended with an EMPTY answer. The model spent its last round on tool calls, ' +
      'the fences were stripped, and the user was given nothing at all — no answer and no ' +
      'reason. A turn must always end in words.',
  );
  assert.ok(
    result.metrics?.stopReason === 'ceiling' || result.metrics?.stopReason === 'no-progress',
    'tools-only empty ending must record ceiling or no-progress stop reason',
  );
  assert.ok(result.metrics!.rounds > 0, 'tool rounds ran before the forced final answer');
  assert.match(result.text, /tool (rounds|call)/i, 'forced answer names why tools stopped');
  assert.match(result.text, /read_file/, 'forced answer summarizes what tools ran');
});

test('askPipeline: design mode refuses tool requests (no fabricated files)', async () => {
  const { calls, callProvider } = makeProviderScript([
    {
      text: 'design text',
      toolRequests: [{ id: 't1', name: 'read_file', args: { path: 'any.ts' } }],
    },
    { text: 'design final' },
  ]);
  const input: AskPipelineInput = {
    question: 'Propose an architecture.',
    intents: [],
    scopeLines: [],
    surface: undefined,
    deictic: false,
    design: { title: 'Demo', outline: 'A service with one route.' },
    designMode: true,
    askMode: 'research',
    graph: null,
    digest: undefined,
    cfg: { provider: 'anthropic', model: 'claude-test', apiKey: 'sk-test' },
    resolveReadable: () => null,
    repoRoot: null,
    callProvider,
  };
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));
  const { byType } = collect(events);

  // Tool is refused (ok:false) but an honest refusal notice is still fed back
  // to the model so it is not left waiting — a TOOL RESULTS section lands in
  // round 2's prompt, carrying the refusal, never a fabricated file body.
  assert.ok(calls[1].includes('TOOL RESULTS'), 'refusal notice fed back as TOOL RESULTS');
  assert.ok(!calls[1].includes('untrusted_repo_content'), 'no fabricated file body in design mode');
  const toolDone = byType['tool:done']?.[0] as { evidence?: string } | undefined;
  assert.ok(toolDone, 'tool:done emitted even for refusal');
  assert.match(toolDone!.evidence ?? '', /attached repo/);
  assert.strictEqual(result.text, 'design final');
});

/* ============================================================ propose_files ===== */

test('executeAskTool propose_files: accepts proposal, attaches payload, does NOT write', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const before = treeSnapshot(repo);
  const result = await executeAskTool(
    'propose_files',
    {
      title: 'Add health route',
      files: [
        { path: 'gateway/src/routes/health.ts', content: 'export const health = () => 200;\n' },
        { path: 'gateway/src/routes/health.test.ts', content: 'import { health } from "./health";\n' },
      ],
    },
    { resolveReadable: (p) => resolveInRepo(root, p), repoRoot: root, designMode: false },
  );
  assert.ok(result.ok, result.evidence);
  assert.match(result.evidence, /proposed 2 files/);
  assert.ok(result.proposal, 'structured proposal attached for SSE');
  assert.strictEqual(result.proposal!.title, 'Add health route');
  assert.strictEqual(result.proposal!.files.length, 2);
  assert.strictEqual(result.proposal!.files[0].path, 'gateway/src/routes/health.ts');
  assert.ok(result.content!.includes('NOT written'), 'content tells the model nothing was written');
  assert.ok(result.content!.includes('gateway/src/routes/health.ts'), 'paths summarized in content');
  // The contract: propose_files never writes. The working tree is byte-identical.
  assert.deepStrictEqual(treeSnapshot(repo), before, 'propose_files wrote nothing to disk');
});

test('executeAskTool propose_files: refuses jail escape and .git internals', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const ctx = {
    resolveReadable: (p: string) => resolveInRepo(root, p),
    repoRoot: root,
    designMode: false,
  };
  const escaped = await executeAskTool(
    'propose_files',
    { files: [{ path: '../../../etc/passwd', content: 'x' }] },
    ctx,
  );
  assert.ok(!escaped.ok);
  assert.match(escaped.evidence, /not writable|jail or reserved/);
  assert.ok(!escaped.proposal, 'no proposal attached on refusal');
  const gitInternal = await executeAskTool(
    'propose_files',
    { files: [{ path: '.git/config', content: 'x' }] },
    ctx,
  );
  assert.ok(!gitInternal.ok);
  assert.match(gitInternal.evidence, /reserved git-internal/);
  assert.ok(!gitInternal.proposal);
});

test('executeAskTool propose_files: missing files array / empty / missing content refused', async () => {
  const ctx = { resolveReadable: () => null, repoRoot: '/tmp', designMode: false };
  const noFiles = await executeAskTool('propose_files', {}, ctx);
  assert.ok(!noFiles.ok);
  assert.match(noFiles.evidence, /non-empty "files"/);
  const empty = await executeAskTool('propose_files', { files: [] }, ctx);
  assert.ok(!empty.ok);
  assert.match(empty.evidence, /non-empty "files"/);
  const noContent = await executeAskTool(
    'propose_files',
    { files: [{ path: 'a.ts' }] },
    ctx,
  );
  assert.ok(!noContent.ok);
  assert.match(noContent.evidence, /missing "content"/);
});

test('executeAskTool propose_files: caps file count', async () => {
  const ctx = { resolveReadable: () => '/tmp/x', repoRoot: '/tmp', designMode: false };
  const files = Array.from({ length: ASK_TOOL_PROPOSE_MAX_FILES + 1 }, (_, i) => ({
    path: `f${i}.ts`,
    content: 'x',
  }));
  const r = await executeAskTool('propose_files', { files }, ctx);
  assert.ok(!r.ok);
  assert.match(r.evidence, /exceeds/);
});

/* ============================================================ run_command ===== */

test('executeAskTool run_command: allowlisted command runs and feeds output back', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const r = await executeAskTool(
    'run_command',
    { cmd: 'pnpm --filter @sequence/schema test' },
    { resolveReadable: (p) => resolveInRepo(root, p), repoRoot: root, designMode: false },
  );
  // pnpm may not be installed in the test env; either way the evidence is honest.
  assert.match(r.evidence, /ran "pnpm --filter @sequence\/schema test"/);
  assert.ok(r.content!.includes('run_command'), 'content header present');
});

/*
 * A REAL, TRUSTED ROOT — these two are about the COMMAND POLICY, and the trust
 * boundary now sits in front of it. `'/tmp'` used to serve as a throwaway root;
 * it does not resolve on Windows at all, so it is untrusted by construction and
 * every assertion below would be answered by the trust refusal rather than by
 * the metacharacter gate they mean to test. The untrusted half is locked in
 * `repo-trust.test.ts`.
 */
function trustedScratchRoot(): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-cmd-policy-')));
  setRepoTrust(userStoreDir(), dir, true);
  return dir;
}

test('executeAskTool run_command: non-allowlisted command refused', async () => {
  const ctx = { resolveReadable: () => null, repoRoot: trustedScratchRoot(), designMode: false };
  const r = await executeAskTool('run_command', { cmd: 'rm -rf .' }, ctx);
  assert.ok(!r.ok);
  assert.match(r.evidence, /shell metacharacters|not allowlisted/);
  assert.ok(!r.content, 'no output fed back for a refused command');
});

test('executeAskTool run_command: shell metacharacters refused', async () => {
  const ctx = { resolveReadable: () => null, repoRoot: trustedScratchRoot(), designMode: false };
  const r = await executeAskTool('run_command', { cmd: 'pnpm test; cat /etc/passwd' }, ctx);
  assert.ok(!r.ok);
  assert.match(r.evidence, /shell metacharacters/);
});

test('executeAskTool run_command: Work job mode refuses by default', async () => {
  const ctx = { resolveReadable: () => '/tmp/x', repoRoot: '/tmp', designMode: false, jobMode: 'work' as const };
  const r = await executeAskTool('run_command', { cmd: 'pnpm test' }, ctx);
  assert.ok(!r.ok);
  assert.match(r.evidence, /Work-mode/);
});

test('executeAskTool run_command: missing cmd refused', async () => {
  const ctx = { resolveReadable: () => null, repoRoot: '/tmp', designMode: false };
  const r = await executeAskTool('run_command', {}, ctx);
  assert.ok(!r.ok);
  assert.match(r.evidence, /missing "cmd"/);
  assert.ok(!r.commandLog, 'no commandLog for allowlist refusal');
});

test('executeAskTool run_command: attaches commandLog after spawn (even on non-zero exit)', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const r = await executeAskTool(
    'run_command',
    { cmd: 'pnpm --filter @sequence/schema test' },
    { resolveReadable: (p) => resolveInRepo(root, p), repoRoot: root, designMode: false },
  );
  assert.ok(r.commandLog, 'commandLog attached after spawn');
  assert.strictEqual(r.commandLog!.cmd, 'pnpm --filter @sequence/schema test');
  assert.ok(typeof r.commandLog!.output === 'string' && r.commandLog!.output.length > 0);
});

/* ============================================================ git_status / git_diff ===== */

test('executeAskTool git_status: returns branch + dirty file list for a real repo', async () => {
  const repo = shopfrontGitRepo();
  const root = fs.realpathSync(repo);
  // Make the working tree dirty so the list is non-empty.
  fs.writeFileSync(path.join(repo, 'gateway/src/routes/orders.ts'), '// touched\n');
  const r = await executeAskTool(
    'git_status',
    {},
    { resolveReadable: (p) => resolveInRepo(root, p), repoRoot: root, designMode: false },
  );
  assert.ok(r.ok, r.evidence);
  assert.match(r.evidence, /git status — \d+ file/);
  assert.ok(r.content!.includes('branch:'), 'branch line in content');
  assert.ok(r.content!.includes('gateway/src/routes/orders.ts'), 'dirty file listed');
});

test('executeAskTool git_diff: returns the unified diff for a dirty path', async () => {
  const repo = shopfrontGitRepo();
  const root = fs.realpathSync(repo);
  const rel = 'gateway/src/routes/orders.ts';
  const original = fs.readFileSync(path.join(repo, rel), 'utf8');
  fs.writeFileSync(path.join(repo, rel), `${original}\n// appended\n`);
  const r = await executeAskTool(
    'git_diff',
    { path: rel },
    { resolveReadable: (p) => resolveInRepo(root, p), repoRoot: root, designMode: false },
  );
  assert.ok(r.ok, r.evidence);
  assert.ok(r.content!.includes('git diff'), 'diff header in content');
  assert.ok(r.content!.includes('// appended'), 'appended line in diff');
});

test('executeAskTool git_diff: missing path refused', async () => {
  const ctx = { resolveReadable: () => null, repoRoot: '/tmp', designMode: false };
  const r = await executeAskTool('git_diff', {}, ctx);
  assert.ok(!r.ok);
  assert.match(r.evidence, /missing "path"/);
});

test('executeAskTool git_diff: jail-escaping path refused', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const r = await executeAskTool(
    'git_diff',
    { path: '../../../etc/passwd' },
    { resolveReadable: (p) => resolveInRepo(root, p), repoRoot: root, designMode: false },
  );
  assert.ok(!r.ok);
  assert.match(r.evidence, /refused: git_diff/);
});

/* ============================================================ call_mcp ===== */

test('executeAskTool call_mcp: unknown server refused when no mcp.json', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const r = await executeAskTool(
    'call_mcp',
    { server: 'nonexistent-server', tool: 'ping' },
    { resolveReadable: (p) => resolveInRepo(root, p), repoRoot: root, designMode: false },
  );
  assert.ok(!r.ok);
  assert.match(r.evidence, /unknown MCP server|not in allowlist/);
});

test('executeAskTool call_mcp: refused in design mode', async () => {
  const ctx = { resolveReadable: () => null, repoRoot: null, designMode: true };
  const r = await executeAskTool('call_mcp', { server: 'x', tool: 'y' }, ctx);
  assert.ok(!r.ok);
  assert.match(r.evidence, /attached repo/);
});

test('executeAskTool call_mcp: missing server or tool refused', async () => {
  const ctx = { resolveReadable: () => null, repoRoot: '/tmp', designMode: false };
  const noServer = await executeAskTool('call_mcp', { tool: 'ping' }, ctx);
  assert.ok(!noServer.ok);
  assert.match(noServer.evidence, /missing "server"/);
  const noTool = await executeAskTool('call_mcp', { server: 'x' }, ctx);
  assert.ok(!noTool.ok);
  assert.match(noTool.evidence, /missing "tool"/);
});

/* ========================================================= call_plugin ===== */

test('executeAskTool call_plugin: ping builtin when declared in plugins.json', async () => {
  const repo = shopfrontRepo();
  fs.mkdirSync(path.join(repo, '.sequence'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, '.sequence', 'plugins.json'),
    JSON.stringify({
      version: 0,
      plugins: [
        {
          id: 'demo',
          mode: 'readonly',
          tools: [{ name: 'ping', description: 'echo' }],
        },
      ],
    }),
  );
  const r = await executeAskTool(
    'call_plugin',
    { plugin: 'demo', tool: 'ping', args: { n: 1 } },
    { resolveReadable: () => null, repoRoot: repo, designMode: false },
  );
  assert.ok(r.ok, r.evidence);
  assert.match(r.evidence, /call_plugin demo\/ping/);
  assert.ok(r.content?.includes('pong'), 'builtin ping body');
  assert.ok(r.content?.includes('untrusted_repo_content'), 'wrapped untrusted');
});

test('executeAskTool call_plugin: unknown plugin refused', async () => {
  const repo = shopfrontRepo();
  const r = await executeAskTool(
    'call_plugin',
    { plugin: 'missing', tool: 'ping' },
    { resolveReadable: () => null, repoRoot: repo, designMode: false },
  );
  assert.ok(!r.ok);
  assert.match(r.evidence, /unknown plugin/);
});

test('executeAskTool call_plugin: declared tool without handler refused honestly', async () => {
  const repo = shopfrontRepo();
  fs.mkdirSync(path.join(repo, '.sequence'), { recursive: true });
  fs.writeFileSync(
    path.join(repo, '.sequence', 'plugins.json'),
    JSON.stringify({
      version: 0,
      plugins: [{ id: 'demo', mode: 'readonly', tools: [{ name: 'echo' }] }],
    }),
  );
  const r = await executeAskTool(
    'call_plugin',
    { plugin: 'demo', tool: 'echo' },
    { resolveReadable: () => null, repoRoot: repo, designMode: false },
  );
  assert.ok(!r.ok);
  assert.match(r.evidence, /no handler yet/);
});

test('executeAskTool call_plugin: missing plugin or tool refused', async () => {
  const ctx = { resolveReadable: () => null, repoRoot: '/tmp', designMode: false };
  const noPlugin = await executeAskTool('call_plugin', { tool: 'ping' }, ctx);
  assert.ok(!noPlugin.ok);
  assert.match(noPlugin.evidence, /missing "plugin"/);
  const noTool = await executeAskTool('call_plugin', { plugin: 'x' }, ctx);
  assert.ok(!noTool.ok);
  assert.match(noTool.evidence, /missing "tool"/);
});

test('executeAskTool call_plugin: refused in design mode', async () => {
  const ctx = { resolveReadable: () => null, repoRoot: null, designMode: true };
  const r = await executeAskTool('call_plugin', { plugin: 'x', tool: 'ping' }, ctx);
  assert.ok(!r.ok);
  assert.match(r.evidence, /needs an attached repo/);
});

test('permissionSubjects call_plugin: plugin:tool subject', () => {
  assert.deepStrictEqual(permissionSubjects('call_plugin', { plugin: 'demo', tool: 'ping' }), [
    { kind: 'plugin', value: 'demo:ping' },
  ]);
});

/* ========================================================= fetch_url ===== */

test('executeAskTool fetch_url: refuses SSRF without calling fetch', async () => {
  let called = false;
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    called = true;
    return new Response('x');
  };
  try {
    const r = await executeAskTool('fetch_url', { url: 'http://127.0.0.1/x' }, {
      resolveReadable: () => null,
      repoRoot: null,
      designMode: true,
    });
    assert.ok(!r.ok);
    assert.match(r.evidence, /refused|failed/i);
    assert.strictEqual(called, false);
  } finally {
    globalThis.fetch = prevFetch;
  }
});

test('executeAskTool fetch_url: works without attached repo', async () => {
  const prev = process.env.SEQUENCE_RESEARCH_ALLOW_LOOPBACK;
  process.env.SEQUENCE_RESEARCH_ALLOW_LOOPBACK = 'http://127.0.0.1:9/doc';
  const prevFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('/doc')) {
      return new Response('<html><title>T</title><body>Hello web.</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    return prevFetch(input);
  };
  try {
    const r = await executeAskTool('fetch_url', { url: 'http://127.0.0.1:9/doc' }, {
      resolveReadable: () => null,
      repoRoot: null,
      designMode: true,
    });
    assert.ok(r.ok, r.evidence);
    assert.match(r.content ?? '', /Hello web/);
  } finally {
    if (prev === undefined) delete process.env.SEQUENCE_RESEARCH_ALLOW_LOOPBACK;
    else process.env.SEQUENCE_RESEARCH_ALLOW_LOOPBACK = prev;
    globalThis.fetch = prevFetch;
  }
});

test('permissionSubjects fetch_url: url subject', () => {
  assert.deepStrictEqual(permissionSubjects('fetch_url', { url: 'https://example.com/a' }), [
    { kind: 'url', value: 'https://example.com/a' },
  ]);
});

/* ============================================================ edit:proposal SSE ===== */

test('askPipeline: propose_files emits edit:proposal SSE with structured files', async () => {
  const repo = shopfrontRepo();
  const before = treeSnapshot(repo);
  const { calls, callProvider } = makeProviderScript([
    {
      text: 'I will propose a health route.',
      usage: { inputTokens: 100, outputTokens: 10, estimated: false },
      toolRequests: [
        {
          id: 'p1',
          name: 'propose_files',
          args: {
            title: 'Add health route',
            files: [{ path: 'gateway/src/routes/health.ts', content: 'export const health = () => 200;\n' }],
          },
        },
      ],
    },
    { text: 'Proposed the health route for your review.' },
  ]);
  const input = await makeAttachedInput(repo, callProvider);
  const events: AskStreamEvent[] = [];
  await runAskPipeline(input, (e) => events.push(e));
  const { byType } = collect(events);

  assert.ok(byType['edit:proposal'], 'edit:proposal event emitted');
  const proposal = byType['edit:proposal'][0] as {
    title?: string;
    files: { path: string; content: string }[];
  };
  assert.strictEqual(proposal.title, 'Add health route');
  assert.strictEqual(proposal.files.length, 1);
  assert.strictEqual(proposal.files[0].path, 'gateway/src/routes/health.ts');
  assert.strictEqual(proposal.files[0].content, 'export const health = () => 200;\n');
  // The proposal was staged as structured SSE — the model text was not the
  // only carrier of the proposal (no hope-JSON parsing).
  assert.ok(calls[1].includes('TOOL RESULTS'), 'tool result fed back to round 2');
  assert.ok(calls[1].includes('NOT written'), 'model told nothing was written');
  // Nothing was written to disk by the proposal.
  assert.deepStrictEqual(treeSnapshot(repo), before, 'pipeline wrote nothing to disk');
});

test('askPipeline: edit intent early-exits after successful propose_files (B1.4)', async () => {
  const repo = shopfrontRepo();
  const { calls, callProvider } = makeProviderScript([
    {
      text: 'Proposed a health route.',
      toolRequests: [
        {
          id: 'p1',
          name: 'propose_files',
          args: {
            title: 'Add health route',
            files: [
              {
                path: 'gateway/src/routes/health.ts',
                content: 'export const health = () => 200;\n',
              },
            ],
          },
        },
      ],
    },
    { text: 'Should not reach a second provider call.' },
  ]);
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'Fix the gateway by adding a health route',
  };
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));
  const { byType } = collect(events);

  assert.strictEqual(result.metrics?.intent, 'edit');
  assert.strictEqual(result.metrics?.rounds, 1);
  assert.strictEqual(result.metrics?.stopReason, 'complete');
  assert.strictEqual(calls.length, 1, 'B1.4 edit early-exit — no second provider round');
  assert.ok(byType['edit:proposal']);
  assert.strictEqual(result.text, 'Proposed a health route.');
});

test('askPipeline: one propose_files per turn — second call refused (B1.4)', async () => {
  const repo = shopfrontRepo();
  const { calls, callProvider } = makeProviderScript([
    {
      text: 'two proposals',
      toolRequests: [
        {
          id: 'p1',
          name: 'propose_files',
          args: {
            title: 'First',
            files: [{ path: 'a.ts', content: 'a\n' }],
          },
        },
        {
          id: 'p2',
          name: 'propose_files',
          args: {
            title: 'Second',
            files: [{ path: 'b.ts', content: 'b\n' }],
          },
        },
      ],
    },
    { text: 'Should not reach — edit early-exits after first success.' },
  ]);
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'Refactor the gateway routes and implement health',
  };
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));
  const { byType } = collect(events);

  assert.strictEqual((byType['edit:proposal'] ?? []).length, 1);
  const doneP2 = (byType['tool:done'] ?? []).find((e) => (e as { id?: string }).id === 'p2') as
    | { evidence?: string }
    | undefined;
  assert.ok(
    doneP2?.evidence?.includes('already staged one file-edit proposal'),
    'second propose_files refused in the same round',
  );
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(result.text, 'two proposals');
});

test('askPipeline: git_status tool runs in-loop and feeds status back', async () => {
  const repo = shopfrontGitRepo();
  const root = fs.realpathSync(repo);
  fs.writeFileSync(path.join(repo, 'gateway/src/routes/orders.ts'), '// touched\n');
  const { calls, callProvider } = makeProviderScript([
    {
      text: 'Checking the tree.',
      toolRequests: [{ id: 'g1', name: 'git_status', args: {} }],
    },
    { text: 'Tree has changes.' },
  ]);
  const input = await makeAttachedInput(repo, callProvider);
  const events: AskStreamEvent[] = [];
  await runAskPipeline(input, (e) => events.push(e));
  const { byType } = collect(events);

  assert.ok(byType['tool:done'], 'tool:done emitted');
  const toolDone = byType['tool:done'][0] as { evidence?: string; name?: string };
  assert.strictEqual(toolDone.name, 'git_status');
  assert.match(toolDone.evidence ?? '', /git status — \d+ file/);
  assert.ok(calls[1].includes('TOOL RESULTS'), 'git status fed back to round 2');
  assert.ok(calls[1].includes('gateway/src/routes/orders.ts'), 'dirty file in fed-back status');
  // root referenced (keeps linter happy about the unused realpath in this test)
  assert.ok(root.length > 0);
});

test('computeAskInstructionHash: same fragments yield same hash; hint change changes hash', () => {
  const base = {
    designMode: false,
    repoRoot: '/fake/repo',
    jobMode: 'work' as const,
    permission: 'propose' as const,
    question: 'How does the gateway route orders?',
    surface: undefined,
  };
  const belt = renderAskInstructionBelt(base);
  const hashA = computeAskInstructionHash(base);
  const hashB = computeAskInstructionHash(base);
  assert.strictEqual(hashA, hashB);
  assert.strictEqual(hashA, hashAskInstructionBelt(belt));
  assert.match(hashA, /^[0-9a-f]{16}$/);

  const planHash = computeAskInstructionHash({ ...base, permission: 'plan' });
  assert.notStrictEqual(hashA, planHash);

  /* Work mode differs from code mode by exactly one tool — the shell — so the
     two belts only diverge in a mode that HAS the shell. Under Propose neither
     carries it and the hints are legitimately identical. */
  const workHint = renderAskToolHintSection('work', 'full').join('\n');
  const codeHint = renderAskToolHintSection('code', 'full').join('\n');
  assert.notStrictEqual(workHint, codeHint);
  const fullBase = { ...base, permission: 'full' as const };
  assert.notStrictEqual(
    computeAskInstructionHash(fullBase),
    computeAskInstructionHash({ ...fullBase, jobMode: 'code' }),
  );
});

test('runAskPipeline: provider prompt includes instruction belt matching trajectory hash inputs', async () => {
  const repo = shopfrontRepo();
  const { calls, callProvider } = makeProviderScript([{ text: 'Done.' }]);
  const input = await makeAttachedInput(repo, callProvider);
  input.permission = 'plan';
  const expectedHash = computeAskInstructionHash(input);
  const belt = renderAskInstructionBelt(input);
  await runAskPipeline(input, () => {});
  assert.ok(calls[0].includes(belt), 'first provider prompt carries the instruction belt');
  assert.strictEqual(expectedHash, computeAskInstructionHash(input));
});

test('askPipeline: run_command emits command:log SSE with structured output', async () => {
  const repo = shopfrontRepo();
  const { calls, callProvider } = makeProviderScript([
    {
      text: 'Running tests.',
      toolRequests: [{ id: 'c1', name: 'run_command', args: { cmd: 'pnpm --filter @sequence/schema test' } }],
    },
    { text: 'Tests finished.' },
  ]);
  const base = await makeAttachedInput(repo, callProvider);
  // Full permission: since Wave 6, run_command executes ONLY under full — the
  // ladder's own promise ("Full is the mode that runs things"), now enforced
  // at the executor and not just in the advertised belt.
  const input: AskPipelineInput = { ...base, permission: 'full' };
  const events: AskStreamEvent[] = [];
  await runAskPipeline(input, (e) => events.push(e));
  const { byType } = collect(events);

  assert.ok(byType['command:log'], 'command:log event emitted');
  const log = byType['command:log'][0] as {
    cmd: string;
    exitCode: number | null;
    output: string;
    ok: boolean;
  };
  assert.strictEqual(log.cmd, 'pnpm --filter @sequence/schema test');
  assert.ok(typeof log.output === 'string' && log.output.length > 0);
  assert.ok(calls[1].includes('TOOL RESULTS'), 'command output fed back to round 2');
});

/** Snapshot every file path + size under repo, for "nothing was written" checks. */
function treeSnapshot(repo: string): Map<string, number> {
  const snap = new Map<string, number>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) snap.set(path.relative(repo, abs), fs.statSync(abs).size);
    }
  };
  walk(repo);
  return snap;
}

/* ==================================================== write→test→fix (Wave 6) ===== */

/** A jail-respecting auto-apply, shaped like the host's applyProposedFiles. */
function testAutoApply(root: string): NonNullable<AskPipelineInput['applyProposedFiles']> {
  return async (files) => {
    const written: string[] = [];
    for (const f of files) {
      const abs = resolveInRepo(root, f.path);
      if (!abs) return { written, refused: [{ path: f.path, reason: 'outside the repo' }] };
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, f.content, 'utf8');
      written.push(f.path);
    }
    return { written, refused: [] };
  };
}

test('askPipeline full permission: write → (feedback) → write again in ONE turn', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const { calls, callProvider } = makeProviderScript([
    {
      text: 'First attempt.',
      toolRequests: [
        {
          id: 'w1',
          name: 'propose_files',
          args: {
            title: 'Add health route',
            files: [
              { path: 'gateway/src/routes/health.ts', content: 'export const health = () => 500;\n' },
            ],
          },
        },
      ],
    },
    {
      text: 'Fixing the status code.',
      toolRequests: [
        {
          id: 'w2',
          name: 'propose_files',
          args: {
            title: 'Fix health status',
            files: [
              { path: 'gateway/src/routes/health.ts', content: 'export const health = () => 200;\n' },
            ],
          },
        },
      ],
    },
    { text: 'Done: health route added and corrected.' },
  ]);
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'Fix the gateway by adding a health route',
    permission: 'full',
    applyProposedFiles: testAutoApply(root),
  };
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));
  const { byType } = collect(events);

  // The whole point: the second write EXECUTED instead of meeting the latch.
  // (Rounds 4-5 are the verify contract doing its job — two writes landed,
  // nothing was executed after them, and prose answers earn BOTH demands.)
  assert.strictEqual(calls.length, 5, 'write, fix, report, verify demand, final demand');
  assert.ok(calls[3]!.includes('YOUR EDIT IS UNVERIFIED'), 'the fourth round is the verify contract');
  assert.ok(calls[4]!.includes('FINAL verification demand'), 'the fifth is the harder-worded repeat');
  const proposals = (byType['edit:proposal'] ?? []) as Array<{ applied?: boolean }>;
  assert.strictEqual(proposals.length, 2, 'both writes surfaced as events');
  assert.ok(proposals.every((p) => p.applied === true), 'both writes applied');
  const done2 = (byType['tool:done'] ?? []).find((e) => (e as { id?: string }).id === 'w2') as
    | { evidence?: string }
    | undefined;
  assert.ok(
    !(done2?.evidence ?? '').includes('already staged'),
    'second write not refused by the propose-mode latch',
  );
  // Disk holds the FIXED content — the iteration actually landed.
  const finalBody = fs.readFileSync(path.join(root, 'gateway/src/routes/health.ts'), 'utf8');
  assert.strictEqual(finalBody, 'export const health = () => 200;\n');
  assert.strictEqual(result.text, 'Done: health route added and corrected.');
});

test('askPipeline full permission: the write budget refuses call N+1 with the budget message', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const overBudget = ASK_TOOL_WRITE_CALLS_PER_TURN + 1;
  const reqs = Array.from({ length: overBudget }, (_, i) => ({
    id: `b${i + 1}`,
    name: 'propose_files',
    args: {
      title: `Write ${i + 1}`,
      files: [{ path: `gen/file-${i + 1}.ts`, content: `export const n = ${i + 1};\n` }],
    },
  }));
  const { callProvider } = makeProviderScript([
    { text: 'Writing a lot.', toolRequests: reqs },
    { text: 'Stopped at the budget.' },
  ]);
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'Generate the module files',
    permission: 'full',
    applyProposedFiles: testAutoApply(root),
  };
  const events: AskStreamEvent[] = [];
  await runAskPipeline(input, (e) => events.push(e));
  const { byType } = collect(events);

  const proposals = (byType['edit:proposal'] ?? []) as Array<{ applied?: boolean }>;
  assert.strictEqual(proposals.length, ASK_TOOL_WRITE_CALLS_PER_TURN, 'budget-many writes landed');
  const doneLast = (byType['tool:done'] ?? []).find(
    (e) => (e as { id?: string }).id === `b${overBudget}`,
  ) as { evidence?: string } | undefined;
  assert.ok(
    (doneLast?.evidence ?? '').includes('write budget'),
    `call ${overBudget} refused with the budget message, got: ${doneLast?.evidence}`,
  );
  assert.strictEqual(
    fs.existsSync(path.join(root, `gen/file-${overBudget}.ts`)),
    false,
    'the over-budget write did not land',
  );
});

test('askPipeline: run_command is refused OUTSIDE full permission, before execution', async () => {
  const repo = shopfrontRepo();
  const { calls, callProvider } = makeProviderScript([
    {
      text: 'Trying to run tests.',
      toolRequests: [{ id: 'r1', name: 'run_command', args: { cmd: 'pnpm test' } }],
    },
    { text: 'Understood — commands need Full access.' },
  ]);
  const base = await makeAttachedInput(repo, callProvider);
  // permission deliberately ABSENT — the propose-behaviour default. The belt
  // omits run_command here; a model that emits the fence anyway must meet a
  // refusal, not an execution.
  const input: AskPipelineInput = { ...base, question: 'Run the tests please' };
  const events: AskStreamEvent[] = [];
  await runAskPipeline(input, (e) => events.push(e));
  assert.ok(calls.length >= 2, 'refusal fed back to a second round');
  assert.ok(
    calls[1].includes('only Full access runs commands'),
    'the refusal names the rule and the mode',
  );
  assert.ok(
    !calls[1].includes('### run_command:'),
    'no command output anywhere — nothing executed',
  );
});

/* ==================================================== the draw contract (Wave 7b) ===== */

test('askPipeline draw intent: a turn that drew nothing gets ONE forced draw round', async () => {
  const repo = shopfrontRepo();
  const { calls, callProvider } = makeProviderScript([
    // Round 1: the granite failure shape — research, then prose, no draw call.
    {
      text: 'The gateway routes orders through the payment service. (prose, no drawing)',
      toolRequests: [{ id: 'r1', name: 'read_file', args: { path: 'gateway/src/server.ts' } }],
    },
    { text: 'More prose about the architecture, still no tool call.' },
    // Forced round: the demand lands, the model finally draws.
    {
      text: 'A compact overview of the gateway.',
      toolRequests: [
        {
          id: 'd1',
          name: 'propose_topology',
          args: {
            title: 'Gateway overview',
            nodes: [{ id: 'svc:overview', label: 'overview', kind: 'service' }],
            edges: [],
          },
        },
      ],
    },
  ]);
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'Draw a travel insurer architecture on the board',
  };
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));
  const { byType } = collect(events);

  assert.strictEqual(result.metrics?.intent, 'draw');
  assert.strictEqual(calls.length, 3, 'two loop rounds + one forced draw round');
  assert.ok(
    calls[2].includes('YOU HAVE NOT DRAWN ANYTHING'),
    'the forced round names the contract',
  );
  assert.ok(byType['topology:proposal'], 'the drawing landed on the board');
  assert.strictEqual(result.text, 'A compact overview of the gateway.');
});

test('askPipeline draw intent: still nothing drawn → the harness says so in its own voice', async () => {
  const repo = shopfrontRepo();
  const { calls, callProvider } = makeProviderScript([
    { text: 'Prose only, no drawing.' },
    { text: 'Even when forced: more prose, no tool call.' },
  ]);
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'Draw a diagram of the gateway',
  };
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));
  const { byType } = collect(events);

  assert.strictEqual(calls.length, 2, 'one loop round + one forced round, then stop');
  assert.strictEqual(byType['topology:proposal'], undefined);
  assert.strictEqual(byType['canvas:block'], undefined);
  assert.ok(
    result.text.includes('Nothing landed on the canvas'),
    `empty canvas is named, got: ${result.text.slice(0, 200)}`,
  );
});

test('askPipeline draw intent: a scoping question is NOT forced into a drawing', async () => {
  const repo = shopfrontRepo();
  const { calls, callProvider } = makeProviderScript([
    { text: 'Do you want a compact overview or a detailed diagram?' },
    { text: 'Should not be called — the model is waiting on the user.' },
  ]);
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'Draw a diagram of the gateway',
  };
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));

  assert.strictEqual(calls.length, 1, 'the clarify flow stands — no forced call');
  assert.strictEqual(result.text, 'Do you want a compact overview or a detailed diagram?');
});

/* ==================================================== prompt caching (Wave 8) ===== */

test('askPipeline: every round declares the SAME invariant-prefix breakpoint, and the prefix is byte-stable', async () => {
  const repo = shopfrontRepo();
  const calls: string[] = [];
  const breakpoints: Array<number | undefined> = [];
  const script: CannedProvider[] = [
    {
      text: 'reading',
      toolRequests: [{ id: 'r1', name: 'read_file', args: { path: 'gateway/src/server.ts' } }],
    },
    {
      text: 'reading more',
      toolRequests: [{ id: 'r2', name: 'read_file', args: { path: 'gateway/src/routes/orders.ts' } }],
    },
    { text: 'Done.' },
  ];
  let i = 0;
  const callProvider: AskPipelineInput['callProvider'] = async (_cfg, prompt, _onDelta, opts) => {
    calls.push(prompt);
    breakpoints.push(opts?.cacheBreakpointChars);
    const canned = script[Math.min(i, script.length - 1)]!;
    i++;
    return { text: canned.text, ...(canned.toolRequests ? { toolRequests: canned.toolRequests } : {}) };
  };
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'How does the gateway route orders in the source code?',
    callProvider,
  };
  await runAskPipeline(input, () => {});

  assert.strictEqual(calls.length, 3);
  const bp = breakpoints[0];
  assert.ok(typeof bp === 'number' && bp > 0, 'a breakpoint is declared');
  assert.ok(breakpoints.every((b) => b === bp), 'same breakpoint every round');
  // THE CLAIM THAT MAKES CACHING WORK: the declared prefix is byte-identical
  // across rounds. A prefix that shifted by one character would be a cache
  // miss every round while the request body promised otherwise.
  const prefix = calls[0].slice(0, bp);
  assert.ok(calls.every((c) => c.startsWith(prefix)), 'declared prefix is byte-stable');
  // And the tail is what varies — round 2 carries round 1's tool results.
  assert.notStrictEqual(calls[0], calls[1]);
});

/* ==================================================== the edit contract (Wave 9) ===== */

test('askPipeline edit+full: a prose-only round gets the make-the-change nudge, then edits land', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const { calls, callProvider } = makeProviderScript([
    // The measured SWE-bench failure: a beautiful plan, zero tool calls.
    { text: 'Phase 1 — READING. The fix is to change the health route. (prose plan, no tools)' },
    // After the nudge: the model actually makes the change.
    {
      text: 'Making the change now.',
      toolRequests: [
        {
          id: 'e1',
          name: 'propose_files',
          args: {
            title: 'Apply the fix',
            files: [{ path: 'gateway/src/routes/health.ts', content: 'export const health = () => 200;\n' }],
          },
        },
      ],
    },
    { text: 'Change applied and verified.' },
  ]);
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'Fix the gateway by adding a health route',
    permission: 'full',
    applyProposedFiles: testAutoApply(root),
  };
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));
  const { byType } = collect(events);

  assert.strictEqual(result.metrics?.intent, 'edit');
  assert.ok(calls.length >= 3, 'prose round + nudged round + report');
  assert.ok(
    calls[1].includes('YOU HAVE CHANGED NOTHING'),
    'the nudge is fed back as a harness tool result',
  );
  assert.ok((byType['edit:proposal'] ?? []).length === 1, 'the edit landed after the nudge');
  assert.strictEqual(
    fs.readFileSync(path.join(root, 'gateway/src/routes/health.ts'), 'utf8'),
    'export const health = () => 200;\n',
  );
  assert.ok(!result.text.includes('no file was changed'), 'no false note once a write landed');
});

test('askPipeline edit+full: still nothing written → the closing fact names it', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const { calls, callProvider } = makeProviderScript([
    { text: 'A plan, but no action.' },
    { text: 'Even after the nudge: more prose.' },
  ]);
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'Fix the gateway by adding a health route',
    permission: 'full',
    applyProposedFiles: testAutoApply(root),
  };
  const result = await runAskPipeline(input, () => {});

  /* The nudge REPEATS under auto-writes — a countdown each round — so a
     prose-only model spends the budget being told the deliverable, not two
     rounds. The closing fact still lands. */
  assert.ok(calls.length > 4, `the harness kept trying (${calls.length} calls)`);
  assert.ok(calls[calls.length - 1]!.includes('round(s) remain'), 'the countdown is live');
  assert.ok(
    result.text.includes('no file was changed this turn'),
    `the untouched tree is named, got: ${result.text.slice(-200)}`,
  );
});

test('askPipeline edit+propose: the nudge demands STAGING, and the staged proposal ends the turn', async () => {
  const repo = shopfrontRepo();
  const { calls, callProvider } = makeProviderScript([
    // Measured on hoppscotch: "create HEALTHCHECK.md" answered in prose,
    // zero proposals, Review empty, nothing said so.
    { text: 'Describing the change instead of staging it.' },
    {
      text: 'Staging it now.',
      toolRequests: [
        {
          id: 's1',
          name: 'propose_files',
          args: {
            title: 'Add health route',
            files: [{ path: 'gateway/src/routes/health.ts', content: 'export const health = () => 200;' }],
          },
        },
      ],
    },
  ]);
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'Fix the gateway by adding a health route',
  };
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));
  const { byType } = collect(events);

  assert.ok(calls[1].includes('YOU HAVE STAGED NOTHING'), 'the propose-mode nudge names staging');
  assert.strictEqual((byType['edit:proposal'] ?? []).length, 1, 'the proposal landed for Review');
  assert.ok(!result.text.includes('nothing new in Review'), 'no false note once staged');
});

test('askPipeline edit+propose: still nothing staged → the closing fact names Review', async () => {
  const repo = shopfrontRepo();
  const { callProvider } = makeProviderScript([
    { text: 'Prose only.' },
    { text: 'Still prose after the nudge.' },
  ]);
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'Fix the gateway by adding a health route',
  };
  const result = await runAskPipeline(input, () => {});
  assert.ok(
    result.text.includes('nothing new in Review'),
    `the empty Review is named, got: ${result.text.slice(-160)}`,
  );
});

test('askPipeline full permission: past half budget with no write, every prompt carries the budget check', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  // Eight distinct reads — always-new evidence, so the loop runs to its cap.
  const files = [
    'gateway/src/server.ts', 'gateway/src/routes/orders.ts', 'gateway/package.json',
    'worker/src/consumer.ts', 'worker/package.json', 'web/src/api.ts',
    'web/package.json', 'docker-compose.yml',
  ];
  const script: CannedProvider[] = files.map((f, i) => ({
    text: `investigating ${i}`,
    toolRequests: [{ id: `r${i}`, name: 'read_file', args: { path: f } }],
  }));
  script.push({ text: 'Ran out while planning.' });
  const { calls, callProvider } = makeProviderScript(script);
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'Fix the gateway routing bug',
    permission: 'full',
    // Pin the everyday cap: this test is about WHERE the budget check appears
    // relative to the half-spent point, not about the agentic default (16).
    maxRounds: MAX_ASK_TOOL_ROUNDS,
    applyProposedFiles: testAutoApply(root),
  };
  await runAskPipeline(input, () => {});

  const half = Math.ceil(MAX_ASK_TOOL_ROUNDS / 2);
  // Prompts assembled BEFORE half spent carry no check; every one after does.
  assert.ok(
    !calls[half - 1]!.includes('harness budget check'),
    'no budget nag while the budget is young',
  );
  const late = calls.slice(half + 1).filter((c) => c.includes('TOOL RESULTS'));
  assert.ok(late.length > 0, 'late rounds exist');
  for (const c of late) {
    assert.ok(
      c.includes('harness budget check') && c.includes('NO FILE HAS BEEN CHANGED'),
      'every post-half prompt names the spent rounds and the missing deliverable',
    );
  }
});

test('askPipeline: the identity follows the permission — engineer under full+edit, answerer otherwise', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  {
    const { calls, callProvider } = makeProviderScript([{ text: 'ok' }]);
    const base = await makeAttachedInput(repo, callProvider);
    await runAskPipeline(
      { ...base, question: 'Fix the gateway health route', permission: 'full', applyProposedFiles: testAutoApply(root) },
      () => {},
    );
    assert.ok(calls[0]!.includes('autonomous software engineer'), 'full+edit opens as an engineer');
    assert.ok(
      !calls[0]!.includes('assistant that answers questions'),
      'and not as an answerer — the first sentence is the job description',
    );
    // The grounding law survives the identity change, word for word.
    assert.ok(calls[0]!.includes('Do NOT invent'), 'grounding rule intact');
  }
  {
    const { calls, callProvider } = makeProviderScript([{ text: 'ok' }]);
    const base = await makeAttachedInput(repo, callProvider);
    await runAskPipeline({ ...base, question: 'How does the gateway route orders?' }, () => {});
    assert.ok(calls[0]!.includes('assistant that answers questions'), 'a question keeps the answerer');
  }
});

/* ================================================== prose-diff salvage ===== */

test('askPipeline full permission: a ```diff fence in the final answer is APPLIED (prose-diff salvage)', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  // The measured SWE-bench failure shape: engineer identity in place, the model
  // reads via tools but delivers its whole edit as a unified diff in prose and
  // never calls propose_files. The harness must apply that work, not discard it.
  const answer = [
    'The health route should report a version. Fix:',
    '```diff',
    '--- a/gateway/src/index.ts',
    '+++ b/gateway/src/index.ts',
    "@@ -15,3 +15,3 @@",
    " app.get('/health', (_req, res) => {",
    '-  res.json({ ok: true });',
    "+  res.json({ ok: true, version: 2 });",
    ' });',
    '```',
  ].join('\n');
  const { callProvider } = makeProviderScript([{ text: answer }]);
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'Fix the health route to report a version',
    permission: 'full',
    applyProposedFiles: testAutoApply(root),
  };
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));
  const { byType } = collect(events);

  // The edit landed on disk through the same jail as propose_files.
  const body = fs.readFileSync(path.join(root, 'gateway/src/index.ts'), 'utf8');
  assert.ok(body.includes('version: 2'), `diff applied to disk, got: ${body.slice(0, 400)}`);
  const proposals = (byType['edit:proposal'] ?? []) as Array<{ applied?: boolean }>;
  assert.strictEqual(proposals.length, 1, 'the salvage surfaced as an edit:proposal event');
  assert.strictEqual(proposals[0]!.applied, true);
  // The answer says what happened, and the "no file was changed" fact is gone —
  // a file WAS changed.
  assert.ok(/Applied the diff above to 1 file\(s\)/.test(result.text), result.text);
  assert.ok(!result.text.includes('no file was changed'), result.text);
});

test('askPipeline full permission: a diff whose context does not match is refused HONESTLY, not half-applied', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const answer = [
    'Fix:',
    '```diff',
    '--- a/gateway/src/index.ts',
    '+++ b/gateway/src/index.ts',
    '@@ -15,2 +15,2 @@',
    ' app.get(NOT_IN_THE_FILE, (_req, res) => {',
    // the removal must be unreal too — a real '-' line now anchors the edit
    '-  res.json({ NOT_REAL: true });',
    '+  res.json({ ok: false });',
    '```',
  ].join('\n');
  const { callProvider } = makeProviderScript([{ text: answer }]);
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'Fix the health route payload',
    permission: 'full',
    applyProposedFiles: testAutoApply(root),
  };
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));
  const { byType } = collect(events);

  const body = fs.readFileSync(path.join(root, 'gateway/src/index.ts'), 'utf8');
  assert.ok(body.includes('res.json({ ok: true });'), 'file untouched');
  assert.strictEqual((byType['edit:proposal'] ?? []).length, 0, 'nothing surfaced as applied');
  assert.ok(/Not applied — .*context does not match/.test(result.text), result.text);
  // And the closing fact still tells the truth: nothing changed.
  assert.ok(result.text.includes('no file was changed'), result.text);
});

test('askPipeline propose permission: prose diffs are NOT silently applied without auto-writes', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const answer = [
    '```diff',
    '--- a/gateway/src/index.ts',
    '+++ b/gateway/src/index.ts',
    '@@ -16 +16 @@',
    '-  res.json({ ok: true });',
    '+  res.json({ ok: true, version: 2 });',
    '```',
  ].join('\n');
  const { callProvider } = makeProviderScript([{ text: answer }]);
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'Fix the health route',
    permission: 'propose',
    applyProposedFiles: testAutoApply(root),
  };
  await runAskPipeline(input, () => {});
  const body = fs.readFileSync(path.join(root, 'gateway/src/index.ts'), 'utf8');
  assert.ok(!body.includes('version: 2'), 'propose mode never writes disk from prose');
});

/* ============================================== last-chance diff round ===== */

test('askPipeline full permission: a turn about to end with zero writes gets ONE last-chance diff round, and the salvage lands it', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const diffAnswer = [
    'Here is the fix:',
    '```diff',
    '--- a/gateway/src/index.ts',
    '+++ b/gateway/src/index.ts',
    '@@ -16 +16 @@',
    '-  res.json({ ok: true });',
    '+  res.json({ ok: true, version: 3 });',
    '```',
  ].join('\n');
  const { calls, callProvider } = makeProviderScript([
    // Ends with '?', which skips the countdown nudge — the exact break path
    // the last-chance round exists to intercept.
    { text: 'I have diagnosed the issue. Shall I proceed with the change?' },
    { text: diffAnswer },
  ]);
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'Fix the health route version field',
    permission: 'full',
    applyProposedFiles: testAutoApply(root),
  };
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));
  const { byType } = collect(events);

  assert.strictEqual(calls.length, 2, 'exactly one extra round was spent');
  const body = fs.readFileSync(path.join(root, 'gateway/src/index.ts'), 'utf8');
  assert.ok(body.includes('version: 3'), 'the last-chance diff landed on disk');
  const proposals = (byType['edit:proposal'] ?? []) as Array<{ applied?: boolean }>;
  assert.strictEqual(proposals.length, 1);
  assert.ok(!result.text.includes('no file was changed'), result.text);
});

test('askPipeline full permission: the last-chance round spends ONCE — a model that proses through it ends the turn', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const { calls, callProvider } = makeProviderScript([
    { text: 'Diagnosis only. Want me to continue?' },
    { text: 'Still describing the change instead of making it. OK?' },
  ]);
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'Fix the health route version field',
    permission: 'full',
    applyProposedFiles: testAutoApply(root),
  };
  const result = await runAskPipeline(input, () => {});
  assert.strictEqual(calls.length, 2, 'no spin: one last chance, then the turn ends');
  // The turn ends on the model's question (the closing fact yields to a
  // question by design), and nothing was written.
  assert.ok(result.text.length > 0);
  const body = fs.readFileSync(path.join(root, 'gateway/src/index.ts'), 'utf8');
  assert.ok(body.includes('res.json({ ok: true });'), 'file untouched');
});

/* ================================================== verify contract ===== */

test('askPipeline full permission: an edit turn ending without a command run gets the VERIFY round, and the run satisfies it', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const { calls, callProvider } = makeProviderScript([
    {
      text: 'Writing the fix.',
      toolRequests: [
        {
          id: 'w1',
          name: 'propose_files',
          args: {
            title: 'Fix',
            files: [{ path: 'gateway/src/routes/fixed.ts', content: 'export const ok = 1;\n' }],
          },
        },
      ],
    },
    { text: 'Fix is in place. All done.' }, // stops without running anything
    {
      text: 'Verifying.',
      toolRequests: [{ id: 'r1', name: 'run_command', args: { cmd: 'node --version' } }],
    },
    { text: 'Verified: node ran clean. Done.' },
  ]);
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'Fix the gateway route',
    permission: 'full',
    applyProposedFiles: testAutoApply(root),
  };
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));

  assert.strictEqual(calls.length, 4, 'write → stop → verify nudge → run → done');
  assert.ok(calls[2]!.includes('YOUR EDIT IS UNVERIFIED'), 'the verify contract spoke');
  const { byType } = collect(events);
  const cmdDone = (byType['tool:done'] ?? []).find((e) => (e as { id?: string }).id === 'r1');
  assert.ok(cmdDone, 'run_command executed');
  assert.strictEqual(result.text, 'Verified: node ran clean. Done.');
});

test('askPipeline full permission: the verify contract demands TWICE, then a refusing model ends the turn', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const { calls, callProvider } = makeProviderScript([
    {
      text: 'Writing.',
      toolRequests: [
        {
          id: 'w1',
          name: 'propose_files',
          args: { title: 'Fix', files: [{ path: 'gen/a.ts', content: 'export const a = 1;\n' }] },
        },
      ],
    },
    { text: 'Done, trust me.' },
    { text: 'Still not running anything. Done.' },
  ]);
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'Fix the gateway route',
    permission: 'full',
    applyProposedFiles: testAutoApply(root),
  };
  const result = await runAskPipeline(input, () => {});
  assert.strictEqual(calls.length, 4, 'no spin: two verify demands, then the turn ends');
  assert.strictEqual(result.text, 'Still not running anything. Done.');
});

test('askPipeline: a turn whose edit was followed by a real run is NOT nudged', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const { calls, callProvider } = makeProviderScript([
    {
      text: 'Write and verify.',
      toolRequests: [
        {
          id: 'w1',
          name: 'propose_files',
          args: { title: 'Fix', files: [{ path: 'gen/b.ts', content: 'export const b = 1;\n' }] },
        },
        { id: 'r1', name: 'run_command', args: { cmd: 'node --version' } },
      ],
    },
    { text: 'Edited and verified in one pass. Done.' },
  ]);
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'Fix the gateway route',
    permission: 'full',
    applyProposedFiles: testAutoApply(root),
  };
  await runAskPipeline(input, () => {});
  assert.strictEqual(calls.length, 2, 'write+run then done — no contract round needed');
  assert.ok(!calls.some((c) => c.includes('YOUR EDIT IS UNVERIFIED')));
});

/* ==================================== provider death mid-turn survival ===== */

test('askPipeline: a provider that dies MID-TURN ends the turn honestly instead of killing it', async () => {
  const repo = shopfrontRepo();
  let calls = 0;
  const callProvider: AskPipelineInput['callProvider'] = async () => {
    calls++;
    if (calls === 1) {
      return {
        text: 'Reading the gateway first.',
        toolRequests: [
          { id: 't1', name: 'read_file', args: { path: 'gateway/src/index.ts' } },
        ],
      };
    }
    throw new Error('could not locate assistant text in the provider response');
  };
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = { ...base, question: 'How does the gateway route orders?' };
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));

  assert.strictEqual(calls, 2, 'the second call is where it died');
  assert.ok(
    result.text.includes('provider failed after 1 completed round'),
    `the cut is named: ${result.text}`,
  );
  assert.ok(
    result.text.includes('Reading the gateway first.'),
    'round-1 text survives the failure',
  );
});

test('askPipeline: a provider that dies on the FIRST call still fails loudly', async () => {
  const repo = shopfrontRepo();
  const callProvider: AskPipelineInput['callProvider'] = async () => {
    throw new Error('could not locate assistant text in the provider response');
  };
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = { ...base, question: 'How does the gateway route orders?' };
  await assert.rejects(
    () => runAskPipeline(input, () => {}),
    /could not locate assistant text/,
    'nothing was established, so there is nothing to save — the caller must see the error',
  );
});

test('askPipeline: an edit turn that ends EMPTY at the ceiling explains itself before the closing fact', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  // Every round asks for another read; the final round returns empty text —
  // the shape measured live where the whole answer was one orphaned note.
  let i = 0;
  const callProvider: AskPipelineInput['callProvider'] = async () => {
    i++;
    return {
      text: '',
      toolRequests: [
        { id: `t${i}`, name: 'read_file', args: { path: 'gateway/src/index.ts', offset: i } },
      ],
    };
  };
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'Fix the gateway health route',
    permission: 'full',
    applyProposedFiles: testAutoApply(root),
  };
  const result = await runAskPipeline(input, () => {});
  assert.ok(
    /I used all \d+ of my tool rounds|I stopped looking|did not produce an answer/.test(result.text),
    `the funnel explains the empty ending: ${result.text}`,
  );
  assert.ok(result.text.includes('no file was changed'), 'and the closing fact still lands');
});

/* ======================================================= syntax gate ===== */

test('askPipeline full permission: a written .py that does not parse is NAMED in the same tool result', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const { callProvider } = makeProviderScript([
    {
      text: 'Writing the fix.',
      toolRequests: [
        {
          id: 'w1',
          name: 'propose_files',
          args: {
            title: 'Broken python',
            files: [{ path: 'scripts/fix.py', content: 'def a():\n     return 1\n  pass\n' }],
          },
        },
      ],
    },
    { text: 'Wrote it. Done.' },
    { text: 'Acknowledged the warning. Done for real.' },
  ]);
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'Fix the build script',
    permission: 'full',
    applyProposedFiles: testAutoApply(root),
  };
  const events: AskStreamEvent[] = [];
  await runAskPipeline(input, (e) => events.push(e));
  const { byType } = collect(events);
  const done = (byType['tool:done'] ?? []).find((e) => (e as { id?: string }).id === 'w1') as
    | { evidence?: string }
    | undefined;
  assert.ok(
    (done?.evidence ?? '').includes('DOES NOT PARSE'),
    `the broken write is named: ${done?.evidence}`,
  );
});

test('askPipeline full permission: a written .py that parses carries no warning', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const { callProvider } = makeProviderScript([
    {
      text: 'Writing.',
      toolRequests: [
        {
          id: 'w1',
          name: 'propose_files',
          args: {
            title: 'Good python',
            files: [{ path: 'scripts/ok.py', content: 'def a():\n    return 1\n' }],
          },
        },
      ],
    },
    { text: 'Done.' },
    { text: 'Done again.' },
  ]);
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'Fix the build script',
    permission: 'full',
    applyProposedFiles: testAutoApply(root),
  };
  const events: AskStreamEvent[] = [];
  await runAskPipeline(input, (e) => events.push(e));
  const { byType } = collect(events);
  const done = (byType['tool:done'] ?? []).find((e) => (e as { id?: string }).id === 'w1') as
    | { evidence?: string }
    | undefined;
  assert.ok(!(done?.evidence ?? '').includes('DOES NOT PARSE'), done?.evidence);
});

/* ===================================================== issue pre-read ===== */

test('askPipeline: a file path NAMED in an edit question is pre-read into round-1 evidence', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const { calls, callProvider } = makeProviderScript([{ text: 'Understood. Done?' }]);
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'Fix the health handler in gateway/src/index.ts to include a version field',
    permission: 'full',
    applyProposedFiles: testAutoApply(root),
  };
  const events: AskStreamEvent[] = [];
  await runAskPipeline(input, (e) => events.push(e));
  assert.ok(calls[0]!.includes('harness pre-read gateway/src/index.ts'), 'pre-read announced');
  assert.ok(calls[0]!.includes("app.get('/health'"), 'the named file content is in round 1');
  const { byType } = collect(events);
  assert.ok((byType['file:read'] ?? []).some((e) => (e as { path?: string }).path === 'gateway/src/index.ts'));
});

test('askPipeline: no named path, or a chat question, seeds nothing', async () => {
  const repo = shopfrontRepo();
  const { calls, callProvider } = makeProviderScript([{ text: 'Answered.' }]);
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'Fix the checkout flow latency',
    permission: 'full',
  };
  await runAskPipeline(input, () => {});
  assert.ok(!calls[0]!.includes('harness pre-read'), 'nothing to seed, nothing seeded');
  // and a path that does not resolve seeds nothing either
  const { calls: c2, callProvider: cp2 } = makeProviderScript([{ text: 'Answered.' }]);
  const base2 = await makeAttachedInput(repo, cp2);
  await runAskPipeline(
    { ...base2, question: 'Fix invented/path/nowhere.py please', permission: 'full' },
    () => {},
  );
  assert.ok(!c2[0]!.includes('harness pre-read'));
});

test('askPipeline full permission: a .py that parses but cannot IMPORT is named in the same tool result', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const { callProvider } = makeProviderScript([
    {
      text: 'Writing.',
      toolRequests: [
        {
          id: 'w1',
          name: 'propose_files',
          args: {
            title: 'Import-broken python',
            // Parses fine; raises at import time — the django-12304 shape.
            files: [{ path: 'scripts/importfail.py', content: 'import definitely_not_a_module_xyz\nA = 1\n' }],
          },
        },
      ],
    },
    { text: 'Done.' },
    { text: 'Acknowledged.' },
  ]);
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'Fix the build script',
    permission: 'full',
    applyProposedFiles: testAutoApply(root),
  };
  const events: AskStreamEvent[] = [];
  await runAskPipeline(input, (e) => events.push(e));
  const { byType } = collect(events);
  const done = (byType['tool:done'] ?? []).find((e) => (e as { id?: string }).id === 'w1') as
    | { evidence?: string }
    | undefined;
  assert.ok(
    (done?.evidence ?? '').includes('DOES NOT IMPORT'),
    `import break named: ${done?.evidence}`,
  );
});


/* ======================================================== teach mode (W1) ===== */

test('teach mode: the contract is in the belt, and the belt hash knows the mode', async () => {
  const { renderAskInstructionBelt, computeAskInstructionHash } = await import(
    '../server/askPipeline.js'
  );
  const base = { designMode: false, repoRoot: '/r', question: 'teach me how the gateway works' };
  const teachBelt = renderAskInstructionBelt({ ...base, teach: true });
  assert.ok(teachBelt.includes('TEACH MODE'), 'contract present');
  assert.ok(teachBelt.includes('EXACTLY ONE concept'), 'pacing rule present');
  /*
   * "ABSENT WHEN OFF" NOW MEANS OFF *AND* NOT ASKED FOR — amended 2026-09-02.
   *
   * This assertion used to keep the same teach-shaped question and expect no
   * contract, which is precisely the bug the owner hit: he typed "teach me
   * this: …" with the toggle unselected and the belt stayed silent. The
   * contract engages on the QUESTION now, so absence is asserted on a question
   * nobody could read as a lesson.
   */
  const lookup = { ...base, question: 'How does the gateway route orders?' };
  const plain = renderAskInstructionBelt(lookup);
  assert.ok(!plain.includes('TEACH MODE'), 'absent for a plain lookup with the toggle off');
  assert.ok(
    renderAskInstructionBelt({ ...base }).includes('TEACH MODE'),
    'present for a teach-shaped question with the toggle off',
  );
  assert.notStrictEqual(
    computeAskInstructionHash({ ...lookup, teach: true }),
    computeAskInstructionHash({ ...lookup }),
    'the instruction hash distinguishes the mode',
  );
});

test('teach mode: edit tools are refused with the teaching message, and no edit-contract noise fires', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const { calls, callProvider } = makeProviderScript([
    {
      text: 'Let me show you — first I will try to change it.',
      toolRequests: [
        {
          id: 'w1',
          name: 'propose_files',
          args: { title: 'x', files: [{ path: 'gen/teach.ts', content: 'export const a = 1;\n' }] },
        },
      ],
    },
    {
      text:
        'Point one: the gateway routes orders.\n```\n client ──► gateway ──► orders\n```\n' +
        'Does this make sense so far?',
    },
  ]);
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'Teach me: fix the gateway routing bug step by step',
    permission: 'full',
    teach: true,
    applyProposedFiles: testAutoApply(root),
  };
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));
  const { byType } = collect(events);

  assert.ok(!fs.existsSync(path.join(root, 'gen/teach.ts')), 'nothing written in teach mode');
  const done = (byType['tool:done'] ?? []).find((e) => (e as { id?: string }).id === 'w1');
  assert.ok(done, 'the refused call still gets an honest tool:done');
  /*
   * THE READER GETS THE REASON, NOT JUST THE MODEL. This event used to close
   * with no `evidence`, so the reason went only into the model's context and
   * the transcript showed "Called propose_files", status done — a row that
   * reads as a call that ran and quietly did nothing. `evidence` is the row's
   * identifier client-side, which is where a refusal can be read.
   */
  assert.match(
    (done as { evidence?: string }).evidence ?? '',
    /TEACH MODE reads and changes nothing/,
    'the refusal is on the wire the client renders, not only in the prompt',
  );
  assert.strictEqual(calls.length, 2, 'refusal fed back, lesson continued');
  // The edit-shaped machinery stays out of the classroom even for an edit-shaped question.
  assert.ok(!result.text.includes('no file was changed'), result.text);
  assert.ok(!calls.some((c) => c.includes('YOUR EDIT IS UNVERIFIED')));
  assert.ok(!calls.some((c) => c.includes('YOU HAVE CHANGED NOTHING')));
  assert.ok(result.text.includes('Does this make sense so far?'));
});

test('teach contract grader: dumps, missing questions, and ghost files are each named', async () => {
  const { gradeTeachTurn } = await import('../server/askPipeline.js');
  const basenames = new Set(['bigram_counts.py', 'sampling.py', 'names.txt']);
  const dump = Array(300).fill('word').join(' ');
  const p1 = gradeTeachTurn(dump, basenames);
  assert.ok(p1.some((p) => p.includes('words')), 'dump named');
  assert.ok(p1.some((p) => p.includes('check-in question')), 'missing question named');
  const ghost = 'The counts live in char_freq.js as you can see. Does this make sense so far?';
  const p2 = gradeTeachTurn(ghost, basenames);
  assert.ok(p2.some((p) => p.includes('char_freq.js')), 'fabricated file named');
  const good =
    'The bigram model counts adjacent character pairs in bigram_counts.py — a 27x27 table. ' +
    'Does this make sense so far?';
  assert.deepStrictEqual(gradeTeachTurn(good, basenames, new Set(['bigram_counts.py'])), []);
  // Citing a REAL file the turn never read is the subtler fabrication.
  const unread = gradeTeachTurn(good, basenames, new Set());
  assert.ok(unread.some((p) => p.includes('WITHOUT reading')), 'must-read rule fires');
});

test('teach mode: a dumping lesson turn is bounced ONCE with the violations named, and the retry stands', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const dump = Array(300).fill('lecture').join(' ') + ' fabricated_module.py explains it.';
  const { calls, callProvider } = makeProviderScript([
    { text: dump },
    {
      text: 'Reading first.',
      toolRequests: [{ id: 'r1', name: 'read_file', args: { path: 'gateway/src/index.ts' } }],
    },
    {
      text:
        'One concept: the gateway is the front door — every request enters through ' +
        'gateway/src/index.ts.\n```\n client ──► gateway\n```\nMake sense so far?',
    },
  ]);
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'Teach me this repo',
    permission: 'full',
    teach: true,
    applyProposedFiles: testAutoApply(root),
  };
  const result = await runAskPipeline(input, () => {});
  assert.strictEqual(calls.length, 3, 'bounce, a read round, then the grounded retry stands');
  assert.ok(calls[1]!.includes('REJECTED'), 'the bounce named the rejection');
  /*
   * BOTH violations named, which is where this started and where the
   * measurement returned it. A one-complaint ladder replaced this assertion for
   * one commit and was reverted: told a single thing to fix, the model fixed it
   * and stopped, taking stubs from 22-24 to 31-34 and halving median words
   * (docs/research/mid-belt-arm-result.md). The wall is not good, it is the
   * measured lesser harm.
   */
  assert.ok(calls[1]!.includes('words'), 'word count violation named');
  assert.ok(calls[1]!.includes('fabricated_module.py'), 'ghost file named');
  /* Kept from the ladder round: real basenames. With `null` the ghost rule had
     nothing to compare against and this passed for the wrong reason. */
  const { gradeTeachTurn: grade } = await import('../server/askPipeline.js');
  assert.ok(
    grade(dump, new Set(['index.ts']), undefined, false).some((p) =>
      p.includes('fabricated_module.py'),
    ),
    'the grader detects the ghost file against a real basename set',
  );
  assert.ok(result.text.includes('front door'), 'the compliant retry is the answer');
  assert.ok(result.text.includes('──►'), 'and it carries the visual the contract now demands');
});

/* ─────────────────────────────────────────────────────────────────────────────
   THE 2026-09-02 OWNER FAILURE, LOCKED AT THE PIPELINE.

   He typed the question below with the composer's Teach row UNSELECTED, and got
   back a request to choose between "system-architecture or data-flow" and to
   confirm "SeqDiagram v1 with labels within ```json blocks" — because the teach
   contract was never in the belt, so nothing forbade the interrogation. These
   three tests hold the three halves of the fix: the contract engages on the
   QUESTION, it says so on screen, and it carries the two new rules.
   ───────────────────────────────────────────────────────────────────────────── */

const OWNER_TEACH_QUESTION_2026_09_02 =
  'teach me this: AI Overview — Learn Supervised Learning, which is the foundational ' +
  'machine learning concept where an algorithm learns from labeled data to make predictions.';

test('teach mode: a teach-SHAPED question engages the contract with the toggle off, and the turn says so', async () => {
  const repo = shopfrontRepo();
  const { calls, callProvider } = makeProviderScript([
    {
      text:
        'Point one: supervised learning maps labelled inputs to outputs.\n' +
        '```\n labels ──► model ──► predictions\n```\nDoes this make sense so far?',
    },
  ]);
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: OWNER_TEACH_QUESTION_2026_09_02,
    // teach is DELIBERATELY unset — this is his screen, with the toggle off.
  };
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));

  assert.ok(calls[0]!.includes('TEACH MODE'), 'the contract is in the belt without the toggle');
  assert.ok(
    calls[0]!.includes('NEVER ask the learner which chart kind'),
    'and it carries the no-interrogation rule',
  );
  // VISIBLE: a silent mode switch is a surface asserting something the user
  // did not choose. The turn streams the step pair the client renders as a row.
  const steps = events.filter((e) => e.type === 'step:start') as Array<{ id: string }>;
  assert.ok(steps.some((e) => e.id === 'teach-mode'), `no teach-mode step: ${JSON.stringify(steps)}`);
  const done = events.filter((e) => e.type === 'step:done') as Array<{ id: string }>;
  assert.ok(done.some((e) => e.id === 'teach-mode'), 'and the row lands rather than hanging open');
  assert.strictEqual(result.metrics?.intent, 'teach', 'the turn reports the mode it ran in');
});

test('teach contract: the belt forbids interrogation and names propose_chart as the visual', () => {
  // Asserted on the CONSTANT so deleting either rule reds this test, not just
  // reshuffling the prompt that happens to contain it.
  assert.ok(
    TEACH_MODE_INSTRUCTIONS.includes('NEVER ask the learner which chart kind'),
    'no-interrogation rule present',
  );
  assert.ok(
    TEACH_MODE_INSTRUCTIONS.includes('SeqDiagram v1'),
    'our internal format names are forbidden BY NAME — the exact words he was asked to choose between',
  );
  assert.ok(
    TEACH_MODE_INSTRUCTIONS.includes('The visual is propose_chart'),
    'the right tool is named',
  );
  assert.ok(
    TEACH_MODE_INSTRUCTIONS.includes('canvas.write_markdown'),
    'and the wrong one is named as wrong',
  );
});

test('teach belt: the prompt never both orders and forbids the detail interrogation', async () => {
  /*
   * The topology hint carries "ask ONE short clarifying question in chat first:
   * compact overview (few nodes, main flows) or detailed diagram", and the
   * teach contract carries "NEVER ask the learner which chart kind … or what
   * level of detail to use". Composed into one belt, a model resolving the
   * conflict toward the earlier, more operational sentence opens with exactly
   * the question the owner got on 2026-09-02 — now sanctioned by our own
   * prompt. `propose_topology` is refused on a teach turn anyway, so the fix is
   * the belt telling the truth about the tools it has.
   */
  const question = 'teach me this: AI Overview — Learn Supervised Learning';
  const attached = renderAskInstructionBelt({ designMode: false, repoRoot: '/r', question });
  assert.ok(!attached.includes('compact overview'), 'no clarifying-question order on a lesson');
  // The contract still NAMES the refused tools (that is how it refuses them);
  // what must be gone is the syntax that invites the call.
  assert.ok(!attached.includes('"name":"propose_topology"'), 'no hint for a refused tool');
  assert.ok(!attached.includes('"name":"edit_file"'), 'nor for the edit tools it refuses');
  assert.ok(!attached.includes('"name":"propose_files"'), 'nor for the proposal tools');
  assert.ok(attached.includes('TEACH MODE'), 'the contract is still there');

  // Design mode put that same sentence in the belt's SECOND line.
  const design = renderAskInstructionBelt({ designMode: true, repoRoot: null, question });
  assert.ok(!design.includes('compact overview'), 'nor in design mode, where it led the belt');

  // …and the ordinary (non-teach) turn keeps the hint it was written for.
  const ordinary = renderAskInstructionBelt({
    designMode: false,
    repoRoot: '/r',
    question: 'draw the checkout flow on the board',
  });
  assert.ok(ordinary.includes('compact overview'), 'the draw turn still gets the question');
});

test('teach belt: propose_chart ships with a worked fence, on every surface', async () => {
  /*
   * The contract mandates a chart per concept and forbade canvas.write_markdown,
   * while the belt showed fence syntax for read_file, propose_files,
   * propose_topology and canvas.write_markdown — and for propose_chart only its
   * NAME. With no repo attached there is no native tool schema either
   * (repoServer sends `tools: undefined` when designMode || repoRoot === null),
   * so the only writer the model had a worked example for was the forbidden one.
   */
  const question = 'teach me how a request reaches the model';
  for (const belt of [
    renderAskInstructionBelt({ designMode: false, repoRoot: '/r', question }),
    renderAskInstructionBelt({ designMode: true, repoRoot: null, question }),
    renderAskInstructionBelt({ designMode: false, repoRoot: null, question }),
  ]) {
    assert.ok(belt.includes('"name":"propose_chart"'), 'a callable example, not just the name');
    assert.ok(belt.includes('sequence-tool'), 'in the fence form this harness executes');
    assert.ok(!/"version"/.test(belt), 'and never asks the model to type the schema stamp');
  }
  // Not spent on turns that did not ask to be taught.
  const ordinary = renderAskInstructionBelt({
    designMode: false,
    repoRoot: '/r',
    question: 'what calls the billing service?',
  });
  assert.ok(!ordinary.includes('"name":"propose_chart"'));
});

test('executeAskTool propose_chart: a call matching the PUBLISHED schema is drawn, not refused', async () => {
  /*
   * The registry publishes {kind, title, items, links?, focusItemId?} and the
   * teach contract mandates the call; `version` appears in neither, and
   * validateChart demanded it. So the one deliverable of every teach turn was
   * refused for a field nothing asked the model for.
   */
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const result = await executeAskTool(
    'propose_chart',
    {
      kind: 'data-flow',
      title: 'How an order flows',
      items: [
        { id: 'ui', label: 'Storefront' },
        { id: 'gw', label: 'Gateway' },
      ],
      links: [{ from: 'ui', to: 'gw', label: 'POST /orders' }],
      focusItemId: 'gw',
    },
    {
      resolveReadable: (p) => resolveInRepo(root, p),
      repoRoot: root,
      designMode: false,
    },
  );
  assert.strictEqual(result.ok, true, result.evidence);
  assert.strictEqual(result.chart?.version, 1, 'the stamp is supplied by the validator');
});

test('canvas latch: the refusal names propose_chart as the way to draw a breakdown in one call', async () => {
  const { oncePerTurnAskToolRefusal } = await import('../server/askTools.js');
  const refusal = oncePerTurnAskToolRefusal('canvas.write_markdown');
  // Three canvas calls were refused on his screen with "do not call it again"
  // and nothing else, so three rounds taught nothing.
  assert.ok(refusal.includes('propose_chart'), refusal);
  assert.ok(refusal.includes('single call'), refusal);
});

/* =================================================== sandboxed full exec ===== */

test('run_command sandbox path: arbitrary shell runs ONLY under sandboxExec + full, and reports its exit code', async () => {
  const { executeAskTool } = await import('../server/askTools.js');
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const base = {
    resolveReadable: (p: string) => resolveInRepo(root, p),
    repoRoot: root,
    designMode: false,
  };
  // Without the flag, the whitelist still binds — a heredoc/pipe is refused.
  const gated = await executeAskTool(
    'run_command',
    { cmd: 'echo hi | tr a-z A-Z' },
    { ...base, permission: 'full' } as never,
  );
  assert.strictEqual(gated.ok, false);
  assert.match(String(gated.evidence), /refused/);
  // With the flag, real shell: pipes work and the output comes back.
  const freed = await executeAskTool(
    'run_command',
    { cmd: 'echo hi | tr a-z A-Z' },
    { ...base, permission: 'full', sandboxExec: true } as never,
  );
  assert.strictEqual(freed.ok, true, String(freed.evidence));
  assert.match(String(freed.evidence), /HI/);
  // A failing command is reported honestly, not swallowed.
  const failed = await executeAskTool(
    'run_command',
    { cmd: 'exit 3' },
    { ...base, permission: 'full', sandboxExec: true } as never,
  );
  assert.strictEqual(failed.ok, false);
  assert.strictEqual(failed.commandLog?.exitCode, 3);
  // Sandbox exec NEVER applies below full permission.
  const propose = await executeAskTool(
    'run_command',
    { cmd: 'echo nope | cat' },
    { ...base, permission: 'propose', sandboxExec: true } as never,
  );
  assert.strictEqual(propose.ok, false);
});

/* ============================================ propose_chart + the visual rule ===== */

test('propose_chart: a grounded chart is drawn; one that invents a node is refused', async () => {
  const { executeAskTool } = await import('../server/askTools.js');
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const graph = await scanRepo(repo, { cluster: true });
  const ctx = {
    resolveReadable: (p: string) => resolveInRepo(root, p),
    repoRoot: root,
    designMode: false,
    graph,
  } as never;
  const realId = graph.nodes.find((n) => n.kind === 'service')!.id;
  const ok = await executeAskTool(
    'propose_chart',
    {
      version: 1,
      kind: 'data-flow',
      title: 'How an order flows',
      items: [
        { id: 'a', label: 'Gateway', nodeId: realId },
        { id: 'b', label: 'Worker' },
      ],
      links: [{ from: 'a', to: 'b', label: 'queue' }],
      focusItemId: 'a',
    },
    ctx,
  );
  assert.strictEqual(ok.ok, true, String(ok.evidence));
  assert.ok(ok.chart, 'the validated spec rides on the result');
  assert.match(String(ok.evidence), /data-flow/);

  const bad = await executeAskTool(
    'propose_chart',
    {
      version: 1,
      kind: 'system-architecture',
      title: 'Invented',
      items: [{ id: 'x', label: 'Ghost', nodeId: 'svc:not-real-at-all' }],
    },
    ctx,
  );
  assert.strictEqual(bad.ok, false);
  assert.match(String(bad.evidence), /not a node in this repository/);
});

test('a throwaway repro does NOT disarm the salvage: writing a NEW file is not writing the fix', async () => {
  /*
   * THE REPORTED SHAPE, FROM mini-50 v17 (django__django-11790).
   *
   * The model wrote `repro_maxlength.py` to reproduce the bug — a reasonable
   * thing to do — and that one write flipped `fileWriteCallsThisTurn`, which
   * BOTH salvage paths read as "the fix is already written". So the prose-diff
   * rescue never ran and the last-chance round never fired; the turn spent all
   * 32 rounds and 662k input tokens and shipped the repro script as its patch.
   * Sixteen of that run's 25 empty patches are this shape.
   *
   * A file that did not exist before is a repro, a scratch note or a new test.
   * It is not a change to the code that has the bug.
   */
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const TARGET = 'gateway/src/index.ts';
  const before = fs.readFileSync(path.join(root, TARGET), 'utf8');
  assert.ok(before.includes("import express from 'express';"), 'fixture anchor exists');

  const { callProvider } = makeProviderScript([
    {
      // Round 1: reproduce the bug in a NEW file. Nothing that already exists changes.
      text: 'Let me reproduce it first.',
      toolRequests: [
        {
          id: 'r1',
          name: 'propose_files',
          args: {
            title: 'Reproduce',
            files: [{ path: 'repro_gateway.ts', content: 'console.log("repro");\n' }],
          },
        },
      ],
    },
    {
      // Round 2: the actual fix, in prose, as a diff against a file that EXISTS.
      text: [
        'Reproduced. The fix:',
        '```diff',
        `--- a/${TARGET}`,
        `+++ b/${TARGET}`,
        '@@ -1,2 +1,2 @@',
        "-import express from 'express';",
        "+import express from 'express'; // hardened",
        " import { invoicesRouter } from './routes/invoices';",
        '```',
      ].join('\n'),
    },
  ]);

  const base = await makeAttachedInput(repo, callProvider);
  const result = await runAskPipeline(
    {
      ...base,
      question: 'Fix the gateway import bug',
      permission: 'full',
      applyProposedFiles: testAutoApply(root),
    },
    () => {},
  );

  // The repro really was written — otherwise this test proves nothing.
  assert.ok(fs.existsSync(path.join(root, 'repro_gateway.ts')), 'the repro landed');
  // …and the FIX landed too, which is what the old guard prevented.
  const after = fs.readFileSync(path.join(root, TARGET), 'utf8');
  assert.ok(
    after.includes("import express from 'express'; // hardened"),
    `the prose diff must still apply after a new-file write. text:\n${result.text.slice(-400)}`,
  );
  assert.ok(
    (result.filesWritten ?? []).includes(TARGET),
    'the changed file is reported as written',
  );
});

test('teach:step: a teach turn emits the step its chart carries; a normal turn emits none', async () => {
  /*
   * THE STEP RIDES THE CHART (docs/teach-mode.md §3). The first attempt
   * captioned from the answer text and was reverted (604fa893) because the
   * harness overwrites `text` with its own apology on a bad ending. A chart's
   * caption cannot be overwritten that way, and its nodeIds are already
   * validated against the scanned graph — so the step is grounded by
   * construction rather than by hope.
   */
  const repo = shopfrontRepo();
  const graph = await scanRepo(repo, { cluster: true });
  const realId = graph.nodes.find((n) => n.kind === 'service')!.id;
  const CAPTION = 'The gateway is the only door into the system.';

  const script = (): CannedProvider[] => [
    {
      text: 'Point one.',
      toolRequests: [
        {
          id: 'c1',
          name: 'propose_chart',
          args: {
            version: 1,
            kind: 'system-architecture',
            title: 'How a request gets in',
            caption: CAPTION,
            items: [
              { id: 'a', label: 'Gateway', nodeId: realId },
              { id: 'b', label: 'Worker' },
            ],
          },
        },
      ],
    },
    { text: `${CAPTION} Does that land so far?` },
  ];

  const teachRun = makeProviderScript(script());
  const teachBase = await makeAttachedInput(repo, teachRun.callProvider);
  const teachEvents: AskStreamEvent[] = [];
  await runAskPipeline(
    { ...teachBase, question: 'Teach me how a request gets in', teach: true },
    (e) => teachEvents.push(e),
  );
  const steps = (collect(teachEvents).byType['teach:step'] ?? []) as Array<{
    caption: string;
    litNodeIds?: string[];
  }>;
  assert.strictEqual(steps.length, 1, 'one concept, one step');
  assert.strictEqual(steps[0]!.caption, CAPTION, "the model's own sentence, from the chart");
  assert.deepStrictEqual(
    steps[0]!.litNodeIds,
    [realId],
    'only the grounded nodeId; the item without one lights nothing',
  );

  const plainRun = makeProviderScript(script());
  const plainBase = await makeAttachedInput(repo, plainRun.callProvider);
  const plainEvents: AskStreamEvent[] = [];
  await runAskPipeline({ ...plainBase, question: 'Draw how a request gets in' }, (e) =>
    plainEvents.push(e),
  );
  const plain = collect(plainEvents);
  assert.strictEqual((plain.byType['teach:step'] ?? []).length, 0, 'never outside a lesson');
  // NON-VACUITY: the same script really did draw the chart on the normal turn,
  // so the absence above is the teach gate and not a turn that did nothing.
  assert.ok((plain.byType['chart:proposal'] ?? []).length >= 1, 'the chart still landed');
});

test('lookup:located: a locate hit points the board at the file that holds the declaration', async () => {
  /*
   * MAX'S SECOND SENTENCE — hand Sequence a repository and SEE it.
   *
   * Measured on `teach/symbol-index`: asking where a symbol is declared answered
   * 4 of 4 in the chat rail and THE MAP DID NOT MOVE. The engineer was told
   * where the symbol was while the picture of their repository sat unchanged.
   *
   * The only server-fed way to light the board was `teach:step`, and this lane
   * refused to use it for a lookup: that event's caption ASSERTS A LESSON, so
   * emitting it here would stamp the turn as a lesson step it is not — the same
   * fault as a verb claiming an outcome the engine never supplied. Hence a
   * separate event carrying ids and nothing else.
   */
  const repo = shopfrontRepo();

  /* `getJson` is DECLARED in gateway/src/lib/http.ts and CALLED from the route
     files, so this also rides the tool's own rule that a declaration outranks
     its call sites: the event must name the file that declares it, not every
     file that mentions it. */
  const script = (): CannedProvider[] => [
    {
      text: 'Let me find it.',
      toolRequests: [{ id: 'c1', name: 'locate_symbol', args: { name: 'getJson' } }],
    },
    { text: 'It is declared in gateway/src/lib/http.ts.' },
  ];

  const run = makeProviderScript(script());
  const base = await makeAttachedInput(repo, run.callProvider);
  const events: AskStreamEvent[] = [];
  await runAskPipeline({ ...base, question: 'Where is getJson declared?' }, (e) => events.push(e));

  const located = (collect(events).byType['lookup:located'] ?? []) as Array<{ nodeIds: string[] }>;
  assert.strictEqual(located.length, 1, 'one lookup, one pointer');
  assert.deepStrictEqual(
    located[0]!.nodeIds,
    ['file:gateway/src/lib/http.ts'],
    'the file that declares it, resolved to a real graph node — not its call sites',
  );

  /* NOT A LESSON. The whole reason this event exists rather than reusing the
     one that was already wired. */
  assert.strictEqual(
    (collect(events).byType['teach:step'] ?? []).length,
    0,
    'a lookup must never stamp the turn as a lesson step',
  );
});

test('lookup:located: a miss points at nothing rather than at an empty spotlight', async () => {
  /*
   * The failure this guards is the one this repo keeps finding: a label that
   * reads as a measurement. An event carrying `nodeIds: []` would tell the
   * board a lookup located something and then hand it nowhere to look; the
   * board's `lookupDim` would return null and the reader would be left with a
   * turn that claimed to point somewhere and did not.
   */
  const repo = shopfrontRepo();
  const run = makeProviderScript([
    {
      text: 'Looking.',
      toolRequests: [
        { id: 'c1', name: 'locate_symbol', args: { name: 'noSuchSymbolAnywhereInThisRepo' } },
      ],
    },
    { text: 'I could not find it.' },
  ]);
  const base = await makeAttachedInput(repo, run.callProvider);
  const events: AskStreamEvent[] = [];
  await runAskPipeline({ ...base, question: 'Where is noSuchSymbolAnywhereInThisRepo?' }, (e) =>
    events.push(e),
  );

  assert.strictEqual(
    (collect(events).byType['lookup:located'] ?? []).length,
    0,
    'a miss emits no pointer at all',
  );
  /* NON-VACUITY: the tool really ran, so the absence above is the miss and not
     a turn where nothing was attempted. */
  const calls = (collect(events).byType['tool:done'] ?? []) as Array<{ name?: string }>;
  assert.ok(
    calls.some((c) => c.name === 'locate_symbol'),
    'the lookup really ran',
  );
});

test('teach grader: a concept turn with NO visual is a violation, and a chart clears it', async () => {
  const { gradeTeachTurn } = await import('../server/askPipeline.js');
  const names = new Set(['index.ts']);
  const read = new Set(['index.ts']);
  const proseOnly = 'The gateway is the front door for every request. Make sense so far?';
  const noVisual = gradeTeachTurn(proseOnly, names, read, false);
  assert.ok(
    noVisual.some((p) => p.includes('NO VISUAL')),
    `visual rule fires: ${noVisual.join('|')}`,
  );
  // A chart drawn this turn clears it…
  assert.deepStrictEqual(gradeTeachTurn(proseOnly, names, read, true), []);
  // …and so does a diagram the reader actually SEES: a ```seqd fence is lifted
  // out of the answer onto the board, and box-drawing renders as itself.
  const seqd = 'The gateway routes.\n```seqd\n{"nodes":[]}\n```\nMake sense so far?';
  assert.deepStrictEqual(gradeTeachTurn(seqd, names, read, false), []);
});

test('teach visual rule: a ```mermaid fence is NOT the visual — the app renders it as source', async () => {
  const { gradeTeachTurn } = await import('../server/askPipeline.js');
  /*
   * The transcript has no mermaid renderer (only AI Canvas BLOCKS draw one),
   * and only ```seqd is lifted out of the answer onto the board. Counting a
   * mermaid fence let a lesson satisfy "every concept ships one visual" with a
   * wall of `graph TD` the learner reads instead of sees — the owner's "we need
   * to SEE the breakdown on our app" passing the grader that exists for it.
   */
  const names = new Set(['index.ts']);
  const read = new Set(['index.ts']);
  const mermaidOnly = 'The gateway routes.\n```mermaid\ngraph LR;A-->B\n```\nMake sense so far?';
  const problems = gradeTeachTurn(mermaidOnly, names, read, false);
  assert.ok(
    problems.some((p) => p.includes('NO VISUAL')),
    `a mermaid fence must bounce to propose_chart: ${problems.join('|')}`,
  );
  // …unless the turn really drew one, which is what the fourth argument means.
  assert.deepStrictEqual(gradeTeachTurn(mermaidOnly, names, read, true), []);
});

/* ======================== chart/teach fixes from the adversarial review ===== */

test('propose_chart is NOT a mutation — allowed in teach and plan, so the teach visual is drawable', async () => {
  const { ASK_MUTATING_TOOLS, ASK_TOOL_ALLOWLIST } = await import('../server/askTools.js');
  assert.ok(!ASK_MUTATING_TOOLS.includes('propose_chart' as never), 'a chart writes nothing to disk');
  assert.ok(ASK_TOOL_ALLOWLIST.includes('propose_chart' as never), 'still a real tool');
});

test('teach mode refuses run_command even under Full — teaching never runs the repo', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const { callProvider } = makeProviderScript([
    {
      text: 'Let me run the tests to show you.',
      toolRequests: [{ id: 'r1', name: 'run_command', args: { cmd: 'python -m pytest' } }],
    },
    { text: 'Point one: the gateway routes orders.\n```\n a ──► b\n```\nMake sense so far?' },
  ]);
  const { calls } = makeProviderScript([]); void calls;
  const captured: string[] = [];
  const base = await makeAttachedInput(repo, (cfg, prompt, onDelta, opts) => {
    captured.push(prompt);
    return callProvider(cfg, prompt, onDelta, opts);
  });
  const input: AskPipelineInput = {
    ...base,
    question: 'Teach me this repo',
    permission: 'full',
    teach: true,
    applyProposedFiles: testAutoApply(root),
  };
  await runAskPipeline(input, () => {});
  // The refusal is fed back to the model as a tool-result body next round.
  assert.ok(
    captured.some((p) => /TEACH MODE reads and changes nothing/.test(p)),
    'run_command was refused in teach mode and the model was told why',
  );
});

test('teach visual rule: a code arrow (=>) does NOT satisfy the visual, a box-drawing diagram does', async () => {
  const { gradeTeachTurn } = await import('../server/askPipeline.js');
  const names = new Set(['index.ts']);
  const read = new Set(['index.ts']);
  const codeOnly =
    'The handler is `const f = (x) => x + 1` and it returns early. Make sense so far?';
  const bounced = gradeTeachTurn(codeOnly, names, read, false);
  assert.ok(bounced.some((p) => p.includes('NO VISUAL')), 'a bare => is not a visual');
  const ascii =
    'The flow:\n```\n client ──► gateway ──► db\n```\nMake sense so far?';
  assert.deepStrictEqual(gradeTeachTurn(ascii, names, read, false), [], 'box-drawing counts');
});

test('teach check-in rule tolerates a trailing fenced visual after the question', async () => {
  const { gradeTeachTurn } = await import('../server/askPipeline.js');
  const names = new Set(['index.ts']);
  const withTrailingChartText =
    'The gateway is the front door. Which service do you think it calls first?\n```mermaid\ngraph LR;a-->b\n```';
  assert.deepStrictEqual(gradeTeachTurn(withTrailingChartText, names, names, true), []);
});

/* ===== teach mode: comprehension questions are allowed, clarifying ones are not ===== */

test('teach mode allows COMPREHENSION questions mid-lesson, not just one at the close', async () => {
  const { gradeTeachTurn } = await import('../server/askPipeline.js');
  const names = new Set(['index.ts']);
  /*
   * The owner asked for questions DURING the lesson ("the question pop ups when
   * learning not just one final question"). The old contract said EXACTLY ONE
   * check-in, so this shape — a question mid-explanation plus the closing beat —
   * was disallowed by wording written to stop something else entirely.
   */
  const midLesson =
    'The gateway is the front door: every request lands there before anything else. ' +
    'So what do you think happens to the rest of the system if it stops responding? ' +
    'Nothing behind it is reachable, which is why it carries the largest blast radius ' +
    'on the board. Does that make sense so far?';
  assert.deepStrictEqual(gradeTeachTurn(midLesson, names, names, true), []);
});

test('teach mode bounces a CLARIFYING question even when the turn ends correctly', async () => {
  const { gradeTeachTurn } = await import('../server/askPipeline.js');
  const names = new Set(['index.ts']);
  /*
   * THE NEGATIVE HALF, and the reason it ships with the permission rather than
   * after it. This turn opens by interrogating the learner about output options —
   * the exact bug the old one-question rule existed to kill — and then closes
   * with a perfectly good check-in. A gate that only asserted "mid-lesson
   * questions are allowed" would pass it, and the permission would have quietly
   * restored the bug.
   */
  const interrogates =
    'Before we start, would you like the system-architecture view or the data-flow view? ' +
    'The gateway is the front door and every request lands there first. ' +
    'Does that make sense so far?';
  const problems = gradeTeachTurn(interrogates, names, names, true);
  assert.equal(problems.length, 1, 'exactly the clarifying-question bounce');
  assert.match(problems[0]!, /CLARIFYING question/);
  // The closing beat is fine, so the check-in rule must NOT also fire.
  assert.ok(
    !problems.some((p) => /does not END with/.test(p)),
    'the turn does end with a question — only the interrogation is the problem',
  );
});

test('teach mode lets PROSE name a chart kind; only asking the learner to pick one bounces', async () => {
  const { gradeTeachTurn } = await import('../server/askPipeline.js');
  const names = new Set(['index.ts']);
  // Naming what you drew is explanation. Naming it AT the learner as a choice is the violation.
  const describesItsOwnChart =
    'I drew this as a data-flow chart because the point here is movement, not hierarchy. ' +
    'Which service do you think the gateway reaches first?';
  assert.deepStrictEqual(gradeTeachTurn(describesItsOwnChart, names, names, true), []);
});

test('a FAILING run_command feeds its full output (and the run_command header) back to the model', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  // A node script that exits non-zero with a diagnostic on stdout.
  fs.writeFileSync(
    path.join(root, 'fail.js'),
    "console.log('ASSERT: expected 200 got 500'); process.exit(1);\n",
    'utf8',
  );
  const { callProvider } = makeProviderScript([
    {
      text: 'Running the test.',
      toolRequests: [{ id: 'r1', name: 'run_command', args: { cmd: 'node fail.js' } }],
    },
    { text: 'I see the failure now. Done.' },
  ]);
  const captured: string[] = [];
  const base = await makeAttachedInput(repo, (cfg, prompt, onDelta, opts) => {
    captured.push(prompt);
    return callProvider(cfg, prompt, onDelta, opts);
  });
  const input: AskPipelineInput = { ...base, question: 'run the test', permission: 'full' };
  await runAskPipeline(input, () => {});
  const round2 = captured[1] ?? '';
  assert.ok(round2.includes('ASSERT: expected 200 got 500'), 'the failure output reaches the model');
  assert.ok(round2.includes('### run_command:'), 'the run_command header is present (verify-contract detection)');
});

/* ================================================ the done-when gate (G5) ===== */

/**
 * The reported shape: a full-permission edit turn writes a file, answers the
 * verify demands with prose, and ends. Before the gate existed the turn was
 * TOLD its edit was unverified and finished anyway; now the caller's done-when
 * command runs after the loop and its verdict closes the answer.
 */
function doneWhenScript(): CannedProvider[] {
  return [
    {
      text: 'Adding the route.',
      toolRequests: [
        {
          id: 'w1',
          name: 'propose_files',
          args: {
            title: 'Add health route',
            files: [
              { path: 'gateway/src/routes/health.ts', content: 'export const health = () => 500;\n' },
            ],
          },
        },
      ],
    },
    { text: 'Done: health route added.' },
  ];
}

/** Two runner scripts dropped into the fixture so `node <script>` is a real done-when. */
function seedDoneWhenScripts(root: string): void {
  fs.writeFileSync(path.join(root, 'ok.mjs'), 'process.exitCode = 0;\n', 'utf8');
  fs.writeFileSync(
    path.join(root, 'fail.mjs'),
    "console.log('FAILED tests/test_health.py::test_status'); process.exitCode = 3;\n",
    'utf8',
  );
}

test('askPipeline done-when: a FAILING gate is named in result.verify and the closing sentence; the edit stays on disk', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  seedDoneWhenScripts(root);
  const { callProvider } = makeProviderScript(doneWhenScript());
  const base = await makeAttachedInput(repo, callProvider);
  const input: AskPipelineInput = {
    ...base,
    question: 'Fix the gateway by adding a health route',
    permission: 'full',
    applyProposedFiles: testAutoApply(root),
    doneWhen: { kind: 'command', cmd: 'node fail.mjs' },
  };
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(input, (e) => events.push(e));
  const { byType } = collect(events);

  assert.ok(result.verify, 'result.verify is present when a gate ran over a written file');
  assert.strictEqual(result.verify.status, 'failed');
  assert.strictEqual(result.verify.cmd, 'node fail.mjs');
  assert.strictEqual(result.verify.exitCode, 3);
  assert.strictEqual(result.verify.refuseReason, undefined);
  assert.match(result.verify.output ?? '', /FAILED tests\/test_health\.py/);
  // The answer's CLOSING sentence says so, plainly.
  const closing = result.text.trim().split('\n').pop() ?? '';
  assert.match(closing, /^Done-when 'node fail\.mjs' FAILED \(exit 3\)/, closing);
  assert.match(closing, /not reverted/, 'a failing gate names the edit, it does not undo it');
  // The file IS still written — the checkpoint, not the gate, is the rollback point.
  const body = fs.readFileSync(path.join(root, 'gateway/src/routes/health.ts'), 'utf8');
  assert.strictEqual(body, 'export const health = () => 500;\n');
  // The run surfaces through the existing command:log event, and the terminal event carries verify.
  const logs = (byType['command:log'] ?? []) as Array<{ cmd: string; ok: boolean; exitCode: number | null }>;
  const gateLog = logs.find((l) => l.cmd === 'node fail.mjs');
  assert.ok(gateLog, 'command:log emitted for the done-when run');
  assert.strictEqual(gateLog.ok, false);
  assert.strictEqual(gateLog.exitCode, 3);
  const terminal = (byType['result'] ?? [])[0] as { verify?: { status: string } } | undefined;
  assert.strictEqual(terminal?.verify?.status, 'failed', 'the result event carries the receipt');
});

test('askPipeline done-when: the gate runs UNDER the permission policy — `deny run_command(*)` refuses it by rule', async () => {
  /*
   * REVIEW (security): `runAskDoneWhen` was called with no `evaluatePermission`,
   * so a project or user `deny run_command` governed the tool and not the gate —
   * `--done-when` was a second shell the policy could not see. The refusal names
   * the RULE so a reader can tell "your policy said no" from "not a runner".
   */
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  seedDoneWhenScripts(root);
  writePermissionsDocument(root, { ...emptyPermissionDocument(), deny: ['run_command(*)'] });
  const permissions = loadPermissionPolicy(root, {
    knownTools: ASK_TOOL_ALLOWLIST,
    userDir: fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-nouser-')),
    managedRaw: '',
  });
  assert.deepStrictEqual(permissions.warnings, [], 'the fixture rule must parse');
  const { callProvider } = makeProviderScript(doneWhenScript());
  const base = await makeAttachedInput(repo, callProvider);
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(
    {
      ...base,
      question: 'Fix the gateway by adding a health route',
      permission: 'full',
      permissions,
      applyProposedFiles: testAutoApply(root),
      doneWhen: { kind: 'command', cmd: 'node ok.mjs' },
    },
    (e) => events.push(e),
  );
  assert.strictEqual(result.verify?.status, 'failed', 'a policy refusal is never a pass');
  assert.strictEqual(result.verify?.exitCode, null, 'it never ran');
  assert.match(result.verify?.refuseReason ?? '', /denied by permission rule run_command\(\*\)/);
  const closing = result.text.trim().split('\n').pop() ?? '';
  assert.match(closing, /was refused: denied by permission rule run_command\(\*\)/, closing);
  const { byType } = collect(events);
  const logs = (byType['command:log'] ?? []) as Array<{ cmd: string }>;
  assert.ok(!logs.some((l) => l.cmd === 'node ok.mjs'), 'no command:log for a command that was refused');
});

test('askPipeline: a path written twice in one turn is ONE file in filesWritten and in the done-when sentence', async () => {
  /*
   * REVIEW (correctness): `writtenFilesThisTurn` was pushed per write, so a
   * turn that edited the same path twice reported it twice — in
   * `result.filesWritten`, in the receipt, and in "after writing N files".
   */
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  seedDoneWhenScripts(root);
  const twice: CannedProvider[] = [
    {
      text: 'First pass.',
      toolRequests: [
        {
          id: 'w1',
          name: 'propose_files',
          args: { title: 'Add health route', files: [{ path: 'gateway/src/routes/health.ts', content: 'export const health = () => 500;\n' }] },
        },
      ],
    },
    {
      text: 'Second pass, same file.',
      toolRequests: [
        {
          id: 'w2',
          name: 'propose_files',
          args: { title: 'Fix status', files: [{ path: 'gateway/src/routes/health.ts', content: 'export const health = () => 200;\n' }] },
        },
      ],
    },
    { text: 'Done.' },
  ];
  const { callProvider } = makeProviderScript(twice);
  const base = await makeAttachedInput(repo, callProvider);
  const result = await runAskPipeline(
    {
      ...base,
      question: 'Add a health route and make it return 200',
      permission: 'full',
      applyProposedFiles: testAutoApply(root),
      doneWhen: { kind: 'command', cmd: 'node ok.mjs' },
    },
    () => {},
  );
  // Both writes landed — the second is not a refused duplicate that would make this pass vacuously.
  assert.strictEqual(
    fs.readFileSync(path.join(root, 'gateway/src/routes/health.ts'), 'utf8'),
    'export const health = () => 200;\n',
  );
  assert.deepStrictEqual(result.filesWritten, ['gateway/src/routes/health.ts']);
  const closing = result.text.trim().split('\n').pop() ?? '';
  assert.match(closing, /passed after writing 1 file\./, closing);
});

test('askPipeline done-when: a passing gate closes the answer with "passed"', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  seedDoneWhenScripts(root);
  const { callProvider } = makeProviderScript(doneWhenScript());
  const base = await makeAttachedInput(repo, callProvider);
  const result = await runAskPipeline(
    {
      ...base,
      question: 'Fix the gateway by adding a health route',
      permission: 'full',
      applyProposedFiles: testAutoApply(root),
      doneWhen: { kind: 'command', cmd: 'node ok.mjs' },
    },
    () => {},
  );
  assert.strictEqual(result.verify?.status, 'passed');
  assert.strictEqual(result.verify?.exitCode, 0);
  const closing = result.text.trim().split('\n').pop() ?? '';
  assert.match(closing, /^Done-when 'node ok\.mjs' passed after writing 1 file\./, closing);
});

test('askPipeline done-when: an un-allowlisted command is refused WITH the reason — not a pass, not silent', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const { callProvider } = makeProviderScript(doneWhenScript());
  const base = await makeAttachedInput(repo, callProvider);
  const events: AskStreamEvent[] = [];
  const result = await runAskPipeline(
    {
      ...base,
      question: 'Fix the gateway by adding a health route',
      permission: 'full',
      applyProposedFiles: testAutoApply(root),
      doneWhen: { kind: 'command', cmd: './deploy.sh' },
    },
    (e) => events.push(e),
  );
  assert.strictEqual(result.verify?.status, 'failed');
  assert.match(result.verify?.refuseReason ?? '', /not a recognised build\/test runner/);
  const closing = result.text.trim().split('\n').pop() ?? '';
  assert.match(closing, /^Done-when '\.\/deploy\.sh' was refused: not a recognised build\/test runner/, closing);
  // Nothing ran, so nothing is logged as a run.
  const { byType } = collect(events);
  const logs = (byType['command:log'] ?? []) as Array<{ cmd: string }>;
  assert.strictEqual(logs.filter((l) => l.cmd === './deploy.sh').length, 0);
});

test('askPipeline done-when: a skip is recorded with its reason and the edit is called unverified', async () => {
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const { callProvider } = makeProviderScript(doneWhenScript());
  const base = await makeAttachedInput(repo, callProvider);
  const result = await runAskPipeline(
    {
      ...base,
      question: 'Fix the gateway by adding a health route',
      permission: 'full',
      applyProposedFiles: testAutoApply(root),
      doneWhen: { kind: 'skip', reason: 'no test suite in this repo yet' },
    },
    () => {},
  );
  assert.strictEqual(result.verify?.status, 'skipped');
  assert.strictEqual(result.verify?.reason, 'no test suite in this repo yet');
  const closing = result.text.trim().split('\n').pop() ?? '';
  assert.match(closing, /^Done-when gate skipped by the caller \(no test suite in this repo yet\)/, closing);
  assert.match(closing, /unverified/);
});

test('askPipeline done-when: ABSENT when no gate was given, and ABSENT when nothing was written', async () => {
  // No doneWhen: the historical behaviour, byte for byte — no receipt, no sentence.
  {
    const repo = shopfrontRepo();
    const root = fs.realpathSync(repo);
    const { callProvider } = makeProviderScript(doneWhenScript());
    const base = await makeAttachedInput(repo, callProvider);
    const result = await runAskPipeline(
      {
        ...base,
        question: 'Fix the gateway by adding a health route',
        permission: 'full',
        applyProposedFiles: testAutoApply(root),
      },
      () => {},
    );
    assert.strictEqual(result.verify, undefined);
    assert.ok(!result.text.includes('Done-when'), result.text);
  }
  // A gate but no write: a run over an untouched tree verifies nothing, so no receipt.
  {
    const repo = shopfrontRepo();
    const root = fs.realpathSync(repo);
    seedDoneWhenScripts(root);
    const { callProvider } = makeProviderScript([{ text: 'I would add a health route to the gateway.' }]);
    const base = await makeAttachedInput(repo, callProvider);
    const events: AskStreamEvent[] = [];
    const result = await runAskPipeline(
      {
        ...base,
        question: 'Fix the gateway by adding a health route',
        permission: 'full',
        applyProposedFiles: testAutoApply(root),
        doneWhen: { kind: 'command', cmd: 'node ok.mjs' },
      },
      (e) => events.push(e),
    );
    assert.strictEqual(result.verify, undefined, 'no file was written, so there is nothing to gate');
    assert.ok(!result.text.includes('Done-when'), result.text);
    const { byType } = collect(events);
    assert.strictEqual((byType['command:log'] ?? []).length, 0, 'the gate command never ran');
  }
});

test('sequence ask: --done-when-skip without a reason is a usage error, --done-when flows through', () => {
  const skipNoReason = parseAskArgs(['fix the gateway', '--done-when-skip', '']);
  assert.match(skipNoReason.error ?? '', /--done-when-skip needs a non-empty reason/);
  const skipDangling = parseAskArgs(['fix the gateway', '--done-when-skip']);
  assert.match(skipDangling.error ?? '', /--done-when-skip needs a non-empty reason/);
  const cmd = parseAskArgs(['fix the gateway', '--permission', 'full', '--done-when', 'pytest -q']);
  assert.strictEqual(cmd.error, undefined);
  assert.deepStrictEqual(cmd.doneWhen, { kind: 'command', cmd: 'pytest -q' });
  assert.strictEqual(cmd.question, 'fix the gateway');
  const skip = parseAskArgs(['fix it', '--done-when-skip', 'no tests here']);
  assert.deepStrictEqual(skip.doneWhen, { kind: 'skip', reason: 'no tests here' });
  const both = parseAskArgs(['fix it', '--done-when', 'pytest', '--done-when-skip', 'x']);
  assert.match(both.error ?? '', /mutually exclusive/);
});

test('teach contract: the six pedagogical moves, and the refused one now narrowed', () => {
  /*
   * OWNER, 2026-09-02: "the prompt that I send to tell a model to teach me is
   * very important. Make sure we stress that when it comes to our actual
   * teaching feature." The prompt is a product surface with a bench behind it
   * (docs/teach-mode.md: 54 graded conversations), not a hidden constant.
   *
   * Four moves were added, one was already present, and one was REFUSED then
   * re-ruled as a narrower permission — that arc is why this test exists rather
   * than a diff being enough.
   */
  /* Named gaps: a lesson that silently omits reads as one that does not know. */
  assert.ok(TEACH_MODE_INSTRUCTIONS.includes('NAME WHAT YOU ARE NOT COVERING'), 'skips are declared');
  /* Worked numbers from THIS repo, not a rounded illustration. */
  assert.ok(TEACH_MODE_INSTRUCTIONS.includes('WORK THE NUMBERS'), 'quantitative concepts show arithmetic');
  /* Guess BEFORE reveal — the same words in the other order teach nothing. */
  assert.ok(TEACH_MODE_INSTRUCTIONS.includes('COMMIT BEFORE YOU REVEAL'), 'prediction precedes the answer');
  /* Close on the question they have not thought to ask. */
  assert.ok(TEACH_MODE_INSTRUCTIONS.includes('HAVE NOT THOUGHT TO ASK'), 'the closing question may open the next concept');

  /*
   * THE REFUSED MOVE, and it is the load-bearing assertion here. The source
   * material asks for "a deliberately wrong option, planted unlabelled". As a
   * multiple-choice DISTRACTOR that is ordinary teaching; as an unlabelled
   * ASSERTION it is the product telling a learner something false about their
   * own repository, and grounded-not-guessed is not suspended for a lesson. A
   * learner cannot tell a deliberate error from a real one, and one of those
   * destroys the value of every other sentence in the turn.
   *
   * So the contract permits the distractor and forbids the assertion, and this
   * asserts BOTH halves — a version that dropped the second half would read as
   * a licence to lie and would still pass a test that only checked the first.
   */
  assert.ok(
    TEACH_MODE_INSTRUCTIONS.includes('A WRONG OPTION MAY ONLY LIVE INSIDE A QUESTION'),
    'distractors are allowed inside an explicit question',
  );
  assert.ok(
    TEACH_MODE_INSTRUCTIONS.includes('ASSERTING something false'),
    'and asserting a falsehood is refused OUTRIGHT — not as a trap, not as a simplification',
  );
  assert.ok(
    TEACH_MODE_INSTRUCTIONS.includes('Grounded-not-guessed is not suspended for a lesson'),
    'the repo law is named in the contract, so the exception cannot be argued back in',
  );

  /*
   * THE REFUSED MOVE, REOPENED AND RESOLVED — same day.
   *
   * The source material also asked for "a real question mid-explanation". It was
   * refused because the contract required EXACTLY ONE check-in, and a belt that
   * both demands and forbids the same thing is what produced the owner's
   * original failure: the topology hint ordered "ask ONE short clarifying
   * question" thirty lines before the teach contract banned exactly that, and he
   * got interrogated.
   *
   * The refusal caught a real ambiguity rather than a bad idea — "interleave a
   * question" reads as either kind — and the owner then ruled FOR the move: "i
   * like so far for teaching mode the question pop ups when learning not just one
   * final question." The resolution is a NARROWER PERMISSION, not a reversal,
   * because the count was never the thing worth protecting. The KIND is:
   *
   *   COMPREHENSION — asks about material already delivered; changes nothing the
   *     harness does next. Wanted, mid-lesson, as often as the lesson needs.
   *   CLARIFYING — makes the learner choose scope, direction or format. Still
   *     ZERO, at any point in the turn.
   *
   * BOTH halves are pinned here, for the same reason the wrong-option pair above
   * is asserted in two directions: a version that added the permission and lost
   * the ban would restore the interrogation bug while passing a test that only
   * checked the permission.
   */
  assert.ok(
    TEACH_MODE_INSTRUCTIONS.includes('ASK COMPREHENSION QUESTIONS AS YOU GO'),
    'mid-lesson comprehension questions are permitted — the owner asked for them by name',
  );
  assert.ok(
    TEACH_MODE_INSTRUCTIONS.includes('NEVER ask a CLARIFYING question'),
    'and clarifying questions stay at zero, so the permission cannot decay into the old bug',
  );
  assert.ok(
    TEACH_MODE_INSTRUCTIONS.includes('if their answer would change what you do next'),
    'the contract carries the TEST that separates the two kinds, not merely the two labels',
  );

  /*
   * AND THE PERMISSION CARRIES ITS OBLIGATION — added when the evidence arrived,
   * and it corrects wording shipped hours earlier in this same file.
   *
   * The comprehension bullet originally said "withhold the answer until the
   * learner commits". Rowland 2014 (k = 159) says a learner who fails a check
   * and is not told gains nothing — g = 0.03, interval spanning zero, against
   * 0.73 when corrected. A learner cannot commit inside a turn, so that wording
   * made every mid-lesson question rhetorical: it licensed exactly the condition
   * the meta-analysis measures as worthless.
   *
   * Permission and obligation are pinned together for the same reason the
   * clarifying ban is pinned beside the comprehension permission: a contract
   * that says "ask more questions" and drops "and answer them" is worse than the
   * one-question rule it replaced.
   */
  assert.ok(
    TEACH_MODE_INSTRUCTIONS.includes('THEN ANSWER IT, IN THE SAME TURN'),
    'a mid-lesson check must be answered in the turn that asks it',
  );
  assert.ok(
    TEACH_MODE_INSTRUCTIONS.includes('closing check-in'),
    'with exactly one exemption, the closing beat, whose answer is the learner’s next message',
  );

  /*
   * THE TWO THINGS THAT MAKE A DELAYED REVEAL SAFE, and they are separate
   * findings rather than one.
   *
   * Delay itself is fine: Kandemir 2026 (51 studies, 160 effect sizes,
   * preregistered) puts immediate against delayed feedback at g = 0.03, CI
   * [-0.08, 0.13], p = .61. What is NOT fine is the reveal never arriving, or
   * arriving stripped of the guess it answers.
   *
   *   1. UNCONDITIONAL IN BOTH DIRECTIONS. The obvious gap is a wrong guess left
   *      unresolved; the easy-to-miss one is a RIGHT guess, where the reveal
   *      reads as redundant and a model skips it. Confirming a correct retrieval
   *      is the 0.73 cell, not a formality.
   *   2. SAME CONTEXT. Grimaldi & Karpicke 2012, Hays 2013 and Vaughn & Rawson
   *      2012 each found the guessing benefit VANISHES for related pairs under
   *      delayed feedback; a 2023 study recovered it on one condition — the
   *      feedback appeared in the same context as the guess. In a transcript
   *      that context is rebuilt by naming the prediction being resolved.
   *
   * Pinned in the contract because predict-then-reveal (W3) is not built yet, so
   * the prompt is the only place this can bind today. The grader check belongs
   * with W3 and needs structured prior-turn text, not the rendered history lines.
   */
  assert.ok(
    TEACH_MODE_INSTRUCTIONS.includes('WHETHER OR NOT THEY GOT IT RIGHT'),
    'the reveal is unconditional after a CORRECT guess too, not only a wrong one',
  );
  assert.ok(
    TEACH_MODE_INSTRUCTIONS.includes('THE REVEAL RESTATES WHAT WAS PREDICTED'),
    'and it carries the guess back with it — the same-context condition',
  );
});

/* ===== teach mode: ask, then TELL — an unanswered check teaches nothing ===== */

test('teach mode bounces a mid-lesson question the turn never answers', async () => {
  const { gradeTeachTurn } = await import('../server/askPipeline.js');
  const names = new Set(['index.ts']);
  /*
   * Rowland 2014 (k = 159): no feedback with initial success below 50% scores
   * g = 0.03, interval [-0.21, 0.27] — spanning zero — against g = 0.73 when the
   * learner is corrected. A learner cannot reply inside a turn, so a mid-lesson
   * question the turn does not answer is rhetorical and lands in exactly that
   * cell.
   *
   * This corrects wording the contract itself shipped hours earlier ("withhold
   * the answer until the learner commits"), which is right for the closing beat
   * and wrong for every question before it.
   */
  const asksAndWalksAway =
    'The gateway is the front door. So what do you think happens when it stops responding? ' +
    'Does that make sense so far?';
  const problems = gradeTeachTurn(asksAndWalksAway, names, names, true);
  assert.equal(problems.length, 1, 'exactly the ask-then-tell bounce');
  assert.match(problems[0]!, /moved on without answering it/);
});

test('teach mode accepts a mid-lesson question that IS answered in the same turn', async () => {
  const { gradeTeachTurn } = await import('../server/askPipeline.js');
  const names = new Set(['index.ts']);
  // Ask, then tell, then close. The shape the contract is asking for.
  const asksAndTells =
    'The gateway is the front door: every request lands there first. ' +
    'So what happens to everything behind it if it stops responding? ' +
    'Nothing behind it is reachable, which is why it carries the largest blast radius here. ' +
    'Does that make sense so far?';
  assert.deepStrictEqual(gradeTeachTurn(asksAndTells, names, names, true), []);
});

test('teach mode leaves the CLOSING check-in open — exactly one question may be outstanding', async () => {
  const { gradeTeachTurn } = await import('../server/askPipeline.js');
  const names = new Set(['index.ts']);
  /*
   * Not a loophole. The learner's next message IS the closing question's answer,
   * and the contract already requires the next turn to grade it honestly. So one
   * question may be outstanding, it is always the last one, and everything
   * before it owes an answer in the same turn.
   */
  const onlyClosing =
    'The gateway is the front door and every request lands there first. ' +
    'Which component do you think it calls next?';
  assert.deepStrictEqual(gradeTeachTurn(onlyClosing, names, names, true), []);
});

test('teach mode does not accept a bare acknowledgement as the answer', async () => {
  const { gradeTeachTurn } = await import('../server/askPipeline.js');
  const names = new Set(['index.ts']);
  /*
   * Eight words is a floor on "something was said", not a measure of quality. A
   * grader cannot check that prose ANSWERS a question; it can check that the
   * lesson did not ask and walk away, and a two-word transition is walking away.
   */
  const bareAck =
    'The gateway is the front door. So what happens when it stops responding? ' +
    'Exactly. Does that make sense so far?';
  assert.match(
    gradeTeachTurn(bareAck, names, names, true)[0] ?? '',
    /moved on without answering it/,
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   W3 (PREDICT-THEN-REVEAL): TWO CHECKS THAT CANNOT BE WRITTEN YET, HELD HERE
   RATHER THAN IN A DOC

   The evidence says the reveal is where this mode earns its keep, and two
   conditions make a DELAYED reveal safe (docs/teach-mode.md):

     1. it fires unconditionally — including when the learner guessed RIGHT,
        which is the g = 0.73 cell and the one a model will optimise away;
     2. it RESTATES the prediction it resolves, because the guessing benefit
        vanishes under delay unless the feedback carries the guess with it.

   Neither is grader-enforceable today: `gradeTeachTurn` sees one turn and cannot
   know a prediction was outstanding, and the only history the pipeline holds is
   `historyLines` — RENDERED PROMPT TEXT. Recovering "was a prediction
   outstanding" by parsing prompt formatting would be the declared-is-not-rendered
   defect for the fourth time in one night, and this repo has three fresh
   examples of it.

   SO WHY IS THIS IN THE SUITE AND NOT IN THE DOC? Because a rule recorded only
   in prose is the exact artefact this round spent its time cataloguing: the
   teach question-count that lived in the prompt and nowhere else; three anatomy
   locks that pinned numbers while the measurements doc already said not to; a
   bench figure produced by a grader running two of its four rules. Every one was
   written down, in the right place, believed, and unenforced. An "acceptance
   criterion" in a markdown file is that shape again, and the person who builds
   W3 will be reading a wave spec, not this doc.

   The tripwire below therefore ARMS ITSELF. It passes while no
   `drawnPrediction` wire exists and fails the moment one lands, which is the
   only moment these two checks become writable. It is deliberately a normal,
   running assertion rather than a skipped test: a skip is a note, and notes are
   what we are trying to stop relying on.
   ═══════════════════════════════════════════════════════════════════════════ */

test('W3 tripwire: when drawnPrediction lands, the two reveal checks become writable', () => {
  const packagesDir = path.resolve(ANALYZER_ROOT, '..');
  const hits: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      /*
       * `test` directories are excluded, and this file is why: it names the
       * identifier in prose and would trip its own tripwire. Excluding by
       * `import.meta.url` does not work — the suite runs from `dist`, so the
       * running module is the .js and the walk sees the .ts. The wire itself
       * will land in `server/` and `api-types/`, never under `test/`, so the
       * directory rule is the honest one rather than a self-exemption.
       */
      if (
        e.name === 'node_modules' ||
        e.name === 'dist' ||
        e.name === 'test' ||
        e.name.startsWith('.')
      )
        continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(e.name) || e.name.endsWith('.d.ts')) continue;
      if (fs.readFileSync(full, 'utf8').includes('drawnPrediction')) hits.push(full);
    }
  };
  for (const pkg of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (pkg.isDirectory()) walk(path.join(packagesDir, pkg.name, 'src'));
  }

  assert.deepStrictEqual(
    hits,
    [],
    'W3 HAS LANDED — `drawnPrediction` now exists in source, so a reveal turn is a ' +
      'structural thing and the two deferred checks are finally writable. Do not just ' +
      'delete this test. Implement them, using the prediction the request carries rather ' +
      'than parsing historyLines: (1) the reveal fires even when the learner guessed ' +
      'CORRECTLY — confirming a right retrieval is the highest-value case in the feedback ' +
      'table, and it is the one a model skips as redundant; (2) the reveal RESTATES the ' +
      'prediction it resolves, because three studies found the guessing benefit disappears ' +
      'under delayed feedback unless the answer carries the guess back with it. ' +
      'docs/teach-mode.md has the numbers. Then remove this tripwire.',
  );
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE TEACHING BELT IS RENDERED, NOT TYPED

   The owner's most-repeated sentence is that the harness assembles the prompt so
   he never writes one. That was true of everything except the teaching contract,
   which was a static string saying the same words for a first lesson and a
   twentieth. It is now a function of what the turn knows.
   ═══════════════════════════════════════════════════════════════════════════ */

test('teach belt: with NO context it is byte-identical to the constant', async () => {
  const { renderTeachModeInstructions, TEACH_MODE_INSTRUCTIONS: C } = await import(
    '../server/askPipeline.js'
  );
  /*
   * THIS IS WHAT MAKES IT A REFACTOR. A turn carrying no lesson state must
   * produce the prompt that shipped before, to the byte — otherwise every
   * measurement taken against the old belt silently describes a different one.
   */
  assert.strictEqual(renderTeachModeInstructions(), C);
  assert.strictEqual(renderTeachModeInstructions({}), C);
});

test('teach belt: an OPEN prediction is rendered first, and demands the reveal', async () => {
  const { renderTeachModeInstructions } = await import('../server/askPipeline.js');
  const belt = renderTeachModeInstructions({
    open: { question: 'which service does the gateway call first?', expect: 'the scanner' },
    concept: { title: 'how the scan walks a repo', nodeId: 'svc:analyzer' },
  });
  /* First, because a turn that opens with new material has already lost the
     retrieval it asked for. */
  assert.ok(
    belt.indexOf('RESOLVE THE OPEN PREDICTION FIRST') < belt.indexOf("THIS TURN'S CONCEPT"),
    'the reveal outranks the new concept',
  );
  assert.match(belt, /which service does the gateway call first\?/);
  assert.match(belt, /the scanner/);
  /* The unconditional-reveal rule, made mechanical rather than hoped for. */
  assert.match(belt, /whether they replied, guessed wrong, changed the subject, or got it/);
  assert.match(belt, /svc:analyzer/);
});

test('teach belt: a skip is about the LEARNER and never licenses a claim about the repo', async () => {
  const { renderTeachModeInstructions } = await import('../server/askPipeline.js');
  const belt = renderTeachModeInstructions({ known: 'ship-it', doNotExplain: ['what a queue is'] });
  assert.match(belt, /DO NOT EXPLAIN: what a queue is/);
  /*
   * The load-bearing half. "They already know X" is sourced from a button they
   * pressed and can be wrong the way a preference is wrong. It must never be
   * readable as "assert X is true of this repository" — grounded-not-guessed is
   * not suspended by a skip, and the belt says so in the same breath.
   */
  assert.match(belt, /statement about THE LEARNER/);
  assert.match(belt, /never a statement about this repository/);
  assert.match(belt, /still needs its evidence/);
});

test('teach belt: two different lessons cannot share an instruction hash', async () => {
  const { computeAskInstructionHash } = await import('../server/askPipeline.js');
  /*
   * The hash is over the RENDERED belt, so a context that changes the belt
   * changes the hash by construction. This proves that rather than assuming it —
   * the spec expected a manual change here, and the manual change is the kind
   * that gets forgotten.
   */
  const base = { designMode: false, repoRoot: '/repo', teach: true, question: 'teach me this' };
  const a = computeAskInstructionHash({ ...base, teachContext: { concept: { title: 'scanning' } } });
  const b = computeAskInstructionHash({ ...base, teachContext: { concept: { title: 'joining' } } });
  const none = computeAskInstructionHash(base);
  assert.notStrictEqual(a, b, 'different concepts, different belts, different hashes');
  assert.notStrictEqual(a, none);
});

test('propose_chart: a file stem resolves to its node; an invented name still does not', async () => {
  /*
   * MEASURED, not imagined. Every refused propose_chart call in the teach bench
   * cited a nodeId, and the commonest shape was the file the concept lives in:
   *   items[0].nodeId: "nn_bigram.py" is not a node in this repository
   * The model is not inventing there — it is naming a real file by the only name
   * it has seen, and the graph knows which node that is.
   *
   * The same run also refused `softmax_output` and `bigram_counts`, which are
   * NOT stems: invented concept nodes with no file behind them. Those are a
   * different defect, and this fix must not paper over them — which is the
   * second half of this test.
   */
  const { executeAskTool } = await import('../server/askTools.js');
  const repo = shopfrontRepo();
  const root = fs.realpathSync(repo);
  const graph = await scanRepo(repo, { cluster: true });
  const ctx = {
    resolveReadable: (p: string) => resolveInRepo(root, p),
    repoRoot: root,
    designMode: false,
    graph,
  } as never;

  const withPath = graph.nodes.find((n) => n.path !== undefined && /\.[a-z]+$/.test(n.path))!;
  const p = (withPath.path as string).split('\\').join('/');
  const basename = p.slice(p.lastIndexOf('/') + 1);

  const resolved = await executeAskTool(
    'propose_chart',
    {
      version: 1,
      kind: 'data-flow',
      title: 'Stem resolves',
      items: [{ id: 'a', label: 'The file', nodeId: basename }],
    },
    ctx,
  );
  assert.strictEqual(resolved.ok, true, String(resolved.evidence));
  assert.strictEqual(
    resolved.chart?.items[0].nodeId,
    withPath.id,
    'the stem must be rewritten to the real node id, not merely accepted',
  );

  // An invented concept name is not a stem and must still be refused.
  const invented = await executeAskTool(
    'propose_chart',
    {
      version: 1,
      kind: 'data-flow',
      title: 'Invented concept',
      items: [{ id: 'a', label: 'Softmax output', nodeId: 'softmax_output' }],
    },
    ctx,
  );
  assert.strictEqual(invented.ok, false);
  assert.match(String(invented.evidence), /not a node in this repository/);
});
