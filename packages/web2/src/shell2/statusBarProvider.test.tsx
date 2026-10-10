import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { resolvedModel } from '../agents/activeModel';
import { StoreProvider, createStore } from '../state';
import { StatusBar } from './StatusBar';

afterEach(() => act(() => resolvedModel.set(null)));

function mount(model: { model: string; origin: 'unconfigured' | 'local' | 'api-key' | 'default' }) {
  const store = createStore({});
  store.dispatch({ type: 'composer/model', model });
  return render(
    <StoreProvider store={store}>
      <StatusBar />
    </StoreProvider>,
  );
}

describe('the status bar provider', () => {
  it('names no provider when nothing is connected (not "Local")', () => {
    mount({ model: '', origin: 'unconfigured' });
    expect(screen.queryByTestId('s2-status-agent')).toBeNull();
    expect(screen.queryByTestId('s2-status-model')).toBeNull();
  });
  it('uses the resolved model the chip shows: ollama gpt-oss is Local, not OpenAI', () => {
    mount({ model: 'gpt-oss:20b', origin: 'api-key' });
    act(() => resolvedModel.set({ model: 'gpt-oss:20b', provider: 'ollama', label: 'GPT-OSS 20B' }));
    expect(screen.getByTestId('s2-status-agent').getAttribute('data-provider-name')).toBe('Local');
    expect(screen.getByTestId('s2-status-model').textContent).toBe('GPT-OSS 20B');
  });
  it('a hosted gateway is named for itself', () => {
    mount({ model: 'meta-llama/llama-3.3-70b', origin: 'api-key' });
    act(() => resolvedModel.set({ model: 'meta-llama/llama-3.3-70b', provider: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', keyed: true, label: 'meta-llama/llama-3.3-70b' }));
    expect(screen.getByTestId('s2-status-agent').getAttribute('data-provider-name')).toBe('OpenRouter');
  });
  it('Sonnet reads Claude', () => {
    mount({ model: 'claude-sonnet-5-5', origin: 'api-key' });
    expect(screen.getByTestId('s2-status-agent').getAttribute('data-provider-name')).toBe('Claude');
  });
  it('the hosted default is named for its maker, not Local', () => {
    mount({ model: 'deepseek-v4-flash', origin: 'default' });
    expect(screen.getByTestId('s2-status-agent').getAttribute('data-provider-name')).toBe('DeepSeek');
    expect(screen.getByTestId('s2-status-model').textContent).toBe('DeepSeek V4 Flash');
  });
  it('a bare api-key gpt-4o reads OpenAI', () => {
    mount({ model: 'gpt-4o', origin: 'api-key' });
    expect(screen.getByTestId('s2-status-agent').getAttribute('data-provider-name')).toBe('OpenAI');
  });
  it('a loopback server with a dummy key reads Local', () => {
    mount({ model: 'mistral-7b', origin: 'api-key' });
    act(() => resolvedModel.set({ model: 'mistral-7b', provider: 'openai-compatible', baseUrl: 'http://localhost:1234/v1', keyed: true, label: 'Mistral 7B' }));
    expect(screen.getByTestId('s2-status-agent').getAttribute('data-provider-name')).toBe('Local');
  });
});
