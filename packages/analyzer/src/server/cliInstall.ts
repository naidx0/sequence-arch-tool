/**
 * AGENT CLI INSTALL (claims-audit 4.2; A2, U07, U08, U14).
 *
 * "Claude Code sets itself up" was false for the CLI itself: it had to be
 * installed by hand. This runs each vendor's OWN native installer, on a
 * person's click only, with a fixed command (never taken from the caller):
 *
 *   claude  macOS/Linux  curl -fsSL https://claude.ai/install.sh | bash
 *           Windows      irm https://claude.ai/install.ps1 | iex
 *   codex   macOS/Linux  curl -fsSL https://chatgpt.com/codex/install.sh | sh
 *           Windows      powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"
 *
 * (Checked against code.claude.com/docs/en/setup and github.com/openai/codex,
 * 2026-10.) The vendor script downloads the vendor's signed binary; Sequence
 * ships nothing. Progress is the installer's last lines, a failure is shown
 * verbatim, and a good install widens the probe's search to the dirs the
 * installers write to, since a running server's PATH does not see them.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { defaultProviderProbe, rememberBinDir } from './providerProbe.js';
import type { AdapterInstallStatus } from './adapterInstall.js';

export type CliProvider = 'claude' | 'codex';
export type InstallJob = AdapterInstallStatus;

export interface CliCommand {
  file: string;
  args: string[];
  /** The command as a person would type it (shown in the UI). */
  display: string;
}

/** The fixed command for a vendor on a platform. Pure; the only place commands live. */
export function cliInstallCommand(provider: CliProvider, platform: NodeJS.Platform = process.platform): CliCommand {
  if (platform === 'win32') {
    const url = provider === 'claude' ? 'https://claude.ai/install.ps1' : 'https://chatgpt.com/codex/install.ps1';
    const ps = `irm ${url} | iex`;
    return {
      file: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
      display: provider === 'claude' ? ps : `powershell -ExecutionPolicy ByPass -c "${ps}"`,
    };
  }
  const display = provider === 'claude' ? 'curl -fsSL https://claude.ai/install.sh | bash' : 'curl -fsSL https://chatgpt.com/codex/install.sh | sh';
  /* Download first, then run: `curl | bash` under plain sh exits with bash's status, so a failed download
     (bash reading an empty script) would report a successful install. */
  const url = provider === 'claude' ? 'https://claude.ai/install.sh' : 'https://chatgpt.com/codex/install.sh';
  const runner = provider === 'claude' ? 'bash' : 'sh';
  const line = `s=$(curl -fsSL ${url}) && printf '%s\\n' "$s" | ${runner}`;
  return { file: '/bin/sh', args: ['-c', line], display };
}

/** Directories the vendor installers write the CLI to (searched after an install). */
export function cliBinDirs(provider: CliProvider, home = os.homedir(), env: NodeJS.ProcessEnv = process.env): string[] {
  const dirs = [path.join(home, '.local', 'bin')];
  if (provider === 'codex') {
    dirs.push(path.join(home, '.codex', 'bin'));
    if (env.LOCALAPPDATA) dirs.push(path.join(env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin'));
  }
  return dirs;
}

export type SpawnFn = (file: string, args: string[], opts: { env: NodeJS.ProcessEnv; windowsHide: boolean; stdio: ['ignore', 'pipe', 'pipe'] }) => ChildProcess;

export interface CliInstaller {
  start(provider: string): { ok: true; status: InstallJob } | { ok: false; status: number; error: string };
  status(provider: string): InstallJob | null;
}

export interface CliInstallerOptions {
  /** Test seam: replaces child_process.spawn. */
  spawnFn?: SpawnFn;
  platform?: NodeJS.Platform;
  /** The install finished; the caller re-probes. */
  onDone?: (ok: boolean) => void;
  /** Test seam: dirs to remember after a good install (default: {@link cliBinDirs}). */
  binDirs?: (provider: CliProvider) => string[];
}

const TAIL = 30;
const PROVIDERS: readonly string[] = ['claude', 'codex'];

export function createCliInstaller(opts: CliInstallerOptions = {}): CliInstaller {
  const jobs = new Map<string, InstallJob & { child?: ChildProcess }>();
  const view = (j: InstallJob & { child?: ChildProcess }): InstallJob => {
    const { child: _c, ...rest } = j;
    return { ...rest, output: [...rest.output] };
  };
  const doSpawn: SpawnFn = opts.spawnFn ?? ((f, a, o) => spawn(f, a, { ...o, windowsHide: true }));
  return {
    status(provider) {
      const j = jobs.get(provider);
      return j ? view(j) : null;
    },
    start(provider) {
      if (!PROVIDERS.includes(provider)) return { ok: false, status: 404, error: `${provider} has no CLI installer` };
      const id = provider as CliProvider;
      const running = jobs.get(id);
      if (running?.state === 'running') return { ok: true, status: view(running) };
      const cmd = cliInstallCommand(id, opts.platform);
      const job: InstallJob & { child?: ChildProcess } = { provider: id, state: 'running', command: cmd.display, output: [], exitCode: null };
      jobs.set(id, job);
      const fail = (error: string) => {
        job.state = 'failed';
        job.error = error;
        job.child = undefined;
        opts.onDone?.(false);
      };
      let child: ChildProcess;
      try {
        child = doSpawn(cmd.file, cmd.args, { env: { ...process.env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        fail(`The installer could not be started: ${(e as Error).message}`);
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
        if (job.state === 'running') fail(`The installer could not be started: ${e.message}`);
      });
      child.once('close', (code) => {
        if (job.state !== 'running') return;
        job.exitCode = code;
        job.child = undefined;
        if (code !== 0) {
          /* Verbatim: the installer's own last line is the reason. */
          fail(job.output.length ? job.output[job.output.length - 1] : `The installer exited with code ${code}`);
          return;
        }
        for (const d of (opts.binDirs ?? cliBinDirs)(id)) if (fs.existsSync(d)) rememberBinDir(d);
        job.state = 'done';
        opts.onDone?.(true);
      });
      return { ok: true, status: view(job) };
    },
  };
}

/** The process-wide installer; a finished install makes the next probe look again. */
export const defaultCliInstaller: CliInstaller = createCliInstaller({ onDone: () => defaultProviderProbe.invalidate?.() });

/** `startCliInstall('claude'|'codex')`: same shape as startAdapterInstall, on the process-wide installer. */
export function startCliInstall(provider: CliProvider): InstallJob {
  const out = defaultCliInstaller.start(provider);
  if (!out.ok) throw new Error(out.error);
  return out.status;
}
