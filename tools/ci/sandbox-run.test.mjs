/**
 * THE SANDBOX REFUSAL MUST NAME THE OWNER, OR ADMIT THAT IT CANNOT.
 *
 * Built from the reported shape: Windows Sandbox runs one instance per machine,
 * ML BUILD was using it, and this lane's previous run cleared a collision by
 * killing `WindowsSandboxServer` — a machine-wide service — which ended ML
 * BUILD's download rather than anything of ours.
 *
 * The case these tests exist for is the SECOND one below. A lane that launched
 * without the driver leaves no lock, so the busy machine has no owner on file.
 * The tempting bug is to treat a missing lock as a free machine, which collides
 * with exactly the run the driver protects; the other tempting bug is to print
 * a placeholder and let the reader believe a name was found. Both are the same
 * fault this repo keeps hitting — a label that reads as a measurement — so the
 * assertion is not just "it refused" but "it refused WITHOUT inventing a name".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { decide } from './sandbox-run.mjs';

const HOST = 'nightshift-01';

test('busy with a lock from this machine: refuses and names the owner and their work', () => {
  const d = decide({
    busy: true,
    host: HOST,
    lock: {
      lane: 'ML BUILD',
      host: HOST,
      since: '2026-09-10T13:02:00Z',
      what: 'the harness image',
    },
  });
  assert.equal(d.ok, false);
  assert.match(d.reason, /ML BUILD/);
  assert.match(d.reason, /the harness image/);
  assert.match(d.reason, /2026-09-10T13:02:00Z/);
});

test('busy with no lock: refuses, says the owner is unknown, invents no name', () => {
  const d = decide({ busy: true, host: HOST, lock: null });
  assert.equal(d.ok, false);
  assert.match(d.reason, /no lock file says whose/);
  assert.match(d.reason, /Nothing was launched/);
  /* The whole point: no placeholder that a reader could take for an answer. */
  assert.doesNotMatch(d.reason, /undefined|null|unknown's|lane=/);
  /* And it must not quietly become permission to proceed. */
  assert.doesNotMatch(d.reason, /\bfree\b(?!")/);
});

/*
 * The lock lives in the vault, which syncs between machines. The sandbox does
 * not. So a lock naming another host is a true statement about a DIFFERENT
 * machine, and the two failures available here are opposite and both bad:
 * print that lane's name as the owner of the process running here, or read the
 * lock as stale and delete a lock that is doing its job elsewhere.
 */
test('busy with a lock from another machine: refuses without borrowing that owner', () => {
  const d = decide({
    busy: true,
    host: HOST,
    lock: {
      lane: 'ML BUILD',
      host: 'some-other-box',
      since: '2026-09-10T13:02:00Z',
      what: 'the harness image',
    },
  });
  assert.equal(d.ok, false);
  assert.match(d.reason, /different machine/);
  assert.match(d.reason, /owner unknown/);
  /* It may say which machine the lock came from; it must not claim that lane
     owns the sandbox running here. */
  assert.doesNotMatch(d.reason, /it is ML BUILD's/);
});

test('free with a lock from another machine: proceeds and does not call it stale', () => {
  const d = decide({
    busy: false,
    host: HOST,
    lock: { lane: 'ML BUILD', host: 'some-other-box', since: '2026-09-10T09:00:00Z', what: 'x' },
  });
  assert.equal(d.ok, true);
  assert.match(d.note, /different machine/);
  assert.doesNotMatch(d.note, /stale/);
});

test('free with no lock: proceeds', () => {
  const d = decide({ busy: false, host: HOST, lock: null });
  assert.equal(d.ok, true);
  assert.equal(d.note, null);
});

test('free with a stale lock from this machine: proceeds, and says the lock was stale', () => {
  const d = decide({
    busy: false,
    host: HOST,
    lock: {
      lane: 'ML BUILD',
      host: HOST,
      since: '2026-09-10T09:00:00Z',
      what: 'a run that was killed',
    },
  });
  assert.equal(d.ok, true);
  assert.match(d.note, /stale/);
  assert.match(d.note, /ML BUILD/);
});

/*
 * ── THE HALF A REFUSAL NEVER REACHES ──────────────────────────────────────
 *
 * Every case above drives `decide`, which is the REFUSAL. The path that takes
 * the lock, logs the TAKE and gives the machine back had never run in a test,
 * because running it used to mean launching an 8GB virtual machine on the one
 * instance this driver exists to share. So `holdAndRun` takes an injected
 * `launch` and these drive it against a temp lock.
 *
 * The release is the half that matters to the other lanes: a lock that is never
 * given back locks them out of a machine nobody is using, which is the same
 * outage as the collision, just quieter and longer.
 *
 * Each case imports a FRESH copy of the module with a cache-busting query,
 * because the lock path is read from the environment once at module load.
 */
async function driverWithLock(lockPath, lane = 'sequence') {
  process.env.SEQUENCE_SANDBOX_LOCK = lockPath;
  process.env.SEQUENCE_SANDBOX_LANE = lane;
  return import(`./sandbox-run.mjs?case=${encodeURIComponent(lockPath)}:${lane}`);
}

function scratch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandboxlock-'));
  return { dir, lock: path.join(dir, 'sandbox.lock'), log: path.join(dir, 'sandbox.lock.log') };
}

test('a held run writes the lock, then gives it back', async () => {
  const { dir, lock, log } = scratch();
  const driver = await driverWithLock(lock);

  let lockedDuringLaunch = null;
  const status = driver.holdAndRun({
    what: 'the 0.1.0 installer',
    share: dir,
    /* Read the lock from INSIDE the launch: after the fact everything looks the
       same whether the lock was ever written or not. */
    launch: () => {
      lockedDuringLaunch = fs.readFileSync(lock, 'utf8').trim();
      return { status: 0 };
    },
  });

  assert.equal(status, 0);
  assert.ok(lockedDuringLaunch, 'no lock existed while the sandbox was running');
  /* The ruled shape, field by field — this is what another lane parses. */
  assert.match(lockedDuringLaunch, /^lane=sequence /);
  assert.match(lockedDuringLaunch, / host=\S+ /);
  assert.match(lockedDuringLaunch, / since=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z /);
  assert.match(lockedDuringLaunch, / pid=\d+ /);
  assert.match(lockedDuringLaunch, / born=/);
  assert.match(lockedDuringLaunch, / what=the 0\.1\.0 installer$/);

  assert.equal(fs.existsSync(lock), false, 'the machine was not given back');

  const lines = fs.readFileSync(log, 'utf8').trim().split('\n');
  assert.match(lines[0], /^TAKE {5}lane=sequence /);
  assert.match(lines[1], /^RELEASE {2}lane=sequence /);
});

test('a launch that THROWS still gives the machine back', async () => {
  /*
   * The reason the release is in a `finally`. A sandbox that fails to start is
   * exactly when a lane is most likely to walk away, and a lock left behind
   * then reads to everyone else as a run still in progress.
   */
  const { dir, lock } = scratch();
  const driver = await driverWithLock(lock);

  assert.throws(() =>
    driver.holdAndRun({
      what: 'a launch that fails',
      share: dir,
      launch: () => {
        throw new Error('WindowsSandbox.exe is not installed');
      },
    }),
  );
  assert.equal(fs.existsSync(lock), false, 'a failed launch kept the lock');
});

test('release NEVER deletes a lock another lane took during our run', async () => {
  /*
   * The quiet version of the Stop-Process that started all this: handing the
   * machine to the next lane while its owner is still inside it.
   *
   * THE FIRST VERSION OF THIS TEST ASSERTED THE WRONG THING, and its failure
   * is what taught the difference. It pre-seeded another lane's lock and
   * expected `holdAndRun` to leave it — but `holdAndRun` is only ever reached
   * once `decide` has said the machine is FREE, and a foreign lock on a free
   * machine is a STALE lock from a run that was killed. Taking it is the
   * designed behaviour, not a bug; refusing there would leave the machine
   * permanently unusable after any lane crashed.
   *
   * The hazard the ownership check really guards is a RACE: another lane taking
   * the lock while we are still running, so the file at release time is theirs
   * and not the one we wrote. That is reproduced here by overwriting the lock
   * from inside the launch.
   */
  const { dir, lock } = scratch();
  const driver = await driverWithLock(lock);

  const theirs =
    `lane=mlbuild host=${HOST} since=2026-09-10T17:49:50Z pid=1 born=x what=their walk`;
  driver.holdAndRun({
    what: 'ours',
    share: dir,
    launch: () => {
      /* They take it out from under us, mid-run. */
      fs.writeFileSync(lock, `${theirs}\n`);
      return { status: 0 };
    },
  });

  assert.ok(fs.existsSync(lock), "another lane's lock was deleted");
  assert.match(fs.readFileSync(lock, 'utf8'), /lane=mlbuild/);
});

test('the .wsb it writes maps the share READ-ONLY and nothing else', async () => {
  /* "Nothing mapped in but the installer" is a property of this file, not of
     the person running it, so it is checked here rather than remembered. */
  const { dir } = scratch();
  const driver = await driverWithLock(path.join(dir, 'sandbox.lock'));
  driver.holdAndRun({ what: 'x', share: dir, launch: () => ({ status: 0 }) });

  const wsb = fs.readFileSync(path.join(dir, 'sequence.wsb'), 'utf8');
  assert.match(wsb, /<ReadOnly>true<\/ReadOnly>/);
  assert.equal((wsb.match(/<MappedFolder>/g) ?? []).length, 1, 'exactly one folder is mapped in');
  assert.ok(
    wsb.includes(`<HostFolder>${dir}</HostFolder>`),
    'the .wsb must map the share it was given, verbatim',
  );
});
