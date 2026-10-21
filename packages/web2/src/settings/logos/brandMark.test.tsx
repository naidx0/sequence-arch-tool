import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createAgentRunStore } from '../../agents/agentRuns';
import { AgentCatalogSection } from '../AgentCatalogSection';
import type { CatalogClient, CatalogRow } from '../agentCatalogClient';
import { ProviderCatalogCard, type CatalogProvider } from '../ProviderCatalogCard';
import { agentMark } from './agentMark';
import { AGENT_MARKS } from './agentMarks';
import { LOBE_MARKS } from './lobeMarks';
import { BrandMark } from './BrandMark';
import { providerMark } from './providerMark';
import { PROVIDER_MARKS } from './providerMarks';

const ALL = [...Object.entries(AGENT_MARKS), ...Object.entries(PROVIDER_MARKS)];

describe('vendor marks (agents from the ACP registry, providers from models.dev)', () => {
  it('there are marks for the agents and most providers, and they are packaged data', () => {
    expect(Object.keys(AGENT_MARKS).length).toBeGreaterThanOrEqual(13);
    expect(Object.keys(PROVIDER_MARKS).length).toBeGreaterThanOrEqual(120);
  });

  it('every mark is sanitised: shapes only, no script, handler, link, style or literal colour', () => {
    for (const [id, [viewBox, shapes]] of ALL) {
      expect(viewBox, id).toMatch(/^[-\d. ]+$/);
      const tags = [...shapes.matchAll(/<\/?([a-zA-Z]+)/g)].map((m) => m[1]!.toLowerCase());
      expect(tags.length, id).toBeGreaterThan(0);
      for (const t of tags) expect(['path', 'circle', 'ellipse', 'rect', 'polygon', 'polyline', 'line', 'g'], `${id} <${t}>`).toContain(t);
      expect(shapes, id).not.toMatch(/\son[a-z]+=|href|url\(|<script|<style|javascript:|#[0-9a-fA-F]{3,8}\b|rgb\(/i);
      for (const [, v] of shapes.matchAll(/\s(?:fill|stroke)="([^"]*)"/g)) expect(['currentColor', 'none'], id).toContain(v);
    }
  });

  it('the generator and the page never fetch a logo at run time', () => {
    for (const f of ['BrandMark.tsx', 'agentMark.ts', 'providerMark.ts']) expect(readFileSync(join(process.cwd(), 'src/settings/logos', f), 'utf8'), f).not.toMatch(/fetch\(|https?:\/\/[^\s'"`)]*\.svg/);
  });

  it('the lobehub marks are sanitised the same way and their source is recorded', () => {
    expect(Object.keys(LOBE_MARKS)).toContain('hermes');
    for (const [id, [viewBox, shapes]] of Object.entries(LOBE_MARKS)) {
      expect(viewBox, id).toMatch(/^[-\d. ]+$/);
      expect(shapes, id).not.toMatch(/\son[a-z]+=|href|url\(|<script|<style|javascript:|#[0-9a-fA-F]{3,8}\b|rgb\(/i);
    }
    const md = readFileSync(join(process.cwd(), 'src/settings/logos/SOURCES.md'), 'utf8');
    expect(md).toContain('- hermes (Nous Research): https://unpkg.com/@lobehub/icons-static-svg@1.95.1/icons/nousresearch.svg');
    expect(readFileSync(join(process.cwd(), 'src/shell2/brand/SOURCE.txt'), 'utf8')).toContain('icons/nousresearch.svg');
  });

  it('SOURCES.md names the source URL of every packaged mark', () => {
    const md = readFileSync(join(process.cwd(), 'src/settings/logos/SOURCES.md'), 'utf8');
    for (const id of Object.keys(AGENT_MARKS)) expect(md, id).toContain(`- ${id}: https://cdn.agentclientprotocol.com/registry/v1/latest/${id}.svg`);
    for (const id of Object.keys(PROVIDER_MARKS)) expect(md, id).toContain(`- ${id}: https://models.dev/logos/${id}.svg`);
  });

  it('a vendor with a mark draws it, one without gets its initial in the same tile', () => {
    const { container, rerender } = render(<BrandMark mark={agentMark('gemini')} name="Gemini CLI" />);
    expect(container.querySelector('[data-mark="logo"] svg')?.getAttribute('fill')).toBe('currentColor');
    rerender(<BrandMark mark={providerMark('no-such-provider')} name="zed Corp" />);
    expect(container.querySelector('[data-mark="monogram"]')?.textContent).toBe('Z');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('memory ids that name an ACP agent find its mark', () => {
    for (const id of ['claude', 'codex', 'qwen', 'copilot', 'amp', 'gemini', 'opencode', 'auggie', 'cline', 'hermes', 'hermes-agent', 'cursor-agent', 'gemini-cli']) expect(agentMark(id), id).toBeDefined();
  });
});

const ROWS: CatalogRow[] = [
  { id: 'gemini', name: 'Gemini CLI', source: 'builtin', state: 'npx', shown: 'x', installHint: 'x' },
  { id: 'hermes', name: 'Hermes Agent', source: 'builtin', state: 'ready', shown: 'hermes acp', installHint: 'x' },
];
const noop = async () => ({ ok: true as const, body: {} as never });

describe('the settings lists carry the marks', () => {
  it('More agents: a logo for every agent with one, Hermes included, an initial for one without', async () => {
    const c = { list: vi.fn(async () => ({ ok: true as const, body: { agents: ROWS, registryFetchedAt: null } })), refresh: noop, connect: noop, methods: noop, signIn: noop, job: noop, install: noop, installJob: noop } as unknown as CatalogClient;
    render(<AgentCatalogSection client={c} store={createAgentRunStore()} />);
    const rows = await screen.findAllByTestId('agent-catalog-row');
    const mark = (r: HTMLElement) => r.querySelector('[data-mark]')?.getAttribute('data-mark');
    expect(rows.map(mark)).toEqual(['logo', 'logo']);
    expect(within(rows[0]!).queryByText('H')).toBeNull();
  });

  it('Models: a searched provider shows its logo, an unknown one its initial', async () => {
    const PROVIDERS: CatalogProvider[] = [
      { id: 'groq', name: 'Groq', wire: 'openai-compatible', api: 'https://api.groq.com/openai/v1', env: ['GROQ_API_KEY'], models: [{ id: 'm', name: 'M' }] },
      { id: 'groq-lookalike', name: 'Groq Lookalike', wire: 'openai-compatible', api: 'https://x.example/v1', env: ['X'], models: [{ id: 'm', name: 'M' }] },
    ];
    const f = (async () => new Response(JSON.stringify({ providers: PROVIDERS, detected: [] }), { status: 200 })) as typeof fetch;
    render(<ProviderCatalogCard fetchImpl={f} save={async () => null} onPick={() => {}} />);
    fireEvent.change(await screen.findByTestId('provider-catalog-search'), { target: { value: 'groq' } });
    const hits = await screen.findAllByTestId('provider-catalog-hit');
    expect(hits.map((h) => h.querySelector('[data-mark]')?.getAttribute('data-mark'))).toEqual(['logo', 'monogram']);
  });
});
