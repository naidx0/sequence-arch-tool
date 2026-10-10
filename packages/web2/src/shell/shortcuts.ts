/* ══════════════════════════════════════════════════════════════════════════
   THE SHORTCUTS, WRITTEN DOWN ONCE
   packages/web2/src/shell/shortcuts.ts

   Every keyboard route in this product was invisible. Cmd/Ctrl-K opens the
   only command surface there is and appears nowhere on screen; Escape closes
   an overlay and now stops a running turn; Enter sends and Shift+Enter does
   not. A reader learns none of that by looking, and `usability-standard.md`
   opens on discoverable.

   ── ONE LIST, BECAUSE TWO WOULD DISAGREE ─────────────────────────────────

   The chord that a hint advertises and the chord a handler listens for have to
   be the same chord. They were separately literal — the handler in `Shell.tsx`,
   the words in nobody — so the first hint written anywhere would have been a
   copy free to drift the moment either changed.

   This is the list. A surface that shows a hint reads it from here, and a test
   asserts every entry names a chord something actually handles.

   ── AND IT IS PLATFORM-CORRECT ───────────────────────────────────────────

   `Cmd` on a Mac and `Ctrl` everywhere else. Showing the wrong one is a hint
   that teaches the reader a keystroke their machine does not have.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * WHO LISTENS FOR IT. The keys help reads this list, and so does every
 * handler: `shell/KeysHost.tsx` matches the `keys` rows with `matchShortcut`,
 * `composer/composerKeys.ts` matches the composer rows by id, and the other
 * owners are named so a test can check the file that listens exists.
 */
export type ShortcutOwner =
  | 'keys' /* shell/KeysHost.tsx */
  | 'palette' /* v3/V3CommandPalette.tsx */
  | 'composer' /* v3/V3Chat.tsx onComposerKeyDown, via composer/composerKeys.ts */
  | 'approval' /* chat/ApprovalGate.tsx gateAnswerFor */
  | 'overlay'; /* v3/V3OverlayHost.tsx and the stop button */

/** Where the help groups it. */
export type ShortcutGroup = 'Chats' | 'Composer' | 'Approvals' | 'App';

export interface Shortcut {
  id: string;
  /** What it does, in the reader's terms. */
  label: string;
  /** The key, without the platform modifier (as `KeyboardEvent.key` names it, or `Esc`). */
  key: string;
  /** How the key is drawn, when not by its name (`↑` for ArrowUp). */
  display?: string;
  /** True when it needs Cmd on a Mac and Ctrl elsewhere. */
  meta?: boolean;
  /** True when it needs the Control key itself, on every platform (Ctrl+Tab). */
  ctrl?: boolean;
  /** True when it needs Shift. */
  shift?: boolean;
  /** When it applies, if not always ("while a turn runs"). */
  when?: string;
  owner?: ShortcutOwner;
  group?: ShortcutGroup;
  /**
   * A page-wide key that ALSO fires from the composer. No key fires while any
   * other text field has focus, and none fires from the composer unless it
   * says so here or is a composer key.
   */
  inComposer?: boolean;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { id: 'palette', label: 'Open the command palette', key: 'K', meta: true, owner: 'palette', group: 'App', inComposer: true },
  { id: 'keys-help', label: 'Show these keys', key: '/', meta: true, owner: 'keys', group: 'App', inComposer: true },
  { id: 'toggle-sidebar', label: 'Show or hide the sidebar', key: 'B', meta: true, owner: 'keys', group: 'App', inComposer: true },
  { id: 'new-chat', label: 'Start a new chat', key: 'N', meta: true, owner: 'keys', group: 'Chats', inComposer: true },
  { id: 'next-chat', label: 'Next chat', key: 'Tab', ctrl: true, owner: 'keys', group: 'Chats', inComposer: true },
  { id: 'prev-chat', label: 'Previous chat', key: 'Tab', ctrl: true, shift: true, owner: 'keys', group: 'Chats', inComposer: true },
  { id: 'send', label: 'Send', key: 'Enter', owner: 'composer', group: 'Composer' },
  { id: 'newline', label: 'New line without sending', key: 'Enter', shift: true, owner: 'composer', group: 'Composer' },
  /* S5 steering: Enter while a Codex turn runs adds the text to that turn;
     an agent that cannot be steered (ACP) queues it instead. */
  { id: 'steer', label: 'Steer the running turn (Codex), or queue it', key: 'Enter', when: 'while a turn runs', owner: 'composer', group: 'Composer' },
  { id: 'queue', label: 'Queue it for after this turn', key: 'Tab', when: 'while a turn runs', owner: 'composer', group: 'Composer' },
  { id: 'recall', label: 'Bring back your last prompt', key: 'ArrowUp', display: '↑', when: 'in an empty composer', owner: 'composer', group: 'Composer' },
  { id: 'access', label: 'Cycle modes: Ask, Auto-edit, Full access, Plan', key: 'Tab', shift: true, owner: 'composer', group: 'Composer' },
  /* Escape does three things in a defined order — close the palette, then an
     overlay, then stop a running turn — and the hint names the one a reader
     is most likely to want rather than listing all three. */
  { id: 'escape', label: 'Close, or stop what is running', key: 'Esc', owner: 'overlay', group: 'App' },
  { id: 'approve', label: 'Allow the waiting approval', key: 'Y', when: 'one approval waiting, or a card focused', owner: 'approval', group: 'Approvals' },
  { id: 'approve-always', label: 'Allow always, for that command prefix', key: 'A', when: 'when offered', owner: 'approval', group: 'Approvals' },
  { id: 'deny', label: 'Deny it', key: 'N', when: 'one approval waiting, or a card focused', owner: 'approval', group: 'Approvals' },
];

/** The fields of a KeyboardEvent a match reads. */
export interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Where the key was pressed. */
export type KeyTarget = 'composer' | 'text' | 'other';

/** Whether this event is this shortcut's chord on this machine. */
export function chordMatches(shortcut: Shortcut, e: KeyEventLike, mac: boolean = isMacLike()): boolean {
  if (e.altKey) return false;
  const want = shortcut.key === 'Esc' ? 'escape' : shortcut.key.toLowerCase();
  if (e.key.toLowerCase() !== want) return false;
  if (!!e.shiftKey !== !!shortcut.shift) return false;
  /* The platform modifier: Cmd on a Mac, Ctrl elsewhere. A literal `ctrl`
     row wants Control on every machine and no Cmd. */
  const wantMeta = shortcut.meta === true && mac;
  const wantCtrl = shortcut.ctrl === true || (shortcut.meta === true && !mac);
  return !!e.metaKey === wantMeta && !!e.ctrlKey === wantCtrl;
}

/** The row with this id. Throws on a typo, so a handler cannot bind to nothing. */
export function shortcutById(id: string): Shortcut {
  const s = SHORTCUTS.find((x) => x.id === id);
  if (!s) throw new Error(`no shortcut ${id}`);
  return s;
}

/**
 * The page-wide shortcut this keystroke is, for one owner, or null.
 *
 * NO KEY FIRES IN A TEXT FIELD unless it is defined for the composer: a
 * settings input, the terminal or a rename box gets every key it is typed.
 * In the composer, only the rows marked `inComposer`.
 */
export function matchShortcut(e: KeyEventLike, target: KeyTarget, owner: ShortcutOwner = 'keys', mac: boolean = isMacLike()): Shortcut | null {
  if (target === 'text') return null;
  for (const s of SHORTCUTS) {
    if (s.owner !== owner) continue;
    if (target === 'composer' && !s.inComposer) continue;
    if (chordMatches(s, e, mac)) return s;
  }
  return null;
}

/** The keys help: every row, grouped, in table order. */
export function shortcutGroups(): { group: ShortcutGroup; rows: Shortcut[] }[] {
  const order: ShortcutGroup[] = ['Chats', 'Composer', 'Approvals', 'App'];
  return order
    .map((group) => ({ group, rows: SHORTCUTS.filter((s) => (s.group ?? 'App') === group) }))
    .filter((g) => g.rows.length > 0);
}

/**
 * Whether this machine wants Cmd rather than Ctrl.
 *
 * Read from the platform string once at call time rather than cached, so a
 * test can answer it either way without a module reset.
 */
export function isMacLike(platform: string = typeof navigator === 'undefined' ? '' : navigator.platform): boolean {
  return /mac|iphone|ipad/i.test(platform);
}

/**
 * How to write a shortcut for this machine.
 *
 * Showing `Ctrl` to a Mac user teaches them a keystroke their machine does not
 * have, and they will conclude the feature does not work.
 */
export function shortcutChord(shortcut: Shortcut, mac: boolean = isMacLike()): string {
  const parts: string[] = [];
  if (shortcut.ctrl) parts.push(mac ? '⌃' : 'Ctrl');
  if (shortcut.meta) parts.push(mac ? '⌘' : 'Ctrl');
  if (shortcut.shift) parts.push(mac ? '⇧' : 'Shift');
  parts.push(shortcut.display ?? shortcut.key);
  /* No separator on a Mac — ⌘K, not ⌘+K — because that is how every Mac app
     writes it, and matching the platform is the whole point of branching. */
  return mac ? parts.join('') : parts.join('+');
}

/** The one-line hint for a surface that has room for exactly one. */
export function paletteHint(mac: boolean = isMacLike()): string {
  const palette = SHORTCUTS.find((s) => s.id === 'palette')!;
  return `${shortcutChord(palette, mac)} for commands`;
}
