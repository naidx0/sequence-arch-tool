import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import './settings.css';
import { ProviderCatalogCard, contextLabel, defaultModel, modelLine, type CatalogProvider } from './ProviderCatalogCard';

const PROVIDERS: CatalogProvider[] = [
  { id: 'deepseek', name: 'DeepSeek', wire: 'openai-compatible', api: 'https://api.deepseek.com', env: ['DEEPSEEK_API_KEY'], models: [{ id: 'deepseek-flash', name: 'DeepSeek Flash', context: 1_000_000, cost: [0.15, 0.6] }, { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', context: 128_000 }] },
  { id: 'groq', name: 'Groq', wire: 'openai-compatible', api: 'https://api.groq.com/openai/v1', env: ['GROQ_API_KEY'], doc: 'https://console.groq.com/docs', models: [{ id: 'llama-5', name: 'Llama 5' }] },
];

function serve(detected: { id: string; name: string; keyEnv: string }[]) {
  return (async () => new Response(JSON.stringify({ providers: PROVIDERS, detected }), { status: 200 })) as typeof fetch;
}

describe('Settings › Models: any provider, and the keys already here', () => {
  it('the starting model is an everyday one where the name says so, else the newest', () => {
    const anthropic: CatalogProvider = { id: 'anthropic', name: 'Anthropic', wire: 'anthropic', api: 'https://api.anthropic.com', env: ['ANTHROPIC_API_KEY'], models: [{ id: 'claude-haiku-5-5', name: 'Haiku' }, { id: 'claude-sonnet-5-5', name: 'Sonnet' }] };
    expect(defaultModel(anthropic).id).toBe('claude-sonnet-5-5');
    expect(defaultModel(PROVIDERS[0]!).id).toBe('deepseek-flash');
  });

  it('labels: context and price as a person reads them', () => {
    expect(contextLabel(1_000_000)).toBe('1M');
    expect(contextLabel(128_000)).toBe('128K');
    expect(modelLine(PROVIDERS[0]!.models[0]!)).toBe('DeepSeek Flash, 1M context, $0.15 in / $0.60 out per 1M');
  });

  it('a key found in the environment is offered by its variable; Use saves a model that reads it, with the chosen model', async () => {
    const save = vi.fn(async () => null);
    render(<ProviderCatalogCard fetchImpl={serve([{ id: 'deepseek', name: 'DeepSeek', keyEnv: 'DEEPSEEK_API_KEY' }])} save={save} onPick={() => {}} />);
    const offer = await screen.findByTestId('provider-catalog-offer');
    /* Plain words: the provider and where its key was found, not a variable name. */
    expect(offer.textContent).toMatch(/Found in your environment/);
    /* The name is the row's title; the line under it does not repeat it. */
    expect(offer.textContent).not.toMatch(/DeepSeek, found/);
    expect(offer.textContent).not.toMatch(/DEEPSEEK_API_KEY|Key in/);
    fireEvent.click(screen.getByTestId('provider-catalog-model'));
    fireEvent.click(screen.getAllByTestId('provider-catalog-model-option').find((o) => o.getAttribute('data-value') === 'deepseek-v4-pro')!);
    fireEvent.click(screen.getByTestId('provider-catalog-use'));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: 'DeepSeek DeepSeek V4 Pro', provider: 'openai-compatible', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro', apiKeyEnv: 'DEEPSEEK_API_KEY' }));
    /* A fresh id each time, so an earlier model for this provider is never overwritten. */
    expect((save.mock.calls[0] as unknown as [{ id: string }])[0].id).toMatch(/^env-deepseek-[a-z0-9]+$/);
  });

  it('a provider already saved at its address (key pasted or by name) is not offered again', async () => {
    render(<ProviderCatalogCard fetchImpl={serve([{ id: 'deepseek', name: 'DeepSeek', keyEnv: 'DEEPSEEK_API_KEY' }])} save={vi.fn()} onPick={() => {}} saved={[{ id: 'p1', name: 'x', provider: 'openai-compatible', model: 'm', baseUrl: 'https://api.deepseek.com/', apiKey: '••••abcd' }]} />);
    await screen.findByTestId('provider-catalog-search');
    expect(screen.queryByTestId('provider-catalog-offer')).toBeNull();
  });

  it('a refused save says why on the row', async () => {
    render(<ProviderCatalogCard fetchImpl={serve([{ id: 'deepseek', name: 'DeepSeek', keyEnv: 'DEEPSEEK_API_KEY' }])} save={async () => 'DEEPSEEK_API_KEY is not set in this environment'} onPick={() => {}} />);
    fireEvent.click(await screen.findByTestId('provider-catalog-use'));
    expect((await screen.findByTestId('provider-catalog-failure')).textContent).toMatch(/is not set/);
  });

  it('search finds any provider; Set up fills the form with its wire, address and a current model', async () => {
    const onPick = vi.fn();
    render(<ProviderCatalogCard fetchImpl={serve([])} save={vi.fn()} onPick={onPick} />);
    fireEvent.change(await screen.findByTestId('provider-catalog-search'), { target: { value: 'gro' } });
    fireEvent.click(await screen.findByTestId('provider-catalog-pick'));
    expect(onPick).toHaveBeenCalledWith({ provider: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-5', name: 'Groq Llama 5', providerName: 'Groq', keyUrl: 'https://console.groq.com/docs' });
    fireEvent.change(screen.getByTestId('provider-catalog-search'), { target: { value: 'zzzz' } });
    expect(screen.getByTestId('provider-catalog-none').textContent).toMatch(/No provider/);
  });

  it('Set up starts on the same everyday model Use does, not the first listed', async () => {
    const anthropic: CatalogProvider = { id: 'anthropic', name: 'Anthropic', wire: 'anthropic', api: 'https://api.anthropic.com', env: ['ANTHROPIC_API_KEY'], models: [{ id: 'claude-haiku-5-5', name: 'Haiku' }, { id: 'claude-sonnet-5-5', name: 'Sonnet' }] };
    const f = (async () => new Response(JSON.stringify({ providers: [anthropic], detected: [] }), { status: 200 })) as typeof fetch;
    const onPick = vi.fn();
    render(<ProviderCatalogCard fetchImpl={f} save={vi.fn()} onPick={onPick} />);
    fireEvent.change(await screen.findByTestId('provider-catalog-search'), { target: { value: 'anth' } });
    fireEvent.click(await screen.findByTestId('provider-catalog-pick'));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-sonnet-5-5', providerName: 'Anthropic' }));
  });

  it('prices read to two places, and the price sits under the menu so a narrow select never cuts it off', async () => {
    const p: CatalogProvider = { id: 'groq', name: 'Groq', wire: 'openai-compatible', api: 'https://api.groq.com/openai/v1', env: ['GROQ_API_KEY'], models: [{ id: 'm', name: 'Llama', context: 131000, cost: [0.8, 4] }] };
    const f = (async () => new Response(JSON.stringify({ providers: [p], detected: [{ id: 'groq', name: 'Groq', keyEnv: 'GROQ_API_KEY' }] }), { status: 200 })) as typeof fetch;
    render(<ProviderCatalogCard fetchImpl={f} save={vi.fn()} onPick={() => {}} />);
    expect((await screen.findByTestId('provider-catalog-price')).textContent).toBe('$0.80 in / $4.00 out per 1M');
    fireEvent.click(screen.getByTestId('provider-catalog-model'));
    expect(screen.getByRole('option').textContent).toBe('Llama, 131K context$0.80 in / $4.00 out per 1M');
  });

  it('no catalog route: nothing is drawn', async () => {
    const f = vi.fn(async () => new Response('{}', { status: 404 })) as unknown as typeof fetch;
    const { container } = render(<ProviderCatalogCard fetchImpl={f} save={vi.fn()} onPick={() => {}} />);
    await waitFor(() => expect(f).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});
