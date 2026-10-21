/**
 * THE TEST RUN MUST NOT SEE THE PERSON'S OWN `~/.sequence`, AND MUST NOT LEAVE
 * ITS TEMPORARY DIRECTORIES BEHIND.
 *
 * Loaded with `--import` before any test file, so `SEQUENCE_USER_DIR` is set
 * before the first `userStoreDir()` call. Not a helper anyone imports: it has
 * to run first, and a helper only runs when somebody remembers to call it.
 *
 * WHY THE USER-DIR HALF EXISTS. `createRepoServer` falls back to the user-level
 * store for an AI config when a repo has none. Using the app to point Sequence
 * at a local Ollama writes `~/.sequence/ai.json` - which is the product working
 * correctly. The tests then read that file, and three of them that assert "no
 * provider configured" found one and turned red:
 *
 *     /api/annotate: no provider -> 200 with empty annotations, mode none
 *       actual: 'ai'   expected: 'none'
 *
 * So the suite passed or failed according to whether the developer had ever
 * used the product they were testing. Both directions were wrong: red on a
 * machine where nothing was broken, and - worse - green elsewhere for reasons
 * that had nothing to do with the code.
 *
 * WHY THE TEMP-ROOT HALF EXISTS. Measured 2026-09-10: `%TEMP%` on this machine
 * held 598,408 directories named `sequence-*`, across 133 distinct prefixes,
 * dating back weeks. 159,816 of them - 27% - were `sequence-user-store-`, from
 * the single `mkdtempSync` this very file used to call, once per test process,
 * with nothing ever removing it. The comment that line carried said the OS
 * would collect the directory. It does not. Windows never sweeps `%TEMP%`, and
 * the analyzer suite spawns hundreds of processes per run.
 *
 * THE FIX IS ONE ROOT, NOT 271 `afterEach`ES. There are 271 `os.tmpdir()` call
 * sites in this package. Cleaning up at each one is a large diff whose failure
 * mode is silent: miss one and it leaks forever, and nothing tells you. So
 * instead `os.tmpdir()` itself is redirected, here, before any test module is
 * loaded, into a single per-run root that this process removes on the way out.
 * Every existing call site keeps working unchanged and lands inside that root.
 *
 * THE ONE WAY TO ESCAPE THIS. A module that does `import { tmpdir } from
 * 'node:os'` binds the function directly and never sees the patch below. No
 * file in this package does that (checked); four files in `packages/web2` do,
 * and they run under a different runner. If you add one here, it will leak.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* The real one, captured before the patch. A test that needs to look at the
   machine's actual temp directory - the leak test does - reads it from here
   rather than calling the patched `os.tmpdir()` and measuring its own sandbox. */
const REAL_TMPDIR = os.tmpdir();
process.env.SEQUENCE_TEST_REAL_TMPDIR = REAL_TMPDIR;

/*
 * NOT EVERY PROCESS THAT LOADS THIS FILE IS A TEST PROCESS.
 *
 * `--import` is inherited, and measured on 2026-09-10 one analyzer run created
 * 315 run roots and leaked exactly 12 - every one of them from
 * `node_modules/node-pty/lib/worker/conoutSocketWorker.js`. node-pty spawns
 * that worker with our flags, and tears it down by terminating it when the pty
 * closes, so no `exit` handler ever runs and its root survives. It is not a
 * test, it never wanted a temp directory, and the cheapest correct answer is
 * not to give it one.
 *
 * Entry point inside `node_modules` is the discriminator because it is the
 * true statement: our test files are compiled into `dist/` and are never in
 * there, and a dependency's worker always is.
 *
 * WORTH RECORDING BECAUSE IT WAS WRONG THE FIRST TIME: those 12 were all EMPTY
 * directories, which reads exactly like Windows' `rmdir` racing the release of
 * the children it just deleted - so the first fix was `maxRetries` on the
 * `rmSync`. The count stayed at 12, and the warning added alongside it never
 * printed once, which proved the delete was not failing at all. The handler
 * was never running. The retries are kept below because that race is real and
 * cheap to defend against, but they fixed nothing here.
 */
/*
 * AND THE TEST RUN MUST NOT SEE AN INHERITED `GIT_DIR`.
 *
 * `GIT_DIR` beats `cwd`: git does not discover a repository when it has been
 * handed one. Git exports it into hooks, so a suite launched from a pre-push
 * hook runs with every `git` command pointed at the product checkout however
 * carefully each test set its own `cwd`.
 *
 * Measured 2026-09-11: that happened. `git-worktree-handoff.test.ts` builds
 * throwaway repositories in temp directories and creates fixture branches in
 * them; run under the hook, it created `dup`, `feature/handoff`, `handoff/one`
 * and `preexisting` as real refs in the product repository, and registered a
 * worktree there too. Reproduced afterwards with two throwaway repos: same
 * command, `cwd` on the temp repo, the branch lands in whichever repository
 * `GIT_DIR` names.
 *
 * Cleared here rather than in that one test because the hazard belongs to the
 * environment, not to the test: any of the 290 files in this suite that shells
 * out to git inherits it, and the next one to do so would not know to look.
 */
delete process.env.GIT_DIR;
delete process.env.GIT_WORK_TREE;

/*
 * AND `maxRetries` MUST MEAN WHAT IT SAYS ON WINDOWS.
 *
 * Measured 2026-10-09 on Node 24.13 under a parallel run: `fs.rmSync(dir,
 * { recursive: true, maxRetries: 40, retryDelay: 150 })` failed with EPERM
 * after under 0.6 s, so it never retried. The folder was briefly held after a
 * server closed (an agent or git child that had just exited; no process was
 * left), and the same delete succeeded 1.5 s later. Dozens of tests here ask
 * for retries exactly for that moment, so the retries are restored for the
 * test run: EPERM, EBUSY and ENOTEMPTY are retried every `retryDelay` for at
 * least `maxRetries` x `retryDelay`, and never less than 3 s. Only when the
 * caller asked for retries, or for a forced recursive delete (a temp-dir
 * cleanup: under the push gate the ask index's background `git` outlived the
 * test and failed a different pair of tests each run); anything else still
 * throws at once.
 */
if (process.platform === 'win32') {
  const rmSync = fs.rmSync.bind(fs);
  const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  fs.rmSync = ((target: fs.PathLike, opts?: fs.RmOptions) => {
    const tries = opts?.maxRetries ?? 0;
    if (tries <= 0 && !(opts?.recursive && opts?.force)) return rmSync(target, opts);
    const delay = opts?.retryDelay ?? 100;
    const until = Date.now() + Math.max(tries * delay, 3000);
    for (;;) {
      try {
        return rmSync(target, opts);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if ((code !== 'EPERM' && code !== 'EBUSY' && code !== 'ENOTEMPTY') || Date.now() > until) throw e;
        sleep(delay);
      }
    }
  }) as typeof fs.rmSync;
}

/*
 * AND THE SHARED find_files HOST MUST NOT OUTLIVE THE TEST THAT STARTED IT.
 *
 * Any test that reaches `find_files` (an ask, the MCP server, createRepoServer's
 * ask tools) makes the first client spawn `--find-files-host <repo>`: a DETACHED
 * process that serves the index until no client has connected for
 * FIND_FILES_HOST_IDLE_MS, 15 minutes by default. The test's temp repo and
 * user store sit under this run's root, so the host (a) leaked, about 14 alive
 * at once after a gate run, and (b) held the root, so the exit hook above
 * failed with EPERM ("could not remove ...sequence-run-*"). Two test files set
 * a short idle themselves; every other one inherited 15 minutes. Set for the
 * whole run, unless a caller deliberately chose a value.
 */
if (!process.env.SEQUENCE_FIND_FILES_HOST_IDLE_MS) process.env.SEQUENCE_FIND_FILES_HOST_IDLE_MS = '3000';

const ENTRY = process.argv[1] ?? '';
const IS_DEPENDENCY_WORKER = /[\\/]node_modules[\\/]/.test(ENTRY);

/* Named `sequence-run-` so that the directory which exists to make cleanup
   unnecessary is itself inside the scope of the manual cleanup - if this
   process is killed with SIGKILL and the exit hook never runs, the leftover
   is one directory with a name a `sequence-*` sweep already covers. */
const RUN_ROOT = IS_DEPENDENCY_WORKER
  ? null
  : fs.mkdtempSync(path.join(REAL_TMPDIR, 'sequence-run-'));

if (RUN_ROOT !== null) os.tmpdir = () => RUN_ROOT;

/* Respect an override that is already set: a caller who deliberately pointed
   the store somewhere (a fixture, a debugging run) means it. */
/* The built bridge (dist/claude-agent-acp.mjs) is on disk after a build, which would make every fake-`claude` test
   "have a bridge". "none" says this install has none; a test of the bundled path passes its own `bundledBridge`. */
if (!process.env.SEQUENCE_CLAUDE_BRIDGE) process.env.SEQUENCE_CLAUDE_BRIDGE = 'none';

if (RUN_ROOT !== null && !process.env.SEQUENCE_USER_DIR) {
  process.env.SEQUENCE_USER_DIR = fs.mkdtempSync(path.join(RUN_ROOT, 'user-store-'));
}

let cleaned = false;
function removeRunRoot(): void {
  if (cleaned || RUN_ROOT === null) return;
  cleaned = true;
  /* Synchronous on purpose: `exit` handlers may not defer work, and an async
     rm here would be abandoned mid-tree. `force` so a run that never created
     anything is not an error.

     `maxRetries` IS THE WHOLE FIX ON WINDOWS, and it was measured, not
     guessed. The first cut left this at Node's default of 0 and one
     `gate:count` leaked 12 run roots - every one of them EMPTY. That is the
     signature: the recursive walk deletes the children, then the `rmdir` of
     the root races the OS actually releasing them and fails EBUSY/ENOTEMPTY.
     A retry a few milliseconds later succeeds. */
  try {
    fs.rmSync(RUN_ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  } catch (e) {
    /* A handle still open can refuse deletion even after the retries. Leaking
       one run root is a failure we can live with; throwing out of an exit
       handler and turning a green suite red is not.

       But it is SAID. The first cut swallowed this silently, which is how a
       cleanup that had stopped working would look exactly like one that was
       working - the leak this whole file exists to end, back again with no
       signal. One line to stderr costs nothing and cannot be mistaken for
       success. */
    process.stderr.write(
      `isolate-user-store: could not remove ${RUN_ROOT} — ${(e as Error)?.message ?? e}\n`,
    );
  }
}

process.on('exit', removeRunRoot);
/* Ctrl-C and a parent's terminate both bypass `exit` unless we opt in. Re-raise
   after cleaning so the exit code still reports the signal honestly. */
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    removeRunRoot();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}
