#!/usr/bin/env node
/*
 * Task-completion A/B: run an agent arm on every sealed task in a temp copy, score pass/fail by running the
 * task's own test, write one JSON row per (task, repeat), and compare two arms with paired statistics.
 *
 *   node tools/bench/agent-ab/task-run.mjs --dry                     scripted fake models, no model/network: proves scoring + stats
 *   node tools/bench/agent-ab/task-run.mjs --arm agent --dist <analyzer dist> --label base --out base.jsonl [--repeat 3] [--limit n]
 *   node tools/bench/agent-ab/task-run.mjs --compare base.jsonl branch.jsonl
 *
 * Refuses to run an arm unless tasks/SEALED.md matches the set on disk.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import { TASKS_DIR, listTasks, copyRepo, scoreTask, sealHash, readSealed } from './taskset.mjs';
import { runAgentArm, scriptedProvider, envCfg } from './agent-arm.mjs';
import { pairedStats, formatStats } from './stats.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const DEFAULT_DIST = path.resolve(HERE, '..', '..', '..', 'packages', 'analyzer', 'dist');

export function assertSealed() {
  const now = sealHash(TASKS_DIR);
  if (now !== readSealed(TASKS_DIR)) throw new Error(`task set does not match tasks/SEALED.md (${now}); refusing to run`);
  return now;
}

/** Run one arm over tasks. `agent` is async (task, dir) => { text, claimedPass, ms, toolCalls, ... }. */
export async function runArm({ label, tasks, repeat = 1, agent, out }) {
  const rows = [];
  const seal = sealHash(TASKS_DIR);
  if (out) fs.writeFileSync(out, '');
  for (const task of tasks) {
    for (let rep = 0; rep < repeat; rep++) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-run-'));
      try {
        copyRepo(task, dir);
        const run = await agent(task, dir);
        const score = scoreTask(task, dir);
        const row = {
          arm: label,
          seal,
          task: task.id,
          rep,
          pass: score.pass ? 1 : 0,
          testsRestored: score.testsRestored,
          reason: score.reason ?? null,
          violations: score.violations?.length ? score.violations : undefined,
          timedOut: score.timedOut,
          claimedPass: run.claimedPass ? 1 : 0,
          claimedFail: run.claimedPass && !score.pass ? 1 : 0,
          ms: run.ms,
          toolCalls: run.toolCalls,
          tokensIn: run.tokensIn,
          tokensOut: run.tokensOut,
          error: run.error ?? null,
        };
        rows.push(row);
        if (out) fs.appendFileSync(out, JSON.stringify(row) + '\n');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  }
  return rows;
}

export const readRows = (f) =>
  fs
    .readFileSync(f, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));

export function report(aRows, bRows, la, lb) {
  return [['pass', 'higher'], ['claimedFail', 'lower']].map(([key, better]) => formatStats(pairedStats(aRows, bRows, { key, better }), la, lb)).join('\n\n');
}

async function main() {
  const arg = (n, d) => {
    const i = process.argv.indexOf(n);
    return i === -1 ? d : process.argv[i + 1];
  };
  const has = (n) => process.argv.includes(n);
  if (has('--compare')) {
    const i = process.argv.indexOf('--compare');
    const [fa, fb] = [process.argv[i + 1], process.argv[i + 2]];
    const [ra, rb] = [readRows(fa), readRows(fb)];
    const seals = new Set([...ra, ...rb].map((r) => r.seal ?? 'none'));
    const current = readSealed(TASKS_DIR);
    if (seals.size !== 1 || !seals.has(current)) {
      console.error(`refusing to compare: every row must carry the seal in tasks/SEALED.md (${current}); found ${[...seals].join(', ')}`);
      process.exit(2);
    }
    console.log(report(ra, rb, path.basename(fa), path.basename(fb)));
    return;
  }
  const sha = assertSealed();
  const tasks = listTasks().slice(0, Number(arg('--limit', 1e9)));
  const repeat = Number(arg('--repeat', 1));
  if (has('--dry')) {
    console.log(`sealed ${sha}  ${tasks.length} tasks  (dry: scripted fake models through the real agent loop)`);
    const dist = path.resolve(arg('--dist', DEFAULT_DIST));
    const mk = (kind) => (task, dir) => runAgentArm({ task, dir, dist, callProvider: scriptedProvider(kind, task) });
    const nul = await runArm({ label: 'null', tasks, repeat, agent: mk('null') });
    const half = await runArm({ label: 'half', tasks, repeat, agent: mk('half') });
    const oracle = await runArm({ label: 'oracle', tasks, repeat, agent: mk('oracle') });
    const rate = (r) => (r.reduce((s, x) => s + x.pass, 0) / r.length).toFixed(3);
    console.log(`pass rate  null ${rate(nul)}  half ${rate(half)}  oracle ${rate(oracle)}\n`);
    console.log('== null -> oracle ==\n' + report(nul, oracle, 'null', 'oracle'));
    console.log('\n== half -> oracle ==\n' + report(half, oracle, 'half', 'oracle'));
    console.log('\n== oracle -> oracle (negative control) ==\n' + report(oracle, oracle, 'oracle', 'oracle'));
    return;
  }
  if (arg('--arm') !== 'agent') throw new Error('--arm agent (or --dry / --compare)');
  const label = arg('--label', 'agent');
  const dist = path.resolve(arg('--dist', DEFAULT_DIST));
  const cfg = envCfg();
  if (!cfg.model) throw new Error('set SEQUENCE_AI_MODEL (and SEQUENCE_AI_BASE_URL / SEQUENCE_AI_API_KEY) in the environment');
  console.log(`sealed ${sha}  arm ${label}  dist ${dist}  model ${cfg.model}`);
  const out = arg('--out', path.join(os.tmpdir(), `agent-ab-tasks-${label}.jsonl`));
  const rows = await runArm({ label, tasks, repeat, out, agent: (task, dir) => runAgentArm({ task, dir, dist, cfg }) });
  console.log(`pass ${rows.filter((r) => r.pass).length}/${rows.length}  rows -> ${out}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) await main();
