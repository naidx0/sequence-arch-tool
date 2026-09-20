import { describe, expect, it } from 'vitest';

import { desktopBridge, isDesktop } from './desktopBridge';

/**
 * THE ELECTRON SEAM, READ FROM THE WEB SIDE.
 *
 * `packages/desktop/src/preload.ts` exposes `window.sequence` through
 * `contextBridge`, and `packages/desktop/src/test/preload-bridge.test.ts` locks
 * that name and that method signature. A lock on one side of a seam is only half
 * a lock: rename the global and the preload test still passes while the web
 * build silently loses the native picker. These are the other half.
 *
 * The v1 module this replaces was deleted with `packages/web`. It is REBUILT
 * rather than restored, because its original reason no longer holds: v1 drew a
 * simulated macOS window — a 22px-inset, rounded, drop-shadowed frame — that
 * Electron then drew its real OS frame around, and `isDesktop()` existed to
 * suppress that fake chrome (owner: "when it's actually an electron app, it
 * shouldn't be a box view within a box"). web2 draws no fake frame, so the
 * box-in-a-box problem is gone and that motivation is dead. What survives is the
 * capability itself: in the desktop build the user picks a folder with the OS
 * dialog instead of typing a path into a jailed browser.
 */
describe('isDesktop', () => {
  it('is true only when the host exposes a CALLABLE openRepo', () => {
    expect(isDesktop({ sequence: { openRepo: () => Promise.resolve(null) } })).toBe(true);
  });

  it('is false with no bridge at all — the browser build must stay fully usable', () => {
    expect(isDesktop({})).toBe(false);
    expect(isDesktop(undefined)).toBe(false);
  });

  /*
   * FEATURE DETECTION IS "THE CAPABILITY IS THERE", NOT "THE PROPERTY IS TRUTHY".
   *
   * A page that happens to carry an unrelated `window.sequence` — a global from
   * another script, a string, a stub — must not flip the app into desktop mode,
   * because the very next thing the app does is CALL `openRepo()`. Keying off
   * truthiness turns a name collision into a TypeError in the click handler.
   */
  it('is false for a truthy `sequence` that cannot actually open a repo', () => {
    expect(isDesktop({ sequence: 'yes' })).toBe(false);
    expect(isDesktop({ sequence: 42 })).toBe(false);
    expect(isDesktop({ sequence: {} })).toBe(false);
    expect(isDesktop({ sequence: { openRepo: 'not a function' } })).toBe(false);
    expect(isDesktop({ sequence: null })).toBe(false);
  });
});

describe('desktopBridge', () => {
  it('hands back the SAME object the host exposed, so the caller can invoke it', async () => {
    const api = { openRepo: () => Promise.resolve('C:/repos/thing') };
    const got = desktopBridge({ sequence: api });

    expect(got).toBe(api);
    await expect(got!.openRepo()).resolves.toBe('C:/repos/thing');
  });

  it('is undefined off the desktop, which is what makes the call site branch', () => {
    expect(desktopBridge({})).toBeUndefined();
    expect(desktopBridge({ sequence: { openRepo: 'no' } })).toBeUndefined();
  });
});
