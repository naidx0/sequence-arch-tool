import { useEffect, useState } from 'react';

import { SHELL_COMMANDS } from '../shell';
import { shortcutById, shortcutChord } from '../shell/shortcuts';

/* ══════════════════════════════════════════════════════════════════════════
   WHAT THIS PRODUCT CAN DO, AND HOW TO GET AT IT
   packages/web2/src/help/HelpPanel.tsx

   The onboarding row in the register was marked done and then corrected to
   "OVERSTATED — not built": the whole of it was ONE `Ctrl-K` hint in the app
   bar. A person who never guesses that chord cannot reach the session list, the
   activity view, review, rewind, search or settings at all — every one of them
   lives behind the palette and the palette lives behind the chord.

   ── IT IS GENERATED FROM `SHELL_COMMANDS`, AND THAT IS THE DESIGN ────────

   A hand-written list of features is a second claim about what the product does,
   and it goes stale the first week. This renders the SAME array the palette
   renders, so a command that does not exist cannot appear here, a command that
   is added appears without anybody remembering to, and the order matches the
   order a reader will meet in the palette — which `SHELL_COMMANDS` argues for
   at length and which would be lost by re-sorting.

   ── AND IT DOES NOT INVENT KEYS ─────────────────────────────────────────

   The register's own measurement: `Shell.tsx` binds exactly TWO chords, and no
   `SHELL_COMMANDS` entry has one of its own — so a keycap column would render
   empty on every row, "a surface with nothing to show, which is the defect this
   register exists to remove". The two real ones are named, once, at the top,
   and the page says plainly that everything else is reached by name. Giving the
   commands chords is a design decision about which keys and what they collide
   with; it is not this page's to make up.
   ══════════════════════════════════════════════════════════════════════════ */

export const HELP = {
  root: 'help',
  chords: 'help-chords',
  chord: 'help-chord',
  commands: 'help-commands',
  command: 'help-command',
  /** The honest note about what has no key. */
  nokeys: 'help-nokeys',
  surfaces: 'help-surfaces',
} as const;

/**
 * The three keys worth knowing before anything else, read from the one shortcut
 * list the handlers and the Keys dialog also read (shell/shortcuts.ts), so a
 * chord shown here can never drift from the one that is bound. The full list is
 * the Keys dialog; this page only points at it.
 */
const HEADLINE: readonly { id: string; does: string }[] = [
  { id: 'palette', does: 'Open the command palette. Everything below is in it' },
  { id: 'keys-help', does: 'Show every keyboard shortcut' },
  { id: 'escape', does: 'Close what is open, or stop a running turn' },
];

const CHORDS = HEADLINE.map(({ id, does }) => ({ keys: shortcutChord(shortcutById(id)), does }));

/**
 * What each part of the window is for, in plain words (a first-time reader has
 * not met "scan layers" or "jails").
 *
 * Decision 5 / P2.5: Sessions sidebar LEFT, Chat CENTRE, board pane RIGHT
 * (Architecture or Whiteboard). The files-and-functions list lives inside the
 * board pane, not a fourth column.
 */
const SURFACES: readonly { name: string; does: string }[] = [
  {
    name: 'Chats, on the left',
    does:
      'Your conversations. Each project keeps its own, and you can chat without opening a project.',
  },
  {
    name: 'Chat, in the middle',
    does:
      'Ask about your project. Every answer says what it could NOT see, which most coding ' +
      'assistants cannot tell you.',
  },
  {
    name: 'Files, Architecture, Spaces and Terminal, on the right',
    does:
      'The tabs along the top open a view beside the chat, or two side by side. Files is your ' +
      "project's folders and files, and Terminal is a command line in the project folder. " +
      'Architecture is a map of how the project fits together, read from the code, with the file ' +
      'and line behind each part. Anything proposed or drawn by hand looks different, because it ' +
      'was not read from the code. Spaces is your own whiteboard, and nothing on it claims to be ' +
      'true of your code. The list of files and functions sits inside this view: click a ' +
      'function to see the flow it belongs to.',
  },
];

/**
 * ON A PHONE THERE IS NO KEYBOARD AND NO THREE COLUMNS. A narrow window or a
 * touch screen gets what is actually there: two tabs, a chat list button, sheets
 * that swipe away, and tap and hold. The same media query the sheet's grabber
 * uses (v3.css), so this page and the sheet agree on what "narrow" is.
 */
const NARROW_QUERY = '(max-width: 720px), (pointer: coarse)';

function useNarrow(): boolean {
  const read = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(NARROW_QUERY).matches
      : false;
  const [narrow, setNarrow] = useState(read);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(media.matches);
    onChange();
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);
  return narrow;
}

const SURFACES_NARROW: readonly { name: string; does: string }[] = [
  {
    name: 'Chat and Workspace',
    does:
      'The two tabs at the top switch between your conversation and the views for your project: ' +
      'Files, Architecture, Spaces and Terminal.',
  },
  {
    name: 'Your chats',
    does:
      'The button at the top left opens your list of chats. Each project keeps its own, and you ' +
      'can chat without opening a project.',
  },
  {
    name: 'Asking',
    does:
      'Ask about your project. Every answer says what it could NOT see, which most coding ' +
      'assistants cannot tell you.',
  },
  {
    name: 'The views',
    does:
      "Files is your project's folders and files, and Terminal is a command line in the project " +
      'folder. Architecture is a map of how the project fits together, read from the code, with ' +
      'the file and line behind each part. Anything proposed or drawn by hand looks different, ' +
      'because it was not read from the code. Spaces is your own whiteboard, and nothing on it ' +
      'claims to be true of your code.',
  },
  {
    name: 'Sheets',
    does:
      'Settings, Search and this page open as sheets. Swipe a sheet down, or tap the cross, to ' +
      'close it.',
  },
  {
    name: 'More actions',
    does: 'Tap and hold a file, or a part of the map, to see what else you can do with it.',
  },
];

export function HelpPanel() {
  const narrow = useNarrow();
  const surfaces = narrow ? SURFACES_NARROW : SURFACES;
  return (
    <section
      className="hp-scope hp-panel"
      data-testid={HELP.root}
      data-layout={narrow ? 'narrow' : 'wide'}
      role="dialog"
      aria-label="Help"
    >
      <header className="hp-head">
        <h2 className="hp-title">What you can do here</h2>
      </header>

      <div className="hp-body">
        {narrow ? null : (
          <section className="hp-section">
            <h3 className="hp-h">Keys</h3>
            <ul className="hp-chords" data-testid={HELP.chords}>
              {CHORDS.map((chord) => (
                <li key={chord.keys} className="hp-chordrow" data-testid={HELP.chord}>
                  <kbd className="hp-kbd mono">{chord.keys}</kbd>
                  <span className="hp-does">{chord.does}</span>
                </li>
              ))}
            </ul>
            {/* THE HONEST PART. Advertising a keycap column that renders empty on
                every row would be worse than saying this. */}
            <p className="hp-note" data-testid={HELP.nokeys}>
              Everything else is reached by name in the palette. Start typing and it filters.
            </p>
          </section>
        )}

        <section className="hp-section">
          <h3 className="hp-h">{narrow ? 'Getting around' : 'The window'}</h3>
          <ul className="hp-list" data-testid={HELP.surfaces}>
            {surfaces.map((surface) => (
              <li key={surface.name} className="hp-item">
                <span className="hp-name">{surface.name}</span>
                <span className="hp-does">{surface.does}</span>
              </li>
            ))}
          </ul>
        </section>

        {narrow ? null : (
          <section className="hp-section">
            <h3 className="hp-h">Everything in the palette</h3>
            {/* GENERATED FROM THE SAME ARRAY THE PALETTE RENDERS, in the same
                order. A command that does not exist cannot appear here. */}
            <ul className="hp-list" data-testid={HELP.commands}>
              {SHELL_COMMANDS.map((command) => (
                <li key={command.id} className="hp-item" data-testid={HELP.command} data-id={command.id}>
                  <span className="hp-name">{command.label}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </section>
  );
}
