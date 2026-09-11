import { useEffect, useRef, useState } from 'react';

import type { PermissionControl as PermissionControlState, PermissionMode } from '../state/types';
import { Icon } from './Icon';
import type { IconName } from './Icon';

/* ══════════════════════════════════════════════════════════════════════════
   ITEM 2.8 — THE PERMISSION CONTROL, UNDER THE COMPOSER
   packages/web2/src/chat/PermissionControl.tsx

   UNSHEETED, AND SAID SO RATHER THAN INVENTED QUIETLY. `permission` appears
   ZERO times across all twelve sheets of docs/brand/graphite/ and its
   _core.html; §5.6 of the plan lists this control among the eleven surfaces the
   book does not cover, and warns that "the dangerous state is thinking the book
   covers them".

   So this file is assembled from two sources, each named:

     THE FORM is Codex's, stolen verbatim per §5.2 item 1 — "one always-visible
     dropdown, three modes, non-defaults opt-in from Settings". The plan calls
     it "the solved interaction for the autonomy question", and the reason it is
     solved is that the mode is legible WITHOUT opening anything: the question
     "what is this thing allowed to do to my repo right now" is answered by
     looking, at all times, in the place you are about to type.

     THE GEOMETRY is Graphite's — sheet 12.4's under-composer strip: 20px,
     --r-8, --t-10, outside the composer's border, "because it describes the
     kind of session you are in and is true whether or not you type anything".
     That sentence is exactly true of the permission mode.

   PHASE 1 WAS THE CONTROL. P3 wires Auto-edit / Full: they stay refused in
   the menu until Settings → Workspace turns them on. Once enabled, Auto-edit
   writes proposed files without Accept; Full also allows run_command under
   `.sequence/permissions.json`. Seat walk: refused rows say "Turn this on in
   Settings → Workspace."

   HUE BUDGET: ZERO. Autonomy is a setting, not a verdict, and Graphite law 1
   reserves colour for claims about the world.
   ══════════════════════════════════════════════════════════════════════════ */

export interface PermissionModeSpec {
  mode: PermissionMode;
  label: string;
  /** What it means, in the user's terms. Rendered in the menu, under the name. */
  description: string;
  icon: IconName;
}

/**
 * The three modes, weakest first, so the list reads as a ladder of trust and
 * the top row is the one that is always safe.
 *
 * Every description says what happens to FILES, because that is the only
 * consequence the user is being asked to consent to. A mode described in terms
 * of what the agent "may do" is a mode nobody can evaluate.
 */
export const PERMISSION_MODES: readonly PermissionModeSpec[] = [
  {
    mode: 'plan',
    label: 'Plan',
    description: 'Reads only. Ends in a written plan.',
    icon: 'file',
  },
  {
    mode: 'propose',
    label: 'Propose',
    description: 'Changes arrive as proposals you accept.',
    icon: 'file',
  },
  {
    mode: 'autoEdit',
    label: 'Auto-edit',
    description: 'Writes files without asking.',
    icon: 'pen',
  },
  {
    mode: 'full',
    label: 'Full access',
    description: 'Writes files and runs commands without asking.',
    icon: 'sensitive',
  },
];

/** Shown under refused Auto-edit / Full — point at Settings, which now exists. */
export const PERMISSION_UNAVAILABLE =
  'Turn this on in Settings → Workspace.';

/**
 * TEACH IS A ROW IN THIS MENU, NOT A SECOND CONTROL. Owner, 2026-09-02: "The
 * teach mode should be part of the same thing as a proposed plan. Auto-edit,
 * full access should just be another mode. Teaching and teach are a little
 * bit confusing modes, and we tell the user too much about which is which."
 * It had been its own chip beside this one, wording itself Teach / Teaching
 * with a two-sentence title each way — two controls answering one question
 * ("what will this turn do?"). Now the answer is one word in one place.
 *
 * On the wire it stays the `teach` flag (docs/teach-mode.md), never a
 * PermissionMode: the server reads `permission` and `teach` separately and
 * teach refuses every mutating tool on its own, so no permission value has
 * to change for it. The row is rendered only when the host wires `onTeach`.
 */
export const TEACH_ROW: Omit<PermissionModeSpec, 'mode'> = {
  label: 'Teach',
  description: 'One concept per turn, drawn on the board. Reads only.',
  icon: 'board',
};

export interface PermissionControlProps {
  control: PermissionControlState;
  onChange: (mode: PermissionMode) => void;
  /** Teach mode, on or off. Rendered as the first row when `onTeach` is wired. */
  teach?: boolean;
  onTeach?: (on: boolean) => void;
}

export function PermissionControl({ control, onChange, teach = false, onTeach }: PermissionControlProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);
  const permissionSpec = PERMISSION_MODES.find((m) => m.mode === control.mode) ?? PERMISSION_MODES[0];
  const teaching = onTeach !== undefined && teach;
  const current = teaching ? TEACH_ROW : permissionSpec;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent) => {
      if (wrapRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    /* The scope class is on this root as well as on the composer's, because
       this control is rendered — and tested — on its own. A component whose
       styling only arrives when some ancestor happens to carry a class is a
       component that renders unstyled the first time it is reused. */
    <span className="chat-scope menuwrap" ref={wrapRef}>
      <button
        type="button"
        className="permsel"
        data-testid="permission-control"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <Icon name={current.icon} size={12} />
        {/* THE MODE IS A WORD BEFORE IT IS ANYTHING ELSE. Sheet 12.5's rule for
            run states — "no state in this product is communicated by colour
            alone" — is the general one, and it binds here even though this
            control spends no colour at all: the trigger says the mode, so the
            answer to "what is it allowed to do" never requires a click. */}
        <span>{current.label}</span>
        <Icon name="chevdown" size={12} />
      </button>

      {open ? (
        <div className="menu" role="menu" data-testid="permission-menu">
          {onTeach ? (
            <button
              type="button"
              role="menuitemradio"
              className="menuitem tall"
              data-testid="permission-option"
              data-mode="teach"
              aria-checked={teaching}
              onClick={() => {
                onTeach(true);
                setOpen(false);
              }}
            >
              <Icon name={TEACH_ROW.icon} />
              <span className="stack">
                <span>{TEACH_ROW.label}</span>
                <span className="sub">{TEACH_ROW.description}</span>
              </span>
              {teaching ? <Icon name="check" size={12} /> : null}
            </button>
          ) : null}
          {PERMISSION_MODES.map((spec) => {
            const enabled = control.enabled.includes(spec.mode);
            /* While teaching, no permission row is the live one — the turn is
               a lesson, whatever the remembered permission says. */
            const live = !teaching && spec.mode === control.mode;

            return (
              <button
                key={spec.mode}
                type="button"
                role="menuitemradio"
                className="menuitem tall"
                data-testid="permission-option"
                aria-checked={live}
                aria-disabled={!enabled}
                onClick={() => {
                  /*
                   * A REFUSED MODE REFUSES OUT LOUD. Non-default modes stay
                   * unavailable until Settings → Workspace enables them; a row
                   * that silently does nothing when clicked teaches the user
                   * the control is broken.
                   */
                  if (!enabled) return;
                  // Picking any permission row is also leaving Teach.
                  if (teaching) onTeach?.(false);
                  onChange(spec.mode);
                  setOpen(false);
                }}
              >
                <Icon name={spec.icon} />
                <span className="stack">
                  <span>{spec.label}</span>
                  <span className="sub">
                    {enabled ? spec.description : PERMISSION_UNAVAILABLE}
                  </span>
                </span>
                {live ? <Icon name="check" size={12} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </span>
  );
}
