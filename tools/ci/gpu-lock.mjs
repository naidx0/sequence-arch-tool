#!/usr/bin/env node
/**
 * THE CARD LOCK — written so a card owner can decide a dead holder.
 *
 *   node tools/ci/gpu-lock.mjs run --what "the two makemore runs" -- node bench.mjs
 *   node tools/ci/gpu-lock.mjs take --what "..." --pid 1234
 *   node tools/ci/gpu-lock.mjs release
 *   node tools/ci/gpu-lock.mjs show
 *
 * One line, five fields:
 *
 *   lane=<lane> since=<UTC Z> pid=<holder pid> born=<holder start, UTC Z> what=<line>
 *
 * ── WHY pid AND born, AND WHY NEITHER ALONE ───────────────────────────────
 *
 * A lock is a promise that somebody is using the card. The question a card owner
 * has to answer is whether that promise is still true, and `since` cannot answer
 * it: a lane that died at minute two and a lane still working at minute fifty
 * look identical.
 *
 * `pid` alone cannot answer it either, and this is the failure that makes the
 * pair necessary rather than tidy: pids are recycled. A holder that died can
 * have its number reissued to an unrelated process, and a check of "is pid 1234
 * alive?" then answers **yes** about somebody else's shell. The lock would never
 * clear.
 *
 * `born` — the holder's own start time — settles it. A live process whose start
 * time matches the lock is the holder; a live process whose start time does not
 * is a recycled number and the lock is stale. Every lock written before this
 * change answers "cannot be decided", which is the honest reading of a line that
 * carries neither field.
 *
 * ── THE HOLDER IS THE RUN, NOT THE WRITER ─────────────────────────────────
 *
 * `run` is the mode to use: it writes the lock, spawns the command, and deletes
 * the lock when that command exits. The holder named in the file is THIS
 * wrapper, which lives for exactly as long as the run — not the child, whose
 * start time is not yet readable the instant it is spawned, and not the shell
 * that invoked us, which exits immediately and would make the lock read as dead
 * the moment it was written.
 *
 * ── THE PATH IS NOT IN THIS FILE ──────────────────────────────────────────
 *
 * ── THE LOG IS THE HISTORY THE LOCK CANNOT KEEP ──────────────────────────
 *
 * The lock file answers "is the card held right now" and is deleted on release,
 * so it can never answer "who held it tonight, and for how long". Protocol
 * amendment of 2026-09-06: every writer APPENDS one line to `gpu.lock.log`
 * beside the lock — the full lock line on take, and
 *
 *   released lane=<lane> at=<UTC Z> held=<seconds>
 *
 * on release. Append-only, one line each, and `held` is computed from the
 * `since=` in the lock being released rather than from a timer in this process,
 * so it stays right for a lock this process did not write.
 *
 * A failure to append never blocks a release. Recording that the card was freed
 * matters less than freeing it, and a logging error that stranded the card would
 * be the tail wagging the dog.
 *
 * `SEQUENCE_GPU_LOCK` gives the lock's path. It is deliberately not defaulted to
 * a real one: the lock lives in a personal notes directory, and hardcoding that
 * path here would publish it — this repository's own release mirror refuses a
 * tree containing it. A machine sets the variable; the repository does not learn
 * where anybody's notes are.
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const LOCK = process.env.SEQUENCE_GPU_LOCK ?? '';
const LANE = process.env.SEQUENCE_GPU_LANE ?? 'sequence';
const argv = process.argv.slice(2);
const mode = argv[0] ?? 'show';
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};

if (LOCK === '') {
  console.error(
    'gpu-lock: SEQUENCE_GPU_LOCK is not set. It is the path to the machine\'s card lock, and it is ' +
      'not defaulted here on purpose — see the header.',
  );
  process.exit(2);
}

const nowZ = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');


/** Beside the lock, in the same directory, for the same reason: not hardcoded. */
const LOG = path.join(path.dirname(LOCK), 'gpu.lock.log');

/** Append one line. Never throws — see the header. */
const append = (line) => {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, `${line}\n`);
  } catch (e) {
    console.error(`gpu-lock: could not append to the log (${e instanceof Error ? e.message : e})`);
  }
};

/** Seconds between the lock's own `since=` and now, or null when unreadable. */
const heldFor = (lockText) => {
  const m = /since=(\S+)/.exec(lockText ?? '');
  if (m === null) return null;
  const t = Date.parse(m[1]);
  return Number.isFinite(t) ? Math.max(0, Math.round((Date.now() - t) / 1000)) : null;
};
/**
 * A process's real start time, UTC, or null when it cannot be read.
 *
 * Null is not "now". A lock claiming a birth it did not measure is worse than
 * one admitting it could not, because the card owner would act on it.
 */
function bornOf(pid) {
  /* `none` is a declaration that no process holds the card, so there is no
     birth to read and the reaper is knowingly out of the picture. Distinct from
     `unknown`, which means a lookup failed and nobody noticed. */
  if (pid === 'none') return 'none';
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue; ` +
          "if ($p) { $p.CreationDate.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }",
      ],
      { encoding: 'utf8', timeout: 15_000 },
    ).trim();
    return out === '' ? null : out;
  } catch {
    return null;
  }
}

const write = (pid, what) => {
  const born = bornOf(pid);
  const line =
    `lane=${LANE} since=${nowZ()} pid=${pid} born=${born ?? 'unknown'} what=${what}`;
  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  fs.writeFileSync(LOCK, `${line}\n`);
  append(line);
  console.log(line);
  if (born === null) {
    console.error(
      "gpu-lock: WARNING — could not read the holder's start time; wrote born=unknown. A recycled " +
        'pid cannot be ruled out for this hold. If this came from `--pid $$` in Git Bash, that is ' +
        'an MSYS pid Windows cannot resolve: pass a real Windows pid, or `--pid none` to declare ' +
        'that no single process holds the card.',
    );
  }
  return line;
};

let released = false;
/**
 * How many models the local server currently holds resident, or null.
 *
 * The protocol's third staleness input, asked at release time. Null on any
 * failure: a probe that cannot answer must not be reported as zero, which is
 * the reassuring direction and the one this house keeps finding.
 */
function localModelsLoaded() {
  const base = process.env.SEQUENCE_AI_BASE_URL ?? 'http://127.0.0.1:11434/v1';
  const root = base.replace(/\/v1\/?$/, '');
  try {
    const out = execFileSync(
      'curl',
      ['-s', '-m', '3', `${root}/api/ps`],
      { encoding: 'utf8', timeout: 6000 },
    ).trim();
    if (out === '') return null;
    const parsed = JSON.parse(out);
    return Array.isArray(parsed?.models) ? parsed.models.length : null;
  } catch {
    return null;
  }
}

const release = () => {
  /* IDEMPOTENT. The exit path and a signal handler can both reach here, and two
     release lines for one hold would make the log lie about the history it
     exists to keep. */
  if (released) return;
  if (fs.existsSync(LOCK)) {
    let held = null;
    try {
      held = heldFor(fs.readFileSync(LOCK, 'utf8'));
    } catch {
      /* unreadable — `held=unknown`, never a guess */
    }
    /*
     * RELEASING IS EVIDENCE-BEARING, IN THE SAME WAY TAKING IS.
     *
     * On 2026-09-07 this lane released a 6,693-second hold on the strength of a
     * log line it had itself written, rather than on any check that the work had
     * stopped. It had — by luck. The asymmetry that allowed it is that taking
     * felt like a claim and releasing felt like bookkeeping.
     *
     * With `pid=none` there is nothing to release AGAINST: rule 2's staleness
     * test wants age, a dead holder and an idle card, and no pid removes one
     * input and makes a second unusable. So the release line now carries the one
     * input that is still available — what the local model server says is
     * loaded — and says so whether it is reassuring or not.
     *
     * IT REPORTS, IT DOES NOT BLOCK. A logging or probe failure must never
     * strand the card; `models=unknown` is an honest cell and a stranded card is
     * not. And a loaded model is not proof of work in flight — Ollama keeps one
     * resident against a TTL — so this is evidence for a reader, not a verdict.
     */
    /*
     * THE STRONGER INPUT FIRST. `models` is the weakest of the three staleness
     * inputs, and the first version of this recorded only that one. Rule 1 of
     * the protocol requires a pid, so a release can record whether that pid was
     * still there when the card was let go — the same question the reaper asks,
     * asked by the holder about itself.
     *
     * Same discipline as `models`: alive / gone / unknown, never a reassuring
     * value from a probe that failed. `none` is its own answer, because a hold
     * that declared no owning process has no holder to check and saying
     * "unknown" there would hide a deliberate limitation behind a failure.
     */
    const lockText = (() => {
      try {
        return fs.readFileSync(LOCK, 'utf8');
      } catch {
        return '';
      }
    })();
    const pidField = fieldOf(lockText, 'pid');
    const bornField = fieldOf(lockText, 'born');
    const holder =
      pidField === 'none'
        ? 'none'
        : { true: 'alive', false: 'gone' }[String(holderAlive(Number(pidField), bornField))] ??
          'unknown';
    const loaded = localModelsLoaded();
    fs.rmSync(LOCK, { force: true });
    released = true;
    append(
      `released lane=${LANE} at=${nowZ()} held=${held ?? 'unknown'} holder=${holder} ` +
        `models=${loaded ?? 'unknown'}`,
    );
    console.log('gpu-lock: released');
    if (typeof loaded === 'number' && loaded > 0) {
      console.error(
        `gpu-lock: NOTE — ${loaded} model(s) still resident on release. Ollama keeps one against a ` +
          'TTL, so this is not proof of work in flight; it is the check a release should carry ' +
          'rather than a reason to refuse.',
      );
    }
    if (loaded === 0) {
      /*
       * THE HONEST CELL NEEDS A CLAUSE TOO.
       *
       * The note above fires only on `loaded > 0` and de-escalates, so the code
       * was protected against over-refusal and unprotected against
       * over-confidence — and `models=0` is the reading that ENDS an inquiry.
       * It means the local server holds nothing resident, which is equally true
       * of work that never touched the local server, a run between model loads,
       * and a process still writing rows after its model unloaded.
       */
      console.error(
        'gpu-lock: NOTE — models=0 means the local server holds none resident. It is not evidence ' +
          'that work stopped: a run between loads, work on another endpoint, and a process still ' +
          'writing after its model unloaded all look the same from here.',
      );
    }
  } else {
    console.log('gpu-lock: nothing to release');
  }
};

/**
 * Is the process named by a lock still the holder?
 *
 * Returns `true` (alive and the same process), `false` (definitively gone, or a
 * recycled pid now belonging to something else), or `null` — CANNOT BE DECIDED.
 *
 * The three-way answer is the whole point. Folding "cannot be decided" into
 * "gone" would reap a live lane's card the first time PowerShell was slow, and
 * folding it into "alive" would strand every lock written before `born` existed.
 * A lock that names no birth is never reaped; it is reported and left for a
 * person, because absence of a signal is not evidence of absence.
 *
 * ── THE PROBE IS `Win32_Process`, AND THAT IS NOT AN IMPLEMENTATION DETAIL ──
 *
 * Do not "simplify" this to `process.kill(pid, 0)` or a bare `OpenProcess`.
 * On Windows a process object outlives the process while ANY handle to it is
 * open, and a spawned child's handle is held by its parent until released — so
 * a handle-based probe answers ALIVE about a child that has already exited.
 * ML BUILD measured it on ml-harness (`32673f0`) and it flaked a push-lock test
 * one run in six. Reproduced here on this machine, six runs each:
 *
 *   OpenProcess, parent still holding the handle    6 of 6 read ALIVE  (wrong)
 *   OpenProcess, after the handle is dropped        0 of 6 read alive
 *   Get-CimInstance Win32_Process                   0 of 6 read alive  (right)
 *
 * WMI enumerates running processes, not process objects, so it is immune to the
 * retention that fools the handle probe. That is why this call is worth its
 * PowerShell round-trip.
 *
 * ── AND THIS DRIVER NEVER ASKS ABOUT A CHILD IT SPAWNED ────────────────────
 *
 * Both callers pass a pid parsed out of the LOCK FILE, never a `spawn()`
 * return. `run` mode is the one that spawns, and it deliberately writes its own
 * pid rather than the child's (see the block above the `spawn` call) — so even
 * a handle-based probe would have nothing of ours to be wrong about. The two
 * defences are independent, which is why both are written down.
 */
function holderAlive(pid, born) {
  if (!Number.isFinite(pid) || born === undefined || born === 'unknown') return null;
  let out;
  try {
    out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue; ` +
          "if ($p) { $p.CreationDate.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') } else { 'GONE' }",
      ],
      { encoding: 'utf8', timeout: 15_000 },
    ).trim();
  } catch {
    return null; /* the probe failed; that is not evidence the holder died */
  }
  if (out === '') return null;
  if (out === 'GONE') return false;
  /* A live pid whose birth disagrees with the lock is a RECYCLED number, and the
     holder it names is gone. This is the case `since` alone can never see. */
  return out === born;
}

/*
 * TWO BACKSLASHES, AND THE FIRST VERSION HAD ONE.
 *
 * In a template literal an unrecognised escape collapses, so a lone
 * backslash-S became a bare S and the regex read `pid=(S+)` — which matches
 * nothing. The reaper could therefore never read a pid, answered "cannot be
 * decided" for every lock, and refused exactly the stale ones it was written
 * to clear. The planted case caught it: the probe said GONE and the next run
 * still exited 3.
 */
const fieldOf = (text, name) =>
  new RegExp(name + '=(' + '\\S+)').exec(text ?? '')?.[1];

/**
 * Clear a lock whose holder is provably gone, and record the hold that ended.
 * Returns true when it reaped, false when the lock stands.
 */
function reapIfDead(text) {
  const pid = Number(fieldOf(text, 'pid'));
  const born = fieldOf(text, 'born');
  const alive = holderAlive(pid, born);
  if (alive !== false) return false;
  const held = heldFor(text);
  const lane = fieldOf(text, 'lane') ?? 'unknown';
  fs.rmSync(LOCK, { force: true });
  append(`released lane=${lane} at=${nowZ()} held=${held ?? 'unknown'} stale=holder-gone`);
  console.error(`gpu-lock: reaped a stale lock — pid ${pid} is gone (lane=${lane}, held ${held ?? '?'}s)`);
  return true;
}

/*
 * `check` — "may I make a model call right now?"
 *
 * WRITTEN AFTER BREAKING THE RULE IT ENFORCES. On 2026-09-06 I verified a new
 * refusal end to end by POSTing two asks to a locally started app. The first was
 * refused before any provider call, which was the point. The SECOND named a file,
 * so it ran a real lesson — and `~/.sequence/ai.json` points this machine's app
 * at http://127.0.0.1:11434, the local runtime. That is one granite call on the
 * GPU while another lane held the card.
 *
 * Nothing in the app says "this will spend the card": the ask path looks like a
 * product check, and the provider it resolves is a config file nobody reads at
 * the moment they run one. So the rule cannot live in anybody's head.
 *
 *   node tools/ci/gpu-lock.mjs check    # 0 = free or mine, 3 = another lane
 *
 * Exit 3 is the same code `run` uses for a held card, so a script can gate on
 * either without knowing which it called.
 */
if (mode === 'check') {
  if (!fs.existsSync(LOCK)) {
    console.log('gpu-lock: card free');
    process.exit(0);
  }
  const text = fs.readFileSync(LOCK, 'utf8');
  const lane = /lane=(\S+)/.exec(text)?.[1] ?? 'unknown';
  if (lane === LANE) {
    console.log(`gpu-lock: held by this lane (${lane}) — yours to spend`);
    process.exit(0);
  }
  console.error(`gpu-lock: HELD BY ANOTHER LANE — do not make a model call:\n  ${text.trim()}`);
  process.exit(3);
}

if (mode === 'show') {
  console.log(fs.existsSync(LOCK) ? fs.readFileSync(LOCK, 'utf8').trim() : '(no lock — card free)');
} else if (mode === 'release') {
  release();
} else if (mode === 'take') {
  /*
   * `--pid none` IS A DECLARATION, NOT A MISSING VALUE.
   *
   * A hold that spans several commands — an agent's, typically — has no single
   * process behind it, and the honest thing is to say so. Writing a pid nobody
   * can check is worse: `born` then reads `unknown`, which resolves to
   * cannot-decide for the life of the hold, and the birth field exists
   * precisely to rule out a recycled pid.
   *
   * This machine makes that easy to do by accident. `$$` in Git Bash is an
   * MSYS pid, and `Get-CimInstance Win32_Process` cannot see one, so
   * `--pid $$` from a bash shell ALWAYS lands on born=unknown.
   */
  const pidArg = flag('pid');
  const pid = pidArg === 'none' ? 'none' : Number(pidArg);
  if (pid !== 'none' && !Number.isFinite(pid)) {
    console.error(
      'gpu-lock: take needs --pid <the pid that will hold the card>, or `--pid none` when no ' +
        'single process does. Prefer `run`.',
    );
    process.exit(2);
  }
  write(pid, flag('what') ?? 'unstated');
} else if (mode === 'run') {
  const sep = argv.indexOf('--');
  if (sep < 0 || sep === argv.length - 1) {
    console.error('gpu-lock: run needs `-- <command...>`');
    process.exit(2);
  }
  const cmd = argv.slice(sep + 1);
  if (fs.existsSync(LOCK)) {
    /* A held card is refused — unless its holder is provably gone, in which case
       the lock is a leftover and clearing it is the honest move. A lock that
       cannot be decided is still refused: see holderAlive. */
    const text = fs.readFileSync(LOCK, 'utf8');
    if (!reapIfDead(text)) {
      console.error(`gpu-lock: REFUSED — the card is held:\n  ${text.trim()}`);
      process.exit(3);
    }
  }
  /*
   * THE WRAPPER IS THE HOLDER, and the lock is written BEFORE the child starts.
   *
   * The first version named the child's pid and wrote the lock after `spawn`.
   * Two defects, both found by running it: a window in which the run had started
   * and the card was unlocked (a stand-in child read the file and got ENOENT),
   * and `born=unknown`, because the child's start time is not yet readable the
   * instant it is spawned — and a lock that cannot state a birth is exactly the
   * lock this change exists to stop writing.
   *
   * This process lives for precisely as long as the run — it exits when the
   * child exits — and its own pid and start time are readable immediately. So it
   * is the honest holder.
   */
  write(process.pid, flag('what') ?? cmd.join(' '));
  const child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit', shell: false });
  /*
   * Released on every exit path this process can OBSERVE — a normal exit, a
   * crash in the child, and a SIGINT/SIGTERM that the platform delivers.
   *
   * IT IS NOT RELEASED ON A KILL THIS PROCESS CANNOT CATCH, and the planted case
   * measures exactly that: on Windows a signal sent to another process becomes
   * TerminateProcess, no handler runs, and the lock is stranded. No in-process
   * code can fix that — the process is gone before it could act.
   *
   * So the release line for such a hold is written by WHOEVER NOTICES, in the
   * reaper below. That is what `pid` and `born` were added for: a stranded lock
   * is decidable, and a decidable stranded lock can be cleared and recorded
   * rather than waiting for a person. The invariant the log keeps is not "every
   * run writes its own release" — it is "every hold eventually gets a release
   * line", which is the one that can actually be held to.
   */
  const done = () => release();
  child.on('exit', (code) => {
    done();
    process.exit(code ?? 0);
  });
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      try {
        child.kill(sig);
      } catch {
        /* already gone */
      }
      done();
      process.exit(1);
    });
  }
} else {
  console.error(`gpu-lock: unknown mode ${mode}`);
  process.exit(2);
}
