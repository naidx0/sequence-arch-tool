import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

import { ATTENTION_CHANNEL, AttentionController, FOCUS_CHAT_CHANNEL, type AttentionWindow } from '../attention';

/**
 * S5, NEVER MISS A TURN: the main-process handlers, against a FAKE
 * BrowserWindow, app and Notification. `attention.ts` imports nothing from
 * Electron, so this runs under `node --test` like server-control.test.ts.
 * The last two tests check main.ts and preload.ts name the channel, as
 * preload-bridge.test.ts does, because importing them needs Electron.
 */

class FakeWindow implements AttentionWindow {
  focused = false;
  minimized = false;
  destroyed = false;
  calls: string[] = [];
  sent: { channel: string; args: unknown[] }[] = [];
  flashes: boolean[] = [];
  overlays: { overlay: unknown; description: string }[] = [];
  webContents = { send: (channel: string, ...args: unknown[]) => void this.sent.push({ channel, args }) };
  isDestroyed() { return this.destroyed; }
  isFocused() { return this.focused; }
  isMinimized() { return this.minimized; }
  show() { this.calls.push('show'); }
  restore() { this.calls.push('restore'); this.minimized = false; }
  focus() { this.calls.push('focus'); this.focused = true; }
  flashFrame(flag: boolean) { this.flashes.push(flag); }
  setOverlayIcon(overlay: unknown, description: string) { this.overlays.push({ overlay, description }); }
}

function rig(platform = 'win32', supported = true) {
  const win = new FakeWindow();
  const badges: number[] = [];
  type Fake = { title: string; body: string; shown: boolean; handlers: Record<string, (...a: unknown[]) => void>; click?: () => void };
  const notices: Fake[] = [];
  const logs: string[] = [];
  const ctl = new AttentionController({
    window: () => win,
    app: { setBadgeCount: (n?: number) => (badges.push(n ?? 0), true) },
    notifier: {
      isSupported: () => supported,
      create: (opts) => {
        const n: Fake = { ...opts, shown: false, handlers: {} };
        notices.push(n);
        return {
          on: (e: string, fn: (...a: never[]) => void) => {
            n.handlers[e] = fn as (...a: unknown[]) => void;
            if (e === 'click') n.click = fn as () => void;
          },
          show: () => void (n.shown = true),
        };
      },
    },
    platform,
    overlayIcon: () => 'DOT',
    log: (l) => void logs.push(l),
  });
  return { win, badges, notices, ctl, logs };
}

test('notify: shown while the window is in the background, with the text the renderer sent', () => {
  const { notices, ctl } = rig();
  const r = ctl.handle({ kind: 'notify', title: 'Codex finished', body: 'Open Sequence to see what happened.', runId: 'run-1' });
  assert.deepStrictEqual(r, { shown: true });
  assert.strictEqual(notices.length, 1);
  assert.strictEqual(notices[0]!.title, 'Codex finished');
  assert.strictEqual(notices[0]!.shown, true);
});

test('notify: NOT shown while the window is focused (it reports what is on screen)', () => {
  const { win, notices, ctl } = rig();
  win.focused = true;
  assert.deepStrictEqual(ctl.handle({ kind: 'notify', title: 't', body: 'b' }), { shown: false });
  assert.strictEqual(notices.length, 0);
});

test('notify: nothing on a system without notifications', () => {
  const { notices, ctl } = rig('win32', false);
  assert.deepStrictEqual(ctl.handle({ kind: 'notify', title: 't', body: 'b' }), { shown: false });
  assert.strictEqual(notices.length, 0);
});

test('clicking a notification restores, shows and focuses the window, and tells the page which chat', () => {
  const { win, notices, ctl } = rig();
  win.minimized = true;
  ctl.handle({ kind: 'notify', title: 't', body: 'b', runId: 'run-7' });
  notices[0]!.click!();
  assert.deepStrictEqual(win.calls, ['restore', 'show', 'focus']);
  assert.deepStrictEqual(win.sent, [{ channel: FOCUS_CHAT_CHANNEL, args: [{ runId: 'run-7' }] }]);
});

test('waiting approvals in the background on Windows: an overlay icon saying how many, and flashFrame; setBadgeCount (a no-op there) is not relied on', () => {
  const { win, badges, ctl } = rig('win32');
  ctl.handle({ kind: 'waiting', count: 2 });
  assert.deepStrictEqual(win.overlays, [{ overlay: 'DOT', description: '2 approvals waiting' }]);
  assert.deepStrictEqual(badges, []);
  assert.deepStrictEqual(win.flashes, [true]);
  assert.deepStrictEqual(ctl.snapshot, { waiting: 2, badge: 2, flashing: true });
});

test('answered (count 0) clears the overlay with null and stops the flash', () => {
  const { win, ctl } = rig('win32');
  ctl.handle({ kind: 'waiting', count: 1 });
  ctl.handle({ kind: 'waiting', count: 0 });
  assert.deepStrictEqual(win.overlays, [{ overlay: 'DOT', description: '1 approval waiting' }, { overlay: null, description: '' }]);
  assert.deepStrictEqual(win.flashes, [true, false]);
});

test('focus stops the flash and clears the overlay even with approvals unanswered; blur brings both back', () => {
  const { win, ctl } = rig('win32');
  ctl.handle({ kind: 'waiting', count: 3 });
  win.focused = true;
  ctl.onFocus();
  assert.deepStrictEqual(ctl.snapshot, { waiting: 3, badge: 0, flashing: false });
  assert.deepStrictEqual(win.flashes, [true, false], 'flashFrame(false) on focus');
  win.focused = false;
  ctl.onBlur();
  assert.deepStrictEqual(win.overlays.map((o) => o.description), ['3 approvals waiting', '', '3 approvals waiting']);
  assert.deepStrictEqual(win.flashes, [true, false, true]);
});

test('a count while the window is focused sets no badge and no flash', () => {
  const { win, ctl } = rig('win32');
  win.focused = true;
  ctl.handle({ kind: 'waiting', count: 4 });
  assert.deepStrictEqual(win.overlays, []);
  assert.deepStrictEqual(win.flashes, []);
});

test('macOS: badge, no flashFrame (the badge is the dock\'s own signal)', () => {
  const { win, badges, ctl } = rig('darwin');
  ctl.handle({ kind: 'waiting', count: 1 });
  ctl.handle({ kind: 'waiting', count: 0 });
  assert.deepStrictEqual(badges, [1, 0]);
  assert.deepStrictEqual(win.overlays, []);
  assert.deepStrictEqual(win.flashes, []);
});

test('the evidence: Electron show and Windows failed events are logged and read back by status', () => {
  const { notices, ctl, logs } = rig();
  ctl.handle({ kind: 'notify', title: 'Codex finished', body: 'b' });
  ctl.handle({ kind: 'notify', title: 'Codex needs you', body: 'b' });
  assert.deepStrictEqual((ctl.handle({ kind: 'status' }) as { notices: unknown[] }).notices, [
    { title: 'Codex finished', state: 'requested' },
    { title: 'Codex needs you', state: 'requested' },
  ]);
  notices[0]!.handlers.show!();
  notices[1]!.handlers.failed!({}, 'toast suppressed');
  assert.deepStrictEqual((ctl.handle({ kind: 'status' }) as { notices: unknown[] }).notices, [
    { title: 'Codex finished', state: 'shown' },
    { title: 'Codex needs you', state: 'failed', error: 'toast suppressed' },
  ]);
  assert.deepStrictEqual(logs, ['[attention] notification shown: Codex finished', '[attention] notification failed: Codex needs you: toast suppressed']);
});

test('the AppUserModelID set at startup is electron-builder appId (the shortcut id), in dev too', () => {
  const main = read('main.ts');
  const id = /export const APP_USER_MODEL_ID = '([^']+)'/.exec(main)?.[1];
  const yml = fs.readFileSync(path.resolve(__dirname, '..', '..', 'electron-builder.yml'), 'utf8');
  assert.equal(id, /^appId:\s*(\S+)/m.exec(yml)?.[1]);
  assert.match(main, /if \(process\.platform === 'win32'\) app\.setAppUserModelId\(APP_USER_MODEL_ID\);/);
});

test('an unknown request kind throws (a preload/main drift is an error, not a dead feature)', () => {
  const { ctl } = rig();
  assert.throws(() => ctl.handle({ kind: 'bounce' } as never), /unknown request kind/);
});

test('a destroyed window is left alone', () => {
  const { win, ctl } = rig();
  win.destroyed = true;
  ctl.handle({ kind: 'waiting', count: 1 });
  ctl.raise('run-1');
  assert.deepStrictEqual(win.flashes, []);
  assert.deepStrictEqual(win.calls, []);
});

const SRC = path.resolve(__dirname, '..', '..', 'src');
const read = (f: string) => fs.readFileSync(path.join(SRC, f), 'utf8').replace(/\r\n/g, '\n');

test('main.ts handles the attention channel with the controller, and clears on focus', () => {
  const main = read('main.ts');
  assert.match(main, /ipcMain\.handle\(ATTENTION_CHANNEL, \(_e, req: AttentionRequest\) => attention\.handle\(req\)\)/);
  assert.match(main, /mainWindow\.on\('focus', \(\) => attention\.onFocus\(\)\)/);
  assert.match(main, /mainWindow\.on\('blur', \(\) => attention\.onBlur\(\)\)/);
});

test('the preload exposes `attention` on the channel main handles, and `onFocusChat` on the one it sends', () => {
  const preload = read('preload.ts');
  assert.ok(preload.includes(`ipcRenderer.invoke('${ATTENTION_CHANNEL}', req)`));
  assert.ok(preload.includes(`ipcRenderer.on('${FOCUS_CHAT_CHANNEL}', listener)`));
});

test('Windows notifications switched off (failed with 0x803E0114): status says blocked, the overlay and flash still work, and a later show clears it', () => {
  const { win, notices, ctl } = rig('win32');
  ctl.handle({ kind: 'notify', title: 'Codex needs you', body: 'b' });
  notices[0]!.handlers.failed!({}, 'Notification failed. HRESULT:-2143420140');
  const status = () => ctl.handle({ kind: 'status' }) as { notificationsBlocked: boolean };
  assert.equal(status().notificationsBlocked, true);
  ctl.handle({ kind: 'waiting', count: 1 });
  assert.deepStrictEqual(win.overlays, [{ overlay: 'DOT', description: '1 approval waiting' }]);
  assert.deepStrictEqual(win.flashes, [true]);
  ctl.handle({ kind: 'notify', title: 'Codex finished', body: 'b' });
  notices[1]!.handlers.show!();
  assert.equal(status().notificationsBlocked, false);
});

test('a failure for any other reason is not reported as blocked', () => {
  const { notices, ctl } = rig('win32');
  ctl.handle({ kind: 'notify', title: 't', body: 'b' });
  notices[0]!.handlers.failed!({}, 'Notification failed. HRESULT:-2147024891');
  assert.equal((ctl.handle({ kind: 'status' }) as { notificationsBlocked: boolean }).notificationsBlocked, false);
});

test('the overlay dot is the S4 dark-theme accent (#6b91ff), not the retired gold', () => {
  const main = read('main.ts');
  assert.match(main, /OVERLAY_DOT_RGB = \{ r: 0x6b, g: 0x91, b: 0xff \}/);
  assert.doesNotMatch(main, /0xc9 \* \(a \/ 255\)/);
});
