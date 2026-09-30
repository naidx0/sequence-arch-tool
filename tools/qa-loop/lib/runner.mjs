/**
 * Run each repo in its OWN child process.
 *
 * ## Why
 *
 * The harness used to measure all 27 repositories inside one Node process. That
 * worked only for as long as the back half of the corpus was doing no work: once
 * the tree-sitter leak was fixed (`9fb4dbc`) and every repo really parsed, the
 * run degraded catastrophically with POSITION — n8n takes ~148s measured alone
 * and did not finish in 34 minutes as the 21st repo of the same process, at
 * 102% CPU with RSS flat (so: not GC pressure, not a JS leak). Tree-sitter's
 * trees live in a WASM heap that is grown but never returned, and a heap that
 * has been churned by twenty repositories of wildly different allocation
 * profiles serves the twenty-first one very slowly.
 *
 * A fresh process per repo makes a repo's cost a property of the repo, not of
 * its position in the run.
 *
 * ## What it buys beyond speed
 *
 * A REAL timeout. `--timeout-ms` used to be a `Promise.race` that abandoned the
 * loser without stopping it — it could not interrupt a synchronous parse, which
 * is the only thing that ever actually hangs. A child process can be killed, so
 * the cap now means what it says, and a repo that blows it becomes an honest
 * failure row naming the repo and the elapsed time instead of a run that never
 * returns.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { failureRow } from './measure.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const CHILD_MODULE = path.join(here, 'child.mjs');

/** Grace between SIGTERM and SIGKILL. A child stuck inside a synchronous WASM
 * parse will never handle SIGTERM; this is how long we are polite about it. */
export const KILL_GRACE_MS = 2_000;

/**
 * Measure one repo in a child process.
 *
 * @param {{row: any, dir: string, opts: any}} job
 * @param {{timeoutMs: number, ioDir: string, ioName?: string, childModule?: string, execPath?: string, execArgv?: string[], onSpawn?: (child: any) => void}} cfg
 * @returns {Promise<any>} the JSONL row — always a row, never a throw
 */
export function runRepoInChild(job, cfg) {
  const childModule = cfg.childModule ?? CHILD_MODULE;
  const started = Date.now();
  fs.mkdirSync(cfg.ioDir, { recursive: true });
  // `--local /a/foo --local /b/foo` yields two rows with the same id, so the
  // caller's slot number — not the id alone — is what keeps their files apart.
  const safeId = String(cfg.ioName ?? job.row.id).replace(/[^a-zA-Z0-9._-]/g, '_');
  const jobFile = path.join(cfg.ioDir, `${safeId}.job.json`);
  const outFile = path.join(cfg.ioDir, `${safeId}.row.json`);
  fs.writeFileSync(jobFile, JSON.stringify(job));
  try {
    fs.rmSync(outFile, { force: true });
  } catch {
    /* a stale row from a previous run must never be mistaken for this one's */
  }

  return new Promise((resolve) => {
    const child = spawn(
      cfg.execPath ?? process.execPath,
      [...(cfg.execArgv ?? []), childModule, '--job', jobFile, '--out', outFile],
      {
        stdio: ['ignore', 'inherit', 'inherit'],
        env: {
          ...process.env,
          NODE_OPTIONS: [process.env.NODE_OPTIONS, '--experimental-strip-types'].filter(Boolean).join(' '),
        },
      }
    );
    cfg.onSpawn?.(child);

    let timedOut = false;
    let hardKill;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      hardKill = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
      hardKill.unref?.();
    }, cfg.timeoutMs);
    timer.unref?.();

    child.on('error', (err) => {
      clearTimeout(timer);
      clearTimeout(hardKill);
      resolve(
        failureRow(job.row, job.dir, Date.now() - started, {
          name: 'ChildSpawnError',
          message: `could not start the child process for ${job.row.id}: ${err.message}`,
          stack: err.stack ?? null,
        })
      );
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      clearTimeout(hardKill);
      const elapsedMs = Date.now() - started;

      if (timedOut) {
        resolve(
          failureRow(job.row, job.dir, elapsedMs, {
            name: 'RepoTimeoutError',
            message:
              `${job.row.id} exceeded the ${cfg.timeoutMs}ms per-repo cap and was killed ` +
              `after ${elapsedMs}ms (signal ${signal ?? 'none'}). Raise --timeout-ms, or ` +
              `reproduce alone with \`node tools/qa-loop/run.mjs --repos ${job.row.id}\`.`,
            stack: null,
          })
        );
        return;
      }

      let row = null;
      if (fs.existsSync(outFile)) {
        try {
          row = JSON.parse(fs.readFileSync(outFile, 'utf8'));
        } catch (err) {
          row = null;
          resolve(
            failureRow(job.row, job.dir, elapsedMs, {
              name: 'ChildResultError',
              message: `${job.row.id}: the child wrote an unreadable result row — ${err.message}`,
              stack: null,
            })
          );
          return;
        }
      }
      if (row) {
        resolve(row);
        return;
      }
      resolve(
        failureRow(job.row, job.dir, elapsedMs, {
          name: 'ChildCrashError',
          message:
            `${job.row.id}: the child process exited ${signal ? `on ${signal}` : `with code ${code}`} ` +
            `after ${elapsedMs}ms without writing a result row — see the inherited output above.`,
          stack: null,
        })
      );
    });
  });
}

/**
 * Run every target, each in its own child.
 *
 * Sequential by default: bounded per-repo time is the point of this change, and
 * four repos sharing four cores would make every number a function of what else
 * happened to be running. `concurrency > 1` is opt-in via `--concurrency`.
 *
 * @param {{row: any, dir: string|null, cloneError: string|null}[]} targets
 * @param {{opts: any, timeoutMs: number, ioDir: string, concurrency?: number,
 *          childModule?: string, onStart?: (row:any)=>void, onDone?: (r:any)=>void,
 *          cloneErrorRow?: (t:any)=>any}} cfg
 */
export async function runAllRepos(targets, cfg) {
  const concurrency = Math.max(1, cfg.concurrency ?? 1);
  const results = new Array(targets.length).fill(null);
  let next = 0;

  const takeOne = async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= targets.length) return;
      const t = targets[i];
      if (t.cloneError) {
        results[i] = cfg.cloneErrorRow(t);
        cfg.onDone?.(results[i]);
        continue;
      }
      cfg.onStart?.(t.row);
      results[i] = await runRepoInChild(
        { row: t.row, dir: t.dir, opts: cfg.opts },
        {
          timeoutMs: cfg.timeoutMs,
          ioDir: cfg.ioDir,
          childModule: cfg.childModule,
          ioName: `${String(i + 1).padStart(2, '0')}-${t.row.id}`,
        }
      );
      cfg.onDone?.(results[i]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, targets.length) }, takeOne));
  return results;
}
