/* Plumbing for the client bench: the machine, a scratch profile, fixtures, process memory, the packaged-app copy.
   Nothing here touches the real home, the real userData or a real agent: every launch gets a scratch HOME,
   USERPROFILE, APPDATA, LOCALAPPDATA and SEQUENCE_USER_DIR, a PATH whose first entry holds fake claude/codex
   that exit 1, and none of the secret-looking variables of the caller. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildEnv, envLeaks } from '../../release-smoke/lib.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const PLATFORM = process.platform;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function arg(argv, key, fallback) {
  const i = argv.indexOf(key);
  return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
}

export async function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

/** CPU, threads, RAM, OS: what the machine is, for the report. */
export function machine() {
  const cpus = os.cpus();
  return {
    cpu: cpus[0]?.model?.trim() ?? 'unknown',
    threads: cpus.length,
    ramGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    freeRamGBAtStart: Math.round((os.freemem() / 1024 ** 3) * 10) / 10,
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    node: process.version,
    loadAvg1m: PLATFORM === 'win32' ? null : os.loadavg()[0],
  };
}

/** Every process as {pid, ppid, name, created, privateBytes, workingSet}. */
export function processTable() {
  if (PLATFORM === 'win32') {
    const r = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CreationDate,PrivatePageCount,WorkingSetSize | ConvertTo-Json -Compress'],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
    );
    try {
      return JSON.parse(r.stdout).map((p) => ({ pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name, created: String(p.CreationDate), privateBytes: Number(p.PrivatePageCount) || 0, workingSet: Number(p.WorkingSetSize) || 0 }));
    } catch {
      return [];
    }
  }
  const r = spawnSync('ps', ['-A', '-o', 'pid=', '-o', 'ppid=', '-o', 'rss=', '-o', 'lstart=', '-o', 'comm='], { encoding: 'utf8' });
  return String(r.stdout)
    .split('\n')
    .map((l) => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w+\s+\w+\s+\d+\s+[\d:]+\s+\d+)\s+(.*)$/.exec(l))
    .filter(Boolean)
    .map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), workingSet: Number(m[3]) * 1024, privateBytes: Number(m[3]) * 1024, created: m[4], name: m[5] }));
}

export function descendantsOf(table, rootPid) {
  const out = [];
  const seen = new Set([rootPid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of table) if (!seen.has(p.pid) && seen.has(p.ppid)) (seen.add(p.pid), out.push(p), (grew = true));
  }
  return out;
}

/** Remembers a launch's process tree so it can be killed by pid AND creation time (never by image name). */
export class Tracked {
  constructor(rootPid) {
    this.rootPid = rootPid;
    this.rows = new Map();
    this.snapshot();
  }
  snapshot() {
    const table = processTable();
    for (const r of [...table.filter((p) => p.pid === this.rootPid), ...descendantsOf(table, this.rootPid)]) this.rows.set(r.pid, r);
    return table;
  }
  /** Sum of private bytes over the live tree (main, renderers, GPU, the server child, any pty). */
  privateBytes() {
    const table = processTable();
    const live = [...table.filter((p) => p.pid === this.rootPid), ...descendantsOf(table, this.rootPid)];
    for (const r of live) this.rows.set(r.pid, r);
    return { privateBytes: live.reduce((a, p) => a + p.privateBytes, 0), workingSet: live.reduce((a, p) => a + p.workingSet, 0), processes: live.length };
  }
  killRemaining() {
    const table = processTable();
    const killed = [];
    for (const r of this.rows.values()) {
      const now = table.find((p) => p.pid === r.pid);
      if (!now || now.created !== r.created) continue;
      if (PLATFORM === 'win32') spawnSync('taskkill', ['/PID', String(r.pid), '/F'], { windowsHide: true });
      else {
        try {
          process.kill(r.pid, 'SIGKILL');
        } catch {
          /* gone */
        }
      }
      killed.push(`${r.name}:${r.pid}`);
    }
    return killed;
  }
}

export function findGitDir() {
  const r = spawnSync(PLATFORM === 'win32' ? 'where' : 'which', ['git'], { encoding: 'utf8', windowsHide: true });
  const hits = String(r.stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const preferred = hits.find((h) => /[\\/]cmd[\\/]git(\.exe)?$/i.test(h)) ?? hits[0];
  return preferred ? path.dirname(preferred) : null;
}

/** A dir of fake agent launchers that exit 1, so a "detected" agent can never do anything. */
export function writeFakeBin(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ['claude', 'codex']) {
    fs.writeFileSync(path.join(dir, `${name}.cmd`), '@echo off\r\nexit /b 1\r\n');
    fs.writeFileSync(path.join(dir, name), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  }
  return dir;
}

/** The scratch environment of one profile: HOME and friends in `base/home`, userData in `base/userData`. */
export function scratchProfile(base, { gitDir, fakeBin }) {
  const home = path.join(base, 'home');
  const userData = path.join(base, 'userData');
  for (const d of [home, userData, path.join(home, 'AppData', 'Roaming'), path.join(home, 'AppData', 'Local'), path.join(home, '.sequence')]) fs.mkdirSync(d, { recursive: true });
  const env = buildEnv({ base: process.env, platform: PLATFORM, fakeHome: home, gitDir, extra: { SEQUENCE_BENCH: '1' } });
  const sep = PLATFORM === 'win32' ? ';' : ':';
  env.PATH = `${fakeBin}${sep}${env.PATH}`;
  if (PLATFORM === 'win32') env.Path = env.PATH;
  const leaks = envLeaks(env, os.homedir());
  if (leaks.length) throw new Error(`refusing to launch: ${leaks.join('; ')}`);
  /* The fake agent list the stream stand-in needs; no real binary behind it. */
  fs.writeFileSync(path.join(env.SEQUENCE_USER_DIR, 'agents.json'), JSON.stringify({ agents: [{ id: 'codex', command: 'codex', label: 'Codex' }] }));
  return { base, home, userData, env, store: env.SEQUENCE_USER_DIR };
}

const git = (cwd, args) => spawnSync('git', ['-c', 'user.name=bench', '-c', 'user.email=bench@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8', windowsHide: true, env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined } });

/** A git-inited copy of `fixture` in `dest`. `this` copies the tracked files of the repo; `shopfront` the analyzer fixture. */
export function writeFixture(fixture, dest) {
  fs.mkdirSync(dest, { recursive: true });
  if (fixture === 'shopfront') {
    fs.cpSync(path.join(ROOT, 'packages', 'analyzer', 'test', 'fixtures', 'shopfront'), dest, { recursive: true });
  } else if (fixture === 'this') {
    const ls = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
    const files = ls.stdout.toString('utf8').split('\0').filter(Boolean);
    for (const f of files) {
      const from = path.join(ROOT, f);
      const to = path.join(dest, f);
      try {
        if (!fs.statSync(from).isFile()) continue;
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
      } catch {
        /* a submodule dir or a file removed in the working tree */
      }
    }
  } else throw new Error(`unknown fixture ${fixture} (this | shopfront)`);
  git(dest, ['init', '-q', '-b', 'main']);
  git(dest, ['add', '-A']);
  const c = git(dest, ['commit', '-q', '-m', 'bench fixture']);
  if (c.status !== 0) throw new Error(`fixture commit failed: ${c.stderr}`);
  const n = fs.readdirSync(dest).length;
  return { dest, topLevel: n };
}

/** Make `releaseDir`'s win-unpacked (or the platform sibling) a temp copy and return its exe: the repo guard refuses to launch from inside the repo. */
export function copyPackaged(exe, tmpRoot) {
  const srcDir = path.dirname(exe);
  const destDir = path.join(tmpRoot, 'app');
  fs.cpSync(srcDir, destDir, { recursive: true });
  return path.join(destDir, path.basename(exe));
}

/** Drop Chromium's caches (HTTP, code, GPU, shader) from a userData so the next launch is cold, keeping Local Storage. */
export function stripCaches(userData) {
  for (const d of ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'GrShaderCache', 'GraphiteDawnCache', 'ShaderCache']) {
    fs.rmSync(path.join(userData, d), { recursive: true, force: true });
    fs.rmSync(path.join(userData, 'Network', d), { recursive: true, force: true });
  }
}

export function sameDir(a, b) {
  const n = (p) => {
    let r = path.resolve(p);
    try {
      r = fs.realpathSync.native(r);
    } catch {
      /* not there */
    }
    return PLATFORM === 'win32' ? r.toLowerCase() : r;
  };
  return n(a) === n(b);
}
