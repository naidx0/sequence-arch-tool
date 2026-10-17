#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   THE AGENT, DRIVEN AGAINST A REAL MODEL
   tools/agent-live/run.mjs

   Owner, 2026-09-22: "debug and do bug testing on our agentic frameworks to
   make sure they all work and are in place so that we dont have to double and
   triple check manually."

   ── WHY THIS EXISTS: EVERY OTHER CHECK HERE CALLS NO MODEL ────────────────

   The unit suites prove the agent loop's LOGIC with scripted providers. The
   QA loop (`tools/qa-loop`) drives the scanner over real repositories and says
   in its own header that it "calls no model" and that its AI tier "does not
   exist yet". So nothing in this repository ever asked the shipped agent a
   question and checked that an answer came back.

   That is the gap a real fault walked straight through. `isDesignShortPathAsk`
   clamped a question about a real repository to the two-round budget written
   for having nothing to read, because the question mentioned a board. Every
   unit test was green; the owner asked the same question four times and got
   `32.4k in · 0 out` — no answer at all. A scripted provider answers whatever
   the test tells it to, so no unit test could have seen that. Only a real
   model spending its real rounds could.

   ── WHAT IT CHECKS ────────────────────────────────────────────────────────

   Each question in the battery names the failure it exists to catch. For every
   turn it records, and asserts against:

     answered      the turn ended with prose, not with the "I have not written
                   an answer" stop copy — the 0-out fault
     out > 0       the provider produced output tokens, when usage is reported
     no error      no `error` event on the stream
     no repeat     no tool called twice in a row with the same evidence — the
                   loop that spends a round learning nothing
     in budget     finished inside the per-turn wall clock

   ── WHAT IT DOES NOT PRETEND ──────────────────────────────────────────────

   It does not grade whether an answer is GOOD. That needs a judge, and a judge
   built from the same small model would be marking its own homework. This
   checks the things a harness can know for certain: an answer arrived, it was
   not a refusal to answer, and the loop did not stall on itself getting there.

   NO MODEL IS A SKIP, AND A SKIP IS NOT A PASS. If the configured endpoint does
   not answer, this exits 2 and says so. A green that meant "there was nothing
   to test" is exactly the kind of result that let the clamp fault through.

   Usage
     node tools/agent-live/run.mjs --repo <path>          boot an engine on it
     node tools/agent-live/run.mjs --base http://127.0.0.1:<port>   use one
     pnpm agent:live -- --repo <path>

   Flags
     --repo <path>     repository to ask about (booted with the built CLI)
     --base <url>      an engine that is already running; skips the boot
     --only <id,id>    run only these battery ids
     --budget <sec>    per-turn wall clock (default 240 — a local model is slow)
     --json <file>     also write the full report here

   Exit codes
     0  every turn passed
     1  at least one turn failed an assertion
     2  skipped — no model answered, so nothing was tested
   ══════════════════════════════════════════════════════════════════════════ */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const CLI = path.join(ROOT, 'packages', 'analyzer', 'dist', 'cli.js');

/* ── the battery ─────────────────────────────────────────────────────────── */

/**
 * Each question carries the failure it guards, so a red row says what broke
 * rather than only that something did.
 *
 * Questions are phrased about whatever repository is attached, so the battery
 * runs on any project rather than being pinned to one fixture.
 */
export const BATTERY = [
  {
    id: 'plain',
    guards: 'the loop answers an ordinary question at all',
    question: 'In two or three sentences, what does this project do?',
  },
  {
    id: 'lookup',
    guards: 'a question that needs a tool call reaches an answer after it',
    /*
     * THE ANSWER MUST NOT ALREADY BE IN THE PROMPT. The first version asked
     * "what are the main services", and the model answered it correctly with
     * no tool call at all — because the ask prompt already ships an
     * orientation index of the architecture. That is the right behaviour, and
     * the harness failed it. The instrument was wrong, not the agent.
     *
     * A file's literal contents are not in the digest, so quoting one needs a
     * read. `expectTool` can only mean something on a question like this.
     */
    question: 'Open the README and quote its first heading exactly as written.',
    expectTool: true,
  },
  {
    id: 'bare-draw',
    guards: 'the short path still completes a bare drawing request',
    question: 'Draw a diagram of the main services on the board.',
    /* A bare drawing may legitimately answer with the drawing and little
       prose, which is what the short path is for. It must not ERROR or
       stall; it need not write paragraphs. */
    allowDrawingOnly: true,
  },
  {
    id: 'compound',
    guards:
      'a compound ask that mentions the board is not clamped to the no-repository budget (the 0-out fault)',
    /* The owner's own sentence, verbatim and misspelled, from the transcript
       that exposed the clamp. The wording is the finding: a paraphrase would
       be a different question and might not trip the same guess. */
    question:
      'walk through the whole surface of this feature, porpse your changes make them, ' +
      'show me on the arch board - the whole logic, back end of the working system and ' +
      'how it interacts with all of the information and supplementals, also on the ' +
      'arch board dive deepr and exaplin the main srervice and what it shows',
  },
  {
    id: 'arch-add',
    guards:
      'a request to ADD to the board lands a proposal — photo 3, 2026-09-22: three calls and two ' +
      'whole-proposal refusals to place one box, then a tool fence printed to the reader',
    /* Bastion turn 17, verbatim. */
    question:
      'on the arch baord i wnat to add a new program which is a local worksapce like harness where ' +
      'its your ai powered local lab that can control evertyhing local lab related, spin up a  ' +
      'coding harness workfllow, spin up your agents, local models, work on your inference locally, ' +
      'let you store information, see sessions, manage everything from one dashboard, research ' +
      'thigns etc show me how this archecture could look like internally on the idea and then the ' +
      'output and style of how that could look like on the arch board in fact make the skeleton for ' +
      'the whole thing including projected files with comments in them about what they should contain',
    expectDraw: true,
  },
  {
    id: 'plan',
    guards:
      '/plan produces its parts — goal and steps, the plan document, a before-and-after, the ' +
      'expected effect — scored as a rate, never as pass or fail (docs/OWNER-WALK-2026-09-22.md)',
    question:
      '/plan add a memory system to this project so the assistant remembers past sessions, and ' +
      'show how the system works before and after',
    body: { permission: 'plan' },
    scorePlan: true,
  },
  {
    id: 'teach-flow',
    guards:
      'the owner\'s teaching prompt, in his real state (Plan chat, Teach toggle off, AI Canvas open), ' +
      'reads the repository and lands a drawing on the AI canvas — docs/teaching-flow-plan.md, the live baseline',
    /* Verbatim. Whether the answer explains the root flow is read from the log
       by a person; the harness checks that the first prompt carried the
       gathered evidence, that something landed, and that the chart's steps are
       hops of the gathered traces.

       NO `expectTool` (2026-09-23). The fourth measurement: it failed 6/6,
       "expected at least one tool call and made none", once the harness did
       the research before the first call. That measured the model's tool
       count, not the turn. */
    question:
      'Teach me how this app works at the root: how the engine sends AI token requests to the model, ' +
      'how the harness and the gates fit around it, and what the UI does. I know nothing about it yet. ' +
      'Draw on the ai canvas the visual breakdown to teach me about the elements within the app.',
    body: { permission: 'plan', surface: { id: 'ai-canvas' } },
    expectEvidence: true,
    expectFlowOnTrace: true,
    expectDraw: true,
  },
];

/**
 * WHICH PARTS OF A PLAN APPEARED. Guidance, not gates: this is reported, and a
 * plan missing a part still passes. The wording of the guidance is what moves
 * when a part never appears.
 */
export function planParts(rec) {
  return {
    steps: rec.tools.some((t) => t.name === 'write_plan'),
    document: rec.planBlocks.includes('markdown'),
    beforeAfter: rec.planBlocks.includes('mermaid'),
    effect: rec.planCharts > 0,
  };
}

/** The copy the pipeline writes when it stops without answering. */
const NO_ANSWER =
  /have not written an answer|ran out|was still looking things up|hit its time budget|rather than guess/i;

/* ── args ────────────────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const out = { budget: 240 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--repo') out.repo = next();
    else if (a === '--base') out.base = next();
    else if (a === '--only') out.only = next().split(',');
    else if (a === '--budget') out.budget = Number(next());
    else if (a === '--json') out.json = next();
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

/* ── the engine ──────────────────────────────────────────────────────────── */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort() {
  const net = await import('node:net');
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

async function bootEngine(repo) {
  if (!fs.existsSync(CLI)) {
    throw new Error(`the CLI is not built at ${CLI} — run the analyzer build first`);
  }
  const port = await freePort();
  const child = spawn(process.execPath, [CLI, 'serve', '--repo', repo, '--port', String(port)], {
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${base}/api/status`);
      if (r.ok) return { base, stop: () => child.kill() };
    } catch {
      /* not up yet */
    }
    await wait(1000);
  }
  child.kill();
  throw new Error('the engine did not answer /api/status within 90s');
}

/* ── the model preflight ─────────────────────────────────────────────────── */

/**
 * Does the configured model answer? Read from the engine rather than from
 * `~/.sequence/ai.json` directly, so this tests the provider the ENGINE will
 * actually use and not a file it might be reading differently.
 */
async function modelAnswers(base) {
  let cfg;
  try {
    cfg = await fetch(`${base}/api/ai-config`).then((r) => r.json());
  } catch (e) {
    return { ok: false, why: `could not read /api/ai-config: ${String(e).slice(0, 80)}` };
  }
  const baseUrl = cfg?.baseUrl ?? cfg?.profile?.baseUrl;
  const model = cfg?.model ?? cfg?.profile?.model ?? '(unnamed)';
  if (!baseUrl) {
    return { ok: cfg?.configured === true, model, why: cfg?.configured ? '' : 'no provider configured' };
  }
  try {
    const r = await fetch(`${String(baseUrl).replace(/\/$/, '')}/models`, {
      signal: AbortSignal.timeout(5000),
    });
    return r.ok
      ? { ok: true, model, baseUrl }
      : { ok: false, model, baseUrl, why: `${baseUrl}/models answered ${r.status}` };
  } catch {
    return { ok: false, model, baseUrl, why: `nothing answered at ${baseUrl}` };
  }
}

/* ── one turn ────────────────────────────────────────────────────────────── */

/** Read an SSE response into events, tolerating `data:` lines split across chunks. */
async function* sseEvents(res) {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let cut;
    while ((cut = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, cut);
      buf = buf.slice(cut + 2);
      const data = block
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (!data) continue;
      try {
        yield JSON.parse(data);
      } catch {
        /* a keepalive or a non-JSON frame is not an event */
      }
    }
  }
}

async function runTurn(base, item, budgetSec) {
  const started = Date.now();
  const rec = {
    id: item.id,
    guards: item.guards,
    ms: 0,
    text: '',
    /* Every delta the reader watched arrive, joined (2026-09-22). */
    streamed: '',
    in: null,
    out: null,
    tools: [],
    errors: [],
    drew: false,
    /* A drawing the HARNESS made — the teach floor's chart, the plot floor —
       outside any model tool call. Kept apart from `drew` so a run says who
       drew. The board seed at turn start is neither (see `modelDrew`). */
    harnessDrew: false,
    /* The stream reached its `result` (or `error`). r3 of the 2026-09-22
       baseline ended on a bare `tool:start` and was printed PASS. */
    ended: false,
    timedOut: false,
    /* Characters of the model's thinking that reached the wire (2026-09-22). */
    thought: 0,
    /* Block types and charts that landed on the Plan tab (a /plan turn). */
    planBlocks: [],
    planCharts: 0,
    /* Tool results that began "refused:" — each is a wall the model hit. */
    refusals: [],
    /* What the harness handed the first prompt, off the result (2026-09-23). */
    evidence: null,
    /* The last landed chart's steps as `from>to` (2026-09-23). */
    chartSteps: [],
  };

  const ctl = new AbortController();
  const timer = setTimeout(() => {
    rec.timedOut = true;
    ctl.abort();
  }, budgetSec * 1000);

  try {
    const res = await fetch(`${base}/api/ask/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: item.question, ...(item.body ?? {}) }),
      signal: ctl.signal,
    });
    if (!res.ok || !res.body) {
      rec.errors.push(`HTTP ${res.status}`);
    } else {
      let streamed = '';
      const drawn = drawingLedger();
      for await (const ev of sseEvents(res)) {
        drawn.see(ev);
        seeTraceEvent(rec, ev);
        switch (ev.type) {
          case 'delta':
            streamed += ev.text ?? '';
            break;
          case 'result':
            rec.text = typeof ev.text === 'string' ? ev.text : streamed;
            rec.ended = true;
            break;
          case 'usage':
            rec.in = ev.inputTokens ?? rec.in;
            rec.out = ev.outputTokens ?? rec.out;
            break;
          case 'tool:start':
            rec.tools.push({ name: ev.name ?? '?', evidence: ev.evidence ?? '' });
            break;
          case 'tool:done':
            if (typeof ev.evidence === 'string' && /^refused:/.test(ev.evidence)) {
              rec.refusals.push(ev.evidence.slice(0, 200));
            }
            break;
          case 'reasoning':
            rec.thought += typeof ev.text === 'string' ? ev.text.length : 0;
            break;
          case 'topology:proposal':
          case 'board:item':
          case 'canvas:block':
          case 'chart:proposal':
            if (ev.surface === 'plan') {
              if (ev.type === 'canvas:block') rec.planBlocks.push(ev.blockType);
              if (ev.type === 'chart:proposal') rec.planCharts += 1;
            }
            break;
          case 'error':
            rec.errors.push(String(ev.message ?? ev.error ?? 'error').slice(0, 160));
            rec.ended = true;
            break;
          default:
            break;
        }
      }
      rec.streamed = streamed;
      rec.drew = drawn.model;
      rec.harnessDrew = drawn.harness;
      if (!rec.ended && !rec.timedOut) rec.errors.push('stream closed without result or error');
      if (!rec.text) rec.text = streamed;
    }
  } catch (e) {
    if (!rec.timedOut) rec.errors.push(String(e).slice(0, 160));
  } finally {
    clearTimeout(timer);
  }

  rec.ms = Date.now() - started;
  return judge(rec, item);
}

/* ── the verdict ─────────────────────────────────────────────────────────── */

/**
 * Two consecutive calls to the same tool with the same evidence.
 *
 * The stream does not carry a tool's ARGUMENTS, only its name and a one-line
 * evidence string, so "same evidence" is the closest honest proxy for "same
 * call". It can miss a repeat whose evidence differs cosmetically; it cannot
 * report one that did not happen. Named here so a green row is read for what
 * it measured.
 */
export function repeatedCall(tools) {
  for (let i = 1; i < tools.length; i += 1) {
    const a = tools[i - 1];
    const b = tools[i];
    /*
     * EMPTY EVIDENCE PROVES NOTHING. `tool:start` often carries no evidence
     * line — `search_files` does not — so two DIFFERENT searches both read as
     * `""`, and "same name, same evidence" called them a repeat. The first live
     * run flagged exactly that: two searches with, as far as the stream can
     * say, nothing in common but their name, reported as a loop.
     *
     * A repeat is only shown when there is evidence to compare. With none, the
     * harness cannot tell a loop from progress, and it says nothing rather
     * than guess — the same rule it applies to the model.
     */
    if (!a.evidence || !b.evidence) continue;
    if (a.name === b.name && a.evidence === b.evidence) return `${b.name} (${b.evidence})`;
  }
  return null;
}

/*
 * THE HARNESS'S OWN ONE-LINE NOTES ARE NOT AN ANSWER. Found live on
 * 2026-09-22: the compound question's whole text was "(Nothing was drawn this
 * turn …)" and the judge passed it, because it looked for the stop copy and
 * found words. A text that is only these lines answered nothing.
 */
const HARNESS_NOTE_LINE =
  /^\((?:Nothing was (?:drawn|put)[^)]*|No chart was drawn[^)]*)\)$|^Note: no file (?:was changed|change was staged)[^\n]*$/gm;

/**
 * WHO DREW. On 2026-09-22 the baseline's run r3 landed nothing — its one
 * `propose_chart` began and the stream died — and the battery printed
 * "PASS … drew", because the harness places one seed box per service at the
 * start of every turn (`askPipeline.ts`, THE AUTO SEED) and any `board:item`
 * set `drew`. A drawing counts for the MODEL only inside one of its own
 * drawing tool calls, and only when that call was not refused; a drawing
 * outside any tool call is the harness's (floor, forced-round note), unless
 * it is the seed. Pure over the event stream so the judge test can feed it.
 */
const DRAWING_TOOL = /^(propose_chart|propose_topology|canvas\.)/;
const HARNESS_ITEM = /^(seed:|plot-floor)/;
export function drawingLedger() {
  let open = null;
  let pending = false;
  const ledger = {
    model: false,
    harness: false,
    see(ev) {
      switch (ev.type) {
        case 'tool:start':
          open = DRAWING_TOOL.test(ev.name ?? '') ? ev.name : null;
          pending = false;
          break;
        case 'tool:done':
          if (pending && !(typeof ev.evidence === 'string' && /^refused:/.test(ev.evidence))) ledger.model = true;
          open = null;
          pending = false;
          break;
        case 'topology:proposal':
        case 'board:item':
        case 'canvas:block':
        case 'chart:proposal': {
          /* The engine's shape: `{ type: 'board:item', items: [{ id, … }] }`. */
          const ids = ev.type === 'board:item' ? (ev.items ?? []).map((it) => it?.id ?? '') : [];
          if (ids.length && ids.every((id) => HARNESS_ITEM.test(String(id)))) break;
          if (open) pending = true;
          else ledger.harness = true;
          break;
        }
        default:
          break;
      }
    },
  };
  return ledger;
}

/*
 * WHAT THE TURN WAS HANDED, AND WHAT IT DREW ON IT (2026-09-23). The stream does
 * not carry the prompt, so the engine says on the `result` what evidence the
 * first prompt carried — its length, its files, and every traced hop as
 * `from>to` — and the landed chart's steps are compared to those hops. Pure over
 * one event so the judge test can feed it.
 */
export function seeTraceEvent(rec, ev) {
  if (ev.type === 'result' && ev.evidence && typeof ev.evidence === 'object') rec.evidence = ev.evidence;
  const steps = ev.type === 'chart:proposal' ? ev.chart?.steps : undefined;
  if (Array.isArray(steps) && steps.length > 0) rec.chartSteps = steps.map((s) => `${s.from}>${s.to}`);
}

export function modelDrew(events) {
  const ledger = drawingLedger();
  for (const ev of events) ledger.see(ev);
  return ledger.model;
}

export function judge(rec, item) {
  const fails = [];
  /* Either hand's drawing satisfies "something landed"; the report says whose. */
  const landed = rec.drew || rec.harnessDrew === true;
  const text = rec.text.replace(HARNESS_NOTE_LINE, '').trim();
  const stoppedWithoutAnswer = NO_ANSWER.test(text);

  if (rec.timedOut) fails.push(`did not finish inside the budget`);
  if (rec.errors.length) fails.push(`stream error: ${rec.errors[0]}`);

  if (item.allowDrawingOnly && landed) {
    /* A bare drawing that drew is the short path working. */
  } else if (!text) {
    fails.push('no answer text at all');
  } else if (stoppedWithoutAnswer) {
    fails.push('stopped without answering ("have not written an answer")');
  }

  if (rec.out === 0 && !(item.allowDrawingOnly && landed)) {
    fails.push('provider reported 0 output tokens');
  }

  const repeat = repeatedCall(rec.tools);
  if (repeat) fails.push(`repeated an identical tool call back to back: ${repeat}`);

  if (item.expectTool && rec.tools.length === 0) {
    fails.push('expected at least one tool call and made none');
  }

  if (item.expectDraw && !landed) {
    fails.push('asked for the board and nothing landed');
  }

  if (item.expectEvidence && !(rec.evidence?.chars > 0)) {
    fails.push('the first prompt did not carry the gathered evidence');
  }

  if (item.expectFlowOnTrace) {
    const hops = new Set(rec.evidence?.hops ?? []);
    const steps = rec.chartSteps ?? [];
    const off = steps.find((s) => !hops.has(s));
    if (steps.length === 0) fails.push('no landed chart has steps to check against the gathered traces');
    else if (off !== undefined) fails.push(`the landed chart step ${off} is not a hop of the gathered traces`);
  }

  /* Photo 3: the fragment "sequence-tool )" was printed to the reader. */
  if (/sequence-tool/.test(text)) {
    fails.push('a tool fence reached the reader');
  }

  /* The re-measure's r1 (2026-09-22): the result was the model's planning,
     ending on a think close tag, and its deltas had streamed the tool fences
     and that tag to the chat while the final text looked like prose. The
     reader sees the stream too, so the stream is judged as well as the result. */
  if (/<\/?think>/.test(text)) {
    fails.push("the model's thinking reached the reader as the answer");
  }
  if (typeof rec.streamed === 'string') {
    if (/sequence-tool/.test(rec.streamed)) fails.push('a tool fence streamed to the reader');
    if (/<\/?think>/.test(rec.streamed)) fails.push("the model's thinking streamed to the reader");
  }

  return { ...rec, fails, pass: fails.length === 0 };
}

/* ── main ────────────────────────────────────────────────────────────────── */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.repo && !args.base)) {
    console.log('usage: node tools/agent-live/run.mjs --repo <path> | --base <url> [--only a,b] [--budget sec] [--json file]');
    process.exit(args.help ? 0 : 64);
  }

  let engine = null;
  let base = args.base;
  if (!base) {
    console.log(`booting the engine on ${args.repo} ...`);
    engine = await bootEngine(args.repo);
    base = engine.base;
  }

  try {
    const model = await modelAnswers(base);
    console.log(`model: ${model.model ?? '?'}  ${model.baseUrl ?? ''}`);
    if (!model.ok) {
      /* NOT A PASS. A green that meant "nothing was tested" is the exact
         shape of result that let the clamp fault reach the owner. */
      console.log(`\nSKIPPED — ${model.why}. Nothing was tested; start the model and run again.`);
      process.exitCode = 2;
      return;
    }

    const battery = args.only ? BATTERY.filter((b) => args.only.includes(b.id)) : BATTERY;
    const results = [];
    for (const item of battery) {
      process.stdout.write(`\n[${item.id}] ${item.guards}\n  asking ... `);
      const r = await runTurn(base, item, args.budget);
      results.push(r);
      const toks = r.out === null ? 'usage not reported' : `${r.in ?? '?'} in / ${r.out} out`;
      console.log(
        `${r.pass ? 'PASS' : 'FAIL'}  ${(r.ms / 1000).toFixed(1)}s  ${toks}  tools=${r.tools.length}` +
          `${r.drew ? '  drew' : r.harnessDrew ? '  harness-drew' : ''}  thought=${r.thought ?? 0}  refused=${r.refusals?.length ?? 0}`,
      );
      if (item.scorePlan) {
        const parts = planParts(r);
        const have = Object.entries(parts).filter(([, v]) => v).map(([k]) => k);
        console.log(`    plan parts ${have.length}/4: ${have.join(', ') || 'none'}`);
      }
      for (const f of r.fails) console.log(`    - ${f}`);
      if (r.text) console.log(`    "${r.text.replace(/\s+/g, ' ').slice(0, 140)}${r.text.length > 140 ? '…' : ''}"`);
    }

    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} turns passed`);
    if (args.json) {
      fs.writeFileSync(args.json, JSON.stringify({ at: new Date().toISOString(), model, results }, null, 2));
      console.log(`report: ${args.json}`);
    }
    process.exitCode = failed.length ? 1 : 0;
  } finally {
    engine?.stop();
  }
}

/* Run only when invoked, so the judge can be imported and tested on its own —
   a harness that is never shown to FAIL is not evidence of anything. */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`agent-live: ${String(e?.stack ?? e).slice(0, 400)}`);
    process.exitCode = 1;
  });
}
