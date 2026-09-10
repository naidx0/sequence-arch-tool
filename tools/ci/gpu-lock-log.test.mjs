import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import url from 'node:url';

/**
 * THE LOCK LOG'S PLANTED CASES — protocol amendment of 2026-09-06.
 *
 * The lock file is deleted on release, so it can never say who held the card
 * tonight or for how long. `gpu.lock.log` is that history: the full lock line on
 * take, `released lane=… at=… held=… holder=… models=…` on release, append-only.
 *
 * The case that matters is the LAST one: a run that dies by signal must still
 * write its release line. A history that records only tidy exits would be
 * missing exactly the nights worth reading — this window's own run crashed at
 * 00:02:33, and the crash is the event a card owner needs.
 *
 * Each case gets its own temporary lock directory, so none of them can touch the
 * real card lock. `SEQUENCE_GPU_LOCK` is undefaulted precisely so this is
 * possible without knowing where anybody's notes live.
 */
const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const LOCK_CLI = path.join(HERE, 'gpu-lock.mjs');

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpu-lock-'));
  return { dir, lock: path.join(dir, 'gpu.lock'), log: path.join(dir, 'gpu.lock.log') };
}

const envFor = (s) => ({ ...process.env, SEQUENCE_GPU_LOCK: s.lock, SEQUENCE_GPU_LANE: 'testlane' });

const runCli = (s, args) =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, [LOCK_CLI, ...args], { env: envFor(s), stdio: 'ignore' });
    p.on('exit', (code) => resolve(code ?? 0));
  });

const readLog = (s) => (fs.existsSync(s.log) ? fs.readFileSync(s.log, 'utf8').trim().split(/\r?\n/) : []);

test('take appends the full lock line, release appends a released line with held seconds', async () => {
  const s = sandbox();
  try {
    await runCli(s, ['take', '--pid', String(process.pid), '--what', 'a planted case']);
    let lines = readLog(s);
    assert.strictEqual(lines.length, 1, 'one line on take');
    assert.match(lines[0], /^lane=testlane since=\S+ pid=\d+ born=\S+ what=a planted case$/);

    await runCli(s, ['release']);
    lines = readLog(s);
    assert.strictEqual(lines.length, 2, 'append-only: the take line is still there');
    /*
     * The release line gained a `models=` field on 2026-09-07: releasing is
     * evidence-bearing in the same way taking is, and with `pid=none` the
     * resident-model count is the only staleness input still available. The
     * anchored end is kept so the line cannot grow silently again — a new field
     * fails this and gets read by a person.
     */
    assert.match(
      lines[1],
      /^released lane=testlane at=\S+ held=\d+ holder=(alive|gone|unknown|none) models=(\d+|unknown)$/,
    );
    assert.ok(!fs.existsSync(s.lock), 'and the lock itself is gone');
  } finally {
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test('held is read from the lock being released, not from a timer in this process', async () => {
  /*
   * A release must be able to report the hold of a lock IT DID NOT WRITE — that
   * is the ordinary case when a run dies and a person clears the card by hand.
   * A process-local timer would report zero and quietly understate every one of
   * those, which is the reading a card owner would act on.
   */
  const s = sandbox();
  try {
    const since = new Date(Date.now() - 3_600_000).toISOString().replace(/\.\d+Z$/, 'Z');
    fs.writeFileSync(s.lock, `lane=other since=${since} pid=1 born=${since} what=someone else\n`);
    await runCli(s, ['release']);
    const line = readLog(s).at(-1);
    const held = Number(/held=(\d+)/.exec(line)?.[1]);
    assert.ok(held >= 3_500 && held <= 3_700, `an hour-old lock reports about 3600 s, got ${held}`);
  } finally {
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test('a lock with an unreadable since reports held=unknown rather than guessing', async () => {
  const s = sandbox();
  try {
    fs.writeFileSync(s.lock, 'lane=other pid=1 what=no since field\n');
    await runCli(s, ['release']);
    assert.match(readLog(s).at(-1), /held=unknown/);
  } finally {
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test('releasing nothing writes nothing — the log records holds, not attempts', async () => {
  const s = sandbox();
  try {
    await runCli(s, ['release']);
    assert.deepStrictEqual(readLog(s), [], 'no lock, no line');
  } finally {
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test('a run that dies by signal still gets a release line — written by whoever notices', async () => {
  /*
   * THE CASE THIS EXISTS FOR, and it was written the other way round first.
   *
   * The first version asserted that the killed run releases its own card. It
   * FAILED, and the failure is the finding: on Windows a signal sent to another
   * process becomes TerminateProcess, no handler runs, and the lock is stranded.
   * The wrapper's header had claimed release "on every exit path, including a
   * signal", which was simply untrue on this platform.
   *
   * No in-process code can fix that — the process is gone before it could act.
   * So the invariant is not "every run writes its own release"; it is EVERY HOLD
   * EVENTUALLY GETS A RELEASE LINE, and a hold ended by an uncatchable kill has
   * that line written by the next run, which can decide the dead holder from the
   * pid and born fields. This asserts the whole sequence: stranded, then reaped,
   * then recorded as stale.
   */
  const s = sandbox();
  try {
    const child = spawn(
      process.execPath,
      [LOCK_CLI, 'run', '--what', 'a run that will be killed', '--', process.execPath, '-e', 'setInterval(() => {}, 1000)'],
      { env: envFor(s), stdio: 'ignore' },
    );
    for (let i = 0; i < 100 && !fs.existsSync(s.lock); i += 1) {
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(fs.existsSync(s.lock), 'the run took the card');
    assert.strictEqual(readLog(s).length, 1, 'and logged the take');

    const exited = new Promise((r) => child.on('exit', r));
    child.kill('SIGTERM');
    await exited;
    await new Promise((r) => setTimeout(r, 300));

    /* On a platform that delivers the signal the wrapper releases itself; on one
       that does not, the lock is stranded. BOTH are acceptable here — what is
       not acceptable is the card staying held after the next run comes along. */
    const strandedHere = fs.existsSync(s.lock);

    const code = await runCli(s, ['run', '--what', 'the next run', '--', process.execPath, '-e', '0']);
    assert.strictEqual(code, 0, 'the next run was not refused by a dead holder');
    assert.ok(!fs.existsSync(s.lock), 'and the card is free afterwards');

    const lines = readLog(s);
    const releases = lines.filter((l) => l.startsWith('released '));
    assert.ok(releases.length >= 1, 'the killed hold produced a release line');
    /*
     * TWO RELEASE PATHS, TWO KINDS OF EVIDENCE, and the line says which.
     *
     * A HOLDER releasing carries `models=` — what the card looked like when
     * it let go, because releasing is evidence-bearing in the same way
     * taking is. A REAPER breaking a stale lock carries `stale=holder-gone`,
     * which is the justification for breaking someone else's lock and the
     * only evidence that matters for that act.
     *
     * Asserted as a choice of two rather than loosened to `.*`: a release
     * line that carries neither is a release nobody can audit.
     */
    assert.match(
      releases[0],
      /^released lane=testlane at=\S+ held=\d+ (holder=(alive|gone|unknown|none) models=(\d+|unknown)|stale=holder-gone)/,
    );
    if (strandedHere) {
      assert.match(releases[0], /stale=holder-gone/, 'a reaped hold says so');
    }
  } finally {
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test('a lock that names no birth is NEVER reaped — it is refused and left for a person', async () => {
  /*
   * The half that proves the reaper is a reaper and not a bulldozer. Every lock
   * written before `born` existed names none, and "cannot be decided" must not
   * collapse into "gone" — that would hand one lane's card to another while the
   * first was still using it. Absence of a signal is not evidence of absence.
   */
  const s = sandbox();
  try {
    fs.writeFileSync(s.lock, 'lane=other since=2026-09-06T00:00:00Z pid=999999 born=unknown what=old format\n');
    const code = await runCli(s, ['run', '--what', 'should be refused', '--', process.execPath, '-e', '0']);
    assert.strictEqual(code, 3, 'an undecidable lock is refused, not reaped');
    assert.ok(fs.existsSync(s.lock), 'and it is still there');
    assert.deepStrictEqual(readLog(s), [], 'nothing was recorded as released');
  } finally {
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

/* ── `check`: may I make a model call right now? ──────────────────────────── */

test('check says the card is free when it is', async () => {
  const s = sandbox();
  try {
    assert.strictEqual(await runCli(s, ['check']), 0);
  } finally {
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test('check allows a lane that already holds the card', async () => {
  const s = sandbox();
  try {
    fs.writeFileSync(s.lock, 'lane=testlane since=2026-09-06T00:00:00Z pid=1 born=x what=mine\n');
    assert.strictEqual(await runCli(s, ['check']), 0, 'my own hold is mine to spend');
  } finally {
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});

test('check REFUSES when another lane holds the card — the case written after breaking it', async () => {
  /*
   * On 2026-09-06 a live end-to-end verification of the subject-less refusal
   * POSTed two asks to a locally started app. The first was refused before any
   * provider call, which was the point of the check. The second named a file, so
   * it ran a real lesson — and this machine's ~/.sequence/ai.json points the app
   * at http://127.0.0.1:11434. One granite call on the GPU while another lane
   * held the card.
   *
   * Nothing in the app announces "this spends the card": the provider is a
   * config file nobody reads at the moment they run a product check. So the rule
   * cannot live in a head, and this is where it lives instead.
   */
  const s = sandbox();
  try {
    fs.writeFileSync(s.lock, 'lane=mlharness since=2026-09-06T00:00:00Z pid=1 born=x what=a judge pass\n');
    assert.strictEqual(await runCli(s, ['check']), 3, 'another lane holds it — exit 3, same as run');
    assert.ok(fs.existsSync(s.lock), 'and check never touches the lock');
    assert.deepStrictEqual(readLog(s), [], 'nor writes to the log — it only asks');
  } finally {
    fs.rmSync(s.dir, { recursive: true, force: true });
  }
});
