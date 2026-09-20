import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { resolvedStyle, substituteVars } from '../../test/support/css';
import '../tokens/graphite.css';
import '../styles/base.css';
import './chat.css';
import { PERMISSION_MODES, PermissionControl } from './PermissionControl';

/**
 * ITEM 2.8 — THE PERMISSION CONTROL UNDER THE COMPOSER.
 *
 * UNSHEETED, AND SAID SO. `grep -i permission` across all twelve sheets of
 * docs/brand/graphite/ and its _core.html returns ZERO hits — §5.6 of the
 * plan lists the permission control among the eleven surfaces the book does not
 * cover. So the FORM is stolen verbatim from Codex per §5.2 item 1 ("one
 * always-visible dropdown, three modes, non-defaults opt-in from Settings"),
 * and the GEOMETRY is Graphite's: the under-composer strip, 20px, --r-8,
 * --t-10, outside the composer's border (sheet 12.4).
 *
 * TWO RUNGS SINCE 2026-09-13. Owner: "teach mode, plan mode, build mode … it
 * should be pretty simple." The ladder was plan / propose / autoEdit / full,
 * where each pair did one job — two that stage and two that apply — so four
 * names bought one real distinction. Plan is the old `propose` under the name
 * he uses for it; Build is the old `full`. Teach rides beside them as its own
 * flag, which is why the menu shows three rows and `PERMISSION_MODES` has two.
 *
 * THE ENGINE ENFORCES THE BOUNDARY NOW, which it did not when this file was
 * written. `askTools.ts` hands `run_command` to `build` and to nothing else
 * — a membership test, not an exclusion list — and `applyAskFileWrites.ts`
 * writes for `build` alone. Build stays refused until Settings enables it, and
 * that refusal is now about CONSENT rather than about a promise the product
 * could not keep.
 */

function token(name: string): string {
  return substituteVars(`var(${name})`, document.documentElement);
}

describe('Teach is a row of this menu, only when the host wires it (owner, 2026-09-02)', () => {
  it('without onTeach the menu is the four permission rows, exactly as before', () => {
    render(
      <PermissionControl control={{ mode: 'plan', enabled: ['plan'] }} onChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('permission-control'));
    expect(screen.getAllByTestId('permission-option').length).toBe(PERMISSION_MODES.length);
  });

  it('with onTeach the Teach row comes first, turns teach on, and the trigger names it', () => {
    const onTeach = vi.fn();
    const { rerender } = render(
      <PermissionControl
        control={{ mode: 'plan', enabled: ['plan'] }}
        onChange={vi.fn()}
        teach={false}
        onTeach={onTeach}
      />,
    );
    fireEvent.click(screen.getByTestId('permission-control'));
    const rows = screen.getAllByTestId('permission-option');
    expect(rows.length).toBe(PERMISSION_MODES.length + 1);
    expect(rows[0].getAttribute('data-mode')).toBe('teach');
    expect(rows[0].getAttribute('aria-checked')).toBe('false');
    fireEvent.click(rows[0]);
    expect(onTeach).toHaveBeenCalledWith(true);

    rerender(
      <PermissionControl
        control={{ mode: 'plan', enabled: ['plan'] }}
        onChange={vi.fn()}
        teach={true}
        onTeach={onTeach}
      />,
    );
    const trigger = screen.getByTestId('permission-control');
    expect(trigger.textContent).toContain('Teach');
    expect(trigger.textContent).not.toContain('Plan');
    fireEvent.click(trigger);
    const checked = screen.getAllByTestId('permission-option').filter((r) => r.getAttribute('aria-checked') === 'true');
    expect(checked.length).toBe(1);
    expect(checked[0].getAttribute('data-mode')).toBe('teach');
  });
});

describe('item 2.8 — the control shows its current mode', () => {
  it('names the live mode on the always-visible trigger', () => {
    render(
      <PermissionControl
        control={{ mode: 'plan', enabled: ['plan'] }}
        onChange={vi.fn()}
      />,
    );

    // Always visible, and it says what it is without being opened. A control
    // whose state you have to open a menu to learn is not an indicator.
    expect(screen.getByTestId('permission-control').textContent).toContain('Plan');
  });

  it('moves with the mode rather than showing a default', () => {
    // NON-VACUITY. If the trigger were a hardcoded label the assertion above
    // would pass forever; this is the one that catches it.
    render(
      <PermissionControl
        control={{ mode: 'build', enabled: ['plan', 'build'] }}
        onChange={vi.fn()}
      />,
    );

    const trigger = screen.getByTestId('permission-control');
    expect(trigger.textContent).toContain('Build');
    expect(trigger.textContent).not.toContain('Plan');
  });

  it('CARRIES THE MODE AS A WORD, never as colour alone', () => {
    /*
     * Graphite law 1 and sheet 12.5's rule: "no state in this product is
     * communicated by colour alone."
     *
     * THE SECOND HALF OF THAT COMMENT USED TO SAY the trigger "spends no hue at
     * all — autonomy is a setting, not a verdict". That stopped being true on
     * 2026-09-13 by the owner's ruling: "add colours for each mode — plan
     * yellow, build red, teach purple." Two of those are verdict hues, and the
     * cost is argued in graphite.css rather than hidden here.
     *
     * SO THIS CASE NOW GUARDS THE HALF THAT STILL BINDS, and it is the half
     * that matters: the hue may never be the ONLY carrier. The mode's name is
     * in the trigger, in text, at a readable size, whatever colour sits behind
     * it — which is what "never as colour alone" actually asks for.
     */
    render(
      <PermissionControl control={{ mode: 'plan', enabled: ['plan'] }} onChange={vi.fn()} />,
    );

    const trigger = screen.getByTestId('permission-control');
    /*
     * GEOMETRY RE-POINTED 2026-09-02, not weakened. These two lines pinned 20px
     * and --t-10, which `.permsel` had borrowed from `.branch` — a LABEL. The
     * trigger is the only interactive thing in the strip, and a button sized
     * like a caption measured 89.1 x 20 in the running app, failing WCAG 2.2 AA
     * 2.5.8's 24x24 floor. The owner's words for it: "very discreet, and
     * sometimes they're hard or easy to mess up".
     *
     * So it now sits on --control-h. The assertions follow the tokens rather
     * than the old literals, and the FLOOR is asserted underneath them —
     * because the height is not the point, clearing 24px is, and a bare token
     * comparison would go green again if --control-h were ever lowered.
     */
    /* THE WORD IS THERE. Read off the spec rather than hard-coded, so renaming
       a mode cannot leave this asserting a label nobody ships. */
    const plan = PERMISSION_MODES.find((m) => m.mode === 'plan')!;
    expect(trigger.textContent).toContain(plan.label);

    /* ON THE ORDINARY CONTROL RUNG — and this line has been both ways, so the
       history stays.

       2026-09-13, the owner: "make most buttons same size … each thing should
       be bigger and comparable", which put this on --control-h-lg.
       2026-09-14, the owner, on the same control: "make the plan build or teach
       buttons smaller to match". Decision 16 took the workspace tabs down the
       same rung for the same complaint, and this row sits under the composer
       where --t-11 is now the whole line's type.

       THE FLOOR IS WHAT THE CASE IS ACTUALLY FOR and it does not move: the
       assertion below still demands 24px, which the 2026-09-02 correction
       exists to protect (it was escaping a 20px caption height). 28 clears it
       by four. A bare token comparison would go green again if the rung were
       silently lowered, which is why both lines are here rather than one. */
    expect(resolvedStyle(trigger, 'height')).toBe(token('--control-h'));
    expect(Number.parseFloat(resolvedStyle(trigger, 'height'))).toBeGreaterThanOrEqual(24);

    /* And the hue it wears is one of the three DECLARED mode tones — not a
       verdict token borrowed raw, which is what would let a mode chip be
       mistaken for a claim about the repository. */
    expect(trigger.getAttribute('data-tone')).toBe('plan');
  });
});

/**
 * A menu row, found by the words a reader sees.
 *
 * Positional lookup is what broke when `plan` joined the ladder, and a test
 * that breaks because a list grew is testing the list's length rather than the
 * product's behaviour.
 */
function optionFor(label: string): HTMLElement {
  const row = screen
    .getAllByTestId('permission-option')
    .find((el) => el.textContent?.includes(label));
  if (!row) throw new Error(`no permission option labelled ${label}`);
  return row;
}

describe('item 2.8 — the ladder of modes, and only the honest ones are selectable', () => {
  it('offers every mode, so the autonomy question is visible before it is answerable', () => {
    render(
      <PermissionControl control={{ mode: 'plan', enabled: ['plan'] }} onChange={vi.fn()} />,
    );

    fireEvent.click(screen.getByTestId('permission-control'));

    const options = screen.getAllByTestId('permission-option');
    expect(options.length).toBe(PERMISSION_MODES.length);
    /*
     * WEAKEST FIRST, and the order is the claim. The list reads as a ladder of
     * trust, so the row a reader lands on first is the one that cannot hurt
     * them. `plan` joined at the top in the 2026-08-22 owner walk.
     */
    expect(PERMISSION_MODES.map((m) => m.mode)).toEqual(['plan', 'build']);
  });

  it('PLAN is offered as a real choice, not drawn refused like Build', () => {
    /*
     * The asymmetry worth locking. Build is refused until Settings enables it
     * because it writes without an Accept and runs commands — consequences an
     * Accept cannot take back. Plan asks for no such thing: it stages every
     * file change and the belt refuses it the shell, so it needs no opt-in to
     * be honest about what it will do.
     */
    render(<PermissionControl control={{ mode: 'plan', enabled: ['plan'] }} onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId('permission-control'));
    expect(optionFor('Plan').getAttribute('aria-disabled')).toBe('false');
  });

  it('refuses BUILD until Settings enables it', () => {
    /*
     * P3: Settings → Workspace turns these on. Until then the row points at
     * Settings rather than claiming the product cannot deliver them.
     */
    const onChange = vi.fn();
    render(<PermissionControl control={{ mode: 'plan', enabled: ['plan'] }} onChange={onChange} />);

    fireEvent.click(screen.getByTestId('permission-control'));

    const build = optionFor('Build');

    expect(build.getAttribute('aria-disabled')).toBe('true');
    expect(build.textContent).toMatch(/Settings/i);

    /* AND THE PRESS IS REFUSED, not merely styled as unavailable. A row that
       looks disabled and still fires would be the control claiming a consent
       the user never gave — the defect this whole file exists to prevent. */
    fireEvent.click(build);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('selects a mode the user has enabled', () => {
    const onChange = vi.fn();
    render(
      <PermissionControl
        control={{ mode: 'plan', enabled: ['plan', 'build'] }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByTestId('permission-control'));

    const auto = optionFor('Build');
    expect(auto.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(auto);
    expect(onChange).toHaveBeenCalledWith('build');
  });

  it('marks the live mode in the menu as well as on the trigger', () => {
    render(
      <PermissionControl control={{ mode: 'plan', enabled: ['plan'] }} onChange={vi.fn()} />,
    );

    fireEvent.click(screen.getByTestId('permission-control'));
    const selected = screen
      .getAllByTestId('permission-option')
      .filter((el) => el.getAttribute('aria-checked') === 'true');

    expect(selected.length).toBe(1);
    expect(selected[0].textContent).toContain('Plan');
  });

  it('closes when the pointer lands outside the menu', () => {
    render(
      <PermissionControl control={{ mode: 'plan', enabled: ['plan'] }} onChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('permission-control'));
    expect(screen.getByTestId('permission-menu')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('permission-menu')).toBeNull();
  });
});
