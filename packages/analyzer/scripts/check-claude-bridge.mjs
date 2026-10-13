#!/usr/bin/env node
/* Boot check for the Claude bridge, from the shape an installer ships (and from tests).
   Starts `<nodeBin> <...args>` (the full bundle, or the launcher plus a bridge entry) with a FAKE `claude`
   first on PATH and CLAUDE_CODE_EXECUTABLE unset, sends ACP `initialize` and then `session/new`, and reports:
     ok / agentInfo   the bridge started and answered initialize;
     claudeEnv        the environment the bridge gave the `claude` it spawned for the session (null when it never did).
   Callers assert claudeEnv.CLAUDE_CODE_EXECUTABLE is the fake and ELECTRON_RUN_AS_NODE is absent although the
   bridge was started with it. No model is called and nothing signs in.
   See writeFakeClaude for the fake on each platform. */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const NPM_HEAD = '@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n';

const FAKE_CLI = (dump) => `const fs = require('node:fs');\nif (process.argv.includes('--version')) console.log('2.1.280 (Claude Code)');\nelse fs.writeFileSync(${JSON.stringify(dump)}, JSON.stringify(process.env));\n`;

/** The compiled-launcher helper from the analyzer build, or null (a build without the test output keeps the old Windows fake). */
async function windowsShim() {
  if (process.platform !== 'win32') return null;
  try {
    return (await import(new URL('../dist/test/helpers/nativeShim.js', import.meta.url).href)).makeNativeShim;
  } catch {
    return null;
  }
}

/** Writes a fake `claude` into `dir`. Unix: an executable that dumps its environment as JSON to `dump`.
 *  Windows: a real npm shim (the native-binary template of claude >= 2.1.113) around a copy of node.exe named
 *  claude.exe; that binary cannot dump its environment, so claudeEnv stays null there. Returns the path
 *  CLAUDE_CODE_EXECUTABLE should end up as. */
export function writeFakeClaude(dir, dump, shim = null) {
  if (process.platform === 'win32') {
    const bin = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin');
    fs.mkdirSync(bin, { recursive: true });
    if (shim) {
      /* A compiled launcher (test/helpers/nativeShim) that runs the same dumping script as the Unix fake. */
      const cli = path.join(dir, 'fake-claude.js');
      fs.writeFileSync(cli, FAKE_CLI(dump));
      shim(bin, 'claude', cli);
    } else {
      fs.copyFileSync(process.execPath, path.join(bin, 'claude.exe'));
    }
    fs.writeFileSync(path.join(dir, 'claude.cmd'), `${NPM_HEAD}"%dp0%\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe"   %*\r\n`);
    return path.join(bin, 'claude.exe');
  }
  const cli = path.join(dir, 'fake-claude.js');
  fs.writeFileSync(cli, FAKE_CLI(dump));
  const exe = path.join(dir, 'claude');
  fs.writeFileSync(exe, `#!/bin/sh\nexec "${process.execPath}" "${cli}" "$@"\n`);
  fs.chmodSync(exe, 0o755);
  return exe;
}

export async function checkClaudeBridge({ args, entry, nodeBin = process.execPath, env = {}, timeoutMs = 25000 }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-bridge-check-'));
  try {
    const dump = path.join(dir, 'claude-env.json');
    const fake = writeFakeClaude(dir, dump, await windowsShim());
    const key = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
    const childEnv = { ...process.env, ...env, [key]: dir + path.delimiter + (process.env[key] ?? '') };
    delete childEnv.CLAUDE_CODE_EXECUTABLE;
    let spawned = null;
    try {
    return await new Promise((resolve) => {
      const child = (spawned = spawn(nodeBin, (args ?? [entry]).map((a) => (a.startsWith('-') ? a : path.resolve(a))), { env: childEnv, cwd: dir, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }));
      let out = '';
      let err = '';
      let info = null;
      let poll = null;
      let soon = null;
      const done = (r) => {
        clearTimeout(timer);
        clearInterval(poll); /* on Windows the dump never appears: an uncleared poll kept the host process alive forever */
        clearTimeout(soon);
        killTree(child);
        let claudeEnv = null;
        try {
          claudeEnv = JSON.parse(fs.readFileSync(dump, 'utf8'));
        } catch {}
        resolve({ fake, claudeEnv, ...r, stderr: err.slice(-1500) });
      };
      const timer = setTimeout(() => done(info ? { ok: true, problems: [], agentInfo: info } : { ok: false, problems: ['no initialize answer in time'] }), timeoutMs);
      const finishSoon = () => (soon = setTimeout(() => done({ ok: true, problems: [], agentInfo: info }), process.platform === 'win32' ? 20000 : 6000));
      child.stdout.on('data', (d) => {
        out += d;
        if (!info && out.split('\n').some((l) => l.includes('"id":1'))) {
          const line = out.split('\n').find((l) => l.includes('"id":1'));
          try {
            info = JSON.parse(line).result?.agentInfo;
          } catch (e) {
            return done({ ok: false, problems: [`unparseable answer: ${e.message}`] });
          }
          if (!info?.name) return done({ ok: false, problems: ['initialize answered without agentInfo'] });
          child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: dir, mcpServers: [] } }) + '\n');
          poll = setInterval(() => {
            if (fs.existsSync(dump)) {
              clearInterval(poll);
              setTimeout(() => done({ ok: true, problems: [], agentInfo: info }), 200);
            }
          }, 100);
          finishSoon();
        }
      });
      child.stderr.on('data', (d) => (err += d));
      child.on('error', (e) => done({ ok: false, problems: [`could not start: ${e.message}`] }));
      child.on('exit', (code) => done(info ? { ok: true, problems: [], agentInfo: info } : { ok: false, problems: [`exited ${code} before answering`] }));
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } }) + '\n');
    });
    } finally {
      await waitForExit(spawned, 5000);
    }
  } finally {
    await removeDirRetry(dir);
  }
}

/** Kills the child and, on Windows, everything it spawned (the fake claude.exe runs with cwd = the temp dir). */
function killTree(child) {
  try {
    if (process.platform === 'win32' && child.pid) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill();
  } catch {}
  try {
    child.kill();
  } catch {}
}

/** Resolves once the child has exited (or after timeoutMs): Windows keeps a directory locked while a process has it as cwd. */
export function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, timeoutMs);
    child.once('exit', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

/** fs.rmSync that retries briefly on EPERM / EBUSY / ENOTEMPTY (a just-killed process can hold the folder a moment longer). */
export async function removeDirRetry(dir, { rm = fs.rmSync, attempts = 25, delayMs = 200 } = {}) {
  for (let i = 0; ; i++) {
    try {
      rm(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      if (i >= attempts - 1 || !['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(e?.code)) throw e;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

/** Why a finished check should fail the packaging step, or null. On Windows the fake claude is a copy of node.exe that
 *  cannot dump its environment (claudeEnv stays null), so only "the bridge started" can be asserted there. */
export function bridgeCheckProblem(r, platform = process.platform) {
  if (!r.ok) return r.problems.join('; ') || 'the bridge did not start';
  if (platform === 'win32' && !r.claudeEnv) return null;
  if (!r.claudeEnv || r.claudeEnv.ELECTRON_RUN_AS_NODE !== undefined || !r.claudeEnv.CLAUDE_CODE_EXECUTABLE) return 'claude saw the wrong environment';
  return null;
}
