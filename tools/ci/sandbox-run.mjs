#!/usr/bin/env node
/**
 * THE SANDBOX LOCK — Windows Sandbox is one instance per MACHINE, not per lane.
 *
 *   node tools/ci/sandbox-run.mjs check
 *   node tools/ci/sandbox-run.mjs run --what "the 0.1.0 installer" --share C:\SandboxShare
 *
 * ── WHY THIS EXISTS, WITH THE INCIDENT THAT PAID FOR IT ───────────────────
 *
 * 2026-09-10: this lane launched a sandbox while ML BUILD had one running, then
 * cleared its own by running `Stop-Process` on `WindowsSandboxServer`. That is
 * a machine-wide service. It does not end "my" sandbox, it ends THE sandbox, and
 * ML BUILD's run died mid-download. Neither lane could see the other, so neither
 * could have known — which is the part a driver fixes and politeness does not.
 *
 * ── BUSY AND OWNER ARE TWO QUESTIONS, ANSWERED BY TWO DIFFERENT SOURCES ───
 *
 * `vmmemWindowsSandbox` is the authority on whether a sandbox is running. It is
 * the kernel's own answer and no lane can forget to update it. But a process
 * name cannot say WHOSE it is, and a refusal that cannot name the owner sends
 * the reader to Task Manager to guess.
 *
 * So a lock file beside it names the owner — and the two are kept separate on
 * purpose. If the machine says busy and no lock exists, the honest answer is
 * "busy, owner unknown", NOT a guess and NOT "free". A lane that launched
 * without this driver is exactly the lane that leaves no lock, and reading a
 * missing lock as a free machine would collide with precisely the run this file
 * exists to protect.
 *
 * The reverse — a lock with no sandbox process — is a stale lock from a lane
 * that was killed. That does not block: the machine is genuinely free, and the
 * refusal is about the machine, not about the file.
 *
 * ── THE PATH IS NOT IN THIS FILE ──────────────────────────────────────────
 *
 * `SEQUENCE_SANDBOX_LOCK` gives the lock's path and `SEQUENCE_SANDBOX_LANE`
 * this lane's name, for the same reason `gpu-lock.mjs` takes its path from the
 * environment: the lock is a property of the machine the lanes share, not of
 * any one checkout, and a default baked in here would be wrong on the first
 * machine that put it somewhere else.
 *
 * On a machine running several lanes, point `SEQUENCE_SANDBOX_LOCK` at ONE
 * shared file — the same place the card lock lives, whatever that is here —
 * and give each lane its own `SEQUENCE_SANDBOX_LANE`. A lock only answers
 * "whose" if every lane names the same path; two lanes with two lock files is
 * the no-lock case wearing a lock's clothes.
 *
 * The concrete value is deliberately NOT written here. `gpu-lock.mjs` says the
 * same thing three lines from the top and it is the same reason twice: the path
 * is a property of one machine, not of this repository, and a real one written
 * into a public file publishes somebody's home directory. That is not
 * hypothetical — the first cut of this header carried an absolute path through
 * a personal note vault, and the release mirror's scanner refused the publish
 * over it.
 *
 * ── THE LOG IS THE HISTORY THE LOCK CANNOT KEEP ──────────────────────────
 *
 * The lock is deleted on release, so it can never answer "who held the sandbox
 * tonight, and for how long". Every writer APPENDS to `sandbox.lock.log` beside
 * it, in the dialect ML BUILD already writes there:
 *
 *   TAKE     lane=<lane> host=<host> since=<Z> pid=<pid> born=<Z> what=<line>
 *   RELEASE  <the same line, as it stood in the lock being released>
 *
 * This deliberately does NOT use `gpu.lock.log`'s `released … at= held=` shape.
 * That file has one writer per line-format; this one is shared with another
 * lane that got here first, and a second dialect in a shared append-only log is
 * a parsing trap for whoever reads it later. `held` is recoverable by
 * subtracting the `since=` that RELEASE carries.
 *
 * A failure to append never blocks a release: recording that the sandbox was
 * freed matters less than freeing it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const LOCK = process.env.SEQUENCE_SANDBOX_LOCK ?? '';
const LANE = process.env.SEQUENCE_SANDBOX_LANE ?? 'sequence';
const nowZ = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

/** Beside the lock, in the same directory, for the same reason: not hardcoded. */
const LOG = LOCK ? path.join(path.dirname(LOCK), 'sandbox.lock.log') : '';

/** Append one line. Never throws — see the header. */
const append = (line) => {
  if (!LOG) return;
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, `${line}\n`);
  } catch (e) {
    console.error(`sandbox-run: could not append to the log (${e instanceof Error ? e.message : e})`);
  }
};

/**
 * This process's real start time, UTC, or null when it cannot be read.
 *
 * Null is not "now". A lock claiming a birth it did not measure is worse than
 * one admitting it could not, because the next lane would act on it. Same
 * reasoning as `gpu-lock.mjs`: `pid` alone cannot decide a dead holder,
 * because pids are recycled and the check then answers yes about a stranger.
 */
function bornOfSelf() {
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${process.pid}" -ErrorAction SilentlyContinue; ` +
          "if ($p) { $p.CreationDate.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }",
      ],
      { encoding: 'utf8', timeout: 15_000 },
    ).trim();
    return out === '' ? null : out;
  } catch {
    return null;
  }
}

/* The process names that mean a sandbox is up. `vmmemWindowsSandbox` is the VM's
   memory process and lives for the whole session; `WindowsSandboxServer` is the
   host service. Either one present means busy. */
export const SANDBOX_PROCESSES = ['vmmemWindowsSandbox', 'WindowsSandboxServer'];

/**
 * The decision, as a pure function, so the refusal can be tested without a
 * sandbox running. `busy` comes from the machine, `lock` from the file.
 */
export function decide({ busy, lock, host }) {
  /* THE LOCK IS IN THE VAULT, WHICH SYNCS BETWEEN MACHINES; THE SANDBOX IS NOT.
     A lock written by a lane on another host is a true statement about that
     machine and says nothing about this one, so it can neither name the owner
     of the sandbox running here nor be declared stale from here. Dropping it
     is the only reading that does not put someone else's name on our process
     or delete a lock that is doing its job elsewhere. */
  const foreign = lock && host && lock.host !== 'unknown' && lock.host !== host;
  const mine = foreign ? null : lock;

  if (!busy) {
    if (foreign) {
      return {
        ok: true,
        note:
          `the lock names ${lock.lane} on ${lock.host}, a different machine — it says nothing ` +
          'about this one, and is left alone',
      };
    }
    return mine
      ? { ok: true, note: `a stale lock names ${mine.lane}, but no sandbox is running — taking it` }
      : { ok: true, note: null };
  }
  if (foreign) {
    return {
      ok: false,
      reason:
        'Windows Sandbox is already running here, and the only lock on file was written by ' +
        `${lock.lane} on ${lock.host} — a different machine, so it does not say whose this is. ` +
        'Nothing was launched. Treat this as owner unknown: check with the other lanes, and ' +
        'never Stop-Process the sandbox to clear it, because that service is machine-wide and ' +
        "ends somebody else's run, not yours.",
    };
  }
  if (lock) {
    return {
      ok: false,
      reason:
        `Windows Sandbox is already running and it is ${lock.lane}'s. ` +
        `Held since ${lock.since} for: ${lock.what}. ` +
        'One sandbox runs per machine, so this run would collide with theirs. ' +
        `Ask ${lock.lane}, or wait.`,
    };
  }
  return {
    ok: false,
    reason:
      'Windows Sandbox is already running, and no lock file says whose. Nothing was launched. ' +
      'A lane that started a sandbox without this driver leaves no lock, so "no lock" is not ' +
      '"free" — check with the other lanes before forcing anything, and never Stop-Process the ' +
      "sandbox to clear it: that service is machine-wide and ends somebody else's run, not yours.",
  };
}

export function readLock() {
  if (!LOCK || !fs.existsSync(LOCK)) return null;
  try {
    const raw = fs.readFileSync(LOCK, 'utf8').trim();
    const fields = Object.fromEntries(
      raw.split(/\s+(?=\w+=)/).map((pair) => {
        const i = pair.indexOf('=');
        return [pair.slice(0, i), pair.slice(i + 1)];
      }),
    );
    return {
      lane: fields.lane ?? 'unknown',
      host: fields.host ?? 'unknown',
      since: fields.since ?? 'unknown',
      what: fields.what ?? 'unstated',
    };
  } catch {
    return null;
  }
}

export function sandboxBusy() {
  try {
    const out = execFileSync('tasklist', ['/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    return SANDBOX_PROCESSES.some((n) => out.includes(`"${n}.exe"`) || out.includes(`"${n}"`));
  } catch {
    /* The probe failed. That is not evidence the machine is free, and guessing
       "free" here is how two sandboxes get launched. Refuse by claiming busy. */
    return true;
  }
}

function writeLock(what) {
  if (!LOCK) return;
  const born = bornOfSelf();
  const line =
    `lane=${LANE} host=${os.hostname()} since=${nowZ()} pid=${process.pid} ` +
    `born=${born ?? 'unknown'} what=${what}`;
  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  fs.writeFileSync(LOCK, `${line}\n`);
  append(`TAKE     ${line}`);
  console.log(line);
  if (born === null) {
    console.error(
      "sandbox-run: WARNING — could not read this process's start time; wrote born=unknown. A " +
        'recycled pid cannot be ruled out for this hold.',
    );
  }
}

let released = false;
function releaseLock() {
  if (released) return;
  released = true;
  try {
    if (!LOCK || !fs.existsSync(LOCK)) return;
    const line = fs.readFileSync(LOCK, 'utf8').trim();
    /* Only ever release our own hold. A lock this lane did not write belongs to
       a run still in progress, and deleting it would hand the machine to the
       next lane while its owner is still using it. */
    if (!line.startsWith(`lane=${LANE} `)) {
      console.error(
        `sandbox-run: the lock is not ours (${line.split(' ')[0]}) — leaving it alone.`,
      );
      return;
    }
    fs.unlinkSync(LOCK);
    append(`RELEASE  ${line}`);
  } catch {
    /* never let a failed release throw out of an exit path */
  }
}

function wsbFor(share) {
  return [
    '<Configuration>',
    '  <MappedFolders>',
    '    <MappedFolder>',
    `      <HostFolder>${share}</HostFolder>`,
    '      <SandboxFolder>C:\\Installer</SandboxFolder>',
    '      <ReadOnly>true</ReadOnly>',
    '    </MappedFolder>',
    '  </MappedFolders>',
    '  <Networking>Enable</Networking>',
    '  <MemoryInMB>8192</MemoryInMB>',
    '</Configuration>',
    '',
  ].join('\n');
}

function main(argv) {
  const cmd = argv[0] ?? 'check';
  const arg = (name, dflt) => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? dflt : argv[i + 1];
  };

  const busy = sandboxBusy();
  const lock = readLock();
  const decision = decide({ busy, lock, host: os.hostname() });

  if (cmd === 'check') {
    if (decision.ok) {
      console.log(`sandbox: FREE${decision.note ? ` — ${decision.note}` : ''}`);
      return 0;
    }
    console.log(`sandbox: BUSY — ${decision.reason}`);
    return 1;
  }

  if (cmd !== 'run') {
    console.error(`sandbox-run: unknown command "${cmd}". Use check or run.`);
    return 2;
  }

  const what = arg('what', '');
  const share = arg('share', '');
  if (!what || !share) {
    console.error('sandbox-run: run needs --what "<line>" and --share <host folder>');
    return 2;
  }

  if (!decision.ok) {
    console.error(`sandbox-run: REFUSED — ${decision.reason}`);
    return 1;
  }
  if (decision.note) console.log(`sandbox-run: ${decision.note}`);
  if (!LOCK) {
    console.error(
      'sandbox-run: WARNING — SEQUENCE_SANDBOX_LOCK is not set, so this run leaves no lock and the ' +
        'next lane to check will be told "busy, owner unknown". Set it.',
    );
  }

  return holdAndRun({ what, share });
}

/**
 * Take the lock, launch, and give it back — the half a refusal never reaches.
 *
 * SEPARATE AND EXPORTED SO IT CAN BE TESTED WITHOUT A VM. Every test this file
 * had drove `decide`, which is the REFUSAL. The path that writes the lock, logs
 * the TAKE, and gives the machine back had never run in a test even once,
 * because running it meant launching an 8GB virtual machine on the one instance
 * this whole driver exists to share. A check that cannot PASS in the state it
 * exists to check is the mirror of one that cannot fail — and the release is
 * the half that matters to the other lanes, since a lock never given back locks
 * them out of a machine nobody is using.
 *
 * `launch` is injected for exactly that reason and defaults to the real thing.
 *
 * THE RELEASE IS IN A `finally`. The `exit` handler below would catch a throw
 * too, but only by accident of Node running exit handlers on an uncaught error;
 * a `finally` says it on purpose, and holds when a future edit adds a `catch`
 * further out that would otherwise swallow the throw and keep the lock.
 */
export function holdAndRun({ what, share, launch }) {
  const wsb = path.join(share, 'sequence.wsb');
  fs.writeFileSync(wsb, wsbFor(share));
  writeLock(what);

  /* Belt and braces: `finally` covers a throw, these cover the process being
     ended out from under us before it can run. */
  process.on('exit', releaseLock);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      releaseLock();
      process.exit(130);
    });
  }

  try {
    console.log(`sandbox-run: launching ${wsb} — held by ${LANE} for: ${what}`);
    const run = launch ?? ((file) => spawnSync('WindowsSandbox.exe', [file], { stdio: 'inherit' }));
    const result = run(wsb);
    return result?.status ?? 0;
  } finally {
    releaseLock();
  }
}

/* Only act when run as a program: importing this for `decide` must launch nothing. */
const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invoked && import.meta.url === new URL(`file:///${invoked.replace(/\\/g, '/')}`).href) {
  process.exit(main(process.argv.slice(2)));
}
