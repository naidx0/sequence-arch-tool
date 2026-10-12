/*
 * A minimal bash agent in the mini-swe-agent style: each turn the model writes
 * one ```bash block, we run it read-only in the repository and show the output,
 * until it answers with {"files": [...]}. It exists because Codex's own prompt
 * does not fit a small local model's context (measured 2026-10-01: Codex on
 * qwen3.5:4b hit the 32,768-token window and made 0 tool calls).
 *
 * The two arms differ by one line of the system prompt and one allowed command:
 * the sequence arm may run `sequence-map who_calls|impact|path_between`.
 * Both arms are refused `.sequence/` (Sequence's own cache) so the plain arm
 * cannot read the map through the back door.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const MAP_CLI = path.join(HERE, 'sequence-map.mjs');
const OBS_CAP = 6000;

const READ_ONLY = new Set(['grep', 'rg', 'cat', 'head', 'tail', 'ls', 'find', 'wc', 'sed', 'awk', 'sort', 'uniq', 'git', 'sequence-map']);
const GIT_OK = new Set(['grep', 'log', 'show', 'ls-files']);

/*
 * The `map` arm is the sequence arm plus `.sequence/map.md` (4k) in the system
 * prompt — the only difference between the two, so a paired delta is the map's.
 */
export function systemPrompt(arm, map) {
  return [
    'You answer questions about a code repository by running shell commands in it.',
    'Each reply: one short THOUGHT line, then exactly one ```bash block with one read-only command (grep, rg, cat, head, tail, ls, find, wc, sed -n, git grep/log/show/ls-files). Pipes are fine. No writes.',
    arm === 'sequence' || arm === 'map'
      ? 'You also have `sequence-map`, a static map of the repository: `sequence-map who_calls <file|function|service>` lists callers and callees with file:line evidence (add --imports to include importers); `sequence-map impact <file|service>` lists what depends on it; `sequence-map path_between <from> <to>` lists routes between two components. Prefer it for questions about calls, dependencies and request paths.'
      : '',
    arm === 'map' && map
      ? `Architecture map of this repository from a static scan (services, their cross-service edges at file:line, apis, modules; ranked, cut to a budget):\n${map}`
      : '',
    'When you know the answer, reply with ONLY this JSON and no bash block: {"files": ["path/one", "path/two"]} (paths relative to the repository root).',
    'You have at most 15 commands.',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Refuse anything that is not a read-only command from the list, or touches .sequence/. */
export function vet(cmd, arm) {
  if (/(^|[^0-9])>|\btee\b|\brm\b|\bmv\b|\bcp\b|\bchmod\b|\bcurl\b|\bwget\b|\bnode\b|\bpython\b|`|\$\(/.test(cmd)) return 'refused: only read-only commands';
  if (/\.sequence(\/|\\|\b)/.test(cmd)) return 'refused: .sequence/ is off limits';
  for (const part of cmd.split(/\|/)) {
    const words = part.trim().split(/\s+/);
    const w = words[0];
    if (!READ_ONLY.has(w)) return `refused: ${w} is not allowed`;
    if (w === 'sequence-map' && arm === 'plain') return 'refused: sequence-map is not available';
    if (w === 'git' && !GIT_OK.has(words[1])) return 'refused: only git grep/log/show/ls-files';
    if (w === 'sed' && !/\s-n\s/.test(` ${part} `)) return 'refused: sed -n only';
  }
  return null;
}

export function extractBash(text) {
  const m = /```(?:bash|sh)?\s*\n([\s\S]*?)```/.exec(text);
  return m ? m[1].trim().split('\n')[0] : null;
}

function bashExe() {
  if (process.platform !== 'win32') return 'bash';
  for (const p of ['C:/Program Files/Git/bin/bash.exe', 'C:/Program Files (x86)/Git/bin/bash.exe']) {
    try {
      if (spawnSync(p, ['-c', 'true']).status === 0) return p;
    } catch {}
  }
  return 'bash';
}
const BASH = bashExe();

export function runCommand(cmd, cwd) {
  /* sequence-map is a function in the shell, so pipes after it still work. */
  /*
   * `timeout` INSIDE bash, not only spawnSync's: on Windows spawnSync kills bash
   * at its deadline but a child it started (a `grep -r` over a 19 GB tree) keeps
   * the stdout pipe open, and spawnSync then waits on the pipe forever. Measured
   * 2026-10-05: one question hung a whole run for 35 minutes.
   */
  const prelude = `sequence-map() { node "${MAP_CLI.split(path.sep).join('/')}" "$@"; }; export -f sequence-map; `;
  const r = spawnSync(BASH, ['-c', `${prelude}timeout -k 5 55 bash -c "$SEQ_AB_CMD"`], {
    cwd,
    encoding: 'utf8',
    timeout: 70000,
    maxBuffer: 1 << 26,
    env: { ...process.env, SEQ_AB_CMD: cmd },
  });
  let out = (r.stdout ?? '') + (r.stderr ? `\n[stderr] ${r.stderr}` : '');
  if (out.length > OBS_CAP) out = out.slice(0, OBS_CAP) + `\n[... ${out.length - OBS_CAP} more characters cut]`;
  return `[exit ${r.status}]\n${out}`;
}

async function chat(messages, model, baseUrl) {
  const r = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: false, think: false, options: { num_ctx: 32768 } }),
  });
  if (!r.ok) throw new Error(`ollama ${r.status}: ${await r.text()}`);
  const j = await r.json();
  return { text: j.message?.content ?? '', tin: j.prompt_eval_count ?? 0, tout: j.eval_count ?? 0 };
}

/**
 * Run one question. `llm` is injectable so the loop is tested without a model.
 * Returns the same fields the runner records for the other agents.
 */
export async function runBashAgent({ question, cwd, arm, model, map, baseUrl = 'http://127.0.0.1:11434', llm, maxSteps = 15 }) {
  const call = llm ?? ((msgs) => chat(msgs, model, baseUrl));
  const messages = [
    { role: 'system', content: systemPrompt(arm, map) },
    { role: 'user', content: question },
  ];
  const t0 = Date.now();
  let tin = 0, tout = 0, toolCalls = 0, mapCalls = 0, last = '';
  /*
   * A model call that fails (Node's fetch gives up when no response headers
   * arrive in 300 s; granite4.2:3b hit it on 2026-10-05 and the whole run
   * crashed) ends THIS question with whatever answer it has (usually none, so
   * F1 0) and is recorded as `llmError`. Same rule in every arm.
   */
  let llmError = null;
  const ask = async () => {
    try {
      const r = await call(messages);
      tin += r.tin;
      tout += r.tout;
      last = r.text;
      return r;
    } catch (e) {
      llmError = String(e?.cause?.code ?? e?.message ?? e);
      return null;
    }
  };
  for (let step = 0; step < maxSteps; step++) {
    const r = await ask();
    if (!r) break;
    messages.push({ role: 'assistant', content: r.text });
    const cmd = extractBash(r.text);
    if (!cmd) break;
    toolCalls++;
    if (/^\s*sequence-map\b/.test(cmd) || /\|\s*sequence-map\b/.test(cmd)) mapCalls++;
    const refusal = vet(cmd, arm);
    messages.push({ role: 'user', content: refusal ?? runCommand(cmd, cwd) });
  }
  if (!llmError && !/"files"\s*:/.test(last)) {
    messages.push({ role: 'user', content: 'Stop now and give your answer as {"files": [...]} only.' });
    await ask();
  }
  return { ms: Date.now() - t0, last, tokensIn: tin, tokensOut: tout, toolCalls, mcpCalls: mapCalls, exit: 0, ...(llmError ? { llmError } : {}) };
}
