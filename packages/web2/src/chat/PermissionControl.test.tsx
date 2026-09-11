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
 * PHASE 1 IS THE CONTROL, NOT THE ENGINE. The rule algebra is Wave 5 item 5.6.
 * Sequence has no permission system today: `propose_files` never writes and a
 * human clicks Accept, and packages/acp's default policy allows four of ten
 * tool kinds with no injection site for a decision. So `autoEdit` and `full`
 * are typed, drawn, and refused — which is the honest state and is what the
 * last two tests below assert.
 */

function token(name: string): string {
  return substituteVars(`var(${name})`, document.documentElement);
}

describe('Teach is a row of this menu, only when the host wires it (owner, 2026-09-02)', () => {
  it('without onTeach the menu is the four permission rows, exactly as before', () => {
    render(
      <PermissionControl control={{ mode: 'propose', enabled: ['propose'] }} onChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('permission-control'));
    expect(screen.getAllByTestId('permission-option').length).toBe(PERMISSION_MODES.length);
  });

  it('with onTeach the Teach row comes first, turns teach on, and the trigger names it', () => {
    const onTeach = vi.fn();
    const { rerender } = render(
      <PermissionControl
        control={{ mode: 'propose', enabled: ['propose'] }}
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
        control={{ mode: 'propose', enabled: ['propose'] }}
        onChange={vi.fn()}
        teach={true}
        onTeach={onTeach}
      />,
    );
    const trigger = screen.getByTestId('permission-control');
    expect(trigger.textContent).toContain('Teach');
    expect(trigger.textContent).not.toContain('Propose');
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
        control={{ mode: 'propose', enabled: ['propose'] }}
        onChange={vi.fn()}
      />,
    );

    // Always visible, and it says what it is without being opened. A control
    // whose state you have to open a menu to learn is not an indicator.
    expect(screen.getByTestId('permission-control').textContent).toContain('Propose');
  });

  it('moves with the mode rather than showing a default', () => {
    // NON-VACUITY. If the trigger were a hardcoded label the assertion above
    // would pass forever; this is the one that catches it.
    render(
      <PermissionControl
        control={{ mode: 'autoEdit', enabled: ['propose', 'autoEdit'] }}
        onChange={vi.fn()}
      />,
    );

    const trigger = screen.getByTestId('permission-control');
    expect(trigger.textContent).toContain('Auto-edit');
    expect(trigger.textContent).not.toContain('Propose');
  });

  it('carries the mode as a word, never as colour alone', () => {
    /*
     * Graphite law 1 and sheet 12.5's rule: "no state in this product is
     * communicated by colour alone". The trigger is --ink-2 on the
     * under-composer strip and spends no hue at all — autonomy is a setting,
     * not a verdict.
     */
    render(
      <PermissionControl control={{ mode: 'propose', enabled: ['propose'] }} onChange={vi.fn()} />,
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
    expect(resolvedStyle(trigger, 'height')).toBe(token('--control-h'));
    expect(resolvedStyle(trigger, 'font-size')).toBe(token('--t-11'));
    expect(Number.parseFloat(resolvedStyle(trigger, 'height'))).toBeGreaterThanOrEqual(24);
    const claims = [token('--fits'), token('--wont'), token('--spills'), token('--info')];
    expect(claims).not.toContain(resolvedStyle(trigger, 'color'));
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
      <PermissionControl control={{ mode: 'propose', enabled: ['propose'] }} onChange={vi.fn()} />,
    );

    fireEvent.click(screen.getByTestId('permission-control'));

    const options = screen.getAllByTestId('permission-option');
    expect(options.length).toBe(PERMISSION_MODES.length);
    /*
     * WEAKEST FIRST, and the order is the claim. The list reads as a ladder of
     * trust, so the row a reader lands on first is the one that cannot hurt
     * them. `plan` joined at the top in the 2026-08-22 owner walk.
     */
    expect(PERMISSION_MODES.map((m) => m.mode)).toEqual(['plan', 'propose', 'autoEdit', 'full']);
  });

  it('PLAN is offered as a real choice, not drawn refused like the strong modes', () => {
    /*
     * The asymmetry worth locking. `autoEdit` and `full` are refused because
     * this product has no permission system and offering them would promise an
     * autonomy nothing implements. Plan is the opposite case: it asks for LESS
     * than the tool boundary already enforces — only read, fetch, search and
     * think are ever allowed — so it needs no new enforcement to be honest.
     */
    render(<PermissionControl control={{ mode: 'propose', enabled: ['plan', 'propose'] }} onChange={vi.fn()} />);
    fireEvent.click(screen.getByTestId('permission-control'));
    expect(optionFor('Plan').getAttribute('aria-disabled')).toBe('false');
  });

  it('refuses Auto-edit and Full until Settings enables them', () => {
    /*
     * P3: Settings → Workspace turns these on. Until then the row points at
     * Settings rather than claiming the product cannot deliver them.
     */
    const onChange = vi.fn();
    render(<PermissionControl control={{ mode: 'propose', enabled: ['propose'] }} onChange={onChange} />);

    fireEvent.click(screen.getByTestId('permission-control'));

    const auto = optionFor('Auto-edit');
    const full = optionFor('Full access');

    expect(auto.getAttribute('aria-disabled')).toBe('true');
    expect(full.getAttribute('aria-disabled')).toBe('true');
    expect(auto.textContent).toMatch(/Settings/i);

    fireEvent.click(auto);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('selects a mode the user has enabled', () => {
    const onChange = vi.fn();
    render(
      <PermissionControl
        control={{ mode: 'propose', enabled: ['propose', 'autoEdit'] }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByTestId('permission-control'));

    const auto = optionFor('Auto-edit');
    expect(auto.getAttribute('aria-disabled')).toBe('false');
    fireEvent.click(auto);
    expect(onChange).toHaveBeenCalledWith('autoEdit');
  });

  it('marks the live mode in the menu as well as on the trigger', () => {
    render(
      <PermissionControl control={{ mode: 'propose', enabled: ['propose'] }} onChange={vi.fn()} />,
    );

    fireEvent.click(screen.getByTestId('permission-control'));
    const selected = screen
      .getAllByTestId('permission-option')
      .filter((el) => el.getAttribute('aria-checked') === 'true');

    expect(selected.length).toBe(1);
    expect(selected[0].textContent).toContain('Propose');
  });

  it('closes when the pointer lands outside the menu', () => {
    render(
      <PermissionControl control={{ mode: 'propose', enabled: ['propose'] }} onChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('permission-control'));
    expect(screen.getByTestId('permission-menu')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('permission-menu')).toBeNull();
  });
});
