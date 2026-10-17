#!/usr/bin/env node
/**
 * Claims-audit 1.6 (V05): A/B for "short flows run top to bottom".
 *
 * The plan: render 40 sealed 2-3 step asks both ways at 440px, judge the pairs
 * by screenshot, and call top-to-bottom (TD) the winner only if it wins by more
 * than 2 standard errors. Otherwise the default stays left to right (LR).
 *
 *   node tools/bench/flow-direction-score.mjs layouts [--out DIR]
 *       Lays the 40 asks out both ways with the built analyzer
 *       (packages/analyzer/dist; run `pnpm -r build` first) and writes
 *       DIR/layouts.json: [{ id, steps, lr: BoardItem[], td: BoardItem[] }].
 *       Render each side at a 440px board width, screenshot, and judge.
 *
 *   node tools/bench/flow-direction-score.mjs score JUDGMENTS.json
 *       JUDGMENTS.json: [{ id, winner: "td" | "lr" | "tie" }] for every one of
 *       the 40 ids. Prints { n, tdWins, lrWins, ties, p, se, z, verdict }.
 *       p is TD's score (win 1, tie 0.5, loss 0); z = (p - 0.5) / se.
 *       verdict "td-wins" only when z > 2; "lr-stays" otherwise.
 *       Exit 0 whenever it scored; 2 for a malformed or incomplete file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const NOUNS = ['Request', 'Auth', 'Cache', 'Queue', 'Worker', 'Store', 'Parse', 'Plan', 'Review', 'Deploy', 'Index', 'Render', 'Ask', 'Answer', 'Retry', 'Log'];

/** 40 sealed asks, deterministic: 2 or 3 steps, labels drawn by a fixed LCG. Not tuned to either layout. */
export function sealedAsks(n = 40) {
  let seed = 20261012;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648);
  const asks = [];
  for (let i = 0; i < n; i++) {
    const steps = 2 + (i % 2);
    const labels = [];
    while (labels.length < steps) {
      const w = NOUNS[next() % NOUNS.length];
      if (!labels.includes(w)) labels.push(w);
    }
    asks.push({ id: `ask-${String(i + 1).padStart(2, '0')}`, steps, labels });
  }
  return asks;
}

export function score(judgments, ids) {
  const byId = new Map();
  for (const j of judgments) {
    if (!j || typeof j.id !== 'string' || !['td', 'lr', 'tie'].includes(j.winner)) throw new Error(`bad judgment: ${JSON.stringify(j)}`);
    if (byId.has(j.id)) throw new Error(`duplicate judgment for ${j.id}`);
    byId.set(j.id, j.winner);
  }
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) throw new Error(`missing judgments: ${missing.join(', ')}`);
  const xs = ids.map((id) => ({ td: 1, tie: 0.5, lr: 0 })[byId.get(id)]);
  const n = xs.length;
  const p = xs.reduce((a, b) => a + b, 0) / n;
  const variance = xs.reduce((a, x) => a + (x - p) ** 2, 0) / (n - 1);
  const se = Math.sqrt(variance / n);
  const z = se === 0 ? (p > 0.5 ? Infinity : p < 0.5 ? -Infinity : 0) : (p - 0.5) / se;
  return {
    n,
    tdWins: xs.filter((x) => x === 1).length,
    lrWins: xs.filter((x) => x === 0).length,
    ties: xs.filter((x) => x === 0.5).length,
    p,
    se,
    z,
    verdict: z > 2 ? 'td-wins' : 'lr-stays',
  };
}

async function layouts(outDir) {
  const tools = await import(pathToFileURL(path.join(root, 'packages/analyzer/dist/server/boardTools.js')).href);
  const out = [];
  for (const ask of sealedAsks()) {
    const calls = [
      ...ask.labels.map((t, i) => ['board.add_note', { id: `n${i}`, text: t, at: { x: 0, y: 0 } }]),
      ...ask.labels.slice(1).map((_, i) => ['board.connect', { id: `e${i}`, fromId: `n${i}`, toId: `n${i + 1}` }]),
    ];
    const run = (flowTopDown) => {
      const known = tools.withTurn({ nodeIds: [], items: [], ...(flowTopDown ? { flowTopDown: true } : {}) });
      let wire = [];
      for (const [name, args] of calls) {
        const r = tools.executeBoardTool(name, args, known);
        if (!r.ok) throw new Error(`${ask.id}: ${name} refused: ${r.reason}`);
        const drop = new Set(r.removeIds ?? []);
        known.items = known.items.filter((i) => !drop.has(i.id));
        wire = wire.filter((i) => !drop.has(i.id));
        for (const item of r.items) {
          known.items = [...known.items, 'at' in item ? { id: item.id, at: item.at } : { id: item.id }];
          wire.push(item);
        }
      }
      return wire;
    };
    out.push({ ...ask, lr: run(false), td: run(true) });
  }
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, 'layouts.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 1));
  console.log(`${out.length} asks laid out both ways -> ${file}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, arg] = process.argv.slice(2);
  try {
    if (cmd === 'layouts') {
      const i = process.argv.indexOf('--out');
      await layouts(i > 0 ? process.argv[i + 1] : path.join(root, 'tmp-shots', 'flow-direction'));
    } else if (cmd === 'score' && arg) {
      const res = score(JSON.parse(fs.readFileSync(arg, 'utf8')), sealedAsks().map((a) => a.id));
      console.log(JSON.stringify(res, null, 2));
    } else {
      console.error('usage: flow-direction-score.mjs layouts [--out DIR] | score JUDGMENTS.json');
      process.exit(2);
    }
  } catch (e) {
    console.error(String(e instanceof Error ? e.message : e));
    process.exit(2);
  }
}
