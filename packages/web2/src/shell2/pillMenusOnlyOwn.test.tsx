import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { COMPOSER_MODE_COPY } from '../chat/composerModelModes';
import { StoreProvider, createStore } from '../state';
import { ModelMenu } from './ModelMenu';

/*
 * Owner, 2026-10-10: "make sure it only opens mode when you click on the mode
 * icon. Otherwise, if you click on connect the agent, it just opens the whole
 * thing." Measured on 0.1.6: the mode icon opened the three-row mode menu
 * alone, but the model button ("Connect agent") opened the model popup WITH the
 * Mode section (Plan, Smart, Full auto) at its top. Each button now opens its
 * own menu and nothing of the other's.
 */
const MODES = [
  { key: 'plan', label: 'Plan', desc: COMPOSER_MODE_COPY.plan.desc, icon: 'map' as const },
  { key: 'smart', label: 'Smart', desc: COMPOSER_MODE_COPY.smart.desc, icon: 'shield' as const },
  { key: 'full', label: 'Full auto', desc: COMPOSER_MODE_COPY.full.desc, icon: 'bolt' as const },
];

function Host() {
  const [open, setOpen] = useState(false);
  return (
    <StoreProvider store={createStore({})}>
      <ModelMenu
        wrapRef={createRef<HTMLDivElement>()}
        open={open}
        onTrigger={() => setOpen((v) => !v)}
        onClose={() => setOpen(false)}
        sessionId="s"
        agentRun={undefined}
        profiles={[]}
        pickModel={vi.fn()}
        modelErr={null}
        effort="medium"
        effortRows={[{ key: 'medium', label: 'Medium', description: 'Medium' }]}
        pickEffort={() => {}}
        modelChip="Connect agent"
        modelChipShort="Connect agent"
        modelChipTitle="Connect agent"
        effortLabel="Medium"
        modes={MODES}
        currentMode="plan"
        onMode={vi.fn()}
      />
    </StoreProvider>
  );
}
afterEach(cleanup);

describe('each pill button opens its own menu only', () => {
  it('the mode icon opens the mode menu and not the model popup', () => {
    render(<Host />);
    fireEvent.click(screen.getByTestId('s2-mode-trigger'));
    expect(screen.getByTestId('s2-quickmode-menu')).toBeTruthy();
    expect(screen.queryByTestId('s2-model-menu')).toBeNull();
  });

  it('the Connect agent button opens the model popup with no mode rows in it, and not the mode menu', () => {
    render(<Host />);
    fireEvent.click(screen.getByTestId('v3-model-trigger'));
    const menu = screen.getByTestId('s2-model-menu');
    expect(screen.queryByTestId('s2-quickmode-menu')).toBeNull();
    expect(menu.querySelector('[data-testid="s2-mode-menu"]')).toBeNull();
    expect(menu.querySelectorAll('.s2-mi-mode')).toHaveLength(0);
    expect(menu.textContent).not.toMatch(/Full auto|Smart|Plan/);
  });

  it('opening one while the other is open closes the other', () => {
    render(<Host />);
    fireEvent.click(screen.getByTestId('v3-model-trigger'));
    fireEvent.click(screen.getByTestId('s2-mode-trigger'));
    expect(screen.queryByTestId('s2-model-menu')).toBeNull();
    expect(screen.getByTestId('s2-quickmode-menu')).toBeTruthy();
    fireEvent.click(screen.getByTestId('v3-model-trigger'));
    expect(screen.queryByTestId('s2-quickmode-menu')).toBeNull();
    expect(screen.getByTestId('s2-model-menu')).toBeTruthy();
  });
});
