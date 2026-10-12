#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   DOES THE SYSTEM MAKE A WEAK MODEL BEHAVE?
   tools/bench/weak-model.mjs

   THE QUESTION THIS ASKS IS NOT WHICH MODEL IS SMARTER. That comparison is
   already settled and measuring it again teaches nobody anything: a 7B model
   run locally will write a worse security review than a frontier model, every
   time, and a benchmark that reported the score would be a benchmark about
   model weights rather than about this product.

   The question worth money is the other one. Sequence's entire claim is that
   it keeps an answer honest — coverage on every reply, a lie detector over the
   two closed worlds it can check, a graph that refuses an ungrounded node. If
   those hold, a weak model is USABLE here in a way it is not in a plain chat
   box, and that is a product claim rather than a model claim.

   So this runs one genuinely hard task and reports what the SYSTEM caught,
   not what the model said.

   ── WHAT IT MEASURES ─────────────────────────────────────────────────────

     coverage      how much of the graph reached the answer, and what did not
     claims        fabrications the lie detector flagged, with what the scan
                   actually holds
     tools         which tools it reached for, and which were REFUSED
     topology      whether it proposed architecture, and whether that proposal
                   survived the evidence rule

   A refusal is a GOOD result here. `propose_topology` rejecting a node that
   carried `evidenceRef` is the guardrail doing its job on a model that tried
   to dress a guess as a finding, and it is exactly what a frontier model would
   not have needed.

   ── RUNNING IT ───────────────────────────────────────────────────────────

     node tools/bench/weak-model.mjs --model granite4-hermes:latest
     node tools/bench/weak-model.mjs --model granite4-hermes:latest --repo ../shop

   It needs a local OpenAI-compatible server (`--base-url`, default Ollama).
   NO KEY AND NO NETWORK — which is the point: the same non-negotiable the
   product ships under.

   IT IS A MEASUREMENT, NOT A GATE. It always exits 0 unless it could not run
   at all, because "the weak model scored badly" is the expected result and a
   red CI job for it would be noise.
   ══════════════════════════════════════════════════════════════════════════ */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = path.join(ROOT, 'packages', 'analyzer', 'dist', 'cli.js');

/**
 * The task, and it is deliberately one nobody can bluff.
 *
 * Two things at once, both of which need REAL structure to answer: where the
 * edges of this system are, and what already runs. A model that has not read
 * the repository can only answer it with generic advice, and generic advice
 * about a system it has not seen is precisely what the coverage line and the
 * claim checker exist to expose.
 */
const TASK =
  'Add a layer of cyber security and a CI/CD pipeline to this project. ' +
  'Name the exact services and files you would change, and say which entry ' +
  'points are currently unprotected. Do not describe generic best practice — ' +
  'answer about THIS repository.';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const model = arg('model', null);
const baseUrl = arg('base-url', 'http://127.0.0.1:11434/v1');
const repo = path.resolve(arg('repo', ROOT));
const task = arg('task', TASK);
const timeoutMs = Number(arg('timeout', '600000'));

if (!model) {
  console.error('usage: node tools/bench/weak-model.mjs --model <id> [--base-url <url>] [--repo <dir>]');
  console.error('  e.g. --model granite4-hermes:latest');
  process.exit(2);
}
if (!fs.existsSync(CLI)) {
  console.error(`build first — missing ${path.relative(ROOT, CLI)}`);
  process.exit(2);
}

/*
 * A THROWAWAY HOME, so the run cannot read or write the operator's own
 * provider configuration. A benchmark that quietly repointed somebody's editor
 * at a 7B model would be a benchmark nobody runs twice.
 */
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-bench-'));
fs.mkdirSync(path.join(home, '.sequence'), { recursive: true });
fs.writeFileSync(
  path.join(home, '.sequence', 'ai.json'),
  JSON.stringify({ provider: 'openai-compatible', baseUrl, model, apiKey: 'local' }, null, 2),
);

console.log(`\n  task    ${task.slice(0, 72)}…`);
console.log(`  model   ${model}  (${baseUrl})`);
console.log(`  repo    ${path.relative(process.cwd(), repo) || '.'}`);
console.log('  running…\n');

const child = spawn(
  process.execPath,
  [CLI, 'ask', task, '--repo', repo, '--output-format', 'stream-json', '--quiet'],
  { env: { ...process.env, HOME: home, USERPROFILE: home }, stdio: ['ignore', 'pipe', 'pipe'] },
);

let out = '';
let err = '';
child.stdout.on('data', (b) => { out += b.toString(); });
child.stderr.on('data', (b) => { err += b.toString(); });

const kill = setTimeout(() => {
  console.error(`  gave up after ${Math.round(timeoutMs / 1000)}s`);
  child.kill('SIGKILL');
}, timeoutMs);

child.on('exit', (code) => {
  clearTimeout(kill);
  fs.rmSync(home, { recursive: true, force: true });

  /* One event per line; anything else on stdout is the plain answer, which the
     CLI also prints. */
  const events = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line.startsWith('{')) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      /* not an event */
    }
  }

  const result = events.find((e) => e.type === 'result');
  const failure = events.find((e) => e.type === 'error');

  if (!result && !failure) {
    console.error(`  the run produced no result (exit ${code}).`);
    console.error(err.split(/\r?\n/).slice(-8).join('\n'));
    process.exit(2);
  }

  console.log('  ── WHAT THE SYSTEM CAUGHT ' + '─'.repeat(46));

  if (failure) {
    console.log(`\n  the turn ENDED IN WORDS, which is the third non-negotiable:`);
    console.log(`    ${failure.error}`);
    if (failure.fix) console.log(`    and it named its fix: ${failure.fix}`);
  }

  /* ── coverage ────────────────────────────────────────────────────────── */
  const cov = result?.coverage;
  if (cov) {
    const missed = cov.packagesMissed ?? [];
    console.log(`\n  COVERAGE   ${cov.edgesSeen}/${cov.edgesTotal} edges reached the answer`);
    console.log(
      missed.length === 0
        ? '             every component contributed'
        : `             ${missed.length} contributed nothing: ${missed.slice(0, 6).join(', ')}`,
    );
    console.log('             (Codex and Claude Code structurally cannot report this)');
  } else {
    console.log('\n  COVERAGE   not reported');
  }

  /* ── the lie detector ────────────────────────────────────────────────── */
  /*
   * `AskClaimCheck` IS A REPORT, NOT A LIST, and reading it as one is the
   * mistake this block made first: two named finding kinds plus a `checked`
   * pair saying WHICH checks actually ran.
   *
   * That last part is the honest half and it is why the shape is not a bare
   * array — "an empty finding list from a check that could not run is not a
   * clean bill of health". A repository whose datastore engine is unknown gets
   * no technology check at all, and reporting zero findings there as zero
   * fabrications would be the benchmark telling the exact lie the checker
   * exists to catch.
   */
  const check = result?.claims;
  const tech = check?.unsupportedTechnologies ?? [];
  const paths = check?.unknownPaths ?? [];
  console.log(`\n  CLAIMS     ${tech.length + paths.length} flagged by the lie detector`);
  for (const t of tech.slice(0, 6)) {
    console.log(`             ✗ named "${t.term}" — the scan found ${t.found.length > 0 ? t.found.join(', ') : 'nothing of the kind'}`);
    console.log(`               "${String(t.quote).slice(0, 84)}"`);
  }
  for (const u of paths.slice(0, 6)) {
    console.log(`             ✗ cited ${u.path} — no such file in the scan`);
  }
  if (!check) {
    console.log('             the checker did not report');
  } else if (tech.length + paths.length === 0) {
    console.log('             nothing it said contradicted what the scan holds');
  }
  if (check) {
    /* WHICH CHECKS RAN, always — see above. */
    const ran = [
      `datastore engines ${check.checked?.datastores ? 'checked' : 'NOT CHECKED (no engine is known here)'}`,
      `cited paths ${check.checked?.files ? 'checked' : 'NOT CHECKED'}`,
    ];
    console.log(`             ${ran.join(' · ')}`);
  }

  /* ── the tool belt, and what it refused ──────────────────────────────── */
  const tools = events.filter((e) => e.type === 'tool:done');
  const refused = tools.filter((t) => /refused/i.test(String(t.evidence ?? '')));
  console.log(`\n  TOOLS      ${tools.length} calls, ${refused.length} REFUSED`);
  for (const t of tools.slice(0, 10)) {
    console.log(`             ${/refused/i.test(String(t.evidence ?? '')) ? '✗' : '·'} ${t.name ?? '?'}: ${String(t.evidence ?? '').slice(0, 88)}`);
  }
  if (refused.length > 0) {
    console.log('             A REFUSAL IS A GOOD RESULT: the guardrail held on a model that');
    console.log('             tried something a stronger one would not have needed to be stopped from.');
  }

  /* ── architecture it proposed ────────────────────────────────────────── */
  const topo = events.filter((e) => e.type === 'topology:proposal');
  console.log(`\n  TOPOLOGY   ${topo.length} proposal(s) reached the board`);
  for (const t of topo) {
    console.log(`             ${t.nodes.length} nodes, ${t.edges.length} edges — ${t.title ?? 'untitled'}`);
    /* The rule the whole feature stands on. */
    const withEvidence = t.nodes.filter((n) => 'evidenceRef' in n);
    console.log(
      withEvidence.length === 0
        ? '             none of them claimed evidence, which is what makes it a proposal'
        : `             ${withEvidence.length} CLAIMED EVIDENCE — the client strips it, but the server should have refused`,
    );
  }

  /* ── cost ────────────────────────────────────────────────────────────── */
  const usage = result?.usage;
  if (usage) {
    console.log(
      `\n  SPENT      ${usage.inputTokens} in, ${usage.outputTokens} out` +
        `${usage.estimated ? ' (estimated)' : ''} — locally, so nothing was billed`,
    );
  }

  console.log('\n  ── THE ANSWER ' + '─'.repeat(58));
  console.log(
    (result?.text ?? '')
      .split('\n')
      .slice(0, 24)
      .map((l) => `  ${l}`)
      .join('\n'),
  );

  console.log(
    '\n  Read the top half, not the bottom. The answer is what the model produced;\n' +
      '  everything above it is what this product knew about that answer.\n',
  );

  /* A measurement, not a gate — "the weak model scored badly" is the expected
     result and a red job for it would be noise. */
  process.exit(0);
});
