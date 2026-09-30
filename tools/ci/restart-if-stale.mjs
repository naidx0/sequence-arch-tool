#!/usr/bin/env node
/**
 * RESTART THE RUNNING APP WHEN THE CODE HAS MOVED PAST IT.
 *
 * The app on 4173 went stale after most pushes on 2026-09-05 and was caught by
 * `check-running-build.mjs` every time — which is the check working and the
 * PROCESS failing: a step that has to be remembered after every push is a step
 * that will be forgotten, and a day-old server already passed for the product
 * once, costing a seat read, a 2m13s turn and a "no lesson.json" that were all
 * fixed hours earlier.
 *
 *   node tools/ci/restart-if-stale.mjs [port...]      # check, restart, verify
 *   node tools/ci/restart-if-stale.mjs --check [port] # report only, exit 1 if stale
 *
 * ── WHY THIS IS NOT A GIT HOOK ────────────────────────────────────────────
 *
 * A `post-push` hook that restarts servers would be a standing rule on this
 * machine, and this machine runs MORE THAN ONE agent. Another session drives
 * 4173 to read the product; a hook firing on someone else's push would kill a
 * server mid-read and the reader would see a dead page with no idea why. A
 * restart is cheap and a silent kill during someone else's measurement is not,
 * so this is a step a person or a script runs deliberately, and `pnpm restart:app`
 * is the short way to run it. (Not `pnpm restart` -- that is a reserved npm
 * lifecycle which chains `stop`/`restart`/`start` and fails on the missing
 * `stop`. Found by running the command this file's own docs handed out.)
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';

import { REBUILD, staleHalves } from './lock-guard.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const CLI = path.join(REPO, 'packages', 'analyzer', 'dist', 'cli.js');

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const ports = args.filter((a) => !a.startsWith('--')).map(Number).filter(Number.isFinite);
const targets = ports.length > 0 ? ports : [4173];

const log = (...a) => console.log('[restart]', ...a);

async function stampOf(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/build`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok ? await res.json() : { noEndpoint: true };
  } catch {
    return null;
  }
}

/**
 * The process listening on a port, and its command line.
 *
 * The command line is the ownership check: this kills a server only when it is
 * THIS repository's app. A port is not proof of identity, and killing whatever
 * happens to be listening is how a tool that means to help takes down something
 * it never understood.
 */
function listenerOn(port) {
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; ` +
          'if ($c) { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)"; ' +
          'Write-Output "$($p.ProcessId)|$($p.CommandLine)" }',
      ],
      { encoding: 'utf8', timeout: 15_000 },
    ).trim();
    if (!out) return null;
    const bar = out.indexOf('|');
    return { pid: Number(out.slice(0, bar)), cmd: out.slice(bar + 1) };
  } catch {
    return null;
  }
}

/** Which repository the running app says it is attached to, or null. */
async function servedRoot(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/status`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body?.root === 'string' ? body.root : null;
  } catch {
    return null;
  }
}

/** Same directory, whatever the separators and the case of the drive letter. */
export const sameDir = (a, b) =>
  path.resolve(a).split('\\').join('/').toLowerCase() ===
  path.resolve(b).split('\\').join('/').toLowerCase();

/**
 * The arguments a running server was given, taken from its command line.
 *
 * Keyed off `cli.js` rather than a token count. The first version took
 * `split(' ').slice(2)` and produced the right argv ONLY because this machine's
 * interpreter is `"C:\Program Files\nodejs\node.exe"` -- one space, two
 * tokens. A node installed anywhere without a space in its path would have
 * dropped the `app` subcommand and restarted the server into a usage error, on
 * a machine nobody was watching. It is exported so that failure has a test
 * rather than a machine it happens to survive on.
 *
 * Reusing them is what keeps a restart from silently changing which repository
 * is served, or on which port.
 */
export function argvAfterCli(cmd) {
  const at = cmd.indexOf('cli.js');
  if (at < 0) return null;
  const argv = cmd.slice(at + 'cli.js'.length).split(/\s+/).filter(Boolean);
  return argv.length > 0 ? argv : null;
}

let restarted = 0;
let stale = 0;

/* Importing this module for its helpers must not restart anybody's server. */
const RUN = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

for (const port of RUN ? targets : []) {
  const stamp = await stampOf(port);
  if (stamp === null) {
    log(`port ${port}: nothing listening — nothing to restart`);
    continue;
  }
  if (!stamp.noEndpoint && !stamp.stale) {
    log(`port ${port}: current — started ${stamp.startedAt}, built ${stamp.builtAt}`);
    continue;
  }
  stale += 1;
  log(`port ${port}: STALE${stamp.noEndpoint ? ' (no /api/build — it predates the check)' : ''}`);
  /*
   * REBUILD THE HALF THAT IS BEHIND, BEFORE RESTARTING.
   *
   * A restart reloads whatever is on disk. If the CLIENT bundle is what is stale,
   * restarting changes nothing at all — and that is exactly how the client half
   * of a180b036 stayed missing from the product for six hours while
   * `restart:app` reported success each time. The browser was served a bundle
   * from the previous night; a restart cannot rebuild it.
   *
   * Only the half the check names, and only when it names one: a rebuild of both
   * on every restart would make the cheap step expensive, and this is run between
   * measurements.
   */
  const halves = staleHalves(stamp);
  if (halves !== null) {
    for (const which of ['server', 'client']) {
      if (!halves[which]) continue;
      log(`port ${port}: the ${which} half is behind its source — rebuilding before restart`);
      const b = spawnSync('pnpm', REBUILD[which], { cwd: REPO, stdio: 'inherit', shell: true });
      if (b.status !== 0) {
        console.error(`[restart] the ${which} rebuild failed; not restarting into a half-built tree`);
        process.exitCode = 1;
        continue;
      }
    }
    if (halves.why !== null) log(`port ${port}: was ${halves.why}`);
  }
  if (checkOnly) continue;

  /*
   * A SEAT READ IN PROGRESS OUTRANKS A STALE BUILD.
   *
   * This is the other half of "the restart is not a git hook": a hook would kill
   * a server another session is mid-read on, and so would this command run by
   * hand at the wrong moment. `tools/ci/out/seat.lock` is the scripted seat
   * declaring the port it is reading; a live holder is refused, a dead one is
   * ignored, because a lock nobody can clear is worse than no lock.
   */
  const seatLock = path.join(REPO, 'tools', 'ci', 'out', 'seat.lock');
  if (fs.existsSync(seatLock)) {
    try {
      const held = JSON.parse(fs.readFileSync(seatLock, 'utf8'));
      let alive = false;
      try {
        process.kill(held.pid, 0);
        alive = true;
      } catch {
        alive = false;
      }
      if (alive && held.port === port) {
        log(`port ${port}: a seat run holds it (pid ${held.pid}, since ${held.since}) — NOT restarting`);
        process.exitCode = 3;
        continue;
      }
    } catch {
      /* An unreadable lock is not a hold. */
    }
  }

  const owner = listenerOn(port);
  if (!owner) {
    log(`port ${port}: could not identify the listening process — not touching it`);
    continue;
  }
  /*
   * THE OWNERSHIP TEST: ASK THE SERVER WHICH REPOSITORY IT SERVES.
   *
   * The first version matched the command line for the repo name and failed on
   * the real one -- `cli.js app --repo . --port 4173` names neither the repo nor
   * an absolute path, so a server that WAS ours was left alone as a stranger.
   * The command line is how a process was started; `/api/status` is what it is
   * actually serving, which is the question being asked.
   *
   * A different checkout of the same product on this port is left alone, and so
   * is anything that will not say. A wrong kill is worse than a stale read.
   */
  const served = await servedRoot(port);
  const isOurs = owner.cmd.includes('cli.js') && served !== null && sameDir(served, REPO);
  if (!isOurs) {
    log(`port ${port}: pid ${owner.pid} serves ${served ?? 'an unknown root'}, not this repo — left alone`);
    continue;
  }
  if (!fs.existsSync(CLI)) {
    log('the analyzer is not built — run: pnpm -r build');
    process.exitCode = 1;
    break;
  }

  const argv = argvAfterCli(owner.cmd);
  if (argv === null) {
    log(`port ${port}: could not read the server's arguments from its command line — not touching it`);
    continue;
  }
  execFileSync('powershell', ['-NoProfile', '-Command', `Stop-Process -Id ${owner.pid} -Force`], {
    timeout: 15_000,
  });
  const child = spawn(process.execPath, [CLI, ...argv], {
    cwd: REPO,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  restarted += 1;

  /* Verify rather than announce: the whole point of this script is that a
     claim about what is running has to be checkable. */
  let after = null;
  for (let i = 0; i < 20 && after === null; i += 1) {
    await new Promise((r) => setTimeout(r, 500));
    after = await stampOf(port);
  }
  if (after && !after.stale && !after.noEndpoint) {
    log(`port ${port}: restarted — started ${after.startedAt}, built ${after.builtAt}`);
  } else {
    log(`port ${port}: restarted but did not come back current — check it by hand`);
    process.exitCode = 1;
  }
}

if (RUN && checkOnly && stale > 0) process.exitCode = 1;
if (RUN && !checkOnly && stale === 0) log('nothing was stale');
void restarted;
