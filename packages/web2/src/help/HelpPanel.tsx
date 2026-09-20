import { SHELL_COMMANDS } from '../shell';

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
 * The chords the shell actually binds.
 *
 * TWO, and both are measured rather than aspirational — `shortcuts.test.ts`
 * pins them and `helpTruthful.test.tsx` asserts this list matches what
 * `Shell.tsx` binds, so a third can never be advertised here before it exists.
 */
const CHORDS: readonly { keys: string; does: string }[] = [
  { keys: 'Ctrl / Cmd + K', does: 'Open the command palette — every surface below is in it' },
  { keys: 'Esc', does: 'Close what is open, or stop a running turn' },
];

/**
 * What each part of the window is for.
 *
 * Decision 5 / P2.5: Sessions sidebar LEFT, Chat CENTRE, board pane RIGHT
 * (Architecture or Whiteboard). The index rail lives inside the board pane —
 * not a fourth column.
 */
const SURFACES: readonly { name: string; does: string }[] = [
  {
    name: 'Sessions, on the left',
    does:
      'Threads for this machine and, when a repository is attached, for that repository. ' +
      'Blank-workspace sessions survive without an attached repo.',
  },
  {
    name: 'Chat, in the centre',
    does:
      'Ask about the repository. Every answer says what it could NOT see, which is the one thing ' +
      'a coding assistant normally cannot tell you. The default workspace opens here alone.',
  },
  {
    name: 'Architecture or Whiteboard, on the right',
    does:
      'Two boards, one at a time, opened from the workspace tabs. Architecture starts with a ' +
      'scanned layer derived from a parser, with file-and-line evidence. Proposed and drawn parts ' +
      'are not scan evidence, which is why they look different. The whiteboard is yours, and ' +
      'nothing on it is a claim about your code. Files & functions sit in the index rail inside ' +
      'this pane — click a function and the board plays the flow it belongs to.',
  },
];

export function HelpPanel() {
  return (
    <section className="hp-scope hp-panel" data-testid={HELP.root} role="dialog" aria-label="Help">
      <header className="hp-head">
        <h2 className="hp-title">What you can do here</h2>
      </header>

      <div className="hp-body">
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
            Those are the only two. Everything else is reached by name in the palette — start
            typing and it filters.
          </p>
        </section>

        <section className="hp-section">
          <h3 className="hp-h">The window</h3>
          <ul className="hp-list" data-testid={HELP.surfaces}>
            {SURFACES.map((surface) => (
              <li key={surface.name} className="hp-item">
                <span className="hp-name">{surface.name}</span>
                <span className="hp-does">{surface.does}</span>
              </li>
            ))}
          </ul>
        </section>

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
      </div>
    </section>
  );
}
