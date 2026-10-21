import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { COMPOSER_MODE_COPY } from '../chat/composerModelModes';
import { modelNickname } from '../chat/modelNickname';
import { StoreProvider, createStore } from '../state';
import { ModelMenu } from './ModelMenu';

/*
 * ROUND 11 (owner, 2026-10-08): ONE plain pill, two buttons. [mode icon] [provider icon] [model nickname]: no tint, no circle, no divider.
 * The mode icon opens a small three-row menu; the model part opens the full popup.
 */
const MODES = [
  { key: 'plan', label: 'Plan', desc: COMPOSER_MODE_COPY.plan.desc, icon: 'map' as const },
  { key: 'smart', label: 'Smart', desc: COMPOSER_MODE_COPY.smart.desc, icon: 'shield' as const },
  { key: 'full', label: 'Full auto', desc: COMPOSER_MODE_COPY.full.desc, icon: 'bolt' as const },
];

function mount(over: Record<string, unknown> = {}) {
  const onMode = vi.fn();
  const onTrigger = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <StoreProvider store={createStore({})}>
      <ModelMenu
        wrapRef={createRef<HTMLDivElement>()}
        open={false}
        onTrigger={onTrigger}
        onClose={onClose}
        sessionId="s"
        agentRun={undefined}
        profiles={[]}
        pickModel={vi.fn()}
        modelErr={null}
        effort="medium"
        effortRows={[{ key: 'medium', label: 'Medium', description: 'Medium' }]}
        pickEffort={() => {}}
        modelChip="Sonnet 5.5"
        modelChipShort="Sonnet 5.5"
        modelChipTitle="Sonnet 5.5, claude-sonnet-5-5"
        effortLabel="Medium"
        modes={MODES}
        currentMode="plan"
        onMode={onMode}
        {...over}
      />
    </StoreProvider>,
  );
  return { ...view, onMode, onTrigger, onClose };
}
afterEach(cleanup);

describe('the one pill', () => {
  it('holds both buttons in one group: the mode icon, a divider, then the model', () => {
    mount();
    const bar = screen.getByTestId('s2-pillbar');
    const mode = screen.getByTestId('s2-mode-trigger');
    const model = screen.getByTestId('v3-model-trigger');
    expect(bar.contains(mode) && bar.contains(model)).toBe(true);
    expect(document.querySelectorAll('.s2-pillbar')).toHaveLength(1);
    expect(mode.compareDocumentPosition(model) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is one plain pill: no divider between the mode icon and the model, no circle on the icon', () => {
    mount();
    const bar = screen.getByTestId('s2-pillbar');
    expect(bar.querySelector('.s2-pill-sep')).toBeNull();
    expect(bar.querySelector('.s2-mode-dot')).toBeNull();
    expect(bar.querySelectorAll('.s2-pb')).toHaveLength(2);
  });

  it('names the mode in its label and shows no mode word on the chip', () => {
    mount();
    const mode = screen.getByTestId('s2-mode-trigger');
    expect(mode.getAttribute('aria-label')).toBe('Mode: Plan');
    expect(mode.querySelector('.s2-pill-mode-w')).toBeNull();
    /* The word is screen-reader only; the visible part is the plain icon. */
    expect(mode.querySelector('.s2-mode-ico svg')).toBeTruthy();
    expect(mode.querySelector('.s2-sr')?.textContent).toBe('Plan');
    expect(screen.getByTestId('v3-model-trigger').getAttribute('aria-label')).not.toMatch(/Mode:/);
  });

  it('wears the existing icons: Plan a map, Smart a shield, Full auto a bolt', () => {
    for (const [key, icon] of [['plan', 'map'], ['smart', 'shield'], ['full', 'bolt']] as const) {
      const v = mount({ currentMode: key });
      expect(screen.getByTestId('s2-mode-trigger').querySelector('svg')?.getAttribute('data-icon')).toBe(icon);
      expect(screen.getByTestId('s2-mode-trigger').querySelector('.s2-mode-ico')?.getAttribute('data-mode')).toBe(key);
      v.unmount();
    }
  });

  it('puts the model nickname in the label and the whole name in the title', () => {
    mount({ modelChip: 'Qwen 2.5 Coder 32B', modelChipShort: 'Qwen 2.5 Coder 32B', modelChipTitle: 'Qwen 2.5 Coder 32B, qwen2.5-coder-32b-instruct' });
    expect(screen.getByTestId('v3-model-label').textContent).toBe('Qwen 2.5 Coder 32B');
    expect(screen.getByTestId('v3-model-trigger').getAttribute('title')).toContain('qwen2.5-coder-32b-instruct');
  });

  it('condenses long ids to a nickname first', () => {
    expect(modelNickname('Qwen 2.5 Coder 32B Instruct')).toBe('Qwen 2.5 Coder');
    expect(modelNickname('qwen2.5-coder-32b-instruct')).toBe('Qwen 2.5 Coder');
    expect(modelNickname('deepseek-v4-flash')).toBe('DeepSeek V4 Flash');
  });
});

describe('the small mode menu', () => {
  it('opens from the mode icon with exactly three rows and the model popup stays shut', () => {
    const { onTrigger } = mount();
    expect(screen.queryByTestId('s2-quickmode-menu')).toBeNull();
    fireEvent.click(screen.getByTestId('s2-mode-trigger'));
    const menu = screen.getByTestId('s2-quickmode-menu');
    expect(Array.from(menu.querySelectorAll('[role="menuitemradio"]')).map((r) => r.getAttribute('data-testid'))).toEqual(['s2-quickmode-plan', 's2-quickmode-smart', 's2-quickmode-full']);
    expect(screen.getByTestId('s2-quickmode-plan').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('s2-mode-trigger').getAttribute('aria-expanded')).toBe('true');
    expect(onTrigger).not.toHaveBeenCalled();
    expect(screen.queryByTestId('s2-model-menu')).toBeNull();
  });

  it('the Smart row says what Smart does, honestly', () => {
    mount();
    fireEvent.click(screen.getByTestId('s2-mode-trigger'));
    expect(screen.getByTestId('s2-quickmode-smart').textContent).toContain('Edits, asks before commands');
  });

  it('focuses the mode in force, arrows move, Enter-click picks, and focus returns to the icon', async () => {
    const { onMode } = mount();
    const trigger = screen.getByTestId('s2-mode-trigger');
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByTestId('s2-quickmode-plan'));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByTestId('s2-quickmode-smart'));
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByTestId('s2-quickmode-full'));
    fireEvent.click(screen.getByTestId('s2-quickmode-smart'));
    expect(onMode).toHaveBeenCalledWith('smart');
    expect(screen.queryByTestId('s2-quickmode-menu')).toBeNull();
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(document.activeElement).toBe(trigger);
  });

  it('Esc closes it and hands focus back to the icon', async () => {
    mount();
    const trigger = screen.getByTestId('s2-mode-trigger');
    fireEvent.click(trigger);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByTestId('s2-quickmode-menu')).toBeNull();
    await act(async () => {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    expect(document.activeElement).toBe(trigger);
  });

  it('ArrowDown on the icon opens it; the model part calls the popup, not this menu', () => {
    const { onTrigger } = mount();
    fireEvent.keyDown(screen.getByTestId('s2-mode-trigger'), { key: 'ArrowDown' });
    expect(screen.getByTestId('s2-quickmode-menu')).toBeTruthy();
    fireEvent.click(screen.getByTestId('v3-model-trigger'));
    expect(onTrigger).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('s2-quickmode-menu')).toBeNull();
  });

  it('a click outside closes it', () => {
    mount();
    fireEvent.click(screen.getByTestId('s2-mode-trigger'));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('s2-quickmode-menu')).toBeNull();
  });
});
