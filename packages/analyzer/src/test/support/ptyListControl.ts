/* ══════════════════════════════════════════════════════════════════════════
   THE NODE-PTY KILL CONTROL, IN ITS OWN PROCESS
   packages/analyzer/src/test/support/ptyListControl.ts

   Run by pty-shell.test as a child process, never imported. It does what the
   in-process test used to do and prints one RESULT line:
     - the control: node-pty's own kill(), with the console list stubbed to
       [] (counted, never run), on a child that runs for ever;
     - ours: trySpawnPty's kill() on the same kind of child.
   Then it idles until the test tree-kills it.

   WHY A PROCESS (measured 2026-10-06). With the list stubbed, node-pty's kill
   ends nothing it does not have to: under load the control's child stayed
   alive, and node-pty still reported 'exit' (it fires when the output socket
   closes, not when the process ends), so the old in-process cleanup thought
   it was gone and skipped it. Its open pty sockets then kept the test process
   alive after every test had passed: 7 of 24 loaded runs never exited. Here the
   whole tree, that child included, belongs to a process the test holds a
   handle to and kills, so nothing outlives it.
   ══════════════════════════════════════════════════════════════════════════ */

import { createRequire } from 'node:module';
import os from 'node:os';

import { loadPtyModule, trySpawnPty } from '../../server/ptyShell.js';

const ARGS = ['-e', "console.log('up'); setInterval(() => {}, 1000)"];

async function main(): Promise<void> {
  const mod = await loadPtyModule();
  if (!mod) {
    process.stdout.write(`RESULT ${JSON.stringify({ skipped: 'node-pty did not load' })}\n`);
    return;
  }
  const Agent = createRequire(import.meta.url)('node-pty/lib/windowsPtyAgent').WindowsPtyAgent as {
    prototype: { _getConsoleProcessList: () => Promise<number[]> };
  };
  let listed = 0;
  /* Counted, never run: the real one forks a helper and may kill a pid. */
  Agent.prototype._getConsoleProcessList = () => {
    listed++;
    return Promise.resolve([]);
  };
  const firstData = (p: { onData(cb: (d: string) => void): void }) =>
    new Promise<void>((resolve) => p.onData(() => resolve()));

  const raw = mod.spawn(process.execPath, ARGS, { cols: 80, rows: 24, cwd: os.tmpdir(), env: process.env as Record<string, string> });
  await firstData(raw);
  raw.kill();
  await new Promise((r) => setTimeout(r, 300));
  const controlListed = listed;

  const ours = trySpawnPty(process.execPath, os.tmpdir(), process.env, 80, 24, ARGS);
  if (!ours) throw new Error('trySpawnPty returned null');
  await firstData(ours);
  const oursExitMs = await new Promise<number>((resolve) => {
    const t0 = Date.now();
    ours.onExit(() => resolve(Date.now() - t0));
    ours.kill();
  });
  await new Promise((r) => setTimeout(r, 1000));
  process.stdout.write(`RESULT ${JSON.stringify({ controlListed, oursListed: listed - controlListed, oursExitMs })}\n`);
}

main().then(
  () => setInterval(() => {}, 1000),
  (e: unknown) => {
    process.stdout.write(`RESULT ${JSON.stringify({ error: (e as Error).message })}\n`);
    setInterval(() => {}, 1000);
  },
);
