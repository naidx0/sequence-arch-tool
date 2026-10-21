/* ══════════════════════════════════════════════════════════════════════════
   0.1.8.4: WHEN AN AGENT OFFERS SEVERAL SIGN-IN METHODS, ONE IS MARKED RECOMMENDED
   packages/web2/src/settings/recommendedMethod0184.test.tsx

   Owner: "sign-in methods easy to tell apart with the recommended one obvious". One rule for every agent
   (recommendedMethod): among the methods Sequence can run for the person, the one the data flags, else the first the
   agent listed; no label when there is nothing to choose between.
   ══════════════════════════════════════════════════════════════════════════ */

import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import '../tokens/graphite.css';
import './settings.css';

import css from './settings.css?raw';
import { createAgentRunStore } from '../agents/agentRuns';
import { AgentCatalogSection } from './AgentCatalogSection';
import { recommendedMethod, type AuthMethod, type CatalogClient, type CatalogRow } from './agentCatalogClient';

const ROW: CatalogRow = { id: 'gemini', name: 'Gemini CLI', source: 'builtin', state: 'npx', installHint: 'x' };
const okFetch = (async () => new Response(JSON.stringify({ models: [] }), { status: 200 })) as typeof fetch;

const client = (methods: AuthMethod[]): CatalogClient => ({
  list: vi.fn(async () => ({ ok: true as const, body: { agents: [ROW], registryFetchedAt: null } })),
  refresh: vi.fn(async () => ({ ok: true as const, body: { agents: [ROW], registryFetchedAt: 1 } })),
  connect: vi.fn(async () => ({ ok: true as const, body: { via: 'local' } })),
  methods: vi.fn(async () => ({ ok: true as const, body: { methods } })),
  signIn: vi.fn(async (id: string, methodId: string) => ({ ok: true as const, body: { job: { id, methodId, state: 'running' as const } } })),
  job: vi.fn(async () => ({ ok: true as const, body: {} })),
  install: vi.fn(async () => ({ ok: true as const, body: {} })),
  installJob: vi.fn(async () => ({ ok: true as const, body: {} })),
}) as unknown as CatalogClient;

const A = (id: string, extra: Partial<AuthMethod> = {}): AuthMethod => ({ id, name: `Method ${id}`, description: `How ${id} works`, type: 'agent', ...extra });

async function open(methods: AuthMethod[]) {
  render(<AgentCatalogSection client={client(methods)} fetchImpl={okFetch} store={createAgentRunStore()} />);
  fireEvent.click(await screen.findByTestId('agent-catalog-more'));
  fireEvent.click(await screen.findByTestId('agent-catalog-signin'));
  await screen.findAllByTestId('agent-catalog-method');
  return screen.getAllByTestId('agent-catalog-method');
}

describe('recommendedMethod: one rule for every agent', () => {
  it('is the flagged method, else the first the agent listed, and only among the methods Sequence can run', () => {
    expect(recommendedMethod([A('a'), A('b')])).toBe('a');
    expect(recommendedMethod([A('a'), A('b', { recommended: true })])).toBe('b');
    expect(recommendedMethod([{ id: 't', name: 'Terminal', type: 'terminal' }, A('a'), A('b')])).toBe('a');
  });

  it('is nobody when there is nothing to choose between (one runnable method, or none)', () => {
    expect(recommendedMethod([])).toBeNull();
    expect(recommendedMethod([A('a')])).toBeNull();
    expect(recommendedMethod([A('a'), { id: 't', name: 'Terminal', type: 'terminal' }])).toBeNull();
    expect(recommendedMethod([A('a', { recommended: true })])).toBeNull();
  });
});

describe('More agents: the sign-in methods say which one is recommended', () => {
  it('two methods: exactly one visible Recommended label, on the first, in the badge style, with a line that says what it means', async () => {
    const buttons = await open([A('oauth'), A('apikey')]);
    expect(buttons).toHaveLength(2);
    const labels = screen.getAllByTestId('agent-catalog-method-recommended');
    expect(labels).toHaveLength(1);
    expect(labels[0]!.textContent).toBe('Recommended');
    expect(labels[0]!.className).toContain('sb-badge');
    expect(buttons[0]!.contains(labels[0]!)).toBe(true);
    expect(buttons[0]!.getAttribute('data-recommended')).toBe('true');
    expect(within(buttons[1]!).queryByTestId('agent-catalog-method-recommended')).toBeNull();
    expect(screen.getByTestId('agent-catalog-methods-lead').textContent).toContain('recommended');
  });

  it('a flagged second method is the one marked', async () => {
    const buttons = await open([A('oauth'), A('apikey', { recommended: true })]);
    expect(within(buttons[1]!).getByTestId('agent-catalog-method-recommended')).toBeTruthy();
    expect(within(buttons[0]!).queryByTestId('agent-catalog-method-recommended')).toBeNull();
  });

  it('one method: no label and no lead line', async () => {
    await open([A('oauth')]);
    expect(screen.queryByTestId('agent-catalog-method-recommended')).toBeNull();
    expect(screen.queryByTestId('agent-catalog-methods-lead')).toBeNull();
  });
});

describe('a method button is not an oval, and a tall row keeps its mark at the top (CSS)', () => {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (sel: string) => [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1]!.trim().replace(/\s+/g, ' ') === sel).map((m) => m[2]).join(';');
  it('uses the card radius, not the full pill radius of one-line buttons', () => {
    expect(rule('.settings-scope .sb-agent-method')).toMatch(/border-radius:\s*var\(--r-14\)/);
  });
  it('puts the mark at the top of a row that holds a method list or a sign-in panel', () => {
    expect(rule('.settings-scope :is(.sb-agent, .sb-catalog-row):has(.sb-agent-methods, .sb-agent-term) > :first-child')).toMatch(/align-self:\s*start/);
  });
});
