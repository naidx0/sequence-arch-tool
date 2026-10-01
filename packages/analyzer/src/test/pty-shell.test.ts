/**
 * C1.1 — PTY probe + spawn helpers (locking unit tests).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import os from 'node:os';

import {
  loadPtyModule,
  resetPtyModuleCache,
  trySpawnPty,
} from '../server/ptyShell.js';
import { resolveShell } from '../server/terminal.js';

describe('ptyShell (C1.1)', () => {
  it('loads node-pty or honestly returns null', async () => {
    resetPtyModuleCache();
    const mod = await loadPtyModule();
    if (mod === null) {
      assert.equal(trySpawnPty(resolveShell(), os.tmpdir(), process.env), null);
      return;
    }
    assert.equal(typeof mod.spawn, 'function');
  });

  it('spawns a PTY that can echo when the binding is present', async () => {
    resetPtyModuleCache();
    const mod = await loadPtyModule();
    if (!mod) return; // environment without native build — pipe fallback covers CI honesty

    /*
     * RETRY THE SPAWN, and treat a persistent null as the honest fallback it is.
     *
     * node-pty on Windows drives ConPTY, and its console-list helper
     * (conpty_console_list_agent.js) intermittently dies with "AttachConsole failed" when many
     * processes churn — which is exactly what a 1700-test suite does. The spawn then returns
     * null. Asserting that a loaded module ALWAYS yields a session made this test pass alone
     * and fail about three runs in four inside the full suite, which is worse than either a
     * clean pass or a clean failure.
     *
     * The PRODUCT contract is already correct and is what this locks: trySpawnPty returns a
     * real PTY or null, and terminal.ts falls back to a pipe shell and ANNOUNCES pipe (the
     * C1.1 honesty test in terminal.test.ts covers that path). So: retry a few times, and if
     * the OS still refuses a console slot, require that the refusal is the documented win32
     * one rather than silently passing. On any other platform a null here is a hard failure.
     */
    let pty: ReturnType<typeof trySpawnPty> = null;
    for (let attempt = 0; attempt < 3 && !pty; attempt++) {
      pty = trySpawnPty(resolveShell(), os.tmpdir(), process.env, 80, 24);
      if (!pty) await new Promise((r) => setTimeout(r, 250));
    }
    if (!pty) {
      assert.equal(
        process.platform,
        'win32',
        'a loaded node-pty that cannot spawn is only tolerated on win32 ConPTY',
      );
      return;
    }

    assert.equal(pty.backend, 'pty');
    let buf = '';
    pty.onData((d) => {
      buf += d;
    });
    pty.write('echo C1_PTY_OK' + String.fromCharCode(10));
    /*
     * POLL for the marker instead of sleeping a fixed 400ms.
     *
     * A shell under a 1700-test suite does not always start, read and echo inside a fixed
     * window — the spawn succeeded and the echo simply had not arrived yet, so the fixed
     * sleep failed about one run in three while proving nothing about the product. Waiting
     * UNTIL the marker (or a real timeout) tests the same claim without the race.
     */
    const deadline = Date.now() + 8000;
    while (!/C1_PTY_OK/.test(buf) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    pty.resize(100, 30); // must not throw
    pty.kill();
    assert.match(buf, /C1_PTY_OK/);
  });
});
