import assert from 'node:assert';
import { test } from 'node:test';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ServerController } from '../server-control';

/**
 * QUIT ENDS THE SERVER'S WHOLE TREE, AND ONLY THAT TREE.
 *
 * A stand-in server spawns a child, which spawns a DETACHED grandchild that
 * ignores stdio and sleeps: the shape of a codex descendant that does not die
 * when its pipes close. `stop()` (what `before-quit` calls) must leave none of
 * the three alive, inside the 3 s quit budget, while a process this test
 * started outside the tree keeps running.
 *
 * Identity is pid AND creation time, so a reused pid cannot read as a
 * survivor, and cleanup never signals a process that is not ours.
 */

const BUDGET_MS = 3000;
/** Scheduling slack on top of the budget (a loaded machine, a slow taskkill start). */
const SLACK_MS = 750;

function standInServer(): { dir: string; cli: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-quit-tree-'));
  const put = (name: string, lines: string[]): string => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, lines.join('\n'));
    return file;
  };
  /* Each process writes its own pid, atomically, then sleeps. */
  const writePid = (name: string): string =>
    `fs.writeFileSync(path.join(__dirname, '${name}.tmp'), String(process.pid)); fs.renameSync(path.join(__dirname, '${name}.tmp'), path.join(__dirname, '${name}'));`;
  put('grandchild.js', ["const fs = require('node:fs'); const path = require('node:path');", writePid('grandchild.pid'), 'setInterval(() => {}, 1 << 30);']);
  put('child.js', [
    "const fs = require('node:fs'); const path = require('node:path'); const cp = require('node:child_process');",
    writePid('child.pid'),
    "const g = cp.spawn(process.execPath, [path.join(__dirname, 'grandchild.js')], { detached: true, stdio: 'ignore', windowsHide: true });",
    'g.unref();',
    'setInterval(() => {}, 1 << 30);',
  ]);
  const cli = put('server.js', [
    "const fs = require('node:fs'); const path = require('node:path'); const cp = require('node:child_process'); const http = require('node:http');",
    "const port = Number(process.argv[process.argv.indexOf('--port') + 1]);",
    "cp.spawn(process.execPath, [path.join(__dirname, 'child.js')], { stdio: 'ignore', windowsHide: true });",
    "const s = http.createServer((q, r) => { r.statusCode = 200; r.end('ok'); });",
    /* Ready only once the whole tree exists, so the test never races its own setup. */
    "const t = setInterval(() => { if (fs.existsSync(path.join(__dirname, 'grandchild.pid'))) { clearInterval(t); s.listen(port, '127.0.0.1', () => console.log('SEQUENCE_LISTENING http://127.0.0.1:' + port)); } }, 25);",
  ]);
  return { dir, cli };
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 30_000 }, (_e, stdout) => resolve(String(stdout ?? '')));
  });
}

/** Creation time per live pid (absent = not running). One listing for all pids. */
async function liveWithCreation(pids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (process.platform === 'win32') {
    const ps = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const filter = pids.map((p) => `ProcessId=${p}`).join(' OR ');
    const text = await run(ps, [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-CimInstance Win32_Process -Filter '${filter}' | ForEach-Object { "$($_.ProcessId) $(([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds())" }`,
    ]);
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(line);
      if (m) out.set(Number(m[1]), m[2]);
    }
  } else {
    const text = await run('ps', ['-o', 'pid=,lstart=', '-p', pids.join(',')]);
    for (const line of text.split('\n')) {
      const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
      if (m) out.set(Number(m[1]), m[2]);
    }
  }
  return out;
}

async function readPid(file: string): Promise<number> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(file)) return Number(fs.readFileSync(file, 'utf8'));
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`no pid written at ${file}`);
}

test('stop() ends the server, its child and its detached grandchild inside the quit budget; a bystander survives', async () => {
  const { dir, cli } = standInServer();
  const bystander = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30)'], { stdio: 'ignore', windowsHide: true });
  const controller = new ServerController({ cliPath: cli, nodeExecPath: process.execPath, healthTimeoutMs: 20_000, pollIntervalMs: 100 });
  let ours = new Map<number, string>();
  try {
    await controller.start();
    const server = controller.childPid!;
    const child = await readPid(path.join(dir, 'child.pid'));
    const grandchild = await readPid(path.join(dir, 'grandchild.pid'));
    const named = { server, child, grandchild, bystander: bystander.pid! };
    ours = await liveWithCreation(Object.values(named));
    for (const [role, pid] of Object.entries(named)) assert.ok(ours.has(pid), `${role} ${pid} is running before stop`);

    const t0 = Date.now();
    await controller.stop();
    const took = Date.now() - t0;
    assert.ok(took <= BUDGET_MS + SLACK_MS, `stop() took ${took} ms; the quit budget is ${BUDGET_MS} ms`);

    const after = await liveWithCreation(Object.values(named));
    const same = (pid: number): boolean => after.has(pid) && after.get(pid) === ours.get(pid);
    const survivors = (['server', 'child', 'grandchild'] as const).filter((r) => same(named[r])).map((r) => `${r} ${named[r]}`);
    assert.deepStrictEqual(survivors, [], `the server tree must be gone after stop() (${took} ms)`);
    assert.ok(same(named.bystander), `bystander ${named.bystander}, started outside the tree, must survive`);
  } finally {
    await controller.stop().catch(() => undefined);
    /* Kill only what this test made, and only if its creation time still matches. */
    const pids = [...ours.keys()];
    if (pids.length > 0) {
      const now = await liveWithCreation(pids);
      for (const pid of pids) {
        if (now.get(pid) === ours.get(pid)) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            /* gone */
          }
        }
      }
    }
    try {
      bystander.kill('SIGKILL');
    } catch {
      /* gone */
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
