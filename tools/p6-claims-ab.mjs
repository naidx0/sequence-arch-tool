#!/usr/bin/env node
/**
 * P6 Claims A/B — Lane B harness (Sequence MCP tools).
 *
 * Protocol: docs/research/v2-architecture-and-gaps.md §5.5
 *   Same repo. Same model. Ten questions.
 *   Lane A: Claude Code with grep+read (OWNER — not run here).
 *   Lane B: Claude Code with Sequence MCP — this script runs the MCP tools
 *           directly so Lane B tokens-to-answer are measured without a model.
 *
 * Status stays **UNVERIFIED** until the owner fills Lane A and compares.
 * No competitor bars. No socials numbers. Output is evidence for the A/B only.
 *
 * Usage (repo root, after `pnpm --filter @sequence/analyzer build`
 *        and `pnpm --filter @sequence/mcp build`):
 *   node tools/p6-claims-ab.mjs
 *   node tools/p6-claims-ab.mjs --repo packages/analyzer/test/fixtures/shopfront
 *   node tools/p6-claims-ab.mjs --json > /tmp/p6-lane-b.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');

/** ~4 chars/token — same convention as analyzer tokenBudget / agent-context-bench. */
function approxTokens(text) {
  return Math.ceil(String(text).length / 4);
}

/**
 * Ten questions shaped like §5.5. Names are stable symbols on THIS monorepo;
 * `--repo shopfront` remaps to fixture-friendly names below.
 */
export const MONOREPO_QUESTIONS = [
  { id: 'q1', kind: 'who_calls', prompt: 'who calls store.ts', tool: 'who_calls', args: { name: 'store.ts' } },
  { id: 'q2', kind: 'who_calls', prompt: 'who calls scanRepo', tool: 'who_calls', args: { name: 'scanRepo' } },
  { id: 'q3', kind: 'who_calls', prompt: 'who calls askPipeline', tool: 'who_calls', args: { name: 'askPipeline' } },
  { id: 'q4', kind: 'who_calls', prompt: 'who calls whoCallsTool', tool: 'who_calls', args: { name: 'whoCallsTool' } },
  {
    id: 'q5',
    kind: 'who_calls',
    prompt: 'what breaks if I change packages/schema/src/impact.ts',
    tool: 'who_calls',
    args: { name: 'packages/schema/src/impact.ts', depth: 2 },
  },
  {
    id: 'q6',
    kind: 'who_calls',
    prompt: 'what breaks if I change packages/analyzer/src/scan.ts',
    tool: 'who_calls',
    args: { name: 'packages/analyzer/src/scan.ts', depth: 2 },
  },
  {
    id: 'q7',
    kind: 'who_calls',
    prompt: 'what talks to datastores (who_calls postgres)',
    tool: 'who_calls',
    args: { name: 'postgres' },
  },
  {
    id: 'q8',
    kind: 'path_between',
    prompt: 'path between packages/web2 and packages/analyzer',
    tool: 'path_between',
    args: { from: 'packages/web2', to: 'packages/analyzer' },
  },
  {
    id: 'q9',
    kind: 'find_negatives',
    prompt: 'what talks to the database / negatives (find_negatives)',
    tool: 'find_negatives',
    args: { limit: 25 },
  },
  {
    id: 'q10',
    kind: 'who_calls',
    prompt: 'who calls createActivityClient',
    tool: 'who_calls',
    args: { name: 'createActivityClient' },
  },
];

/** Fixture remap when measuring against shopfront (CI-speed / cold demo). */
export const SHOPFRONT_QUESTIONS = [
  { id: 'q1', kind: 'who_calls', prompt: 'who calls orders', tool: 'who_calls', args: { name: 'orders' } },
  { id: 'q2', kind: 'who_calls', prompt: 'who calls gateway', tool: 'who_calls', args: { name: 'gateway' } },
  { id: 'q3', kind: 'who_calls', prompt: 'who calls payments', tool: 'who_calls', args: { name: 'payments' } },
  { id: 'q4', kind: 'who_calls', prompt: 'who calls shipping', tool: 'who_calls', args: { name: 'shipping' } },
  {
    id: 'q5',
    kind: 'who_calls',
    prompt: 'what breaks if I change orders/app/routes.py',
    tool: 'who_calls',
    args: { name: 'orders/app/routes.py', depth: 2 },
  },
  {
    id: 'q6',
    kind: 'who_calls',
    prompt: 'what breaks if I change gateway',
    tool: 'who_calls',
    args: { name: 'gateway', depth: 2 },
  },
  {
    id: 'q7',
    kind: 'who_calls',
    prompt: 'what talks to the database (who_calls postgres)',
    tool: 'who_calls',
    args: { name: 'postgres' },
  },
  {
    id: 'q8',
    kind: 'path_between',
    prompt: 'path between gateway and payments',
    tool: 'path_between',
    args: { from: 'gateway', to: 'payments' },
  },
  {
    id: 'q9',
    kind: 'find_negatives',
    prompt: 'find_negatives on shopfront',
    tool: 'find_negatives',
    args: { limit: 25 },
  },
  {
    id: 'q10',
    kind: 'who_calls',
    prompt: 'who calls invoices',
    tool: 'who_calls',
    args: { name: 'invoices' },
  },
];

function parseArgs(argv) {
  let repo = ROOT;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a === '--repo' && argv[i + 1]) {
      repo = path.resolve(argv[++i]);
    } else if (a === '--help' || a === '-h') {
      console.log(`Usage: node tools/p6-claims-ab.mjs [--repo <path>] [--json]
Lane B only. Status UNVERIFIED until owner fills Lane A (Claude Code + grep).`);
      process.exit(0);
    }
  }
  return { repo, json };
}

async function loadMcp() {
  const mcpJs = path.join(ROOT, 'packages/mcp/dist/index.js');
  if (!fs.existsSync(mcpJs)) {
    throw new Error(
      `missing ${mcpJs} — run: pnpm --filter @sequence/analyzer build && pnpm --filter @sequence/mcp build`,
    );
  }
  return import(pathToFileURL(mcpJs).href);
}

function questionsFor(repo) {
  const shopfront = path.join(ROOT, 'packages/analyzer/test/fixtures/shopfront');
  if (path.resolve(repo) === path.resolve(shopfront)) return SHOPFRONT_QUESTIONS;
  return MONOREPO_QUESTIONS;
}

export async function runLaneB(repoPath, mcp) {
  const questions = questionsFor(repoPath);
  const rows = [];
  for (const q of questions) {
    const started = performance.now();
    let result;
    if (q.tool === 'who_calls') {
      result = await mcp.whoCallsTool({ repoPath, ...q.args });
    } else if (q.tool === 'path_between') {
      result = await mcp.pathBetweenTool({ repoPath, ...q.args });
    } else if (q.tool === 'find_negatives') {
      result = await mcp.findNegativesTool({ repoPath, ...q.args });
    } else {
      throw new Error(`unknown tool ${q.tool}`);
    }
    const text = result.content?.map((c) => c.text).join('\n') ?? '';
    const ms = Math.round(performance.now() - started);
    rows.push({
      id: q.id,
      prompt: q.prompt,
      tool: q.tool,
      laneB: {
        ok: result.isError !== true,
        bytes: text.length,
        approxTokens: approxTokens(text),
        ms,
        preview: text.slice(0, 240),
        error: result.isError ? text.slice(0, 400) : undefined,
      },
      laneA: {
        status: 'PENDING_OWNER',
        note: 'Fill with Claude Code + grep/read: tokens-to-correct-answer + correctness.',
      },
    });
  }
  return {
    status: 'UNVERIFIED',
    protocol: 'docs/research/v2-architecture-and-gaps.md §5.5',
    measuredAt: new Date().toISOString(),
    repoPath,
    laneB: 'Sequence MCP tools (direct; no model)',
    laneA: 'Claude Code + grep/read — OWNER',
    note:
      'Do not publish competitor bars or socials numbers from this file. ' +
      'UNVERIFIED until Lane A is filled and compared.',
    questions: rows,
  };
}

async function main() {
  const { repo, json } = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(repo)) {
    console.error(`repo not found: ${repo}`);
    process.exit(1);
  }
  const mcp = await loadMcp();
  const report = await runLaneB(repo, mcp);
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    console.log(`P6 Claims A/B — Lane B only · status=${report.status}`);
    console.log(`repo: ${report.repoPath}`);
    console.log(`protocol: ${report.protocol}`);
    console.log('');
    for (const q of report.questions) {
      const b = q.laneB;
      const mark = b.ok ? 'ok' : 'ERR';
      console.log(
        `${q.id} [${mark}] ~${b.approxTokens} tok / ${b.bytes} B / ${b.ms} ms  ${q.prompt}`,
      );
      if (!b.ok) console.log(`     ${b.error}`);
    }
    console.log('');
    console.log('Lane A still PENDING_OWNER — run Claude Code with grep+read on the same prompts.');
    console.log('Keep claims off socials until both lanes are compared.');
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
