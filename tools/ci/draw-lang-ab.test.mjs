import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';

import { startFakeOpenAI } from '../measure/fake-openai.mjs';

/**
 * THE DRAW-LANGUAGE A/B DRIVER, END TO END, WITH NO CARD (patch 0014).
 *
 * A fake OpenAI-compatible server stands in for the small model and answers
 * the way one does: mostly right, sometimes an arrow backwards, sometimes
 * prose, sometimes wrapped in a fence. Its answers are written the honest way,
 * by READING THE PROMPT it was sent (the numbered map for the pointing
 * languages, the code list for the rest), so a prompt the driver builds wrong
 * shows up as a wrong score here.
 *
 * The card lock is real: tools/ci/gpu-lock.mjs, pointed at a temporary lock
 * directory through SEQUENCE_GPU_LOCK, exactly as gpu-lock-log.test.mjs does.
 * The cases check that every model call happens while the lock is held, that
 * it is taken and released once per language, and that a card held by another
 * lane is waited for rather than overridden.
 *
 * Set DRAW_AB_KEEP=<dir> to keep the live run's output (summary.md) there.
 */
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DRIVER = path.join(ROOT, 'tools', 'measure', 'draw-lang-ab.mjs');
const SCAN = path.join(ROOT, 'tools', 'measure', 'fixtures', 'shopfront.scan.json');
const QUESTIONS = path.join(ROOT, 'tools', 'measure', 'questions.shopfront.json');
const QS = JSON.parse(fs.readFileSync(QUESTIONS, 'utf8')).questions;
const LANGS = ['json', 'flow', 'mermaid', 'dot', 'path', 'ascii', 'd2', 'states'];
const BUILT = fs.existsSync(path.join(ROOT, 'packages', 'schema', 'dist', 'drawLanguages.js'));

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draw-ab-'));
  return { dir, lock: path.join(dir, 'lock', 'gpu.lock'), log: path.join(dir, 'lock', 'gpu.lock.log'), out: path.join(dir, 'out') };
}

function runDriver(args, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [DRIVER, ...args], {
      env: { ...process.env, SEQUENCE_GPU_LANE: 'drawab', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    p.stdout.on('data', (c) => (out += c));
    p.stderr.on('data', (c) => (out += c));
    p.on('exit', (code) => resolve({ code, out }));
  });
}

/* ---- the stand-in model ---- */

const langOf = (system) =>
  system.startsWith('You are shown a numbered map') ? 'path'
    : system.startsWith('You are shown a numbered picture') ? 'ascii'
      : system.includes('as JSON only') ? 'json'
        : system.includes('as flow lines only') ? 'flow'
          : system.includes('as a D2 diagram only') ? 'd2'
          : system.includes('Mermaid state diagram') ? 'states'
          : system.includes('Mermaid') ? 'mermaid'
            : system.includes('Graphviz') ? 'dot'
              : undefined;

const chainsOf = (q) => (Array.isArray(q.expectPath[0]) ? q.expectPath : [q.expectPath]);

/** Every hop the question expects, as [from, to] display names. */
const hopsOf = (q) => chainsOf(q).flatMap((c) => c.slice(1).map((to, i) => [c[i], to]));

/** Read the numbers off the picture the prompt carried, as a model would. */
function numbersIn(user, lang) {
  const n = new Map();
  const re = lang === 'path' ? /^(\d+) (\S+)/gm : /\[(\d+) ([^\]]+)\]/g;
  for (const m of user.matchAll(re)) n.set(m[2], Number(m[1]));
  return n;
}

function write(lang, hops, user, wrap) {
  const parts = [...new Set(hops.flat())];
  const id = (p) => `p${parts.indexOf(p)}`;
  let text;
  switch (lang) {
    case 'json':
      text = JSON.stringify({
        items: parts.map((p) => ({ id: id(p), label: p.split('/').pop(), nodeId: p })),
        links: hops.map(([a, z]) => ({ from: id(a), to: id(z), label: 'calls' })),
      });
      break;
    case 'flow':
      text = [...parts.map((p) => `${id(p)} = ${p}`), ...hops.map(([a, z]) => `${id(a)} -> ${id(z)}: calls | ${a} calls ${z}`)].join('\n');
      break;
    case 'mermaid':
      text = ['flowchart LR', ...hops.map(([a, z]) => `  ${id(a)}[${a}] -->|calls| ${id(z)}[${z}]`)].join('\n');
      break;
    case 'dot':
      text = ['digraph G {', ...hops.map(([a, z]) => `  "${a}" -> "${z}" [label="calls"];`), '}'].join('\n');
      break;
    case 'd2':
      text = hops.map(([a, z]) => `"${a}" -> "${z}": calls`).join('\n');
      break;
    case 'states':
      text = [
        'stateDiagram-v2',
        ...parts.map((p) => `  state "${p}" as ${id(p)}`),
        `  [*] --> ${id(hops[0][0])}`,
        ...hops.map(([a, z]) => `  ${id(a)} --> ${id(z)} : calls`),
        `  ${id(hops[hops.length - 1][1])} --> [*]`,
      ].join('\n');
      break;
    default: {
      const n = numbersIn(user, lang);
      text = hops.map(([a, z]) => `${n.get(a)} > ${n.get(z)} | ${a.split('/').pop()} calls ${z.split('/').pop()}`).join('\n');
    }
  }
  return wrap ? `Here is the drawing:\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\nEach arrow is a call.` : text;
}

/**
 * The canned behaviour, by language, question and run: right by default, and
 * wrong in the specific ways small models are wrong.
 */
function cannedAnswer(lang, q, run, user) {
  const hops = hopsOf(q);
  const flip = ([a, z]) => [z, a];
  if (lang === 'json' && q.id === 'order-event') return write(lang, hops.map(flip), user); /* backwards: ungrounded */
  if (lang === 'flow' && q.id === 'stock-check') return 'The orders service asks the inventory client, which calls the inventory server.'; /* prose */
  if (lang === 'mermaid' && (q.id === 'get-order' || q.id === 'invoice-read')) {
    return write(lang, [...hops.slice(0, -1), flip(hops[hops.length - 1])], user); /* last arrow backwards */
  }
  if (lang === 'dot') return write(lang, hops, user, true); /* right, inside a fence and prose */
  if (lang === 'path' && run === 2 && q.id === 'charge-payment') return write(lang, [hops[0], [hops[0][0], hops[2][1]]], user); /* a skipped hop */
  if (lang === 'ascii' && run === 1) return write(lang, hops.slice(0, 1), user); /* stops after one hop */
  return write(lang, hops, user);
}

function standInModel({ lockFile, seen } = {}) {
  const count = new Map();
  return ({ system, user }) => {
    const lang = langOf(system);
    const q = QS.find((x) => user.startsWith(x.question));
    if (lang === undefined || q === undefined) throw new Error('the stand-in cannot read this prompt');
    const key = `${lang}#${q.id}`;
    const run = (count.get(key) ?? 0) + 1;
    count.set(key, run);
    if (seen) seen.push({ lang, qid: q.id, locked: lockFile ? fs.existsSync(lockFile) : null, lockText: lockFile && fs.existsSync(lockFile) ? fs.readFileSync(lockFile, 'utf8') : '' });
    return cannedAnswer(lang, q, run, user);
  };
}

const readJsonl = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

/* ---- cases ---- */

test('live: every call runs under the card lock, taken and released once per language, and scores what came back', { skip: !BUILT && 'schema not built' }, async () => {
  const s = sandbox();
  const seen = [];
  const fake = await startFakeOpenAI(standInModel({ lockFile: s.lock, seen }));
  try {
    const { code, out } = await runDriver(
      ['--base-url', fake.baseUrl, '--model', 'stand-in', '--scan', SCAN, '--questions', QUESTIONS, '--runs', '2', '--out', s.out, '--lock-poll-s', '0.2'],
      { SEQUENCE_GPU_LOCK: s.lock },
    );
    assert.equal(code, 0, out);
    const calls = QS.length * LANGS.length * 2;
    assert.equal(fake.calls.length, calls);
    /* Every call made while THIS lane held the card. */
    assert.ok(seen.every((x) => x.locked && /lane=drawab /.test(x.lockText)), 'a call ran without the lock');
    for (const l of LANGS) assert.ok(seen.filter((x) => x.lang === l).every((x) => x.lockText.includes(`draw-lang-ab ${l}:`)));
    /* One take and one release per language, alternating: the card is free between batches. */
    const log = fs.readFileSync(s.log, 'utf8').trim().split('\n');
    assert.equal(log.length, LANGS.length * 2, log.join('\n'));
    log.forEach((line, i) => assert.ok(i % 2 === 0 ? line.startsWith('lane=drawab ') : line.startsWith('released lane=drawab '), line));
    assert.ok(!fs.existsSync(s.lock), 'the lock outlived the run');
    /* The request shape: plain chat completion, temperature 0, capped, streamed. */
    const b = fake.calls[0].body;
    assert.equal(b.temperature, 0);
    assert.equal(b.max_tokens, 400);
    assert.equal(b.stream, true);
    assert.equal(b.model, 'stand-in');
    assert.deepEqual(b.messages.map((m) => m.role), ['system', 'user']);

    const rows = readJsonl(path.join(s.out, 'results.jsonl'));
    assert.equal(rows.length, calls);
    const row = (l, q, r) => rows.find((x) => x.lang === l && x.qid === q && x.run === r);
    assert.equal(row('json', 'get-order', 1).grounded, true);
    assert.equal(row('json', 'get-order', 1).hopCoverage, 1);
    assert.equal(row('json', 'order-event', 1).grounded, false);
    assert.equal(row('json', 'order-event', 1).parsed, true);
    assert.equal(row('json', 'order-event', 1).hopCoverage, 0);
    assert.equal(row('flow', 'stock-check', 1).parsed, false);
    assert.equal(row('flow', 'stock-check', 1).hopCoverage, 0);
    assert.equal(row('mermaid', 'get-order', 1).hopCoverage, 0.75);
    assert.match(row('mermaid', 'get-order', 1).firstProblems[0], /^line \d+ \(.+\): no edge ds:postgres -> file:orders\/app\/db\.py.*The scan has file:orders\/app\/db\.py -> ds:postgres/);
    assert.equal(row('dot', 'who-calls-payments', 2).extracted, 'fence');
    assert.equal(row('dot', 'who-calls-payments', 2).grounded, true);
    assert.equal(row('dot', 'who-calls-payments', 2).hopCoverage, 1);
    assert.equal(row('path', 'charge-payment', 1).grounded, true);
    assert.equal(row('path', 'charge-payment', 2).grounded, false);
    assert.equal(row('ascii', 'get-order', 1).hopCoverage, 0.25);
    assert.equal(row('ascii', 'get-order', 2).hopCoverage, 1);
    for (const r of rows) {
      assert.equal(r.outTokensFrom, 'usage');
      assert.ok(r.outTokens > 0 && r.ms >= 0 && r.firstTokenMs >= 0, JSON.stringify(r));
    }

    const md = fs.readFileSync(path.join(s.out, 'summary.md'), 'utf8');
    assert.match(md, /^\| lang \| n \| parse rate \| grounded rate \| edges real \| mean hop cov \| median out tok \| median ms \| median 1st-tok ms \|$/m);
    assert.match(md, /^\| json \| 14 \| 100% \| 86% \|/m);
    assert.match(md, /^\| flow \| 14 \| 86% \| 86% \|/m);
    assert.match(md, /^\| dot \| 14 \| 100% \| 100% \| 100% \| 1\.00 \|/m);
    assert.match(md, /^\| ascii \| 2 \| 14 \| 100% ± 0% \| 100% ± 0% \| 0\.68 ± 0\.45 \|/m);
    if (process.env.DRAW_AB_KEEP) fs.cpSync(s.out, process.env.DRAW_AB_KEEP, { recursive: true });

    /* Re-running resumes: nothing is asked twice. */
    const again = await runDriver(
      ['--base-url', fake.baseUrl, '--scan', SCAN, '--questions', QUESTIONS, '--runs', '2', '--out', s.out],
      { SEQUENCE_GPU_LOCK: s.lock },
    );
    assert.equal(again.code, 0, again.out);
    assert.equal(fake.calls.length, calls);
    assert.match(again.out, /json: every call already on disk — skipping/);
  } finally {
    await fake.close();
  }
});

test('live: a card held by another lane is waited for, never overridden', { skip: !BUILT && 'schema not built' }, async () => {
  const s = sandbox();
  fs.mkdirSync(path.dirname(s.lock), { recursive: true });
  /* born=unknown: the reaper cannot decide this holder, so `run` must refuse it. */
  fs.writeFileSync(s.lock, 'lane=mlharness since=2026-09-23T00:00:00Z pid=1 born=unknown what=training\n');
  const seen = [];
  const fake = await startFakeOpenAI(standInModel({ lockFile: s.lock, seen }));
  try {
    const run = runDriver(
      ['--base-url', fake.baseUrl, '--scan', SCAN, '--questions', QUESTIONS, '--langs', 'path', '--runs', '1', '--out', s.out, '--lock-poll-s', '0.2', '--lock-wait-s', '30'],
      { SEQUENCE_GPU_LOCK: s.lock },
    );
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(fake.calls.length, 0, 'called the model while another lane held the card');
    assert.match(fs.readFileSync(s.lock, 'utf8'), /lane=mlharness/, 'the other lane\'s lock was touched');
    fs.rmSync(s.lock);
    const { code, out } = await run;
    assert.equal(code, 0, out);
    assert.match(out, /path: the card is held — waiting/);
    assert.equal(fake.calls.length, QS.length);
    assert.ok(seen.every((x) => /lane=drawab /.test(x.lockText)));
  } finally {
    await fake.close();
  }

  /* And a card that stays held stops the run with the lock's own exit code. */
  const t = sandbox();
  fs.mkdirSync(path.dirname(t.lock), { recursive: true });
  fs.writeFileSync(t.lock, 'lane=mlharness since=2026-09-23T00:00:00Z pid=1 born=unknown what=training\n');
  const stuck = await runDriver(
    ['--base-url', 'http://127.0.0.1:9/v1', '--scan', SCAN, '--questions', QUESTIONS, '--langs', 'flow', '--out', t.out, '--lock-poll-s', '0.1', '--lock-wait-s', '0.5'],
    { SEQUENCE_GPU_LOCK: t.lock },
  );
  assert.equal(stuck.code, 3, stuck.out);
  assert.match(stuck.out, /flow: the card stayed held/);
  assert.match(fs.readFileSync(t.lock, 'utf8'), /lane=mlharness/);
});

test('live: the lock is on by default and refuses to run without a lock path', { skip: !BUILT && 'schema not built' }, async () => {
  const s = sandbox();
  const env = { ...process.env };
  delete env.SEQUENCE_GPU_LOCK;
  const r = await new Promise((resolve) => {
    const p = spawn(process.execPath, [DRIVER, '--scan', SCAN, '--questions', QUESTIONS, '--out', s.out], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (c) => (out += c));
    p.stderr.on('data', (c) => (out += c));
    p.on('exit', (code) => resolve({ code, out }));
  });
  assert.equal(r.code, 2);
  assert.match(r.out, /SEQUENCE_GPU_LOCK is not set/);
});

test('--emit-prompts writes exactly the messages live mode sends, and takes no lock', { skip: !BUILT && 'schema not built' }, async () => {
  const s = sandbox();
  const dir = path.join(s.dir, 'prompts');
  const { code, out } = await runDriver(['--scan', SCAN, '--questions', QUESTIONS, '--emit-prompts', dir], { SEQUENCE_GPU_LOCK: s.lock });
  assert.equal(code, 0, out);
  assert.doesNotMatch(out, /CHECK/, 'every shopfront expectPath hop is a real, on-slice scan edge');
  const files = fs.readdirSync(dir).filter((f) => !f.startsWith('_'));
  assert.equal(files.length, QS.length * LANGS.length);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, '_manifest.json'), 'utf8')).langs, LANGS);
  assert.ok(!fs.existsSync(s.log), 'emitting prompts touched the card lock');

  const fake = await startFakeOpenAI(standInModel());
  try {
    const live = await runDriver(['--base-url', fake.baseUrl, '--scan', SCAN, '--questions', QUESTIONS, '--runs', '1', '--no-lock', '--no-stream', '--out', s.out]);
    assert.equal(live.code, 0, live.out);
    for (const c of fake.calls) {
      const lang = langOf(c.system);
      const q = QS.find((x) => c.user.startsWith(x.question));
      const emitted = JSON.parse(fs.readFileSync(path.join(dir, `${q.id}.${lang}.json`), 'utf8'));
      assert.deepEqual(emitted, { system: c.system, user: c.user });
    }
    assert.equal(fake.calls[0].body.stream, false);
  } finally {
    await fake.close();
  }
});

test('--score-answers scores answer files with the same scorer: mean ± sd over runs, n, rough tokens', { skip: !BUILT && 'schema not built' }, async () => {
  const s = sandbox();
  const dir = path.join(s.dir, 'answers');
  const e = await runDriver(['--scan', SCAN, '--questions', QUESTIONS, '--emit-prompts', dir]);
  assert.equal(e.code, 0, e.out);
  for (const q of QS) {
    for (const l of ['path', 'json']) {
      const { user } = JSON.parse(fs.readFileSync(path.join(dir, `${q.id}.${l}.json`), 'utf8'));
      for (const run of [1, 2, 3]) fs.writeFileSync(path.join(dir, `${q.id}.${l}.r${run}.txt`), cannedAnswer(l === 'path' ? 'path' : 'json', q, run, user));
    }
  }
  /* A leading intro line is dropped, by the same rule for every language. */
  const intro = path.join(dir, 'order-event.path.r1.txt');
  fs.writeFileSync(intro, `Here is the path:\n${fs.readFileSync(intro, 'utf8')}`);
  /* One path answer with a hop that is not on the map, in run 3. */
  fs.writeFileSync(path.join(dir, 'stock-check.path.r3.txt'), '19 > 99 | nowhere');
  const { code, out } = await runDriver(['--scan', SCAN, '--questions', QUESTIONS, '--score-answers', dir, '--langs', 'json,path', '--model', 'claude-haiku (stand-in)']);
  assert.equal(code, 0, out);
  const rows = readJsonl(path.join(dir, 'results.jsonl'));
  assert.equal(rows.length, QS.length * 2 * 3);
  assert.ok(rows.every((r) => r.outTokensFrom === 'rough' && r.outTokens > 0 && r.ms === null));
  const introRow = rows.find((r) => r.lang === 'path' && r.qid === 'order-event' && r.run === 1);
  assert.equal(introRow.extracted, 'after-intro');
  assert.equal(introRow.grounded, true);
  const bad = rows.find((r) => r.lang === 'path' && r.qid === 'stock-check' && r.run === 3);
  assert.equal(bad.parsed, false);
  const md = fs.readFileSync(path.join(dir, 'summary.md'), 'utf8');
  assert.match(md, /^# Draw-language A\/B: claude-haiku \(stand-in\) on shopfront\.scan\.json$/m);
  assert.match(md, /^\| path \| 3 \| 21 \| 95% ± 8% \| 90% ± 8% \| 0\.92 ± 0\.07 \| \d+ ± \d+ \|$/m);
  assert.match(md, /^\| json \| 3 \| 21 \| 100% ± 0% \| 86% ± 0% \|/m);
  assert.match(md, /a word-and-punctuation count \(no usage field\)/);

  /* The two newer arms are scored by the same scorer, [*] and all. */
  for (const q of QS) {
    for (const l of ['d2', 'states']) {
      const { system, user } = JSON.parse(fs.readFileSync(path.join(dir, `${q.id}.${l}.json`), 'utf8'));
      assert.equal(langOf(system), l);
      fs.writeFileSync(path.join(dir, `${q.id}.${l}.r1.txt`), write(l, hopsOf(q), user, l === 'd2'));
    }
  }
  /* One invented hop between real parts, on line 2, in each. */
  const [a, z] = hopsOf(QS[0])[0];
  fs.writeFileSync(path.join(dir, `${QS[0].id}.d2.r2.txt`), `"${a}" -> "${z}"\n"${z}" -> "${a}": backwards`);
  fs.writeFileSync(path.join(dir, `${QS[0].id}.states.r2.txt`), `state "${a}" as a\nb --> a : backwards\nstate "${z}" as b\n[*] --> b`);
  const more = await runDriver(['--scan', SCAN, '--questions', QUESTIONS, '--score-answers', dir, '--langs', 'd2,states', '--out', path.join(s.dir, 'scored2')]);
  assert.equal(more.code, 0, more.out);
  const rows2 = readJsonl(path.join(s.dir, 'scored2', 'results.jsonl'));
  assert.equal(rows2.length, QS.length * 2 + 2);
  for (const r of rows2.filter((x) => x.run === 1)) {
    assert.equal(r.grounded, true, JSON.stringify(r));
    assert.equal(r.hopCoverage, 1, JSON.stringify(r));
  }
  assert.equal(rows2.find((r) => r.lang === 'd2' && r.run === 1).extracted, 'fence');
  const st = rows2.find((r) => r.lang === 'states' && r.run === 1 && r.qid === QS[0].id);
  assert.equal(st.edges, hopsOf(QS[0]).length, 'the [*] transitions are not counted as hops');
  for (const l of ['d2', 'states']) {
    const r = rows2.find((x) => x.lang === l && x.run === 2);
    assert.equal(r.parsed, true);
    assert.equal(r.grounded, false);
    assert.match(r.firstProblems[0], /^line 2 \(.+\): no edge /, `${l}: ${r.firstProblems[0]}`);
  }
  assert.match(fs.readFileSync(path.join(s.dir, 'scored2', 'summary.md'), 'utf8'), /^\| d2 \| 8 \| 100% \| 88% \|/m);

  /* Answers scored against a different slice than they were written to are refused. */
  const wrong = await runDriver(['--scan', SCAN, '--questions', QUESTIONS, '--score-answers', dir, '--langs', 'path', '--max-nodes', '10']);
  assert.equal(wrong.code, 2);
  assert.match(wrong.out, /is not the prompt this scan\/questions\/--max-nodes would send/);
});

test('the ML Harness questions are flagged as unchecked, and the driver says which lines do not resolve', { skip: !BUILT && 'schema not built' }, async () => {
  const q = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'measure', 'questions.ml-harness.json'), 'utf8'));
  assert.match(q.about, /^CHECK THE PATHS BEFORE A RUN/);
  const s = sandbox();
  /* Against the wrong repo every path is unresolved, and each one is named. */
  const { code, out } = await runDriver(['--scan', SCAN, '--questions', path.join(ROOT, 'tools', 'measure', 'questions.ml-harness.json'), '--emit-prompts', path.join(s.dir, 'p')]);
  assert.equal(code, 0, out);
  assert.match(out, /CHECK — mlh-teach-path: focus "frontend\/src\/lib\/engine\/client\.ts" names no single node in the scan/);
  assert.match(out, /CHECK — mlh-diagnosis: expectPath "app\/diagnosis\.py" names no single node in the scan/);
});
