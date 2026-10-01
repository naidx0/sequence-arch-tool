#!/usr/bin/env node
/**
 * DRAW-LANGUAGE A/B — which way of writing a chart does a small model ground best?
 *
 * The GPU half of patch 0014 (the pure half is packages/schema/src/drawLanguages.ts).
 * Same questions, same scan slice, one language per arm:
 *
 *   json     propose_chart items/links, as shipped
 *   flow     patch 0011's flow lines
 *   mermaid  flowchart syntax
 *   dot      Graphviz
 *   path     point, don't generate: numbers into a numbered map of the slice
 *   ascii    the same numbers, into an indented box-and-arrow picture
 *   d2       a D2 subset: `"a" -> "b": what moves` (patch 0020)
 *   states   a Mermaid state diagram: `[*] --> a`, `a --> b : event` (patch 0020)
 *
 * ── RUN IT (live, on the card) ────────────────────────────────────────────
 *
 *   pnpm --filter @sequence/schema build          # once; the analyzer too for --repo
 *   SEQUENCE_GPU_LOCK=<your lock path> node tools/measure/draw-lang-ab.mjs \
 *     --repo <path/to/repo> --questions tools/measure/questions.shopfront.json \
 *     --runs 3 --out out/draw-lang-ab
 *
 *   --base-url  http://127.0.0.1:11434/v1 (Ollama; llama-server is :8080/v1)
 *   --model     minicpm5-hermes
 *   --scan      a scan.json (`node packages/analyzer/dist/cli.js scan <repo> --out scan.json`)
 *   --repo      or a repo: scanned here with the built analyzer, --no-cache, so
 *               nothing is written into the repo
 *   --questions [{id, question, focus: [paths], expectPath?: [paths] | [[paths], ...]}]
 *   --langs     json,flow,mermaid,dot,path,ascii,d2,states
 *   --runs 3  --max-tokens 400  --max-nodes 24  --timeout-s 180
 *   --no-stream  (default streams, to time the first token)
 *   --no-lock    (default: take the card lock, see below)
 *   --lock-wait-s 1800 --lock-poll-s 30
 *
 * ── THE CARD LOCK IS TAKEN PER LANGUAGE, AND RELEASED BETWEEN ─────────────
 *
 * Each language's batch runs as its own `tools/ci/gpu-lock.mjs run -- ...`, the
 * same pattern as tools/bench/night-window.mjs, so the lock file, the take and
 * release lines in gpu.lock.log, the dead-holder reaper and the signal-safe
 * release (patch 0005) are that script's and not re-implemented here. Between
 * batches the card is free, so the ML harness lane can slot in. A batch that
 * finds the card held waits (--lock-poll-s) and retries until --lock-wait-s,
 * then stops with exit 3; re-running resumes, because every call is appended
 * to raw.<lang>.jsonl as it lands and a finished (question, run) is skipped.
 * Scoring happens after the last batch, outside the lock: card-free work does
 * not hold the card.
 *
 * ── TWO CARD-FREE MODES (a stand-in model driven by hand) ─────────────────
 *
 *   --emit-prompts <dir>   write <qid>.<lang>.json = {system, user}: exactly the
 *                          messages live mode sends. No model call, no lock.
 *   --score-answers <dir>  read <qid>.<lang>.r<k>.txt answers, score them with
 *                          the same scorer, write results.jsonl + summary.md
 *                          (into --out, default <dir>).
 *
 * ── THE SCORE IS DETERMINISTIC ────────────────────────────────────────────
 *
 * parsed     the answer compiled in its language (a fenced block is scored
 *            when there is one; a <think> block is dropped)
 * grounded   validateChart passed against the scan: every part a scan node,
 *            every hop a scan edge
 * edges real share of drawn hops that are scan edges
 * hop cov    share of expectPath hops drawn, same direction (0 when unparsed)
 * out tok    usage.completion_tokens, else a word-and-punctuation count
 * ms / 1st   wall time and time to the first content token
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SELF = fileURLToPath(import.meta.url);

/* ------------------------------------------------------------------ args -- */

const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
};
const num = (name, dflt) => {
  const v = Number(flag(name, dflt));
  if (!Number.isFinite(v)) die(`--${name} must be a number`);
  return v;
};
function die(msg, code = 2) {
  console.error(`draw-lang-ab: ${msg}`);
  process.exit(code);
}
const log = (msg) => console.log(`draw-lang-ab: ${msg}`);

const ALL_LANGS = ['json', 'flow', 'mermaid', 'dot', 'path', 'ascii', 'd2', 'states'];
const opts = {
  baseUrl: String(flag('base-url', 'http://127.0.0.1:11434/v1')).replace(/\/+$/, ''),
  model: flag('model', 'minicpm5-hermes'),
  scan: flag('scan'),
  repo: flag('repo'),
  questions: flag('questions'),
  langs: String(flag('langs', ALL_LANGS.join(','))).split(',').map((s) => s.trim()).filter(Boolean),
  runs: Math.max(1, Math.floor(num('runs', 3))),
  out: flag('out'),
  lock: !has('no-lock'),
  maxTokens: Math.floor(num('max-tokens', 400)),
  maxNodes: Math.floor(num('max-nodes', 24)),
  stream: !has('no-stream'),
  timeoutMs: num('timeout-s', 180) * 1000,
  lockWaitMs: num('lock-wait-s', 1800) * 1000,
  lockPollMs: num('lock-poll-s', 30) * 1000,
  emitPrompts: flag('emit-prompts'),
  scoreAnswers: flag('score-answers'),
  worker: flag('worker'),
};
for (const l of opts.langs) if (!ALL_LANGS.includes(l)) die(`unknown language "${l}" (have ${ALL_LANGS.join(', ')})`);

/* ------------------------------------------------------------- the worker -- */
/*
 * The only code that runs INSIDE the lock: read the frozen plan, make this
 * language's calls, append each one as it lands. It needs nothing built.
 */
if (opts.worker !== undefined) {
  if (!opts.out) die('--worker needs --out');
  await runWorker(opts.worker, opts.out);
  /* Let fetch's sockets finish closing first: on Windows (Node 24) an exit while one is
     still closing trips a libuv assertion, and the batch reads as a crash (3221226505). */
  await new Promise((r) => setTimeout(r, 250));
  process.exit(0);
}

async function runWorker(lang, out) {
  const plan = JSON.parse(fs.readFileSync(path.join(out, 'plan.json'), 'utf8'));
  const rawFile = path.join(out, `raw.${lang}.jsonl`);
  const done = new Set(readJsonl(rawFile).filter((r) => r.error === undefined).map((r) => `${r.qid}#${r.run}`));
  const calls = plan.calls.filter((c) => c.lang === lang && !done.has(`${c.qid}#${c.run}`));
  log(`${lang}: ${calls.length} call(s) to make (${done.size} already on disk)`);
  for (const c of calls) {
    const r = await chat(plan, c);
    fs.appendFileSync(rawFile, `${JSON.stringify({ lang, qid: c.qid, run: c.run, ...r })}\n`);
    log(`${lang} ${c.qid} r${c.run}: ${r.error ?? `${r.ms} ms, ${r.usage?.completion_tokens ?? '?'} tok`}`);
  }
}

async function chat(plan, c) {
  const body = {
    model: plan.model,
    messages: [
      { role: 'system', content: c.system },
      { role: 'user', content: c.user },
    ],
    temperature: 0,
    max_tokens: plan.maxTokens,
    stream: plan.stream,
  };
  if (plan.stream) body.stream_options = { include_usage: true };
  const headers = { 'content-type': 'application/json' };
  const key = process.env.SEQUENCE_AI_API_KEY ?? process.env.OPENAI_API_KEY;
  if (key) headers.authorization = `Bearer ${key}`;
  const t0 = performance.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), plan.timeoutMs);
  try {
    const res = await fetch(`${plan.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) return { error: `HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`, ms: ms(t0) };
    if (!plan.stream) {
      const j = await res.json();
      return {
        content: j.choices?.[0]?.message?.content ?? '',
        finishReason: j.choices?.[0]?.finish_reason ?? null,
        usage: j.usage ?? null,
        ms: ms(t0),
        firstTokenMs: null,
      };
    }
    let content = '';
    let usage = null;
    let finishReason = null;
    let firstTokenMs = null;
    let buf = '';
    const dec = new TextDecoder();
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let j;
        try {
          j = JSON.parse(data);
        } catch {
          continue;
        }
        const d = j.choices?.[0]?.delta?.content;
        if (typeof d === 'string' && d !== '') {
          if (firstTokenMs === null) firstTokenMs = ms(t0);
          content += d;
        }
        if (j.choices?.[0]?.finish_reason) finishReason = j.choices[0].finish_reason;
        if (j.usage) usage = j.usage;
      }
    }
    return { content, finishReason, usage, ms: ms(t0), firstTokenMs };
  } catch (e) {
    return { error: e?.name === 'AbortError' ? `timeout after ${plan.timeoutMs} ms` : String(e?.message ?? e), ms: ms(t0) };
  } finally {
    clearTimeout(timer);
  }
}

function ms(t0) {
  return Math.round(performance.now() - t0);
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
}

/* ---------------------------------------------------------------- inputs -- */

const schemaFile = path.join(ROOT, 'packages', 'schema', 'dist', 'drawLanguages.js');
if (!fs.existsSync(schemaFile)) die('packages/schema is not built: run `pnpm --filter @sequence/schema build` first');
const D = await import(pathToFileURL(schemaFile).href);

if (!opts.questions) die('--questions <file.json> is required');
const questions = loadQuestions(opts.questions);

const outDir = path.resolve(opts.out ?? opts.scoreAnswers ?? opts.emitPrompts ?? path.join(ROOT, 'out', 'draw-lang-ab'));
fs.mkdirSync(outDir, { recursive: true });
const scan = loadScan();
const scanName = opts.scan ? path.basename(opts.scan) : path.basename(path.resolve(opts.repo));

function loadQuestions(file) {
  let q;
  try {
    q = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    die(`cannot read ${file}: ${e.message}`);
  }
  const list = Array.isArray(q) ? q : q.questions;
  if (!Array.isArray(list) || list.length === 0) die(`${file}: expected a list of questions`);
  const seen = new Set();
  for (const x of list) {
    if (typeof x?.id !== 'string' || !/^[\w-]+$/.test(x.id)) die(`${file}: every question needs an id of letters, digits, - or _`);
    if (seen.has(x.id)) die(`${file}: duplicate id ${x.id}`);
    seen.add(x.id);
    if (typeof x.question !== 'string' || x.question.trim() === '') die(`${file}: ${x.id} has no question`);
    if (!Array.isArray(x.focus) || x.focus.length === 0) die(`${file}: ${x.id} needs a focus list of paths`);
  }
  return list;
}

function loadScan() {
  let file = opts.scan;
  if (!file) {
    if (!opts.repo) die('give --scan <scan.json> or --repo <path>');
    const cli = path.join(ROOT, 'packages', 'analyzer', 'dist', 'cli.js');
    if (!fs.existsSync(cli)) {
      die(
        'the analyzer is not built, so --repo cannot scan. Build it (`pnpm -r build`) or pass --scan ' +
          'from `node packages/analyzer/dist/cli.js scan <repo> --out scan.json --no-cache`',
      );
    }
    file = path.join(outDir, 'scan.json');
    log(`scanning ${opts.repo} (card-free)`);
    const r = spawnSync(process.execPath, [cli, 'scan', path.resolve(opts.repo), '--out', file, '--no-cache'], {
      encoding: 'utf8',
    });
    if (r.status !== 0 || !fs.existsSync(file)) die(`scan failed:\n${r.stderr || r.stdout}`);
  }
  const g = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(g.nodes) || !Array.isArray(g.edges)) die(`${file} is not a scan (no nodes/edges)`);
  return g;
}

/** expectPath as chains: a list of paths is one chain, a list of lists is several. */
function chainsOf(q) {
  const e = q.expectPath;
  if (!Array.isArray(e) || e.length === 0) return [];
  return Array.isArray(e[0]) ? e : [e];
}

function hopCoverageOf(nodePairs, q) {
  const chains = chainsOf(q);
  let hops = 0;
  let hit = 0;
  for (const c of chains) {
    const cov = D.hopCoverage(scan, nodePairs, c);
    if (cov === undefined) continue;
    hops += c.length - 1;
    hit += cov * (c.length - 1);
  }
  return hops === 0 ? undefined : hit / hops;
}

/** Can a grounded answer cover the question at all? Said before any call is spent. */
function checkQuestions() {
  const resolve = D.scanResolver(scan);
  const edges = new Set(scan.edges.map((e) => `${e.srcId}>${e.dstId}`));
  const warnings = [];
  for (const q of questions) {
    const map = D.numberedMap(scan, q.focus, { maxNodes: opts.maxNodes });
    for (const m of map.missing) warnings.push(`${q.id}: focus "${m}" names no single node in the scan`);
    for (const chain of chainsOf(q)) {
      const ids = chain.map((p) => {
        const r = resolve(p);
        if (r === undefined || !('id' in r)) warnings.push(`${q.id}: expectPath "${p}" names no single node in the scan`);
        else if (map.numberOf(r.id) === undefined) warnings.push(`${q.id}: expectPath "${p}" is not on the ${opts.maxNodes}-part slice`);
        return r && 'id' in r ? r.id : undefined;
      });
      for (let k = 1; k < ids.length; k += 1) {
        if (ids[k - 1] && ids[k] && !edges.has(`${ids[k - 1]}>${ids[k]}`)) {
          warnings.push(`${q.id}: expected hop ${chain[k - 1]} -> ${chain[k]} is not a scan edge, so no grounded answer can draw it`);
        }
      }
    }
  }
  for (const w of warnings) console.error(`draw-lang-ab: CHECK — ${w}`);
  return warnings;
}

function promptsFor(q, lang) {
  return D.drawPrompt(lang, q.question, scan, q.focus, { maxNodes: opts.maxNodes });
}

/* --------------------------------------------------------------- scoring -- */

/**
 * The drawing inside an answer, by one rule for every language: drop any
 * <think> block; take the first fenced block when there is one; otherwise the
 * whole text minus one leading intro line that ends in a colon ("Here is the
 * path:"). Prose anywhere else stays in, and each language refuses it on its
 * line; JSON alone ignores text outside its outermost braces, because JSON is
 * delimited and every JSON consumer reads it that way.
 */
function extractDrawing(content) {
  const text = String(content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  const fence = /```[^\n]*\n([\s\S]*?)```/.exec(text);
  if (fence) return { text: fence[1], from: 'fence' };
  const intro = /^[^\n]*:[ \t]*\n/.exec(text);
  if (intro && !/[{}\[\]>|=]|->/.test(intro[0])) return { text: text.slice(intro[0].length), from: 'after-intro' };
  return { text, from: 'whole' };
}

function scoreOne(q, lang, content) {
  const p = promptsFor(q, lang);
  const { text, from } = extractDrawing(content);
  const head = { kind: 'data-flow', title: q.question.slice(0, 80) };
  const g = D.groundDrawing(lang, text, scan, { head, ...(p.map ? { map: p.map } : {}) });
  const cov = hopCoverageOf(g.nodePairs, q);
  return {
    parsed: g.parsed,
    grounded: g.grounded,
    problems: g.problems.length,
    firstProblems: g.problems.slice(0, 3),
    nodes: g.nodes,
    nodesGrounded: g.nodesGrounded,
    edges: g.edges,
    edgesGrounded: g.edgesGrounded,
    hopCoverage: cov === undefined ? null : g.parsed ? cov : 0,
    extracted: from,
  };
}

function score(records) {
  const byId = new Map(questions.map((q) => [q.id, q]));
  return records.map((r) => {
    const q = byId.get(r.qid);
    const base = { lang: r.lang, qid: r.qid, run: r.run };
    if (!q) return { ...base, error: `unknown question ${r.qid}` };
    const outTokens = r.usage?.completion_tokens ?? (r.content !== undefined ? D.roughTokens(r.content) : null);
    const outTokensFrom = r.usage?.completion_tokens !== undefined ? 'usage' : 'rough';
    const timing = { ms: r.ms ?? null, firstTokenMs: r.firstTokenMs ?? null, finishReason: r.finishReason ?? null };
    if (r.error !== undefined) {
      return { ...base, error: r.error, parsed: false, grounded: false, hopCoverage: chainsOf(q).length ? 0 : null, outTokens: null, outTokensFrom, ...timing };
    }
    return { ...base, ...scoreOne(q, r.lang, r.content), outTokens, outTokensFrom, ...timing };
  });
}

const mean = (xs) => (xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length);
const sd = (xs) => {
  if (xs.length < 2) return xs.length === 1 ? 0 : null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};
const median = (xs) => {
  const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (s.length === 0) return null;
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};
const pct = (x) => (x === null ? '—' : `${Math.round(x * 100)}%`);
const f2 = (x) => (x === null ? '—' : x.toFixed(2));
const f0 = (x) => (x === null ? '—' : String(Math.round(x)));
const pm = (xs, fmt) => (xs.length === 0 ? '—' : `${fmt(mean(xs))} ± ${fmt(sd(xs))}`);

function summarize(results, meta) {
  const langs = opts.langs.filter((l) => results.some((r) => r.lang === l));
  const lines = [];
  lines.push(`# Draw-language A/B: ${meta.model} on ${scanName}`);
  lines.push('');
  lines.push(
    `${questions.length} question(s) × ${langs.length} language(s), runs ${meta.runs}; ` +
      `max_tokens ${opts.maxTokens}, slice ${opts.maxNodes} parts, temperature 0. ${meta.mode}.`,
  );
  lines.push('');
  lines.push('| lang | n | parse rate | grounded rate | edges real | mean hop cov | median out tok | median ms | median 1st-tok ms |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const l of langs) {
    const rs = results.filter((r) => r.lang === l);
    const edges = rs.reduce((a, r) => a + (r.edges ?? 0), 0);
    const real = rs.reduce((a, r) => a + (r.edgesGrounded ?? 0), 0);
    const covs = rs.map((r) => r.hopCoverage).filter((x) => typeof x === 'number');
    lines.push(
      `| ${l} | ${rs.length} | ${pct(mean(rs.map((r) => (r.parsed ? 1 : 0))))} | ${pct(mean(rs.map((r) => (r.grounded ? 1 : 0))))} | ` +
        `${edges === 0 ? '—' : pct(real / edges)} | ${f2(mean(covs))} | ${f0(median(rs.map((r) => r.outTokens)))} | ` +
        `${f0(median(rs.map((r) => r.ms)))} | ${f0(median(rs.map((r) => r.firstTokenMs)))} |`,
    );
  }
  lines.push('');
  lines.push('Across runs (each run scored over all questions, then mean ± sample sd over runs):');
  lines.push('');
  lines.push('| lang | runs | n | parse | grounded | hop cov | out tok |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const l of langs) {
    const rs = results.filter((r) => r.lang === l);
    const runs = [...new Set(rs.map((r) => r.run))].sort((a, b) => a - b);
    const per = runs.map((k) => rs.filter((r) => r.run === k));
    const parse = per.map((x) => mean(x.map((r) => (r.parsed ? 1 : 0))));
    const grounded = per.map((x) => mean(x.map((r) => (r.grounded ? 1 : 0))));
    const cov = per.map((x) => mean(x.map((r) => r.hopCoverage).filter((v) => typeof v === 'number'))).filter((v) => v !== null);
    const tok = per.map((x) => mean(x.map((r) => r.outTokens).filter((v) => typeof v === 'number'))).filter((v) => v !== null);
    lines.push(
      `| ${l} | ${runs.length} | ${rs.length} | ${pm(parse, pct)} | ${pm(grounded, pct)} | ${pm(cov, f2)} | ${pm(tok, f0)} |`,
    );
  }
  lines.push('');
  lines.push('Grounded answers per question (of runs):');
  lines.push('');
  lines.push(`| question | ${langs.join(' | ')} |`);
  lines.push(`|---|${langs.map(() => '---').join('|')}|`);
  for (const q of questions) {
    const cells = langs.map((l) => {
      const rs = results.filter((r) => r.lang === l && r.qid === q.id);
      return rs.length === 0 ? '—' : `${rs.filter((r) => r.grounded).length}/${rs.length}`;
    });
    lines.push(`| ${q.id} | ${cells.join(' | ')} |`);
  }
  lines.push('');
  lines.push('Prompt sizes (word-and-punctuation count; view = mean over questions):');
  lines.push('');
  lines.push('| lang | instruction | view |');
  lines.push('|---|---|---|');
  for (const l of langs) {
    const views = questions.map((q) => D.roughTokens(promptsFor(q, l).view));
    lines.push(`| ${l} | ${D.roughTokens(D.instructionFor(l))} | ${f0(mean(views))} |`);
  }
  const froms = new Set(results.map((r) => r.outTokensFrom));
  lines.push('');
  lines.push(
    `Out tok: ${froms.has('rough') ? (froms.has('usage') ? 'usage where the server sent it, else ' : '') + 'a word-and-punctuation count (no usage field)' : "the server's usage.completion_tokens"}. ` +
      'Grounded = validateChart passed against the scan. Hop cov counts an unparsed answer as 0.',
  );
  if (meta.warnings.length > 0) {
    lines.push('');
    lines.push('Question checks:');
    lines.push('');
    for (const w of meta.warnings) lines.push(`- ${w}`);
  }
  const errors = results.filter((r) => r.error);
  if (errors.length > 0) {
    lines.push('');
    lines.push(`${errors.length} call(s) failed; they count as unparsed. First: ${errors[0].lang} ${errors[0].qid} r${errors[0].run}: ${errors[0].error}`);
  }
  return `${lines.join('\n')}\n`;
}

function writeResults(results, meta) {
  fs.writeFileSync(path.join(outDir, 'results.jsonl'), results.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const md = summarize(results, meta);
  fs.writeFileSync(path.join(outDir, 'summary.md'), md);
  console.log('');
  console.log(md);
  log(`wrote ${path.join(outDir, 'results.jsonl')} and summary.md`);
}

/* ----------------------------------------------------------------- modes -- */

const warnings = checkQuestions();

if (opts.emitPrompts !== undefined) {
  const dir = path.resolve(opts.emitPrompts);
  fs.mkdirSync(dir, { recursive: true });
  const manifest = { scan: scanName, maxNodes: opts.maxNodes, maxTokens: opts.maxTokens, langs: opts.langs, prompts: [], warnings };
  for (const q of questions) {
    for (const l of opts.langs) {
      const p = promptsFor(q, l);
      const file = `${q.id}.${l}.json`;
      fs.writeFileSync(path.join(dir, file), `${JSON.stringify({ system: p.system, user: p.user }, null, 2)}\n`);
      manifest.prompts.push({ file, qid: q.id, lang: l, systemTok: D.roughTokens(p.system), userTok: D.roughTokens(p.user) });
    }
  }
  fs.writeFileSync(path.join(dir, '_manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  log(`wrote ${manifest.prompts.length} prompt(s) to ${dir} (answers go in <qid>.<lang>.r<k>.txt)`);
  process.exit(0);
}

if (opts.scoreAnswers !== undefined) {
  const dir = path.resolve(opts.scoreAnswers);
  const re = new RegExp(`^([\\w-]+)\\.(${ALL_LANGS.join('|')})\\.r(\\d+)\\.txt$`);
  const records = [];
  for (const f of fs.readdirSync(dir).sort()) {
    const m = re.exec(f);
    if (!m || !opts.langs.includes(m[2])) continue;
    const [, qid, lang, run] = m;
    /* The prompt this answer was written to, when it sits beside it, must be
       the prompt this scorer rebuilds, or the map's numbers mean something else. */
    const pf = path.join(dir, `${qid}.${lang}.json`);
    const q = questions.find((x) => x.id === qid);
    if (q && fs.existsSync(pf)) {
      const emitted = JSON.parse(fs.readFileSync(pf, 'utf8'));
      if (emitted.user !== promptsFor(q, lang).user) {
        die(`${pf} is not the prompt this scan/questions/--max-nodes would send: score with the same inputs you emitted with`);
      }
    }
    records.push({ lang, qid, run: Number(run), content: fs.readFileSync(path.join(dir, f), 'utf8') });
  }
  if (records.length === 0) die(`no <qid>.<lang>.r<k>.txt answers in ${dir}`);
  const runs = Math.max(...records.map((r) => r.run));
  writeResults(score(records), { model: flag('model', 'answers on disk'), runs, mode: `Scored from ${records.length} answer file(s) in ${dir}`, warnings });
  process.exit(0);
}

/* live */
const plan = {
  model: opts.model,
  baseUrl: opts.baseUrl,
  maxTokens: opts.maxTokens,
  stream: opts.stream,
  timeoutMs: opts.timeoutMs,
  calls: [],
};
for (const l of opts.langs) {
  for (const q of questions) {
    const p = promptsFor(q, l);
    for (let k = 1; k <= opts.runs; k += 1) plan.calls.push({ lang: l, qid: q.id, run: k, system: p.system, user: p.user });
  }
}
fs.writeFileSync(path.join(outDir, 'plan.json'), `${JSON.stringify(plan, null, 1)}\n`);

const lockCli = path.join(ROOT, 'tools', 'ci', 'gpu-lock.mjs');
if (opts.lock && !process.env.SEQUENCE_GPU_LOCK) {
  die('the card lock is on and SEQUENCE_GPU_LOCK is not set. Set it to the machine\'s lock path, or pass --no-lock.');
}

const pending = (l) => {
  const done = new Set(readJsonl(path.join(outDir, `raw.${l}.jsonl`)).filter((r) => r.error === undefined).map((r) => `${r.qid}#${r.run}`));
  return plan.calls.filter((c) => c.lang === l && !done.has(`${c.qid}#${c.run}`)).length;
};

function runBatch(l) {
  const workerArgs = [SELF, '--worker', l, '--out', outDir];
  if (!opts.lock) {
    return new Promise((resolve) => {
      const p = spawn(process.execPath, workerArgs, { stdio: 'inherit' });
      p.on('exit', (code) => resolve(code ?? 1));
    });
  }
  return new Promise((resolve) => {
    const p = spawn(
      process.execPath,
      [lockCli, 'run', '--what', `draw-lang-ab ${l}: ${pending(l)} call(s) to ${opts.model}`, '--', process.execPath, ...workerArgs],
      { stdio: 'inherit', env: { ...process.env, SEQUENCE_AI_BASE_URL: opts.baseUrl } },
    );
    p.on('exit', (code) => resolve(code ?? 1));
  });
}

for (const l of opts.langs) {
  if (pending(l) === 0) {
    log(`${l}: every call already on disk — skipping`);
    continue;
  }
  const started = Date.now();
  for (;;) {
    log(`${l}: ${opts.lock ? 'taking the card' : 'no lock'} for ${pending(l)} call(s)`);
    const code = await runBatch(l);
    if (code === 0) break;
    if (code === 3 && opts.lock && Date.now() - started < opts.lockWaitMs) {
      log(`${l}: the card is held — waiting ${opts.lockPollMs / 1000}s (up to ${Math.round(opts.lockWaitMs / 1000)}s)`);
      await new Promise((r) => setTimeout(r, opts.lockPollMs));
      continue;
    }
    if (code === 3) die(`${l}: the card stayed held for ${Math.round(opts.lockWaitMs / 1000)}s. Re-run to resume; finished calls are kept.`, 3);
    die(`${l}: the batch exited ${code}. Re-run to resume; finished calls are kept.`, 1);
  }
  log(`${l}: done — card released`);
}

const raw = opts.langs.flatMap((l) => {
  /* The last record per (question, run) wins, so a retried failure counts once. */
  const last = new Map();
  for (const r of readJsonl(path.join(outDir, `raw.${l}.jsonl`))) last.set(`${r.qid}#${r.run}`, r);
  return [...last.values()].filter((r) => r.run <= opts.runs && questions.some((q) => q.id === r.qid));
});
writeResults(score(raw), {
  model: opts.model,
  runs: opts.runs,
  mode: `Live against ${opts.baseUrl}${opts.stream ? ', streamed' : ''}${opts.lock ? ', card lock per language' : ', no lock'}`,
  warnings,
});
