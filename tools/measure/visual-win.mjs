#!/usr/bin/env node
/**
 * (lane components) What the visual kit saves an agent: output tokens of a from-scratch svg versus the tool call that
 * asks the kit for the same picture, and the time the kit takes to draw it.
 *
 *   node tools/measure/visual-win.mjs [--json out.json]
 *
 * Baselines are in tools/measure/visual-baselines/*.svg (hand-written the way an agent writes a one-off svg: coordinates
 * chosen by eye, attributes shared with <g>, no theming). Calls are in visual-specs.json (the data is the same on both
 * sides). Tokens: the repo's rule (chars / 4, agentMap.ts) and a stricter proxy that splits digits in groups of three and
 * counts every punctuation mark, which is nearer how a BPE vocabulary treats numeric svg and json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { renderVisual, helpVisual } = await import(path.join(HERE, '../../packages/schema/dist/visual/index.js'));
const specs = JSON.parse(fs.readFileSync(path.join(HERE, 'visual-specs.json'), 'utf8'));

const tok4 = (s) => Math.ceil(s.length / 4);
const tokProxy = (s) => (s.match(/\d{1,3}|[A-Za-z]+|\s+|[^\sA-Za-z\d]/g) ?? []).length;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
const ref = (id) => '```visual\n{"id":"' + id + '"}\n```';

/* What a first use of the tool costs besides the call: the help call the agent makes (output) and its answer (input), and the
   tool's reply naming the saved drawing (input). Counted at the same rate as output so the total is conservative-neutral. */
const MERMAID = { 'architecture flow': 'flow-gateway.mmd', 'sequence diagram': 'sequence-request.mmd' };
const reply = (id) => id + ' v1 "Title" saved (line, 440x260). Line chart "Title": 3 series, 12 points; peak 42 at Jun. To show it in the chat write this block:\n' + ref(id);
const rows = [];
for (const c of specs) {
  const base = fs.readFileSync(path.join(HERE, 'visual-baselines', c.baseline), 'utf8').trim();
  const toolCall = JSON.stringify(c.call);
  const viaTool = toolCall + '\n' + ref('d12');
  const viaFence = '```visual\n' + toolCall + '\n```';
  const times = [];
  let out;
  for (let i = 0; i < 60; i += 1) {
    const t = process.hrtime.bigint();
    out = renderVisual(c.call.component, c.call.spec, { title: c.call.title });
    times.push(Number(process.hrtime.bigint() - t) / 1e6);
  }
  const warm = times.slice(5);
  const helpCall = JSON.stringify({ help: c.call.component });
  const helpText = helpVisual(c.call.component);
  const firstUse = helpCall + '\n' + helpText + '\n' + toolCall + '\n' + reply('d12');
  const mmd = MERMAID[c.name] ? fs.readFileSync(path.join(HERE, 'visual-baselines', MERMAID[c.name]), 'utf8').trim() : null;
  rows.push({
    name: c.name,
    totalP: tokProxy(firstUse),
    total4: tok4(firstUse),
    mermaid4: mmd ? tok4('```mermaid\n' + mmd + '\n```') : null,
    mermaidP: mmd ? tokProxy('```mermaid\n' + mmd + '\n```') : null,
    outputOnlyP: tokProxy(toolCall),
    outputOnly4: tok4(toolCall),
    scratchChars: base.length,
    callChars: viaTool.length,
    fenceChars: viaFence.length,
    scratch4: tok4(base),
    tool4: tok4(viaTool),
    fence4: tok4(viaFence),
    scratchP: tokProxy(base),
    toolP: tokProxy(viaTool),
    fenceP: tokProxy(viaFence),
    renderMs: median(warm),
    kitSvgChars: out.svg.length,
  });
}
const red = (a, b) => Math.round((1 - b / a) * 100);
const lines = ['visual | scratch svg tok (c/4, proxy) | tool call+ref tok | fence tok | reduction (c/4, proxy) | render ms | kit svg chars'];
for (const r of rows) lines.push(`${r.name} | ${r.scratch4}, ${r.scratchP} | ${r.tool4}, ${r.toolP} | ${r.fence4}, ${r.fenceP} | -${red(r.scratch4, r.tool4)}%, -${red(r.scratchP, r.toolP)}% | ${r.renderMs.toFixed(2)} | ${r.kitSvgChars}`);
const m4 = median(rows.map((r) => red(r.scratch4, r.tool4)));
const mP = median(rows.map((r) => red(r.scratchP, r.toolP)));
const mF = median(rows.map((r) => red(r.scratchP, r.fenceP)));
lines.push(`median reduction, tool call + fence reference: ${m4}% (chars/4), ${mP}% (proxy); fence only: ${mF}% (proxy); median render ${median(rows.map((r) => r.renderMs)).toFixed(2)} ms`);
lines.push('');
lines.push('Honest views (proxy tokens). output = what the agent writes (tool call); first use = help call + help text + tool call + tool reply (mixed input and output, so a upper bound on cost).');
lines.push('visual | scratch svg | output only | first use incl. help+reply | saving output, first use | mermaid (flow, sequence only)');
for (const r of rows) lines.push(`${r.name} | ${r.scratchP} | ${r.toolP} (call+ref) | ${r.totalP} | -${red(r.scratchP, r.toolP)}%, ${r.totalP < r.scratchP ? '-' : '+'}${Math.abs(red(r.scratchP, r.totalP))}% | ${r.mermaidP === null ? '-' : `${r.mermaidP} (kit call alone ${r.outputOnlyP}, first use ${r.totalP}: ${r.totalP < r.mermaidP ? 'kit cheaper' : 'mermaid cheaper'})`}`);
const mTotal = median(rows.map((r) => red(r.scratchP, r.totalP)));
lines.push(`median saving, output only (call + reference): ${mP}%; median saving on the first use of a turn, counting help and reply: ${mTotal}%`);
console.log(lines.join('\n'));
const i = process.argv.indexOf('--json');
if (i > 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify({ rows, medianReductionChars4: m4, medianReductionProxy: mP, medianReductionFenceProxy: mF, medianFirstUseProxy: mTotal }, null, 2));
