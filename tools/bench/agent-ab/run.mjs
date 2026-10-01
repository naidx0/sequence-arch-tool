#!/usr/bin/env node
/*
 * AGENT A/B — the same coding agent on the same questions, with and without the
 * Sequence MCP server. The only variable is whether the plugin is attached.
 *
 *   node tools/bench/agent-ab/run.mjs --questions q.json --repos repos.json \
 *     --agent codex|claude|mock --arm plain|sequence [--model m] [--oss] [--limit n] [--out run.jsonl]
 *
 * Both arms: read-only, the user's own config and MCP servers ignored, the same
 * prompt (it names the repository's absolute path in both, so the plain arm is
 * not disadvantaged by not knowing where it is). The sequence arm adds exactly
 * one MCP server, packages/mcp/dist/index.js.
 *
 * Every answer is scored against a hand-labelled file set (score.mjs). Recorded
 * per question: files returned, wall ms, tokens in/out where the agent reports
 * them, tool calls, and the raw final message.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import { parseAnswer, scoreAnswer } from './score.mjs';
import { runBashAgent } from './bash-agent.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const MCP = path.join(ROOT, 'packages', 'mcp', 'dist', 'index.js');
const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i === -1 ? d : process.argv[i + 1];
};
const has = (n) => process.argv.includes(n);
const Q = JSON.parse(fs.readFileSync(arg('--questions'), 'utf8')).questions;
const REPOS = JSON.parse(fs.readFileSync(arg('--repos'), 'utf8'));
const AGENT = arg('--agent', 'mock');
const ARM = arg('--arm', 'plain');
const MODEL = arg('--model');
const LIMIT = Number(arg('--limit', Q.length));
const OUT = arg('--out', path.join(os.tmpdir(), `agent-ab-${AGENT}-${ARM}.jsonl`));
const TIMEOUT = Number(arg('--timeout-ms', 600000));
if (!['plain', 'sequence'].includes(ARM)) throw new Error('--arm plain|sequence');

export function prompt(q, repoAbs) {
  return [
    `You are answering a question about the code repository at ${repoAbs}.`,
    'Work read-only. Do not edit any file.',
    `Question: ${q.question}`,
    'When you are done, reply with ONLY this JSON on the last line, paths relative to the repository root with forward slashes:',
    '{"files": ["path/one", "path/two"]}',
  ].join('\n');
}

/* codex.cmd is a batch shim; run its JS entry with node so no shell parses the arguments. */
function codexEntry() {
  if (process.env.CODEX_JS) return process.env.CODEX_JS;
  const npmBin = process.platform === 'win32' ? path.join(process.env.APPDATA ?? '', 'npm') : '/usr/local/lib';
  const guess = path.join(npmBin, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
  if (fs.existsSync(guess)) return guess;
  throw new Error('set CODEX_JS to @openai/codex/bin/codex.js');
}

function runCodex(text, cwd) {
  const args = ['exec', '--json', '--ephemeral', '--ignore-user-config', '--skip-git-repo-check', '-s', 'read-only', '-C', cwd];
  if (has('--oss')) args.push('--oss', '--local-provider', 'ollama');
  if (MODEL) args.push('-m', MODEL);
  if (ARM === 'sequence') {
    args.push('-c', `mcp_servers.sequence.command="node"`, '-c', `mcp_servers.sequence.args=[${JSON.stringify(MCP.split(path.sep).join('/'))}]`);
    args.push('-c', 'mcp_servers.sequence.startup_timeout_sec=120');
  }
  args.push('-'); // the prompt goes on stdin: a shell would split it into arguments
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [codexEntry(), ...args], { input: text, encoding: 'utf8', timeout: TIMEOUT, maxBuffer: 1 << 28 });
  const ms = Date.now() - t0;
  let last = '', tokensIn = null, tokensOut = null, toolCalls = 0, mcpCalls = 0;
  for (const line of (r.stdout || '').split(/\r?\n/)) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const item = e.item ?? e.msg ?? {};
    const type = item.type ?? item.item_type ?? e.type;
    if (/command_execution|exec_command|mcp_tool_call|tool_call/.test(String(type)) && /started|begin/.test(String(e.type))) toolCalls++;
    if (/mcp_tool_call/.test(String(type)) && /started|begin/.test(String(e.type))) mcpCalls++;
    if (type === 'agent_message' && item.text) last = item.text;
    const u = e.usage ?? item.usage;
    if (u) {
      tokensIn = (u.input_tokens ?? 0) + (u.cached_input_tokens ?? 0);
      tokensOut = u.output_tokens ?? null;
    }
  }
  return { ms, last, tokensIn, tokensOut, toolCalls, mcpCalls, exit: r.status, stderrTail: (r.stderr || '').slice(-400) };
}

function runClaude(text, cwd) {
  const cfg = path.join(os.tmpdir(), `agent-ab-mcp-${ARM}.json`);
  const servers = ARM === 'sequence' ? { sequence: { command: 'node', args: [MCP] } } : {};
  fs.writeFileSync(cfg, JSON.stringify({ mcpServers: servers }));
  const tools = ['Read', 'Grep', 'Glob', 'Bash(git log:*)', 'Bash(git grep:*)'];
  if (ARM === 'sequence') tools.push('mcp__sequence');
  const args = ['-p', '--output-format', 'json', '--strict-mcp-config', '--mcp-config', cfg, '--allowedTools', tools.join(','), '--disallowedTools', 'Edit,Write,NotebookEdit'];
  if (MODEL) args.push('--model', MODEL);
  const t0 = Date.now();
  const r = spawnSync('claude', args, { cwd, input: text, encoding: 'utf8', timeout: TIMEOUT, maxBuffer: 1 << 28 });
  const ms = Date.now() - t0;
  let j = {};
  try { j = JSON.parse(r.stdout); } catch {}
  const u = j.usage ?? {};
  return {
    ms,
    last: j.result ?? '',
    tokensIn: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) || null,
    tokensOut: u.output_tokens ?? null,
    toolCalls: j.num_turns ?? null,
    mcpCalls: null,
    costUsd: j.total_cost_usd ?? null,
    exit: r.status,
    stderrTail: (r.stderr || '').slice(-400),
  };
}

/* A stand-in agent so the runner and scorer are tested without a model. */
function runMock(_text, _cwd, q) {
  const files = ARM === 'sequence' ? q.answer : q.answer.slice(0, 1).concat(['not/a/real/file.ts']);
  return { ms: 1, last: `done\n${JSON.stringify({ files })}`, tokensIn: 100, tokensOut: 10, toolCalls: 1, mcpCalls: ARM === 'sequence' ? 1 : 0, exit: 0 };
}

const runBash = (text, cwd) => runBashAgent({ question: text, cwd, arm: ARM, model: MODEL });
const run = { codex: runCodex, claude: runClaude, bash: runBash, mock: runMock }[AGENT];
if (!run) throw new Error('--agent codex|claude|bash|mock');
fs.writeFileSync(OUT, '');
for (const q of Q.slice(0, LIMIT)) {
  const repoAbs = path.resolve(REPOS[q.repo]);
  const r = await run(prompt(q, repoAbs), repoAbs, q);
  const files = parseAnswer(r.last);
  const s = scoreAnswer(q, files);
  const row = { id: q.id, repo: q.repo, type: q.type, agent: AGENT, arm: ARM, model: MODEL ?? null, files, ...s, ...r };
  fs.appendFileSync(OUT, JSON.stringify(row) + '\n');
  console.log(`${q.id.padEnd(12)} ${ARM.padEnd(8)} f1=${s.f1.toFixed(2)} recall=${s.recall.toFixed(2)} ${(r.ms / 1000).toFixed(1)}s tools=${r.toolCalls ?? '-'} exit=${r.exit}`);
}
console.log(`wrote ${OUT}`);
