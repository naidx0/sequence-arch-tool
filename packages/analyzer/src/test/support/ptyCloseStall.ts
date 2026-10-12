/* ══════════════════════════════════════════════════════════════════════════
   DOES CLOSING A TERMINAL STALL THE SERVER? (child process for pty-shell.test)
   packages/analyzer/src/test/support/ptyCloseStall.ts

   ClosePseudoConsole is synchronous and, per Microsoft, can block until the
   console host has flushed, which waits on someone draining the output pipe.
   In node-pty that call runs on the JS thread, so a close with output still
   pending could freeze the whole server. This closes a terminal through
   trySpawnPty's kill() while its child floods output (64 KB chunks without
   pause), with a 20 ms heartbeat timing the longest event-loop stall, and
   prints one RESULT line. Run as a child with a hard timeout by the test: if
   the close blocked for good, the test kills this process and fails.
   ══════════════════════════════════════════════════════════════════════════ */

import os from 'node:os';

import { loadPtyModule, trySpawnPty } from '../../server/ptyShell.js';

async function main(): Promise<void> {
  if (!(await loadPtyModule())) {
    process.stdout.write(`RESULT ${JSON.stringify({ skipped: 'node-pty did not load' })}\n`);
    return;
  }
  const flood = "console.log('up'); setTimeout(() => setInterval(() => process.stdout.write('x'.repeat(65536)), 0), 200); setInterval(() => {}, 1000)";
  const pty = trySpawnPty(process.execPath, os.tmpdir(), process.env, 80, 24, ['-e', flood]);
  if (!pty) throw new Error('trySpawnPty returned null');
  let bytes = 0;
  pty.onData((d) => (bytes += d.length));
  let exited = false;
  pty.onExit(() => (exited = true));
  /* Close once the flood is well under way. */
  while (bytes < 1_000_000) await new Promise((r) => setTimeout(r, 20));
  let last = Date.now();
  let maxStallMs = 0;
  const hb = setInterval(() => {
    const now = Date.now();
    maxStallMs = Math.max(maxStallMs, now - last);
    last = now;
  }, 20);
  const t0 = Date.now();
  pty.kill();
  const killReturnedMs = Date.now() - t0;
  const deadline = Date.now() + 20_000;
  while (!exited && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 500));
  clearInterval(hb);
  process.stdout.write(`RESULT ${JSON.stringify({ exited, killReturnedMs, maxStallMs, bytesBeforeClose: bytes })}\n`);
}

main().then(
  () => setInterval(() => {}, 1000),
  (e: unknown) => {
    process.stdout.write(`RESULT ${JSON.stringify({ error: (e as Error).message })}\n`);
    setInterval(() => {}, 1000);
  },
);
