#!/usr/bin/env node
/**
 * THE SCRIPTED SEAT — drive the product the way a person does, and write down
 * what they would have seen.
 *
 *   node tools/ci/scripted-seat.mjs [port] ["the ask"]
 *   node tools/ci/scripted-seat.mjs --dry     # everything except the two turns
 *
 * Every defect found today was found by opening the app and looking: the chart
 * that reached the store and never reached the file, the load path that read the
 * chart and threw it away, the thirteen frozen seconds a green log called fine.
 * None of them had a failing test, and all of them were visible in one screen.
 * This is that loop, written down, so it can be run rather than remembered.
 *
 * The run: type an ask, wait the turn out, RELOAD, reopen from the session list,
 * ask the same thing again. Four screens, the canvas file, the chat file, the
 * build stamp, and a transcript of numbered observations.
 *
 * ── IT COSTS CARD TIME, AND THAT IS WHY IT IS A SEPARATE FILE ─────────────
 *
 * `capture-journey.mjs` replays a lesson that is already on disk and calls no
 * model — it is free, and it is safe to run in a loop. This one types into the
 * composer and waits for two real turns. Keeping the two apart is a file
 * boundary that stops somebody reaching for the cheap tool and getting the
 * expensive one, and stops a third mode growing on a script that already has
 * two.
 *
 * ── IT REFUSES A STALE PROCESS ────────────────────────────────────────────
 *
 * A seat read against a server older than its code is a measurement of last
 * week, and this repository has already paid for that once: a person waited two
 * minutes and thirteen seconds for a lesson whose defects had been fixed and
 * pushed hours earlier. So the first thing this does is ask what is running.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

import { foreignLaneHolds, staleHalves, wouldBeRefusedWithoutACall } from './lock-guard.mjs';
import { fileURLToPath } from 'node:url';

import { findChromium, launchOptions, loadPlaywright } from '../../packages/web2/e2e/lib/chromium.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const OUT = path.join(REPO, 'docs', 'journeys', 'seat');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const positional = argv.filter((a) => !a.startsWith('--'));
const port = Number(positional[0] ?? 4173);
const ASK = positional[1] ?? 'Teach me how brief.ts works.';
const base = `http://127.0.0.1:${port}`;
const VIEWPORT = { width: 1280, height: 820 };
/* Generous: a teach turn on this machine has measured 115 s at worst, and a cut
   that fires early would report "no answer" for a turn that was still coming. */
const TURN_TIMEOUT_MS = Number(process.env.SEAT_TURN_TIMEOUT_MS || 240_000);
/*
 * THE WHOLE RUN'S BOUND, not the turn's.
 *
 * Planted case 6 is the runtime being down: the product shows its error screen
 * and the seat must report that inside five minutes rather than hang. A
 * per-turn timeout does not bound a run — two turns at four minutes is eight —
 * so the deadline is on the run, checked before each beat and inside the wait.
 */
const RUN_DEADLINE_MS = Number(process.env.SEAT_DEADLINE_MS || 300_000);
const RUN_STARTED = Date.now();
const outOfTime = () => Date.now() - RUN_STARTED > RUN_DEADLINE_MS;

const log = (...a) => console.log('[seat]', ...a);

/** Not an error: the bound firing is a reported outcome, not a crash. */
class SeatBound extends Error {}

/**
 * The observation ledger.
 *
 * Every line records what was EXPECTED before it was looked at, what was SEEN,
 * and the verdict — because "the chart was there" is a memory and "expected a
 * chart after reload, saw charts: 1 in canvas.json" is a record. The prediction
 * for this run is registered in `docs/research/scripted-seat.md`; these rows are
 * what it gets read against.
 */
const ledger = [];
const observe = (n, expected, seen, ok) => {
  ledger.push({ n, expected, seen, verdict: ok ? 'as expected' : 'DIFFERS' });
  log(`${ok ? ' ok ' : 'DIFF'}  ${n}. ${expected}  →  ${seen}`);
};

async function buildStamp() {
  const res = await fetch(`${base}/api/build`, { signal: AbortSignal.timeout(4000) });
  if (!res.ok) throw new Error(`no /api/build on ${base} — is the app running?`);
  return res.json();
}

/** The repo the app says it serves, so the session files can be found on disk. */
async function servedRoot() {
  const res = await fetch(`${base}/api/status`, { signal: AbortSignal.timeout(4000) });
  const body = await res.json();
  return typeof body?.root === 'string' ? body.root : null;
}

async function activeSessionId() {
  const res = await fetch(`${base}/api/sessions`, { signal: AbortSignal.timeout(4000) });
  const body = await res.json();
  return body?.index?.activeId ?? null;
}

const stamp = await buildStamp();
if (stamp.stale) {
  /*
   * NAME THE HALF, because the remedy differs and "stale" alone sent a reader to
   * the wrong one. On 2026-09-06 the SERVER was current and the client bundle was
   * from the previous night; `restart:app` reported success each time it ran,
   * because a restart reloads what is on disk and cannot rebuild a bundle. Six
   * hours of a missing refusal followed.
   */
  const halves = staleHalves(stamp);
  const which =
    halves === null
      ? 'the app cannot say which half'
      : halves.client && halves.server
        ? 'BOTH halves are behind their source'
        : halves.client
          ? 'the CLIENT BUNDLE is behind its source — a restart alone will not fix it, it needs a rebuild'
          : halves.server
            ? 'the SERVER build is behind its source'
            : `the process started ${stamp.startedAt} and the code was built ${stamp.builtAt}`;
  console.error(
    `scripted-seat: REFUSED — the app on ${port} is stale: ${which}.` +
      (halves?.why ? `\n  ${halves.why}` : '') +
      '\n  A seat read against a stale process is a measurement of last week. Run `pnpm restart:app` first.',
  );
  process.exit(2);
}
/*
 * ── THE CARD, BEFORE ANYTHING IS TYPED ────────────────────────────────────
 *
 * A seat read put a ten-second model call on another lane's GPU card on
 * 2026-09-06, because nothing here had ever read the lock. `gpu-lock check`
 * existed and did not help: it guards scripts, and this is a person's ask going
 * through the product.
 *
 * While another lane holds the card, this types nothing — UNLESS the ask is one
 * the product refuses without a provider call, which is the case the refusal
 * screen exists to capture and is genuinely free. See tools/ci/lock-guard.mjs
 * for why the verdict is computed locally rather than probed over the API: the
 * probe IS the call being avoided.
 */
const holder = foreignLaneHolds(process.env.SEQUENCE_GPU_LOCK, process.env.SEQUENCE_GPU_LANE ?? 'sequence');
if (holder !== null && !DRY) {
  const free = await wouldBeRefusedWithoutACall(REPO, ASK, path.join(REPO, 'packages', 'analyzer', 'dist'));
  if (!free) {
    console.error(
      `scripted-seat: REFUSED — lane ${holder} holds the card and this ask can reach a model.
` +
        `  ask: ${JSON.stringify(ASK)}
` +
        '  Wait for the release, or run an ask the product refuses without a call.',
    );
    process.exit(3);
  }
  log(`lane ${holder} holds the card; this ask is refused before any provider call, so typing it is free`);
}

const root = await servedRoot();
const commit = execSync('git rev-parse --short HEAD', { cwd: REPO }).toString().trim();
log(`app on ${port} is current — started ${stamp.startedAt}, built ${stamp.builtAt}, tree at ${commit}`);
log(`serving ${root}`);

/*
 * ── THE HOLD ──────────────────────────────────────────────────────────────
 *
 * A seat read takes minutes and a push from another session takes seconds. The
 * restart is deliberately not a git hook precisely because it would kill a
 * server another session is mid-read on — but `pnpm restart:app`, run by hand at
 * the wrong moment, does exactly the same thing. So the seat DECLARES the port
 * it is reading, and the restart refuses while that declaration stands.
 *
 * pid + start time, not pid alone: pids are reused, and a lock naming a pid that
 * now belongs to something else blocks the restart forever.
 */
const LOCK = path.join(REPO, 'tools', 'ci', 'out', 'seat.lock');
function takeHold() {
  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  if (fs.existsSync(LOCK)) {
    try {
      const held = JSON.parse(fs.readFileSync(LOCK, 'utf8'));
      /* Alive? `process.kill(pid, 0)` throws when it is not. A stale lock from a
         killed run must not block the next one — a lock nobody can clear is
         worse than no lock. */
      let alive = false;
      try {
        process.kill(held.pid, 0);
        alive = true;
      } catch {
        alive = false;
      }
      if (alive) {
        console.error(
          `scripted-seat: REFUSED — port ${held.port} is held by a seat run (pid ${held.pid}, since ${held.since}).`,
        );
        process.exit(3);
      }
      log(`clearing a stale hold from pid ${held.pid} (not running)`);
    } catch {
      log('clearing an unreadable hold');
    }
  }
  fs.writeFileSync(
    LOCK,
    `${JSON.stringify({ pid: process.pid, port, since: new Date().toISOString(), commit }, null, 2)}
`,
  );
}
const releaseHold = () => fs.rmSync(LOCK, { force: true });
takeHold();
process.on('exit', releaseHold);

const chromium = await loadPlaywright();
const executablePath = findChromium();
if (!chromium || !executablePath) {
  log('SKIP: no headless Chromium available');
  process.exit(0);
}

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ ...launchOptions(), executablePath, headless: true });
const context = await browser.newContext({ viewport: VIEWPORT });
const page = await context.newPage();

/*
 * BEATS, DECLARED BEFORE THE RUN.
 *
 * `assert_ran` for the seat: a beat that logged and did nothing is the failure
 * this exists for — the thirteen frozen seconds a green log called fine. The
 * list is fixed here, each beat marks itself reached, and `beats N of N` is
 * printed with exit 2 on a shortfall. A run that quietly does four of five
 * cannot report success.
 */
const BEATS = DRY ? ['open'] : ['open', 'ask', 'reload', 'reopen', 'ask-again'];
const reached = new Set();
const beat = (name) => {
  if (!BEATS.includes(name)) throw new Error(`undeclared beat: ${name}`);
  reached.add(name);
};

const shots = [];
const shoot = async (step, note) => {
  const file = path.join(OUT, `${step}.png`);
  await page.screenshot({ path: file });
  const { size } = fs.statSync(file);
  /* WITNESS: a screen without a hash is a filename. Two runs claiming the same
     screen can be compared, and a screen swapped after the fact is visible. */
  const sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
  shots.push({ step, file: path.relative(REPO, file).split(path.sep).join('/'), bytes: size, sha256, note });
  log(`  ${step}.png  ${size} bytes  sha256:${sha256} — ${note}`);
};

/*
 * ── void_unless ───────────────────────────────────────────────────────────
 *
 * A beat is void unless its own claim survives a rule. The frozen thirteen
 * seconds is the case: the log said "read down the reply" while the first and
 * last frames were byte-identical. A claim nothing checked is a sentence.
 *
 *   scrolled     the pixel hash of the first and last frame differ AND the
 *                scroll distance is non-zero. Either alone is not enough — a
 *                scrollTop that moved on an unchanged screen is a no-op, and a
 *                screen that changed for another reason is not a scroll.
 *   chart shown  the canvas region's hash differs from the placeholder's.
 *
 * `voided N of M` is printed and a void beat is not a passing beat.
 */
const evidence = [];
const voids = [];
const voidUnless = (name, ok, why) => {
  if (!ok) {
    voids.push({ beat: name, why });
    log(`VOID  ${name}: ${why}`);
  }
};

/*
 * ── THE SNAPSHOT BESIDE THE PIXELS ────────────────────────────────────────
 *
 * Playwright's `ariaSnapshot` renders the page's accessibility tree as YAML-ish
 * text — roles and names, the thing a screen reader would say. Written beside
 * every screen with its own sha256, it turns three claims this seat could only
 * make about pixels into assertions on TEXT: the chart row's sentence, the
 * canvas placeholder, the reply's closing line. A person can read the diff; a
 * script can assert on it.
 *
 * It also gives the void rules a SECOND witness, and the two disagree in exactly
 * the two ways that matter. Pixels moving while the text stands still is an
 * animation — not void. Text moving while the pixels stand still is a hidden
 * element — void by the text rule and invisible to the pixel one.
 *
 * ── WHAT IS STRIPPED BEFORE HASHING, AND WHY NOT MORE ─────────────────────
 *
 * The live snapshot carries relative ages — `2h`, `3h`, `7d` on the session
 * rows — which change with the wall clock and nothing else. Two runs of one
 * build would hash differently for no reason a reader cares about, so ages are
 * redacted before hashing and the redaction is COUNTED, never silent.
 *
 * The token count (`131.1k`) is NOT stripped. It is deterministic given the same
 * state, and it changes when the conversation does — which is a content change,
 * the exact thing this rule exists to see. Stripping it would buy a stable hash
 * by blinding the check.
 */
/* Word-bounded on both sides: without the boundaries this matches inside words —
   `45ms` becomes `<age>s`, and a redaction that eats real text is worse than a hash
   that moves. */
const AGE = /\b\d+(?:\.\d+)?[smhdw]\b/g;
const SESSION_ID = /\bsession \d+/g;
const stableSnapshot = (raw) => {
  const ages = (raw.match(AGE) ?? []).length;
  const ids = (raw.match(SESSION_ID) ?? []).length;
  return {
    text: raw.replace(AGE, '<age>').replace(SESSION_ID, 'session <id>'),
    redactedAges: ages,
    redactedIds: ids,
  };
};

const snapshots = [];
/**
 * One call per beat, on the page object the seat already holds.
 *
 * A snapshot that cannot be taken is recorded as `null` — CANNOT DECIDE — and
 * never counted as taken. `snapshots N of N beats` then falls short and the run
 * exits 2, because a beat with no second witness is a beat this seat cannot
 * speak about.
 */
async function snapshotBeat(name) {
  try {
    const raw = await page.locator('body').ariaSnapshot({ timeout: 5000 });
    const { text, redactedAges, redactedIds } = stableSnapshot(raw);
    const file = path.join(OUT, `${name}.aria.txt`);
    fs.writeFileSync(file, text);
    const sha256 = crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
    snapshots.push({ beat: name, sha256, chars: text.length, redactedAges, redactedIds, file: path.relative(REPO, file).split(path.sep).join('/') });
    log(`  ${name}.aria.txt  ${text.length} chars  sha256:${sha256}  (${redactedAges} age(s), ${redactedIds} id(s) redacted)`);
    return text;
  } catch (e) {
    snapshots.push({ beat: name, sha256: null, reason: e instanceof Error ? e.message : String(e) });
    log(`  ${name}: NO SNAPSHOT — cannot decide (${e instanceof Error ? e.message : e})`);
    return null;
  }
}

/**
 * The second void rule: a beat claiming a CONTENT change is void unless the
 * snapshot changed. Distinct from the frozen-frame rule, which is about pixels.
 */
const voidUnlessSnapshotChanged = (name, before, after) =>
  voidUnless(
    name,
    before === null || after === null ? true : before !== after,
    'the beat claims a content change and the accessibility snapshot is identical',
  );

/** A hash of what is actually painted, for the frozen-frame rule. */
async function frameHash() {
  const buf = await page.screenshot();
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * A hash of a JSON file's CONTENT, not of its bytes.
 *
 * WRITTEN BECAUSE THE BYTE HASH RAISED A FALSE VOID. On 2026-09-06 this seat
 * reported "the conversation changed across a reload, which is not what a reload
 * claims". `chat.json` before and after: the SAME 3,518 bytes, a different
 * sha256, and — parsed and compared field by field — ZERO differing fields. The
 * bytes diverged at offset 630, where one `work` step was serialised with its
 * keys in a different order. 1,177 bytes differed; no content did.
 *
 * So the void was right about the file and wrong about the conversation, which
 * is the worse of the two errors: it accused the product of losing a
 * conversation when the server had merely re-serialised one.
 *
 * Keys are sorted before hashing, so a re-serialisation is invisible and a real
 * change is not. A file that will not parse falls back to the byte hash rather
 * than being called unchanged — an unreadable file is not evidence of sameness,
 * which is the same law as the lock that must say "cannot be decided".
 */
function contentHash(buf) {
  const bytes = () => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
  let parsed;
  try {
    parsed = JSON.parse(buf.toString('utf8'));
  } catch {
    return bytes();
  }
  const stable = (v) =>
    Array.isArray(v)
      ? v.map(stable)
      : v !== null && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])]))
        : v;
  return crypto.createHash('sha256').update(JSON.stringify(stable(parsed))).digest('hex').slice(0, 16);
}

/*
 * THE FILES BESIDE THE PIXELS. Copied after each beat, so "recorded, not
 * rendered" is visible as a pair rather than argued: the screen said one thing,
 * the file on disk said another, and both are in the folder.
 */
function copyEvidence(beatName, sessionId) {
  if (root === null || sessionId === null) return null;
  const dir = path.join(root, '.sequence', 'sessions', sessionId);
  const out = [];
  for (const name of ['canvas.json', 'chat.json', 'lesson.json']) {
    const src = path.join(dir, name);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(OUT, `${beatName}--${name}`);
    fs.copyFileSync(src, dst);
    const bytes = fs.statSync(dst).size;
    out.push({
      name,
      bytes,
      sha256: contentHash(fs.readFileSync(dst)),
    });
  }
  return out;
}

/** How many assistant replies are on screen, and is one still arriving? */
const transcriptState = () =>
  page.evaluate(() => ({
    replies: document.querySelectorAll('[data-testid="chat-prose"]').length,
    streaming: document.querySelectorAll('[data-testid="chat-prose"][data-streaming]').length,
    coverage: document.querySelectorAll('[data-testid="chat-coverage"]').length,
    charts: document.querySelectorAll('[data-testid="chat-chart-pointer"]').length,
    /*
     * The canvas's own state — the half the chat row only points at, and the
     * one the reload defects lived in. Selectors read out of `AiCanvas.tsx`
     * (`ai-canvas`, `ai-canvas-chart`, and the `ai-canvas-empty` class on the
     * placeholder), NOT guessed: a selector that matches nothing is planted
     * case 2, and inventing one here would be committing the defect the seat
     * exists to catch.
     */
    canvasCharts: document.querySelectorAll('[data-testid="ai-canvas-chart"]').length,
    canvasPlaceholder: document.querySelectorAll('.ai-canvas-empty').length,
  }));

/**
 * Type the ask and wait the turn out.
 *
 * Waits on the PRODUCT'S OWN signals — a new `chat-prose` that is no longer
 * `data-streaming` — rather than on a sleep. A fixed sleep passes when the model
 * is fast and reports a missing answer when it is slow, which makes the
 * instrument's verdict a function of the weather.
 */
async function askAndWait(question) {
  const before = await transcriptState();
  const box = page.locator('textarea').first();
  await box.click();
  await box.fill(question);
  await page.locator('[data-testid="composer-send"]').first().click();
  const started = Date.now();
  let state = before;
  while (Date.now() - started < TURN_TIMEOUT_MS && !outOfTime()) {
    await page.waitForTimeout(1000);
    state = await transcriptState();
    if (state.replies > before.replies && state.streaming === 0) break;
  }
  const ms = Date.now() - started;
  const finished = state.replies > before.replies && state.streaming === 0;
  return { ms, finished, before, after: state };
}

/*
 * ── migrated N of N ───────────────────────────────────────────────────────
 *
 * The checkpoint module decides, on open, whether a saved lesson's derivations
 * still belong to the running build. The seat reports that decision for the
 * session it reopened, so a transcript says whether the picture on screen was
 * the one saved or one rebuilt.
 *
 * STATED PRECISELY, because it is not yet an effect: `readCheckpoint` and
 * `migrateCheckpoint` are built and tested but NOT wired into the app's hydrate
 * path, so this line reports what the rule DECIDES, not something the app did.
 * Writing it as though the app had migrated would be the claim the checkpoint
 * exists to prevent.
 */
async function checkpointDecision(sessionId) {
  if (sessionId === null) return null;
  /*
   * ASK THE APP WHAT IT DID, rather than recompute what it should have done.
   *
   * This used to import the checkpoint module and report the DECISION, because
   * the migration was not wired into the serve path. It is now: `GET
   * /api/sessions/:id` migrates before it answers and puts `migrated` on the
   * payload. Reading that is the difference between "the rule says this lesson
   * is stale" and "the app re-derived it" — and only the second is a seat
   * observation.
   */
  try {
    const res = await fetch(`${base}/api/sessions/${encodeURIComponent(sessionId)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { total: 1, migrated: 0, error: `GET /api/sessions/${sessionId} → ${res.status}` };
    const body = await res.json();
    if (body.migrated === undefined) {
      /* No `migrated` key means the session carried no chart to migrate — a real
         state, and not the same as "migrated 0 of 1". */
      return { total: 0, migrated: 0, reason: 'no stored chart on this session' };
    }
    return {
      total: 1,
      migrated: body.migrated.migrated ? 1 : 0,
      reason: body.migrated.reason,
      chartsServed: (body.canvas?.charts ?? []).length,
    };
  } catch (e) {
    return { total: 1, migrated: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** What is actually on disk for this session — the half a screenshot cannot show. */
function sessionFiles(sessionId) {
  if (root === null || sessionId === null) return null;
  const dir = path.join(root, '.sequence', 'sessions', sessionId);
  const read = (name) => {
    const f = path.join(dir, name);
    if (!fs.existsSync(f)) return null;
    try {
      return { bytes: fs.statSync(f).size, json: JSON.parse(fs.readFileSync(f, 'utf8')) };
    } catch {
      return { bytes: fs.statSync(f).size, json: null };
    }
  };
  const canvas = read('canvas.json');
  const chat = read('chat.json');
  return {
    dir: path.relative(root, dir).split(path.sep).join('/'),
    canvas: canvas === null ? null : { bytes: canvas.bytes, charts: canvas.json?.charts?.length ?? 0 },
    chat: chat === null ? null : { bytes: chat.bytes, turns: chat.json?.turns?.length ?? chat.json?.items?.length ?? null },
    lesson: read('lesson.json') === null ? null : 'present',
  };
}

let seat = { turns: [], files: null, checkpoint: null };
let boundHit = null;
try {
  /* ── 1. land, and start a fresh conversation ───────────────────────────── */
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  /*
   * A DRY RUN DOES NOT START A CONVERSATION.
   *
   * `--dry` exists to prove the seat can reach the composer without spending a
   * model call. Clicking "New chat" anyway created a session on EVERY dry run —
   * fifteen empty ones accumulated in this repository before anyone looked, and
   * they are visible to the user in the session list.
   *
   * It also broke the snapshot's own stability case: each run added a row, so
   * two runs of one build could never hash the same. The instrument was
   * perturbing the thing it measures, and then reporting the perturbation as
   * instability in the product.
   */
  if (!DRY) {
    const newChat = page.locator('button:has-text("New chat")').first();
    if ((await newChat.count()) > 0) await newChat.click();
    await page.waitForTimeout(1200);
  }

  /*
   * `open` IS MARKED HERE, BEFORE THE BRANCH.
   *
   * It was marked only inside the `--dry` arm, so every REAL run reported
   * `beats 4 of 5 — MISSED: open` and exited 2 on a phantom shortfall. Found by
   * running planted case 6 against an app with a dead provider: the
   * instrument's own primary assert was wrong on every path that matters, and a
   * gate that always fails is as useless as one that never does.
   */
  beat('open');
  const snapOpen = await snapshotBeat('open');

  if (DRY) {
    await shoot('1-asked', 'DRY — composer reached, no turn taken');
    observe(1, 'the composer is reachable and a new chat can be started', 'reached it', true);
    log('DRY — stopping before the first turn. Nothing was sent to a model.');
  } else {
    /* ── 2. the first turn ──────────────────────────────────────────────── */
    beat('ask');
    const beforeAsk = await frameHash();
    const t1 = await askAndWait(ASK);
    voidUnless('ask', (await frameHash()) !== beforeAsk, 'the screen is byte-identical before and after the turn');
    /* The ask claims a reply arrived — a content change, so the text must move. */
    voidUnlessSnapshotChanged('ask', snapOpen, await snapshotBeat('ask'));
    seat.turns.push({ turn: 1, ...t1 });
    await shoot('1-asked', 'the first reply, as it lands');
    observe(
      1,
      'typing the ask produces one completed reply',
      t1.finished ? `reply arrived in ${(t1.ms / 1000).toFixed(1)}s` : `NO reply within ${TURN_TIMEOUT_MS / 1000}s`,
      t1.finished,
    );
    observe(
      2,
      'the reply carries a coverage line naming what it was answered from',
      `${t1.after.coverage} coverage line(s) on screen`,
      t1.after.coverage > 0,
    );
    /* Planted case 7: the chat's chart row, the one sentence that points at the
       canvas. Absent is the regression this beat is for. */
    observe(
      3,
      'a chart row appears in the chat, pointing at the canvas',
      `${t1.after.charts} chart row(s)`,
      t1.after.charts > 0,
    );
    evidence.push({ beat: 'ask', files: copyEvidence('ask', await activeSessionId()) });

    /* ── 3. reload — the step that found three defects today ────────────── */
    if (outOfTime()) {
      await shoot('x-out-of-time', 'the run hit its five-minute bound; this is the screen it stopped on');
      log(`the run passed its ${RUN_DEADLINE_MS / 1000}s bound — stopping with the beats reached`);
      throw new SeatBound('run deadline');
    }
    beat('reload');
    const snapBeforeReload = await snapshotBeat('before-reload');
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    const afterReload = await transcriptState();
    await shoot('2-reloaded', 'what a person sees immediately after a reload');
    /*
     * A RELOAD CLAIMS THE CONTENT SURVIVES, not that it changes — so this beat
     * is NOT subject to the change rule. Its snapshot is recorded so the two can
     * be diffed as text: what a reload is supposed to do is come back the same.
     */
    const snapReload = await snapshotBeat('reload');
    voidUnless(
      'reload',
      snapReload === null || snapBeforeReload === null || snapReload === snapBeforeReload,
      'the conversation changed across a reload, which is not what a reload claims',
    );
    const reloadSession = await activeSessionId();
    evidence.push({ beat: 'reload', files: copyEvidence('reload', reloadSession) });
    /*
     * A TEACH TURN MUST LEAVE A LESSON, and this beat exists because its absence
     * was reported as three separate faults.
     *
     * On 2026-09-06 the seat asserted a chart row, a second turn and a persisted
     * chart, and all three DIFFERED. There was one cause: the session held
     * chat.json and canvas.json and NO lesson.json, so there was no concept, so
     * buildConceptChart was never reached, so no chart and no derived check-in.
     * Reading the chart alone cannot tell "the lesson had no picture" from "there
     * was no lesson", and those are different defects with different owners.
     *
     * Reported, not enforced, when the turn was not a teach turn: a run in a
     * different mode has no lesson to leave and this must not read as a fault.
     */
    const lessonPresent = (() => {
      if (root === null || reloadSession === null) return null;
      return fs.existsSync(
        path.join(root, '.sequence', 'sessions', reloadSession, 'lesson.json'),
      );
    })();
    if (lessonPresent !== null) {
      observe(
        3.5,
        'a turn taught as a lesson leaves a lesson.json beside the chat',
        lessonPresent ? 'lesson.json present' : 'lesson.json ABSENT — no concept, so no chart and no check-in',
        lessonPresent,
      );
    }
    observe(
      4,
      'the conversation survives a reload without reopening anything',
      `${afterReload.replies} reply/replies on screen after reload`,
      afterReload.replies > 0,
    );

    /* ── 4. reopen from the session list, the way a person returns ──────── */
    /*
     * BY ID, NOT BY TITLE — the same defect the replay had. Several sessions
     * share an ask, so `has-text(...).first()` reopens the topmost matching row,
     * which is not necessarily the one this run created. The row carries
     * `data-id`; the active session id says which one is ours.
     */
    const sid = await activeSessionId();
    const row =
      sid === null
        ? page.locator('button:has-text("' + ASK.slice(0, 18) + '")').first()
        : page.locator(`[data-testid="sessions-row"][data-id="${sid}"]`).first();
    let reopened = false;
    if ((await row.count()) > 0) {
      const active = (await row.getAttribute('data-active')) === 'true';
      if (!active) await row.click();
      reopened = true;
      await page.waitForTimeout(2000);
    }
    beat('reopen');
    const afterReopen = await transcriptState();
    await shoot('3-reopened', 'reopened from the session list');
    await snapshotBeat('reopen');
    evidence.push({ beat: 'reopen', files: copyEvidence('reopen', await activeSessionId()) });
    /*
     * THE FOURTH SEAT'S QUESTION, asked by the script.
     *
     * `charts: N` on disk against what the canvas paints. The defect found by
     * hand at 15:56 was exactly this pair disagreeing: the file held a chart and
     * the screen showed the placeholder. The seat reports the pair, so the
     * disagreement is the finding rather than an argument.
     */
    const onDisk = sessionFiles(await activeSessionId());
    observe(
      5,
      'the canvas paints the chart the session file holds, after a reload',
      `canvas.json charts: ${onDisk?.canvas?.charts ?? '?'} · painted: ${afterReopen.canvasCharts} · placeholder: ${afterReopen.canvasPlaceholder}`,
      (onDisk?.canvas?.charts ?? 0) === 0 || afterReopen.canvasCharts > 0,
    );
    voidUnless(
      'reopen',
      (onDisk?.canvas?.charts ?? 0) === 0 || afterReopen.canvasPlaceholder === 0,
      'the file holds a chart and the canvas shows its placeholder',
    );
    observe(
      6,
      'the session is listed and reopening it shows the same conversation',
      reopened ? `${afterReopen.replies} reply/replies, ${afterReopen.charts} chart pointer(s)` : 'NO row matched the ask',
      reopened && afterReopen.replies > 0,
    );

    /* ── 5. the same ask again, on the restored session ─────────────────── */
    beat('ask-again');
    const snapBeforeSecond = await snapshotBeat('before-ask-again');
    const t2 = await askAndWait(ASK);
    voidUnlessSnapshotChanged('ask-again', snapBeforeSecond, await snapshotBeat('ask-again'));
    seat.turns.push({ turn: 2, ...t2 });
    await shoot('4-second-turn', 'the second turn, on the restored conversation');
    observe(
      7,
      'a second turn runs on the restored session',
      t2.finished ? `second reply in ${(t2.ms / 1000).toFixed(1)}s` : `NO second reply within ${TURN_TIMEOUT_MS / 1000}s`,
      t2.finished,
    );
  }

  /* ── 6. what is on disk ────────────────────────────────────────────────── */
  const sid = await activeSessionId();
  seat.files = sessionFiles(sid);
  seat.checkpoint = await checkpointDecision(sid);
  /*
   * NOT ASSERTED IN --dry. No turn was taken, so a fresh conversation has no
   * chart and no reply — and a check that CANNOT pass in a mode must not fail in
   * it either, or the mode teaches its reader to ignore a red line.
   */
  if (seat.files !== null && !DRY) {
    observe(
      8,
      'the conversation is written to chat.json on disk',
      seat.files.chat === null ? 'chat.json ABSENT' : `chat.json ${seat.files.chat.bytes} bytes`,
      seat.files.chat !== null,
    );
    observe(
      9,
      'a chart drawn this turn is persisted in canvas.json',
      seat.files.canvas === null ? 'canvas.json ABSENT' : `canvas.json ${seat.files.canvas.bytes} bytes, charts: ${seat.files.canvas.charts}`,
      seat.files.canvas !== null && seat.files.canvas.charts > 0,
    );
  } else if (seat.files !== null) {
    log(`  (dry) session dir ${seat.files.dir} — chat.json ${seat.files.chat?.bytes ?? 'absent'}, canvas.json ${seat.files.canvas?.bytes ?? 'absent'}; not asserted`);
  }
} catch (e) {
  if (e instanceof SeatBound) boundHit = e.message;
  else throw e;
} finally {
  await context.close();
  await browser.close();
}

/* ── the one-page transcript ─────────────────────────────────────────────── */

const wallMs = seat.turns.reduce((a, t) => a + t.ms, 0);
const runMs = Date.now() - RUN_STARTED;
const differs = ledger.filter((l) => l.verdict === 'DIFFERS');
const missedBeats = BEATS.filter((b) => !reached.has(b));

/*
 * THE TRANSCRIPT IS A SEAT BLOCK, in the ledger's own form.
 *
 * That form is: a dated headline with the commit, the registered outcomes
 * answered **yes** or **no** in a sentence, the numbers inline with their
 * denominators, then "The finding under it" and what is still outstanding. It
 * is written that way because the ledger is where a seat read is read, and a
 * table nobody pastes is a table nobody reads. The rows are kept underneath for
 * the person checking a number.
 */
const yn = (ok) => (ok ? '**yes**' : '**no**');
const stamped = new Date().toISOString().replace('T', ' ').slice(0, 16);
const outcomes = ledger.map((l) => `${l.expected} ${yn(l.verdict === 'as expected')} (${l.seen})`);

const block = [
  `> **${stamped} (scripted seat):** **the seat read, ${ledger.length - differs.length} of ${ledger.length}** ` +
    `(\`${commit}\`, port ${port}; app started ${stamp.startedAt}, built ${stamp.builtAt}). ` +
    `The ask *"${ASK}"* asked ${seat.turns.length} time(s) with a reload and a reopen between: ` +
    `${outcomes.join('; ')}. ` +
    `**beats ${reached.size} of ${BEATS.length}**${missedBeats.length ? ` — missed ${missedBeats.join(', ')}` : ''}; ` +
    `**voided ${voids.length} of ${BEATS.length}**${voids.length ? ` (${voids.map((v) => `${v.beat}: ${v.why}`).join('; ')})` : ''}; ` +
    `${shots.length} screens, ${(wallMs / 1000).toFixed(1)} s in turns, ${(runMs / 1000).toFixed(1)} s wall.` +
    (boundHit ? ` **The run hit its ${RUN_DEADLINE_MS / 1000}s bound** and stopped where it stood.` : '') +
    (differs.length === 0 && voids.length === 0
      ? ' Nothing differed from what was registered.'
      : ` **The finding under it:** ${[...differs.map((d) => d.expected + ' — saw ' + d.seen), ...voids.map((v) => v.beat + ' is void: ' + v.why)].join('; ')}.`),
  '',
];

const lines = [
  `# Scripted seat — ${stamped}`,
  '',
  ...block,
  '## The rows',
  '',
  '| # | expected | seen | verdict |',
  '| --- | --- | --- | --- |',
  ...ledger.map((l) => `| ${l.n} | ${l.expected} | ${l.seen} | ${l.verdict} |`),
  '',
  '## Files on disk',
  '',
  seat.files === null
    ? '_(no session directory resolved)_'
    : [
        `- \`${seat.files.dir}/chat.json\` — ${seat.files.chat === null ? 'ABSENT' : `${seat.files.chat.bytes} bytes`}`,
        `- \`${seat.files.dir}/canvas.json\` — ${seat.files.canvas === null ? 'ABSENT' : `${seat.files.canvas.bytes} bytes, charts: ${seat.files.canvas.charts}`}`,
        `- \`${seat.files.dir}/lesson.json\` — ${seat.files.lesson ?? 'ABSENT'}`,
      ].join(String.fromCharCode(10))
,
  '',
  '## Evidence copied beside the screens',
  '',
  evidence.length === 0
    ? '_(none)_'
    : evidence
        .flatMap((e) => (e.files ?? []).map((f) => `- \`${e.beat}--${f.name}\` — ${f.bytes} bytes, sha256:${f.sha256}`))
        .join(String.fromCharCode(10))
 || '_(none)_',
  '',
  '## Screens',
  '',
  ...shots.map((s2) => `- \`${s2.file}\` (${s2.bytes} bytes, sha256:${s2.sha256}) — ${s2.note}`),
  '',
];
const transcriptPath = path.join(OUT, 'transcript.md');
fs.writeFileSync(transcriptPath, `${lines.join('\n')}\n`);
fs.writeFileSync(
  path.join(OUT, 'seat.json'),
  `${JSON.stringify({ commit, build: stamp, port, ask: ASK, dry: DRY, wallMs, runMs, boundHit, snapshots, beats: { declared: BEATS, reached: [...reached], missed: missedBeats },
      checkpoint: seat.checkpoint, voids, evidence, ledger, shots, files: seat.files, turns: seat.turns }, null, 2)}\n`,
);

console.log('');
log(`beats ${reached.size} of ${BEATS.length} declared${missedBeats.length ? ` — MISSED: ${missedBeats.join(', ')}` : ''}`);
log(`voided ${voids.length} of ${BEATS.length}${voids.length ? ` — ${voids.map((v) => v.beat).join(', ')}` : ''}`);
/*
 * `snapshots N of N beats`: a beat with no second witness is a beat this seat
 * cannot speak about. Counted against the DECLARED beats, not against however
 * many snapshots happened to be taken.
 */
const tookSnapshot = new Set(snapshots.filter((x) => x.sha256 !== null).map((x) => x.beat));
const beatsWithSnapshot = BEATS.filter((b) => tookSnapshot.has(b)).length;
log(`snapshots ${beatsWithSnapshot} of ${BEATS.length} beats${beatsWithSnapshot < BEATS.length ? ' — CANNOT DECIDE on the rest' : ''}`);

const cp = seat.checkpoint;
log(
  cp === null
    ? 'migrated — no checkpoint resolved for this session'
    : cp.refused !== undefined
      ? `migrated 0 of ${cp.total} — REFUSED: ${cp.refused}`
      : `migrated ${cp.migrated} of ${cp.total} — ${cp.reason ?? cp.error ?? ''}${cp.chartsServed === undefined ? '' : ` (${cp.chartsServed} chart(s) served)`}`,
);log(`turns ${seat.turns.length} · wall ${(wallMs / 1000).toFixed(1)}s · screens ${shots.length} · observations ${ledger.length} (${differs.length} differing)`);
log(`transcript: ${path.relative(REPO, transcriptPath)}`);
/* Exit 2 is "this run does not describe a seat" and outranks 1 ("the product
   differed from expectation"): a run that skipped a beat has not earned the
   right to report a finding about the beats it did reach. */
process.exitCode =
  missedBeats.length > 0 || voids.length > 0 || beatsWithSnapshot < BEATS.length
    ? 2
    : differs.length === 0
      ? 0
      : 1;
