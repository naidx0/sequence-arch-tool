import { useEffect, useId, useRef, useState } from 'react';

import { filterCommands, type ShellCommand } from './shellModel';

/**
 * THE Cmd/Ctrl-K SURFACE.
 *
 * §6 of the v2 plan specifies item 2.3 as shipping "`Cmd/Ctrl-K` → composer",
 * and the item as handed over asks for "the Cmd/Ctrl-K command surface as a
 * shell-level affordance". Both are satisfied by one thing: a list whose FIRST
 * row is "Focus the composer", so Cmd-K then Enter is the composer and the
 * rows beneath it are everything else the frame can do. The difference between
 * the two readings is one keystroke, and it buys a discoverable home for the
 * pane toggles and the overlays, which otherwise have none.
 *
 * IT LISTS THE SHELL'S OWN COMMANDS AND NOBODY ELSE'S. A chat command, a canvas
 * command and a review command each belong to the lane that owns that surface;
 * routing them through here would mean every one of those lanes editing this
 * file. Commands the shell cannot execute are declared `owner: 'host'` and are
 * rendered DISABLED WITH THE REASON rather than hidden — a row that disappears
 * teaches nothing, and "no composer is mounted" is the useful half of the
 * answer.
 *
 * UNSHEETED, and drawn from the substrate's menu rather than invented: sheet 09
 * renders `.menu` at --menu-w with 30px `.menuitem` rows, and sheet 01 is
 * explicit that 320px belongs to --menu-w and never to --pane-w-min.
 */

export interface CommandSurfaceProps {
  commands: readonly ShellCommand[];
  /** Why a command cannot run right now, or null if it can. */
  unavailableReason: (command: ShellCommand) => string | null;
  onRun: (command: ShellCommand) => void;
  onClose: () => void;
}

export function CommandSurface({
  commands,
  unavailableReason,
  onRun,
  onClose,
}: CommandSurfaceProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const matches = filterCommands(query, commands);
  // Clamped rather than reset: a filter that empties the list must not leave
  // aria-activedescendant pointing at a row that is no longer rendered.
  const index = matches.length === 0 ? -1 : Math.min(active, matches.length - 1);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const run = (command: ShellCommand) => {
    if (unavailableReason(command)) return;
    onRun(command);
  };

  return (
    <div
      className="shell-scrim"
      // Closing on the SCRIM, not on the panel: mousedown inside the panel and
      // mouseup outside it is a text selection, and treating that as a
      // dismissal throws away what the user was typing.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="shell-cmd"
        data-testid="command-surface"
        role="dialog"
        aria-modal="true"
        aria-label="Commands"
        onKeyDown={(event) => {
          // The panel holds exactly one focusable element, so the whole focus
          // trap is "Tab stays here". Anything more elaborate would be
          // machinery guarding a list of one.
          if (event.key === 'Tab') event.preventDefault();
        }}
      >
        <input
          ref={inputRef}
          className="shell-cmd-input"
          data-testid="command-field"
          role="combobox"
          type="text"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={index >= 0 ? `${listId}-${index}` : undefined}
          aria-label="Run a command"
          placeholder="Run a command"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((current) => Math.min(current + 1, matches.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((current) => Math.max(current - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              if (index >= 0) run(matches[index]);
            }
          }}
        />

        <ul className="shell-cmd-list" id={listId} role="listbox" aria-label="Commands">
          {matches.map((command, position) => {
            const reason = unavailableReason(command);
            return (
              <li
                key={command.id}
                id={`${listId}-${position}`}
                className="shell-cmd-item"
                data-testid="command-row"
                /* IDENTITY is the testid, STATE is a named data-* attribute.
                   The id rather than the label, because a label is prose and
                   prose is what gets edited; `overlay.review` is the promise. */
                data-command={command.id}
                role="option"
                aria-selected={position === index}
                aria-disabled={reason ? 'true' : undefined}
                onMouseEnter={() => setActive(position)}
                onClick={() => run(command)}
              >
                <span>{command.label}</span>
                {reason ? (
                  <span className="shell-cmd-why" data-testid="command-why">
                    {reason}
                  </span>
                ) : null}
              </li>
            );
          })}
          {matches.length === 0 ? (
            /* Deliberately NOT role="option". An empty state is not a choice,
               and giving it the option role makes "no matches" the thing Enter
               runs and the thing getAllByRole('option') counts. */
            <li className="shell-cmd-empty" data-testid="command-empty">
              No command matches that.
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
