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

export interface Shortcut {
  id: string;
  /** What it does, in the reader's terms. */
  label: string;
  /** The key, without the platform modifier. */
  key: string;
  /** True when it needs Cmd on a Mac and Ctrl elsewhere. */
  meta?: boolean;
  /** True when it needs Shift. */
  shift?: boolean;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { id: 'palette', label: 'Open the command palette', key: 'K', meta: true },
  { id: 'send', label: 'Send', key: 'Enter' },
  { id: 'newline', label: 'New line without sending', key: 'Enter', shift: true },
  /* Escape does three things in a defined order — close the palette, then an
     overlay, then stop a running turn — and the hint names the one a reader
     is most likely to want rather than listing all three. */
  { id: 'escape', label: 'Close, or stop what is running', key: 'Esc' },
];

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
  if (shortcut.meta) parts.push(mac ? '⌘' : 'Ctrl');
  if (shortcut.shift) parts.push(mac ? '⇧' : 'Shift');
  parts.push(shortcut.key);
  /* No separator on a Mac — ⌘K, not ⌘+K — because that is how every Mac app
     writes it, and matching the platform is the whole point of branching. */
  return mac ? parts.join('') : parts.join('+');
}

/** The one-line hint for a surface that has room for exactly one. */
export function paletteHint(mac: boolean = isMacLike()): string {
  const palette = SHORTCUTS.find((s) => s.id === 'palette')!;
  return `${shortcutChord(palette, mac)} for commands`;
}
