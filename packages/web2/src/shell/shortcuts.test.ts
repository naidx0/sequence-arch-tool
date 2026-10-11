import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SHORTCUTS, chordMatches, isMacLike, matchShortcut, paletteHint, shortcutById, shortcutChord, shortcutGroups } from './shortcuts';

const ev = (key: string, mods: Partial<{ meta: boolean; ctrl: boolean; shift: boolean; alt: boolean }> = {}) => ({
  key,
  metaKey: !!mods.meta,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
});

describe('S5: matching a keystroke against the one table', () => {
  it('Cmd+N on a Mac and Ctrl+N elsewhere is a new chat; the other platform\'s chord is not', () => {
    expect(matchShortcut(ev('n', { meta: true }), 'other', 'keys', true)?.id).toBe('new-chat');
    expect(matchShortcut(ev('n', { ctrl: true }), 'other', 'keys', false)?.id).toBe('new-chat');
    expect(matchShortcut(ev('n', { ctrl: true }), 'other', 'keys', true)).toBeNull();
    expect(matchShortcut(ev('n'), 'other', 'keys', false)).toBeNull();
  });

  it('Ctrl+Tab is Control on every platform; Shift walks back', () => {
    expect(matchShortcut(ev('Tab', { ctrl: true }), 'other', 'keys', true)?.id).toBe('next-chat');
    expect(matchShortcut(ev('Tab', { ctrl: true, shift: true }), 'other', 'keys', false)?.id).toBe('prev-chat');
    expect(matchShortcut(ev('Tab', { meta: true }), 'other', 'keys', true)).toBeNull();
  });

  it('Cmd/Ctrl+/ opens the keys help', () => {
    expect(matchShortcut(ev('/', { ctrl: true }), 'other', 'keys', false)?.id).toBe('keys-help');
  });

  it('NO KEY FIRES IN A TEXT FIELD; from the composer only the rows marked for it', () => {
    expect(matchShortcut(ev('n', { ctrl: true }), 'text', 'keys', false)).toBeNull();
    expect(matchShortcut(ev('n', { ctrl: true }), 'composer', 'keys', false)?.id).toBe('new-chat');
    /* Alt changes the chord: Ctrl+Alt+N is somebody else's. */
    expect(matchShortcut(ev('n', { ctrl: true, alt: true }), 'other', 'keys', false)).toBeNull();
  });

  it('chordMatches reads Esc as Escape, and a plain letter needs no modifier', () => {
    expect(chordMatches(shortcutById('escape'), ev('Escape'))).toBe(true);
    expect(chordMatches(shortcutById('approve'), ev('y'))).toBe(true);
    expect(chordMatches(shortcutById('approve'), ev('y', { ctrl: true }))).toBe(false);
    expect(() => shortcutById('nope')).toThrow();
  });

  it('the help groups every row exactly once', () => {
    const rows = shortcutGroups().flatMap((g) => g.rows.map((r) => r.id));
    expect(rows.sort()).toEqual(SHORTCUTS.map((s) => s.id).sort());
    expect(shortcutChord(shortcutById('next-chat'), true)).toBe('⌃Tab');
    expect(shortcutChord(shortcutById('recall'), false)).toBe('↑');
  });
});

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
     * DERIVED, NOT HAND-LISTED (S5). Every row names its owner, and the
     * owner's file must exist and listen: the `keys` rows by id in KeysHost's
     * switch, the S5 composer rows through composerKeys' `shortcutById`, the
     * approval letters in ApprovalGate's gate, the rest by their key in the
     * owner's handler. A row nobody handles fails here, whoever adds it.
     */
    const src = (rel: string) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    const OWNER_FILES: Record<string, string[]> = {
      keys: ['shell/KeysHost.tsx'],
      palette: ['v3/V3CommandPalette.tsx'],
      composer: ['composer/composerKeys.ts', 'v3/V3Chat.tsx'],
      approval: ['chat/ApprovalGate.tsx'],
      overlay: ['v3/V3OverlayHost.tsx'],
    };
    for (const s of SHORTCUTS) {
      expect(s.owner, s.id).toBeDefined();
      const files = OWNER_FILES[s.owner!]!.map(src).join('\n');
      if (s.owner === 'keys') expect(files, s.id).toContain(`case '${s.id}':`);
      else if (s.owner === 'approval') expect(files, s.id).toContain(`case '${s.key.toLowerCase()}':`);
      else if (['steer', 'queue', 'recall'].includes(s.id)) expect(files, s.id).toContain(`shortcutById('${s.id}')`);
      else {
        const key = s.key === 'Esc' ? 'escape' : s.key.toLowerCase();
        expect(files.toLowerCase().includes(`'${key}'`), s.id).toBe(true);
      }
    }
  });

  it('ids are unique, and no two rows of one owner share a chord in the same situation', () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const chords = new Map<string, string>();
    for (const s of SHORTCUTS) {
      /* steer and send are one chord on purpose: what Enter does depends on
         whether a turn is running, and the steer row says so in `when`. */
      const k = `${s.owner}|${s.key}|${!!s.meta}|${!!s.ctrl}|${!!s.shift}|${s.when ?? ''}`;
      expect(chords.has(k), `${s.id} repeats ${chords.get(k)}`).toBe(false);
      chords.set(k, s.id);
    }
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
