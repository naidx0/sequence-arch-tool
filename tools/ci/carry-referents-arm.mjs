#!/usr/bin/env node
/**
 * ONE ARM OF MECHANISM B — stage four's referents measurement.
 *
 *   node tools/ci/carry-referents-arm.mjs --referents 0|1 [--port 4290]
 *
 * Starts its OWN app with the flags set, drives the registered three-turn
 * conversation over the same HTTP route the browser drives, grades it with
 * `tools/bench/lib/seat-grade.mjs`, and writes a self-named arm file.
 *
 * ── WHY IT STARTS ITS OWN APP ────────────────────────────────────────────
 *
 * `SEQUENCE_ASK_CARRY_WIRE` and `SEQUENCE_ASK_CARRY_REFERENTS` are read in the
 * SERVER process, so an arm is a process, not a request header. Attaching to a
 * running app would measure whatever flags that app happened to start with —
 * and the flags are the only difference between the two arms, so getting that
 * wrong is getting the experiment wrong.
 *
 * WIRE is ON in BOTH arms. The control is the same build with only REFERENTS
 * off. A control taken against the pre-wiring build would differ in two
 * changes, which is the confound the control law exists for.
 *
 * ── WHAT WOULD MAKE AN ARM INVALID, NAMED BEFORE IT RUNS ─────────────────
 *
 *   1. A STALE BUILD, EITHER HALF. The server and the client are built
 *      separately; on 2026-09-06 the server was minutes old and the browser was
 *      served the previous night's bundle, and half a commit was missing with
 *      every test green. `/api/build` reports both.
 *   2. AN APP THAT IS NOT THIS ONE. Attaching to something already on the port
 *      would silently measure another process's flags, so the port is checked
 *      to be free before the app starts and the arm refuses if it is not.
 *   3. A RUN THAT WOULD OVERWRITE ANOTHER ARM. Same rule as the bench, for the
 *      same reason: four arms once wrote to one path and three were lost.
 *
 * Each refuses rather than reporting.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import url from 'node:url';

import { DISCRIMINATING, PROSE_EXPLAINED, attribute, readTurnTwo } from '../bench/lib/seat-grade.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const OUT = path.join(REPO, 'tools', 'bench', 'out');
const RUN_STARTED_AT = new Date().toISOString();

const flag = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const REFERENTS = flag('referents') === '1';
/* Registered in docs/research/carry-placement-registration.md. `tail` is the
   shipped behaviour and the control. */
const PLACE = flag('place') ?? 'tail';
if (!['tail', 'before-question', 'last'].includes(PLACE)) {
  console.error(`[arm] REFUSED — unknown placement ${PLACE}. Use tail, before-question or last.`);
  process.exit(2);
}
const PORT = Number(flag('port') ?? 4290);
const base = `http://127.0.0.1:${PORT}`;
const log = (...a) => console.log('[arm]', ...a);

/**
 * The registered conversation. Turn 2 is the measurement.
 *
 * `--variant pointed` replaces turn 2 with one that POINTS AT the carried list
 * without reproducing it. That distinction is the whole probe: a question that
 * named the files would be answered by copying them back, which proves nothing
 * about whether the block was read. This one refers to the list and leaves the
 * model to find it.
 *
 * Registered in docs/research/carry-pointed-probe.md.
 */
const VOICE = flag('voice') ?? 'describe';
if (!['describe', 'instruct'].includes(VOICE)) {
  console.error(`[arm] REFUSED — unknown voice ${VOICE}. Use describe or instruct.`);
  process.exit(2);
}
const VARIANT = flag('variant') ?? 'registered';
if (!['registered', 'pointed'].includes(VARIANT)) {
  console.error(`[arm] REFUSED — unknown variant ${VARIANT}. Use registered or pointed.`);
  process.exit(2);
}
const TURN_TWO = {
  registered: 'Of those, which one would I have to change first?',
  pointed:
    'Using only the list of dependants you were already given earlier in this conversation, ' +
    'name the single one I would have to change first.',
}[VARIANT];
const TURNS = [
  'Which files depend on scan.ts, and what breaks if it changes?',
  TURN_TWO,
  'Show me how that file uses what scan.ts returns.',
];

const portFree = () =>
  new Promise((resolve) => {
    const s = net.createConnection({ host: '127.0.0.1', port: PORT }, () => {
      s.destroy();
      resolve(false);
    });
    s.on('error', () => resolve(true));
  });

if (!(await portFree())) {
  console.error(
    `[arm] REFUSED — something is already listening on ${PORT}. An arm must start its own app, ` +
      'or it measures whatever flags that process began with.',
  );
  process.exit(2);
}

const armName = `carry-referents-${REFERENTS ? 'refs' : 'norefs'}-${PLACE}-${VARIANT}-${VOICE}-${RUN_STARTED_AT.replace(/[:.]/g, '-')}`;
const armPath = path.join(OUT, `${armName}.json`);
if (fs.existsSync(armPath)) {
  console.error(`[arm] REFUSED — ${armPath} exists. An arm must not overwrite an arm.`);
  process.exit(3);
}

log(`starting app on ${PORT} with WIRE=1 REFERENTS=${REFERENTS ? '1' : '0'} PLACE=${PLACE} VOICE=${VOICE}`);
const app = spawn(
  process.execPath,
  ['packages/analyzer/dist/cli.js', 'app', '--repo', '.', '--port', String(PORT), '--no-open'],
  {
    cwd: REPO,
    env: {
      ...process.env,
      SEQUENCE_ASK_CARRY_WIRE: '1',
      SEQUENCE_ASK_CARRY_REFERENTS: REFERENTS ? '1' : '0',
      SEQUENCE_ASK_CARRY_PLACE: PLACE,
      /* describe (shipped, and what twelve arms measured) or instruct. */
      SEQUENCE_ASK_CARRY_VOICE: VOICE,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  },
);
let appStderr = '';
app.stderr.on('data', (d) => {
  appStderr += String(d);
});

const stop = () => {
  try {
    app.kill();
  } catch {
    /* already gone */
  }
};
process.on('exit', stop);

/** Wait for the app, then refuse on either stale half. */
async function awaitReady() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(`${base}/api/build`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) return r.json();
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`app never answered /api/build on ${PORT}. stderr:\n${appStderr.slice(0, 800)}`);
}

const stamp = await awaitReady();
if (stamp.stale === true || stamp.server?.stale === true || stamp.client?.stale === true) {
  console.error(
    '[arm] REFUSED — a build half is older than its source ' +
      `(process ${stamp.stale === true}, server ${stamp.server?.stale === true}, client ${stamp.client?.stale === true}). ` +
      'An arm against a stale build measures last week. Run `pnpm -r build` first.',
  );
  stop();
  process.exit(4);
}
log(`app ready — built ${stamp.builtAt}, both halves current`);

/** One turn over the same route the browser uses. Returns text and tools run. */
async function ask(question, threadId) {
  const res = await fetch(`${base}/api/ask/stream`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ question, threadId, mode: 'research' }),
  });
  if (!res.ok) throw new Error(`/api/ask/stream returned ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  const toolsRan = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    for (;;) {
      const at = buf.indexOf('\n\n');
      if (at < 0) break;
      const frame = buf.slice(0, at);
      buf = buf.slice(at + 2);
      const data = frame
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('');
      if (data === '') continue;
      let ev;
      try {
        ev = JSON.parse(data);
      } catch {
        continue; /* keep-alives and comments are not events */
      }
      if (ev.type === 'tool:done' && typeof ev.name === 'string') toolsRan.push(ev.name);
      if (ev.type === 'result' && typeof ev.text === 'string') text = ev.text;
    }
  }
  return { text, toolsRan };
}

const threadId = `armb-${RUN_STARTED_AT.replace(/[:.]/g, '-')}`;
const turns = [];
try {
  for (let i = 0; i < TURNS.length; i += 1) {
    const started = Date.now();
    const { text, toolsRan } = await ask(TURNS[i], threadId);
    const secs = Math.round((Date.now() - started) / 1000);
    turns.push({ turn: i + 1, ask: TURNS[i], seconds: secs, chars: text.length, toolsRan, text });
    log(`turn ${i + 1}: ${secs}s, ${text.length} chars, tools [${toolsRan.join(', ') || 'none'}]`);
  }
} finally {
  stop();
}

/*
 * THE PRECONDITION THIS ARM DID NOT CHECK, AND SHOULD HAVE.
 *
 * Turn 1's tools are the MODEL's choice. On 3 of the first 12 arms it answered
 * with `search_files` alone and never called `who_calls` — so no referent list
 * was ever produced, the carry had nothing to carry, and turn 2 was graded as
 * though it had declined a list that did not exist. One of those arms said so
 * in plain words: "I don't have a list of dependants from earlier in this
 * conversation."
 *
 * An arm whose turn 1 produced no list measures NOTHING about the carry. It is
 * marked here rather than silently averaged in, and the grade carries the flag
 * so no later reading can miss it.
 */
const listProduced = (turns[0]?.toolsRan ?? []).includes('who_calls');

/* THE READING. Registered; implemented once; not re-decided here. */
const t2 = turns[1];
const verdict = readTurnTwo(t2.text);
const attribution = attribute({
  text: t2.text,
  carried: [...DISCRIMINATING, ...PROSE_EXPLAINED],
  toolsRan: t2.toolsRan,
});

const record = {
  arm: REFERENTS ? `treatment/${PLACE}` : 'control',
  placement: PLACE,
  variant: VARIANT,
  voice: VOICE,
  flags: {
    SEQUENCE_ASK_CARRY_WIRE: '1',
    SEQUENCE_ASK_CARRY_REFERENTS: REFERENTS ? '1' : '0',
    SEQUENCE_ASK_CARRY_PLACE: PLACE,
  },
  when: RUN_STARTED_AT,
  build: { builtAt: stamp.builtAt, startedAt: stamp.startedAt },
  threadId,
  /* False means this arm is VOID for the carry question, whatever turn 2 said. */
  listProduced,
  turnTwo: { verdict: verdict.verdict, discriminating: verdict.discriminating, proseOnly: verdict.proseOnly },
  attribution,
  turns,
};
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(armPath, `${JSON.stringify(record, null, 1)}\n`);
/* Assert the write, do not merely perform it. */
const back = JSON.parse(fs.readFileSync(armPath, 'utf8'));
if (back.turns?.length !== turns.length) {
  console.error(`[arm] REFUSED — ${armPath} holds ${back.turns?.length} turns, the run produced ${turns.length}.`);
  process.exit(5);
}

log(`turn 2 verdict: ${verdict.verdict}${listProduced ? '' : '  (VOID — no list was produced)'}`);
/*
 * VOID IS DECIDED HERE, NOT BY A READER.
 *
 * The first twelve arms were graded by hand afterwards and three of them turned
 * out to have measured nothing — turn 1 never called `who_calls`, so no list
 * existed and turn 2 was scored as declining one. That was caught by asking a
 * good question after publishing; a harness that can only be saved by someone
 * asking a good question is the shape this stage keeps paying for.
 *
 * The file is still written, because a void arm is evidence about the model's
 * tool choice even though it is not evidence about the carry. The EXIT CODE is
 * what makes it automatic: 6 means "re-run me", and a batch that ignores it is
 * visibly ignoring it rather than silently averaging a void arm in.
 */
if (!listProduced) {
  console.error(
    '[arm] VOID — turn 1 never called who_calls, so no referent list existed. This arm says ' +
      'nothing about the carry, whatever turn 2 answered. Exit 6: re-run it.',
  );
  process.exit(6);
}
if (verdict.discriminating.length > 0) log(`  discriminating: ${verdict.discriminating.join(', ')}`);
if (verdict.proseOnly.length > 0) log(`  prose-explained (proves nothing): ${verdict.proseOnly.join(', ')}`);
log(
  attribution.refusedBecause === null
    ? `  attribution: ${attribution.fromCarryOnly.length} item(s) the carry alone could have supplied`
    : `  attribution REFUSED — ${attribution.refusedBecause}`,
);
log(`wrote ${path.basename(armPath)}`);
