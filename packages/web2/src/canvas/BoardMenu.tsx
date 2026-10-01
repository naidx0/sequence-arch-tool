/* ══════════════════════════════════════════════════════════════════════════
   THE NODE CONTEXT MENU — rename and delete, from the user's seat
   packages/web2/src/canvas/BoardMenu.tsx

   docs/brand/graphite/pages/10-spacing-and-the-control-ladder.html — `.menuitem`
   is a 30px rung control (`--row-h`), inset `--sp-8`, gap `--sp-8`, and the
   sheet's own specimen row for that rung is literally "Rename node".

   IT IS A MENU, NOT A FIFTH ZOOM CONTROL. Sheet 05.6 fixes the control cluster
   at FOUR — "zoom out · the readout · zoom in · Fit" — and says in as many
   words that there is no fifth. Editing therefore hangs off the node, which is
   also where the reader is already pointing when they want to rename it.

   ── WHY NO ⌘R HINT, THOUGH THE SHEET'S SPECIMEN SHOWS ONE ────────────────

   That row appears in the sheet as a SPECIMEN of the 30px rung — it is
   demonstrating a height, beside "Architecture" and an account row, not
   legislating a keybinding. Reading it as a mandate would have this component
   hijack ⌘R, which in a browser is reload. A hint for a shortcut that does not
   fire, or fires and navigates away, is the same defect this package has twice
   paid for: a string asserting a behaviour that is not wired. So the item is
   worded and unhinted, and the day the desktop shell owns the accelerator the
   hint goes in beside it.

   THE MENU STYLES ARE THE ONES CHAT ALREADY USES, re-scoped and not redesigned.
   `_core.html:1216-1228` fixes a menu at `--e3`/`--r-10` and says it differs
   from a tooltip, a popover and a dialog by ELEVATION and RADIUS, never by
   colour. A second menu look on the board would be a second answer to a
   question the substrate already answered.

   DELETE IS LAST AND IT IS NOT RED. A destructive item painted at `--danger`
   in a two-item menu makes the menu about the destruction; the node is not a
   file and this is undoable (⌘Z, `docSession`'s bounded stack). Graphite law:
   never more hues than claims.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';

export interface BoardMenuTarget {
  nodeId: string;
  label: string;
  /** True when nobody proved this node — see `generateGate.isGeneratable`. */
  generatable?: boolean;
  /** True when the scan found something inside this service. */
  openable?: boolean;
  /** Where the pointer was, in the board's own client coordinates. */
  x: number;
  y: number;
}

export interface BoardMenuProps {
  target: BoardMenuTarget;
  onRename: (nodeId: string, label: string) => void;
  onDelete: (nodeId: string) => void;
  /**
   * Generate, CONFIRMED. The owner's constraint: "Drawing a box must NOT fire a
   * code proposal. Generate is an explicit act with a confirmation step." The
   * menu therefore never calls this from the first click — the item opens the
   * confirm arm, and this fires only from the choice inside it.
   */
  onGenerate?: (nodeId: string, intent: 'describe' | 'scaffold', note: string) => void;
  /** Open the service — REPLACES the view rather than nesting inside it. */
  onOpen?: (nodeId: string) => void;
  /**
   * ANATOMY — A THIRD GESTURE, AND IT LEAVES OPEN EXACTLY AS IT IS.
   *
   * `onOpen` above is navigation: it replaces the view, one level at a time,
   * which is the board's standing ruling and is not being reopened here. This
   * draws the node's children as a packed treemap INSIDE that node's own
   * footprint — no board node, no board edge, no second structural level, no
   * crumb trail. See `anatomy.ts` for the reasoning and §33 of
   * docs/COMPETITIVE-GAPS-2026-08-22.md for the trail that was reverted.
   *
   * IT SITS BELOW OPEN because it is the smaller act. It is offered on every
   * node and never disabled: `anatomyIsEmpty` is "no children AT ALL", and a
   * node with none says what it is instead of drawing an empty room — which is
   * a different answer from Open's, because Open would land the reader in one.
   */
  onAnatomy?: (nodeId: string) => void;
  /** The wall is already open on this node, so the item closes it. */
  anatomyOpen?: boolean;
  onClose: () => void;
}

export function BoardMenu({
  target,
  onRename,
  onDelete,
  onGenerate,
  onOpen,
  onAnatomy,
  anatomyOpen = false,
  onClose,
}: BoardMenuProps) {
  const [renaming, setRenaming] = useState(false);
  /* THE CONFIRMATION STEP. `null` is the menu; anything else is the arm that
     asks what to generate — which is what makes Generate two deliberate acts
     rather than one click that starts a run. */
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState(target.label);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  /* The menu opens on the node the reader right-clicked, so a menu still open
     over a different node after the target changes would rename the wrong one. */
  useEffect(() => {
    setRenaming(false);
    setConfirming(false);
    setNote('');
    setDraft(target.label);
  }, [target.nodeId, target.label]);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  /* Escape closes and a click anywhere else closes. A menu that can only be
     dismissed by choosing something is a modal wearing a menu's clothes. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    function onPointer(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [onClose]);

  function commit() {
    const next = draft.trim();
    /* An unchanged or empty name closes without dispatching. `docEdit` would
       decline both anyway; not sending them keeps a no-op out of the undo
       stack, where it would cost the reader a press to get past. */
    if (next && next !== target.label) onRename(target.nodeId, next);
    onClose();
  }

  return (
    <div
      ref={rootRef}
      className="board-scope boardmenu"
      data-testid="board-menu"
      role="menu"
      aria-label={`Edit ${target.label}`}
      style={{ left: target.x, top: target.y }}
    >
      {renaming ? (
        <input
          ref={inputRef}
          className="boardmenu-input"
          data-testid="board-menu-rename-input"
          aria-label={`Rename ${target.label}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') onClose();
          }}
          onBlur={commit}
        />
      ) : confirming ? (
        /*
         * THE CONFIRM ARM. Step 3-4 of the owner's editing model: the AI "may
         * pop a tool asking questions about it, or ask for a description of
         * what you want built in it", and step 4 lets a strong architect
         * scaffold it themselves. So the choice between a NOTE and FILES is the
         * user's, made here, rather than a mode they discover from the answer.
         */
        <div className="genconfirm" data-testid="board-menu-generate-confirm">
          <input
            className="boardmenu-input"
            data-testid="board-menu-generate-note"
            aria-label={`What is ${target.label} for?`}
            placeholder={`What is ${target.label} for? (optional)`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button
            type="button"
            className="menuitem"
            data-testid="board-menu-generate-describe"
            onClick={() => {
              onGenerate?.(target.nodeId, 'describe', note);
              onClose();
            }}
          >
            Describe what belongs here
          </button>
          <button
            type="button"
            className="menuitem"
            data-testid="board-menu-generate-scaffold"
            onClick={() => {
              onGenerate?.(target.nodeId, 'scaffold', note);
              onClose();
            }}
          >
            Propose files for it
          </button>
        </div>
      ) : (
        <>
          {/*
            * OPEN IS ALWAYS OFFERED, AND SOMETIMES DISABLED.
            *
            * Owner walk 2026-08-22 (A4): "Open scope doesn't open up." It was
            * omitted whenever the scan recorded nothing inside — which reads,
            * from the reader's seat, identically to the feature not existing.
            * Right-click two services, see Open on neither, conclude there is
            * no such thing.
            *
            * "A control that opens an empty room is worse than no control"
            * still holds and is still enforced: the disabled item opens
            * nothing. What it does instead is say WHY, which is the rule
            * `CommandSurface` already applies to commands the shell cannot
            * run — "a row that disappears teaches nothing".
            *
            * The reason names the SCAN, because the scan is what decided it.
            * Neither the service nor the board is broken.
            */}
          {onOpen ? (
            <button
              type="button"
              role="menuitem"
              className="menuitem"
              data-testid="board-menu-open"
              disabled={!target.openable}
              aria-disabled={target.openable ? undefined : 'true'}
              title={
                target.openable
                  ? undefined
                  : 'The scan recorded nothing inside this service, so there is nothing to open.'
              }
              onClick={() => {
                if (!target.openable) return;
                onOpen(target.nodeId);
                onClose();
              }}
            >
              Open
            </button>
          ) : null}
          {onAnatomy ? (
            <button
              type="button"
              role="menuitem"
              className="menuitem"
              data-testid="board-menu-anatomy"
              aria-pressed={anatomyOpen}
              onClick={() => {
                onAnatomy(target.nodeId);
                onClose();
              }}
            >
              {anatomyOpen ? 'Hide anatomy' : 'Anatomy'}
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="menuitem"
            data-testid="board-menu-rename"
            onClick={() => setRenaming(true)}
          >
            Rename node
          </button>
          <button
            type="button"
            role="menuitem"
            className="menuitem"
            data-testid="board-menu-delete"
            onClick={() => {
              onDelete(target.nodeId);
              onClose();
            }}
          >
            Delete node
          </button>
          {/* OFFERED ONLY ON A NODE NOBODY PROVED. A scanned node already has
              an implementation; generating one would invite a second answer to
              a question the repository has settled. */}
          {target.generatable && onGenerate ? (
            <button
              type="button"
              role="menuitem"
              className="menuitem"
              data-testid="board-menu-generate"
              onClick={() => setConfirming(true)}
            >
              Generate…
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
