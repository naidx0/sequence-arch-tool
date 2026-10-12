import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRuns } from '../agents/agentRuns';
import { StoreProvider, createStore } from '../state';
import { modelGroupOf } from './brandIcons';
import { EMPTY_MODELS_COPY, ModelMenu, moveMenuFocus, popupMaxHeight } from './ModelMenu';

describe('modelGroupOf, the one classifier for chip, bar and picker', () => {
  it('Claude and OpenAI by provider; Ollama is Local even for gpt-oss', () => {
    expect(modelGroupOf({ provider: 'anthropic', model: 'claude-sonnet-5-5' })).toMatchObject({ key: 'claude', label: 'Claude' });
    expect(modelGroupOf({ provider: 'openai', model: 'gpt-5.1' })).toMatchObject({ key: 'openai', label: 'OpenAI' });
    expect(modelGroupOf({ provider: 'ollama', model: 'gpt-oss:20b' })).toMatchObject({ key: 'local', label: 'Local' });
  });
  it('a keyless loopback model is Local whatever its id says', () => {
    expect(modelGroupOf({ provider: 'openai-compatible', model: 'gpt-oss:20b', baseUrl: 'http://localhost:11434/v1', keyed: false }).key).toBe('local');
    expect(modelGroupOf({ provider: 'openai-compatible', model: 'claude-x', keyed: false }).key).toBe('local');
  });
  it('a hosted keyed gateway gets its own group and the neutral icon, never Sequence', () => {
    const or = modelGroupOf({ provider: 'openai-compatible', model: 'meta-llama/llama-3.3-70b', baseUrl: 'https://openrouter.ai/api/v1', keyed: true });
    expect(or).toMatchObject({ label: 'OpenRouter', icon: 'other' });
    expect(modelGroupOf({ provider: 'openai-compatible', model: 'llama-3.3-70b', baseUrl: 'https://api.groq.com/openai/v1', keyed: true }).label).toBe('Groq');
    const meta = modelGroupOf({ provider: 'openai-compatible', model: 'meta-llama/llama-3.3-70b', keyed: true });
    expect(meta).toMatchObject({ label: 'Meta', icon: 'other' });
    expect(modelGroupOf({ provider: 'openai-compatible', model: 'anthropic/claude-sonnet-5-5', baseUrl: 'https://openrouter.ai/api/v1', keyed: true }).key).toBe('claude');
  });
  it('with nothing known beyond the id, claude and openai ids keep their maker and the rest is Local', () => {
    expect(modelGroupOf({ provider: 'openai-compatible', model: 'anthropic/claude-sonnet-5-5' }).key).toBe('claude');
    expect(modelGroupOf({ provider: 'openai-compatible', model: 'minicpm5:latest' }).key).toBe('local');
  });
});

describe('modelGroupOf honesty', () => {
  const oc = (over: Record<string, unknown>) => modelGroupOf({ provider: 'openai-compatible', ...over });
  it('the hosted default is named for the maker in its id, never Local', () => {
    expect(oc({ model: 'deepseek-v4-flash', managed: true })).toMatchObject({ label: 'DeepSeek', icon: 'other' });
    expect(oc({ model: 'qwen3-max', managed: true }).label).toBe('Qwen');
    expect(oc({ model: 'llama-3.3-70b', managed: true }).label).toBe('Meta');
    expect(oc({ model: 'mistral-large-latest', managed: true }).label).toBe('Mistral');
    expect(oc({ model: 'gemini-2.5-pro', managed: true }).label).toBe('Google');
    expect(oc({ model: 'grok-4', managed: true }).label).toBe('xAI');
    expect(oc({ model: 'mystery-1', managed: true })).toMatchObject({ label: 'Hosted model', icon: 'other' });
    /* even a name:tag id is not Local when it is the managed default */
    expect(oc({ model: 'qwen3:30b-a3b', managed: true }).key).not.toBe('local');
  });
  it('a bare api-key selection by id: gpt-4o is OpenAI, an unknown id is not Local', () => {
    expect(oc({ model: 'gpt-4o' }).key).toBe('openai');
    expect(oc({ model: 'deepseek-v4-flash' }).label).toBe('DeepSeek');
    expect(oc({ model: 'mystery-1' }).key).not.toBe('local');
  });
  it('local only on evidence: name:tag ids, local providers, loopback', () => {
    expect(oc({ model: 'qwen3:30b-a3b' }).key).toBe('local');
    expect(modelGroupOf({ provider: 'lmstudio', model: 'whatever' }).key).toBe('local');
    expect(modelGroupOf({ provider: 'llama.cpp', model: 'x' }).key).toBe('local');
    expect(oc({ model: 'qwen3:30b-a3b', keyed: true }).key).not.toBe('local');
  });
  it('loopback with a dummy key is Local, never "Localhost" or "127"', () => {
    expect(oc({ model: 'mistral-7b', baseUrl: 'http://localhost:1234/v1', keyed: true })).toMatchObject({ key: 'local', label: 'Local' });
    expect(oc({ model: 'llama-3', baseUrl: 'http://127.0.0.1:8000/v1', keyed: true })).toMatchObject({ key: 'local', label: 'Local' });
  });
  it('0.0.0.0 and host.docker.internal are this machine too', () => {
    expect(oc({ model: 'x', baseUrl: 'http://0.0.0.0:8000/v1', keyed: true }).key).toBe('local');
    expect(oc({ model: 'x', baseUrl: 'http://host.docker.internal:11434/v1', keyed: true }).key).toBe('local');
  });
  it('an unknown host is "Custom endpoint", a known one is named; never a hostname fragment', () => {
    expect(oc({ model: 'foo', baseUrl: 'https://my-ollama.example.com/v1', keyed: true })).toMatchObject({ key: 'host:custom-endpoint', label: 'Custom endpoint' });
    expect(oc({ model: 'llama-3', baseUrl: 'https://api.deepinfra.com/v1/openai', keyed: true }).label).toBe('DeepInfra');
    expect(oc({ model: 'x', baseUrl: 'https://inference.huggingface.co/v1', keyed: true }).label).toBe('Hugging Face');
  });
});

describe('popupMaxHeight', () => {
  it('is the room above the chip less the margin, capped, never below the floor', () => {
    expect(popupMaxHeight(300)).toBe(292);
    expect(popupMaxHeight(2000)).toBe(960);
    expect(popupMaxHeight(2000, 8, 800)).toBe(800);
    expect(popupMaxHeight(40)).toBe(120);
    expect(popupMaxHeight(300, 16)).toBe(284);
  });
});

const prof = (id: string, provider: string, model: string, active = false) => ({ id, nickname: model, model, provider, active, reasoningEffort: null });
function mount(profiles: ReturnType<typeof prof>[], onClose = vi.fn(), over: Record<string, unknown> = {}) {
  return render(
    <StoreProvider store={createStore({})}>
      <ModelMenu
        wrapRef={createRef<HTMLDivElement>()}
        open
        onTrigger={() => {}}
        onClose={onClose}
        sessionId="s"
        agentRun={undefined}
        profiles={profiles as never}
        pickModel={vi.fn()}
        modelErr={null}
        effort="medium"
        effortRows={[{ key: 'medium', label: 'Medium', description: 'Medium' }]}
        pickEffort={() => {}}
        modelChip="Sonnet 5.5"
        modelChipShort="Sonnet 5.5"
        modelChipTitle="Sonnet 5.5"
        effortLabel="Medium"
        modes={[
          { key: 'ask', label: 'Ask', desc: 'Asks', icon: 'shield' },
          { key: 'plan', label: 'Plan', desc: 'Plans', icon: 'map' },
        ]}
        currentMode="plan"
        onMode={() => {}}
        {...over}
      />
    </StoreProvider>,
  );
}
beforeEach(() => agentRuns.patch((s) => ({ ...s, runs: [], agents: {}, caps: {}, config: {}, capsError: {} })));

describe('keyboard in the popup', () => {
  it('ArrowDown/Up/Home/End rove focus across items (wrapping), skipping the slider', () => {
    mount([prof('1', 'ollama', 'minicpm5:latest'), prof('2', 'anthropic', 'claude-sonnet-5-5', true)]);
    const menu = screen.getByTestId('s2-model-menu');
    const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]')];
    expect(items.length).toBeGreaterThanOrEqual(3);
    items[0]!.focus();
    fireEvent.keyDown(items[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0]!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(items[items.length - 1]);
    expect(items.every((i) => !i.closest('[role="slider"]'))).toBe(true);
    expect(moveMenuFocus(menu, 'x')).toBe(false);
  });
  it('the slider keeps its arrow keys', () => {
    mount([prof('2', 'anthropic', 'claude-sonnet-5-5', true)]);
    const slider = screen.getAllByRole('slider')[0]!;
    slider.focus();
    fireEvent.keyDown(slider, { key: 'ArrowUp' });
    fireEvent.keyDown(slider, { key: 'End' });
    expect(document.activeElement).toBe(slider);
  });
  it('Esc closes and returns focus to the chip', () => {
    const onClose = vi.fn();
    mount([prof('2', 'anthropic', 'claude-sonnet-5-5', true)], onClose);
    const row = screen.getAllByTestId('v3-model-row')[0]!;
    row.focus();
    fireEvent.keyDown(row, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByTestId('v3-model-trigger'));
  });
  it('ArrowDown from the chip enters the menu', () => {
    mount([prof('2', 'anthropic', 'claude-sonnet-5-5', true)]);
    const chip = screen.getByTestId('v3-model-trigger');
    chip.focus();
    fireEvent.keyDown(chip, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getAllByTestId('v3-model-row')[0]);
  });
});

describe('chip and empty popup', () => {
  it('the mode is icon-only on the chip (its word is the accessible name), in every mode', () => {
    mount([prof('2', 'anthropic', 'claude-sonnet-5-5', true)]);
    expect(screen.getByTestId('s2-mode-trigger').querySelector('.s2-pill-mode-w')).toBeNull();
    expect(screen.getByTestId('s2-mode-trigger').getAttribute('aria-label')).toBe('Mode: Plan');
  });
  it('no models: one clear action, no duplicate line, no reasoning slider', () => {
    mount([], vi.fn(), { modelChipShort: 'Connect agent', modelChip: 'Connect a model' });
    expect(screen.queryByTestId('s2-model-empty')).toBeNull();
    expect(screen.queryByTestId('s2-effort')).toBeNull();
    expect(screen.getAllByText(/add a model/i)).toHaveLength(1);
    expect(screen.getByTestId('s2-add-model').textContent).toBe('Add a model or agent');
    expect(screen.getByTestId('v3-model-label').textContent).toBe('Connect agent');
    expect(EMPTY_MODELS_COPY).toBe('');
  });
  it('a model-route error is still said, once', () => {
    mount([], vi.fn(), { modelErr: 'could not list', modelChipShort: 'Connect agent' });
    const note = screen.getByTestId('s2-model-empty');
    expect(note.querySelector('.failure-note-say')?.textContent).toBe('The model list could not be loaded.');
    expect(note.querySelector('details code')?.textContent).toBe('could not list');
  });
  it('reasoning and the add row are the pinned foot, outside the scrolling body', () => {
    mount([prof('2', 'anthropic', 'claude-sonnet-5-5', true)]);
    const foot = screen.getByTestId('s2-menu-foot');
    const body = screen.getByTestId('s2-menu-body');
    expect(foot.contains(screen.getByTestId('s2-effort'))).toBe(true);
    expect(foot.contains(screen.getByTestId('s2-add-model'))).toBe(true);
    expect(body.contains(screen.getByTestId('s2-effort'))).toBe(false);
    expect(body.contains(screen.getByTestId('s2-model-group-claude'))).toBe(true);
  });
  it('shows the scroll fade only while the body has more below it', () => {
    mount([prof('2', 'anthropic', 'claude-sonnet-5-5', true)]);
    const menu = screen.getByTestId('s2-model-menu');
    const body = screen.getByTestId('s2-menu-body');
    const set = (scrollHeight: number, clientHeight: number, scrollTop: number) => {
      Object.defineProperty(body, 'scrollHeight', { configurable: true, value: scrollHeight });
      Object.defineProperty(body, 'clientHeight', { configurable: true, value: clientHeight });
      Object.defineProperty(body, 'scrollTop', { configurable: true, writable: true, value: scrollTop });
      fireEvent.scroll(body);
    };
    set(700, 400, 0);
    expect(menu.getAttribute('data-more')).toBe('true');
    set(700, 400, 300);
    expect(menu.getAttribute('data-more')).toBe('false');
    set(300, 400, 0);
    expect(menu.getAttribute('data-more')).toBe('false');
  });
  it('the chip icon comes from the one resolved model, not the list-active row', () => {
    mount([prof('2', 'anthropic', 'claude-sonnet-5-5', true)], vi.fn(), { chipIdentity: { model: 'qwen3:30b-a3b', provider: 'openai-compatible', baseUrl: 'http://localhost:1234/v1', keyed: true } });
    expect(screen.getByTestId('v3-model-trigger').querySelector('[data-brand="claude"]')).toBeNull();
    cleanup();
    mount([prof('2', 'anthropic', 'claude-sonnet-5-5')], vi.fn(), { chipIdentity: { model: 'claude-sonnet-5-5', provider: 'anthropic' } });
    expect(screen.getByTestId('v3-model-trigger').querySelector('[data-brand="claude"]')).not.toBeNull();
  });
  it('the hosted default chip wears the neutral glyph, not the Sequence or Local mark', () => {
    mount([], vi.fn(), { chipIdentity: { model: 'deepseek-v4-flash', managed: true }, modelChipShort: 'DeepSeek V4 Flash', modelChip: 'DeepSeek V4 Flash' });
    const chip = screen.getByTestId('v3-model-trigger');
    expect(chip.querySelector('.s2-pill-l + *, [data-brand]')).toBeNull();
    expect(chip.querySelector('svg.s2-brand')).toBeNull();
  });
  it('a hosted gateway row is grouped by vendor and does not wear the Sequence mark', () => {
    mount([{ ...prof('9', 'openai-compatible', 'meta-llama/llama-3.3-70b'), baseUrl: 'https://openrouter.ai/api/v1', keyed: true } as never]);
    const g = screen.getByTestId('s2-model-group-host:openrouter');
    expect(g.querySelector('.s2-group-h')!.textContent).toBe('OpenRouter');
    expect(g.querySelector('.s2-brand')).toBeNull();
  });
});
