/*
 * The "agent" arm: Sequence's built-in agent loop (runAskPipeline) on one task, in a temp copy.
 *
 * The code under test is whatever analyzer build `dist` points at, so the two arms of the A/B are two
 * checkouts built separately (base commit vs branch) and the SAME model:
 *   node tools/bench/agent-ab/task-run.mjs --arm agent --dist <checkout>/packages/analyzer/dist --label base --out base.jsonl
 *
 * The model comes from the environment (nothing is read from the user's own config or ~/.sequence):
 *   SEQUENCE_AI_PROVIDER (default openai-compatible)  SEQUENCE_AI_MODEL  SEQUENCE_AI_BASE_URL
 *   SEQUENCE_AI_API_KEY | OPENROUTER_API_KEY          SEQUENCE_AI_TIMEOUT_MS
 *
 * Permission is `build`: edits are written to the temp copy, run_command is the allowlisted runner path.
 * A scripted `callProvider` can be injected, which is how --dry proves the wiring with no model.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';

export function envCfg(env = process.env) {
  return {
    provider: env.SEQUENCE_AI_PROVIDER || 'openai-compatible',
    model: env.SEQUENCE_AI_MODEL || '',
    baseUrl: env.SEQUENCE_AI_BASE_URL || 'http://127.0.0.1:11434/v1',
    apiKey: env.SEQUENCE_AI_API_KEY || env.OPENROUTER_API_KEY || 'none',
    temperature: 0,
    maxRetries: 3,
    timeoutMs: Number(env.SEQUENCE_AI_TIMEOUT_MS || 600_000),
  };
}

const CLAIM = /\b(all |the )?(tests?|suite)\b[^.\n]{0,40}\bpass(es|ed|ing)?\b|\bpass(es|ed|ing)?\b[^.\n]{0,20}\btests?\b|\bfixed\b/i;
/* "not fixed", "isn't fixed", "could not get the tests to pass" are the opposite of a claim: remove them first. */
const NEGATED = /\b(?:not|never|no longer|cannot|can't|couldn't|could not|isn't|aren't|wasn't|don't|doesn't|didn't|unable to|failed to|fail to)\b[^.\n]{0,25}\b(?:fixed|fix|pass(?:es|ed|ing)?)\b/gi;
export const claimsSuccess = (text) => CLAIM.test(String(text ?? '').replace(NEGATED, ' '));

export async function runAgentArm({ task, dir, dist, cfg, callProvider, maxRounds = 12 }) {
  const dj = (rel) => url.pathToFileURL(path.join(dist, rel)).href;
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-user-'));
  const prevUser = process.env.SEQUENCE_USER_DIR;
  process.env.SEQUENCE_USER_DIR = userDir;
  try {
    const { runAskPipeline } = await import(dj('server/askPipeline.js'));
    const { applyAskFileWrites } = await import(dj('server/applyAskFileWrites.js'));
    const { scanRepo } = await import(dj('scan.js'));
    const { buildDigest } = await import(dj('explain/explain.js'));
    const { resolveInRepo } = await import(dj('server/jail.js'));
    const { setRepoTrust } = await import(dj('server/repoTrust.js'));
    const root = fs.realpathSync(dir);
    setRepoTrust(userDir, root, true);
    const graph = await scanRepo(root, { cluster: true });
    const digest = buildDigest(graph);
    let provider = callProvider;
    if (!provider) {
      const providerMod = await import(dj('server/provider.js'));
      const toolsMod = await import(dj('server/askTools.js'));
      const defs = toolsMod.openaiAskToolDefinitions(toolsMod.askToolsForJobMode('code', 'build'));
      provider = async (c, prompt, _d, opts) => {
        const r = await providerMod.generateTextWithUsage(c, prompt, {
          tools: defs,
          ...(opts?.cacheBreakpointChars !== undefined ? { cacheBreakpointChars: opts.cacheBreakpointChars } : {}),
        });
        return {
          text: r.text,
          ...(r.toolRequests?.length ? { toolRequests: r.toolRequests } : {}),
          ...(r.providerUsage ? { usage: { inputTokens: r.providerUsage.inputTokens, outputTokens: r.providerUsage.outputTokens, estimated: false } } : {}),
        };
      };
    }
    const tools = {};
    let error = null;
    let result = null;
    const t0 = Date.now();
    try {
      result = await runAskPipeline(
        {
          question: task.prompt,
          intents: [],
          scopeLines: [],
          askMode: 'research',
          deictic: false,
          designMode: false,
          graph,
          digest,
          cfg: cfg ?? envCfg(),
          resolveReadable: (rel) => resolveInRepo(root, rel),
          repoRoot: root,
          permission: 'build',
          maxRounds,
          callProvider: provider,
          applyProposedFiles: (files) =>
            applyAskFileWrites(files, { repoRoot: root, resolveWritable: (rel) => resolveInRepo(root, rel), runPreWriteHook: async () => ({ allowed: true }) }),
        },
        (e) => {
          if (e.type === 'tool:done' && e.name) tools[e.name] = (tools[e.name] ?? 0) + 1;
        },
      );
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const text = String(result?.text ?? '');
    return {
      ms: Date.now() - t0,
      text,
      claimedPass: claimsSuccess(text),
      tools,
      toolCalls: result?.toolCallsMade ?? Object.values(tools).reduce((a, b) => a + b, 0),
      tokensIn: result?.usage?.inputTokens ?? null,
      tokensOut: result?.usage?.outputTokens ?? null,
      error,
    };
  } finally {
    if (prevUser === undefined) delete process.env.SEQUENCE_USER_DIR;
    else process.env.SEQUENCE_USER_DIR = prevUser;
  }
}

/*
 * Scripted fake models for --dry. Each is a callProvider: `oracle` writes the task's reference solution
 * with propose_files, runs the test, then claims success; `null` writes nothing and CLAIMS success anyway
 * (so the claimed-pass-but-failed count has something to count); `half` is oracle on odd-numbered tasks.
 */
export function scriptedProvider(kind, task) {
  const n = Number(/^t(\d+)/.exec(task.id)?.[1] ?? 0);
  const solves = kind === 'oracle' || (kind === 'half' && n % 2 === 1);
  let round = 0;
  return async () => {
    round += 1;
    if (!solves) return { text: 'I looked at the code and all tests pass now.', usage: { inputTokens: 100, outputTokens: 10, estimated: true } };
    if (round === 1) {
      const files = [];
      const walk = (rel) => {
        for (const e of fs.readdirSync(path.join(task.dir, 'solution', rel), { withFileTypes: true })) {
          const r = rel ? `${rel}/${e.name}` : e.name;
          if (e.isDirectory()) walk(r);
          else files.push({ path: r, content: fs.readFileSync(path.join(task.dir, 'solution', r), 'utf8') });
        }
      };
      walk('');
      return { text: '', toolRequests: [{ id: 'w1', name: 'propose_files', args: { title: 'fix', files } }], usage: { inputTokens: 200, outputTokens: 50, estimated: true } };
    }
    if (round === 2) return { text: '', toolRequests: [{ id: 'r1', name: 'run_command', args: { cmd: 'node --test test/mod.test.js' } }], usage: { inputTokens: 200, outputTokens: 20, estimated: true } };
    return { text: 'Fixed. The tests pass: node --test test/mod.test.js exited 0.', usage: { inputTokens: 300, outputTokens: 20, estimated: true } };
  };
}
