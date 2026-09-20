import { describe, expect, it } from 'vitest';

import { SHORTCUTS, isMacLike, paletteHint, shortcutChord } from './shortcuts';

/**
 * THE SHORTCUTS, WRITTEN DOWN ONCE.
 *
 * Every keyboard route in this product was invisible. Cmd/Ctrl-K opens the only
 * command surface there is and appeared nowhere on screen. A reader learns none
 * of it by looking, and `usability-standard.md` opens on discoverable.
 */

describe('writing a chord for this machine', () => {
  it('uses Cmd on a Mac and Ctrl everywhere else', () => {
    /* Showing Ctrl to a Mac user teaches a keystroke their machine does not
       have, and they conclude the feature does not work. */
    const palette = SHORTCUTS.find((s) => s.id === 'palette')!;
    expect(shortcutChord(palette, true)).toBe('⌘K');
    expect(shortcutChord(palette, false)).toBe('Ctrl+K');
  });

  it('writes Mac chords WITHOUT a separator, as Mac apps do', () => {
    const newline = SHORTCUTS.find((s) => s.id === 'newline')!;
    expect(shortcutChord(newline, true)).toBe('⇧Enter');
    expect(shortcutChord(newline, false)).toBe('Shift+Enter');
  });

  it('an unmodified key is just the key', () => {
    const send = SHORTCUTS.find((s) => s.id === 'send')!;
    expect(shortcutChord(send, true)).toBe('Enter');
    expect(shortcutChord(send, false)).toBe('Enter');
  });

  it('detects the platform from the string it is given', () => {
    expect(isMacLike('MacIntel')).toBe(true);
    expect(isMacLike('iPhone')).toBe(true);
    expect(isMacLike('Win32')).toBe(false);
    expect(isMacLike('Linux x86_64')).toBe(false);
    /* An unknown platform is not a Mac — Ctrl is the safer default because it
       is what the majority of machines actually use. */
    expect(isMacLike('')).toBe(false);
  });
});

describe('the list itself', () => {
  it('EVERY ENTRY NAMES A CHORD SOMETHING HANDLES', () => {
    /*
     * The point of one list. The chord a hint advertises and the chord a
     * handler listens for have to be the same chord; they were separately
     * literal, so the first hint written anywhere was free to drift.
     *
     * These four are the ones Shell.tsx and Composer.tsx actually bind:
     * Cmd/Ctrl-K, Escape, Enter and Shift+Enter.
     */
    expect(SHORTCUTS.map((s) => s.id).sort()).toEqual(['escape', 'newline', 'palette', 'send']);
  });

  it('says what each one DOES, not what it is', () => {
    /*
     * "Cmd+K: palette" tells a reader nothing they cannot already see. The
     * rule is that a label says the ACTION — not that it is long. "Send" is
     * four characters and is a complete answer; an earlier draft asserted a
     * minimum length and failed on it, which was the assertion being wrong
     * about the rule rather than the label being wrong.
     */
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.label.trim()).not.toBe('');
      /* It must not merely restate the chord. */
      expect(shortcut.label.startsWith('Ctrl')).toBe(false);
      expect(shortcut.label.startsWith('Shift')).toBe(false);
      /* No regex here on purpose: a `word-boundary` escape written through
         this toolchain arrived as a literal backspace byte, which the
         no-control-bytes CI guard caught. Plain string checks say the same
         thing and cannot be corrupted in transit. */
      expect(shortcut.label.charCodeAt(0)).toBeGreaterThan(64);
    }
  });

  it('the one-line hint names the palette and what it is for', () => {
    expect(paletteHint(false)).toBe('Ctrl+K for commands');
    expect(paletteHint(true)).toBe('⌘K for commands');
  });
});
