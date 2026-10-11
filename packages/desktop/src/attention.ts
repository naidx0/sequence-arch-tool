/* ══════════════════════════════════════════════════════════════════════════
   NEVER MISS A TURN: the desktop half (S5)
   packages/desktop/src/attention.ts

   The renderer knows when an agent's turn ends and when an approval is
   waiting. It cannot raise the window, flash the taskbar or set a dock badge;
   only the main process can. This is the main-process side of that, kept
   ELECTRON-FREE (like server-control.ts) so it is unit-tested with a fake
   window under `node --test`, where the Electron binary cannot be downloaded.

   ONE CHANNEL, NAMED REQUESTS, as `sequence:shell` does it:
     { kind: 'notify', title, body, runId? }   show an OS notification; a click
                                               raises the window and tells the
                                               renderer to focus that chat
     { kind: 'waiting', count }                how many approvals are waiting:
                                               badge + flashFrame while the
                                               window is not in front (on
                                               Windows the badge is an overlay
                                               icon: setBadgeCount is a no-op)
     { kind: 'status' }                        the state, and each notice's
                                               fate from Electron's 'show' /
                                               'failed' events (the evidence)
   Anything else throws, so a drift between preload and main is an error and
   not a dead feature.

   CLEARED ON FOCUS. A badge or a flashing taskbar button for a window the
   person is already looking at reports what they can see. Focus clears both;
   a later count only re-badges while the window is in the background again.
   ══════════════════════════════════════════════════════════════════════════ */

/** The slice of a BrowserWindow this needs. */
export interface AttentionWindow {
  isDestroyed(): boolean;
  isFocused(): boolean;
  isMinimized(): boolean;
  show(): void;
  restore(): void;
  focus(): void;
  flashFrame(flag: boolean): void;
  /** Windows' taskbar badge: a small image over the app's button, null clears it. */
  setOverlayIcon(overlay: unknown | null, description: string): void;
  webContents: { send(channel: string, ...args: unknown[]): void };
}

/** The slice of `app`: the dock / launcher badge (macOS, Linux Unity). */
export interface AttentionApp {
  setBadgeCount(count?: number): boolean;
}

/** One OS notification, as Electron's main-process `Notification` builds it. */
export interface AttentionNotice {
  on(event: 'click' | 'show', fn: () => void): unknown;
  /** Windows only: the toast could not be shown (Electron's 'failed', with its error). */
  on(event: 'failed', fn: (event: unknown, error: string) => void): unknown;
  show(): void;
}

/** What became of one notification: the evidence, since a toast cannot be screenshotted honestly. */
export interface NoticeRecord {
  title: string;
  state: 'requested' | 'shown' | 'failed' | 'clicked';
  error?: string;
}

export interface AttentionNotifier {
  isSupported(): boolean;
  create(opts: { title: string; body: string }): AttentionNotice;
}

export type AttentionRequest =
  | { kind: 'notify'; title: string; body: string; runId?: string | null }
  | { kind: 'waiting'; count: number }
  /** Read back the state and the notification log (evidence for a smoke run). */
  | { kind: 'status' };

export interface AttentionState {
  /** Approvals the renderer last said are waiting. */
  waiting: number;
  /** What the badge was last set to. */
  badge: number;
  flashing: boolean;
}

/** The channel the renderer is told on, after a notification click. */
export const FOCUS_CHAT_CHANNEL = 'sequence:focus-chat';
/** The invoke channel the preload calls. */
export const ATTENTION_CHANNEL = 'sequence:attention';

export interface AttentionOptions {
  window: () => AttentionWindow | null;
  app: AttentionApp;
  notifier: AttentionNotifier;
  platform: NodeJS.Platform | string;
  /** The image Windows draws over the taskbar button while approvals wait (nativeImage in main). */
  overlayIcon?: () => unknown;
  /** Where notification events are logged (main: console.log). */
  log?: (line: string) => void;
}

export class AttentionController {
  private readonly opts: AttentionOptions;
  private state: AttentionState = { waiting: 0, badge: 0, flashing: false };
  private readonly notices: NoticeRecord[] = [];
  /** The last attempt failed because Windows' own settings switch toasts off. Cleared by a 'show'. */
  private blocked = false;

  constructor(opts: AttentionOptions) {
    this.opts = opts;
  }

  get snapshot(): AttentionState {
    return { ...this.state };
  }

  /** The one entry point behind `ipcMain.handle(ATTENTION_CHANNEL, …)`. */
  handle(req: AttentionRequest): unknown {
    if (!req || typeof req !== 'object') throw new Error('attention: expected a request object');
    switch (req.kind) {
      case 'notify':
        return this.notify(req.title, req.body, req.runId ?? null);
      case 'waiting':
        return this.setWaiting(req.count);
      case 'status':
        return { ...this.snapshot, notificationsBlocked: this.blocked, notices: this.notices.map((n) => ({ ...n })) };
      default:
        throw new Error(`attention: unknown request kind ${String((req as { kind?: unknown }).kind)}`);
    }
  }

  /**
   * Show a notification. Refused (not shown) when the window is in front:
   * the renderer already checks, and this is the second check, because a
   * notification about what is on screen is the one that teaches people to
   * turn the feature off.
   */
  notify(title: string, body: string, runId: string | null): { shown: boolean } {
    const win = this.live();
    if (win && win.isFocused()) return { shown: false };
    if (!this.opts.notifier.isSupported()) return { shown: false };
    const record: NoticeRecord = { title: String(title).slice(0, 200), state: 'requested' };
    this.notices.push(record);
    if (this.notices.length > 20) this.notices.shift();
    const notice = this.opts.notifier.create({ title: record.title, body: String(body).slice(0, 500) });
    /* 'show' and Windows' 'failed' are the only proof a toast was drawn:
       `shown: true` below means only that it was asked for. */
    notice.on('show', () => {
      record.state = 'shown';
      this.blocked = false;
      this.opts.log?.(`[attention] notification shown: ${record.title}`);
    });
    notice.on('failed', (_e: unknown, error: string) => {
      record.state = 'failed';
      /* Only the OS's own "this type is disabled" refusal counts as blocked;
         any other failure says nothing about the person's settings. The
         badge and flashFrame do not depend on toasts and carry on. */
      this.blocked = isNotificationsDisabled(error);
      record.error = String(error);
      this.opts.log?.(`[attention] notification failed: ${record.title}: ${record.error}`);
    });
    notice.on('click', () => {
      record.state = 'clicked';
      this.raise(runId);
    });
    notice.show();
    return { shown: true };
  }

  /** How many approvals are waiting. Badges and flashes only while in the background. */
  setWaiting(count: number): AttentionState {
    const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
    this.state.waiting = n;
    const win = this.live();
    const background = win !== null && !win.isFocused();
    this.apply(background ? n : 0, background && n > 0);
    return this.snapshot;
  }

  /** The window came to the front: the person is looking, so clear both. */
  onFocus(): void {
    this.apply(0, false);
  }

  /** The window went to the background: anything still waiting is badged again. */
  onBlur(): void {
    if (this.state.waiting > 0) this.apply(this.state.waiting, true);
  }

  /** A notification was clicked: bring the window forward and open that chat. */
  raise(runId: string | null): void {
    const win = this.live();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    this.onFocus();
    win.webContents.send(FOCUS_CHAT_CHANNEL, { runId });
  }

  private apply(badge: number, flash: boolean): void {
    if (badge !== this.state.badge) {
      if (this.opts.platform === 'win32') {
        /* app.setBadgeCount does nothing on Windows (getBadgeCount only reads
           back what was stored), so the taskbar badge is an overlay icon. */
        const win = this.live();
        if (win) {
          if (badge > 0 && this.opts.overlayIcon) win.setOverlayIcon(this.opts.overlayIcon(), `${badge} approval${badge === 1 ? '' : 's'} waiting`);
          else win.setOverlayIcon(null, '');
        }
      } else {
        try {
          this.opts.app.setBadgeCount(badge);
        } catch {
          /* A platform without a badge. */
        }
      }
      this.state.badge = badge;
    }
    /* flashFrame is the Windows taskbar's way of saying "needs you" (it is a
       dock bounce on macOS, which the badge already covers). */
    const wantFlash = flash && this.opts.platform === 'win32';
    if (wantFlash !== this.state.flashing) {
      this.live()?.flashFrame(wantFlash);
      this.state.flashing = wantFlash;
    }
  }

  private live(): AttentionWindow | null {
    const win = this.opts.window();
    return win && !win.isDestroyed() ? win : null;
  }
}

/**
 * WPN_E_NOTIFICATION_TYPE_DISABLED (0x803E0114, -2143420140): Windows'
 * settings prevent the notification type from being delivered (toasts off for
 * the system or for this app). Electron passes the HRESULT in its 'failed'
 * error text.
 */
export function isNotificationsDisabled(error: unknown): boolean {
  return /-2143420140|0x803e0114|803e0114/i.test(String(error));
}
