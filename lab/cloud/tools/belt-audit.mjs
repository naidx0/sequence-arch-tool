#!/usr/bin/env node
/*
 * BELT AUDIT — how much instruction does each kind of turn hand the model, and in what voice?
 *
 * The owner's standing thesis is "too many guardrails; small models run into walls". This makes
 * the belt a number instead of an impression: for each kind of turn it renders the instruction
 * belt the SHIPPED engine would assemble (`renderAskInstructionBelt` from the analyzer dist) and
 * reports its size and its voice — approximate tokens, hard-rule words (NEVER / MUST / DO NOT /
 * EXACTLY / ONLY), words in capitals, bullets, and the share of the model's context window the
 * belt alone takes at the context size the local profile runs (16k by default).
 *
 * It calls no model. Run after `pnpm -r build`:
 *   node tools/bench/belt-audit.mjs                 table
 *   node tools/bench/belt-audit.mjs --ctx 32768     against a different window
 *   node tools/bench/belt-audit.mjs --json
 *   node tools/bench/belt-audit.mjs --dump teach    print one belt in full
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/* The turns the owner actually sends, as the pipeline would see them. Each is the belt input only:
 * the question decides the intent classification, the flags decide the sections. */
export const TURNS = {
  teach: { question: 'teach me how this app works, draw it on the ai canvas', teach: true, permission: 'plan', surface: { id: 'ai-canvas' } },
  teachClassified: { question: 'teach me how the engine sends token requests to the model', permission: 'plan' },
  explain: { question: 'how does the engine call the model provider?', permission: 'plan' },
  draw: { question: 'draw the request flow on the ai canvas', permission: 'plan', surface: { id: 'ai-canvas' } },
  build: { question: 'add a retry to the provider client', permission: 'build' },
  plan: { question: '/plan add a memory system to the harness', permission: 'plan' },
  board: { question: 'show the architecture on the board', permission: 'plan', surface: { id: 'task-board' } },
};

const HARD = /\b(?:NEVER|MUST|DO NOT|EXACTLY|ONLY|ALWAYS|FORBIDDEN|BANNED|REFUSED)\b/g;

export function measure(text, ctxTokens) {
  const tokens = Math.round(text.length / 4);
  return {
    chars: text.length,
    approxTokens: tokens,
    ctxShare: ctxTokens ? Math.round((1000 * tokens) / ctxTokens) / 10 : null,
    hardRules: (text.match(HARD) || []).length,
    capsWords: (text.match(/\b[A-Z]{4,}\b/g) || []).length,
    bullets: (text.match(/^\s*- /gm) || []).length,
    sections: (text.match(/^--- .+ ---$/gm) || []).length,
  };
}

async function main(argv) {
  const ctxAt = argv.indexOf('--ctx');
  const ctx = ctxAt >= 0 ? Number(argv[ctxAt + 1]) : 16384;
  const dumpAt = argv.indexOf('--dump');
  const m = await import(pathToFileURL(join(ROOT, 'packages/analyzer/dist/server/askPipeline.js')).href);
  const base = { designMode: false, repoRoot: '/repo', jobMode: 'code' };
  if (dumpAt >= 0) {
    const t = TURNS[argv[dumpAt + 1]];
    if (!t) throw new Error(`unknown turn; one of ${Object.keys(TURNS).join(', ')}`);
    console.log(m.renderAskInstructionBelt({ ...base, ...t }));
    return;
  }
  const rows = Object.entries(TURNS).map(([k, t]) => ({ turn: k, ...measure(m.renderAskInstructionBelt({ ...base, ...t }), ctx) }));
  if (argv.includes('--json')) return console.log(JSON.stringify({ ctx, rows }, null, 2));
  const head = ['turn', 'chars', 'approxTokens', 'ctxShare', 'hardRules', 'capsWords', 'bullets', 'sections'];
  const w = head.map((h) => Math.max(h.length, ...rows.map((r) => String(r[h]).length)));
  console.log(`belt only (the base prompt, digest and question come on top), against a ${ctx}-token window`);
  console.log(head.map((h, i) => h.padEnd(w[i])).join('  '));
  for (const r of rows) console.log(head.map((h, i) => String(h === 'ctxShare' ? `${r[h]}%` : r[h]).padEnd(w[i])).join('  '));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main(process.argv.slice(2));
