/**
 * INSTALL BRIDGE (round 7, A4).
 *
 * Jaden: "For Claude Code, the connector says it needs adapter though. I'm
 * not sure what that means." Sequence drives Claude Code over ACP through a
 * small bridge, claude-agent-acp. This runs its documented global npm install
 * when, and only when, the person presses Install bridge. One install at a
 * time per server; the caller polls for its progress (the last lines npm
 * printed) and its result.
 *
 * The command is fixed here (`npm install -g <the spec's adapter package>`),
 * never taken from the caller. npm is found on the same widened PATH the
 * probe searches and run by that RESOLVED path: a Windows `npm.cmd` shim runs
 * as `cmd.exe /d /s /c ""<abs npm.cmd>" install -g <pkg>"` (verbatim), never a
 * bare `npm`, which cmd.exe would look up in the current directory first. The
 * child is hidden.
 *
 * After a good install, `npm prefix -g` names where the bridge landed; its bin
 * dir (the prefix itself on Windows) is added to the probe's search, since it
 * need not be on the server's PATH (%APPDATA%\npm, nvm, a custom prefix).
 */

import { execFile, spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

import { cmdShimArgs, defaultExtraDirs, pathKey, PROVIDER_SPECS, rememberBinDir, resolveBinary, searchDirs, type ProbeOptions } from './providerProbe.js';

export type AdapterInstallState = 'idle' | 'running' | 'done' | 'failed';

export interface AdapterInstallStatus {
  provider: string;
  state: AdapterInstallState;
  /** The command as a person would type it. */
  command: string;
  /** The last lines npm printed, for the progress line and the failure. */
  output: string[];
  exitCode: number | null;
  error?: string;
}

export interface AdapterInstaller {
  start(provider: string): { ok: true; status: AdapterInstallStatus } | { ok: false; status: number; error: string };
  status(provider: string): AdapterInstallStatus | null;
}

const TAIL = 30;

export { cmdShimArgs };

/** npm's global bin dir, from `npm prefix -g` (the prefix itself on Windows, <prefix>/bin elsewhere); null when npm will not say. */
export function npmGlobalBinDir(npm: string, env: NodeJS.ProcessEnv, timeoutMs = 15_000): Promise<string | null> {
  const shim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(npm);
  const [file, args] = shim ? [process.env.ComSpec ?? 'cmd.exe', cmdShimArgs(npm, ['prefix', '-g'])] : [npm, ['prefix', '-g']];
  return new Promise((resolve) => {
    execFile(file, args, { env, windowsHide: true, timeout: timeoutMs, windowsVerbatimArguments: shim, encoding: 'utf8' }, (err, stdout) => {
      const prefix = err ? '' : String(stdout).trim().split(/\r?\n/).pop()?.trim() ?? '';
      if (!prefix || !path.isAbsolute(prefix)) return resolve(null);
      resolve(process.platform === 'win32' ? prefix : path.join(prefix, 'bin'));
    });
  });
}

export function createAdapterInstaller(
  opts: Pick<ProbeOptions, 'pathValue' | 'extraDirs'> & {
    /** The install ended; `binDir` is npm's global bin dir when it could be read (search it before probing again). */
    onDone?: (ok: boolean, binDir?: string) => void;
  } = {},
): AdapterInstaller {
  const jobs = new Map<string, AdapterInstallStatus & { child?: ChildProcess }>();
  const view = (j: AdapterInstallStatus & { child?: ChildProcess }): AdapterInstallStatus => {
    const { child: _child, ...rest } = j;
    return { ...rest, output: [...rest.output] };
  };
  return {
    status(provider) {
      const j = jobs.get(provider);
      return j ? view(j) : null;
    },
    start(provider) {
      const spec = PROVIDER_SPECS.find((s) => s.id === provider);
      if (!spec?.adapter) return { ok: false, status: 404, error: `${provider} has no bridge to install` };
      const running = jobs.get(provider);
      if (running?.state === 'running') return { ok: true, status: view(running) };
      const pkg = spec.adapter.npmPackage;
      const command = `npm install -g ${pkg}`;
      const baseEnv = { ...process.env };
      const key = pathKey(baseEnv);
      const dirs = searchDirs(opts.pathValue ?? baseEnv[key] ?? '', opts.extraDirs ?? defaultExtraDirs());
      const env: NodeJS.ProcessEnv = { ...baseEnv, [key]: dirs.join(path.delimiter) };
      const npm = resolveBinary('npm', dirs, env);
      const job: AdapterInstallStatus & { child?: ChildProcess } = { provider, state: 'running', command, output: [], exitCode: null };
      jobs.set(provider, job);
      if (!npm) {
        job.state = 'failed';
        job.error = 'npm was not found on this machine. Install Node.js (it includes npm), then try again.';
        opts.onDone?.(false);
        return { ok: true, status: view(job) };
      }
      const args = ['install', '-g', pkg];
      const shim = process.platform === 'win32' && /\.(cmd|bat)$/i.test(npm);
      let child: ChildProcess;
      try {
        child = shim
          ? spawn(process.env.ComSpec ?? 'cmd.exe', cmdShimArgs(npm, args), { env, windowsHide: true, windowsVerbatimArguments: true, stdio: ['ignore', 'pipe', 'pipe'] })
          : spawn(npm, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        job.state = 'failed';
        job.error = `npm could not be started: ${(e as Error).message}`;
        opts.onDone?.(false);
        return { ok: true, status: view(job) };
      }
      job.child = child;
      const take = (b: Buffer) => {
        job.output.push(...String(b).split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim() !== ''));
        if (job.output.length > TAIL) job.output.splice(0, job.output.length - TAIL);
      };
      child.stdout?.on('data', take);
      child.stderr?.on('data', take);
      child.once('error', (e) => {
        job.state = 'failed';
        job.error = `npm could not be started: ${e.message}`;
        job.child = undefined;
        opts.onDone?.(false);
      });
      child.once('close', (code) => {
        if (job.state !== 'running') return;
        job.exitCode = code;
        job.child = undefined;
        if (code !== 0) {
          job.state = 'failed';
          job.error = `npm exited with code ${code}`;
          opts.onDone?.(false);
          return;
        }
        /* Still 'running' until the bin dir is known, so the caller's re-probe searches it. */
        void npmGlobalBinDir(npm, env).then((binDir) => {
          if (binDir && opts.extraDirs === undefined) rememberBinDir(binDir);
          job.state = 'done';
          opts.onDone?.(true, binDir ?? undefined);
        });
      });
      return { ok: true, status: view(job) };
    },
  };
}
