import { describe, expect, it } from 'vitest';
import { slashCommands, slashGroupOf } from '../chat/composerModel';
import {
  answerComponentOffer,
  componentOfferFromEvent,
  componentUsedFromEvent,
  componentsBody,
  fetchComponents,
  parseComponentsCommand,
  putComponentsSettings,
  setComponentInWorkspace,
} from './componentsClient';

const ok = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });

describe('/components in the slash registry', () => {
  it('is offered once, typeable, under Commands, with its args in the hint', () => {
    const all = slashCommands([], undefined, { components: true });
    const c = all.filter((x) => x.name === 'components');
    expect(c).toHaveLength(1);
    expect(c[0]!.source.kind).toBe('components');
    expect(slashGroupOf(c[0]!.source)).toBe('commands');
    for (const arg of ['list', 'on', 'off', 'auto', 'approve', 'manual', '<id>']) expect(c[0]!.hint).toContain(arg);
  });
});

describe('parseComponentsCommand', () => {
  it('reads every arg, and an id otherwise', () => {
    expect(parseComponentsCommand('')).toEqual({ kind: 'list' });
    expect(parseComponentsCommand('list')).toEqual({ kind: 'list' });
    expect(parseComponentsCommand('ON')).toEqual({ kind: 'enabled', enabled: true });
    expect(parseComponentsCommand('off')).toEqual({ kind: 'enabled', enabled: false });
    for (const m of ['auto', 'approve', 'manual'] as const) expect(parseComponentsCommand(m)).toEqual({ kind: 'mode', mode: m });
    expect(parseComponentsCommand(' security/reverse-engineer-anything ')).toEqual({ kind: 'load', id: 'security/reverse-engineer-anything' });
  });
  it('carries picked ids in the run body, and nothing when none', () => {
    expect(componentsBody(['a/b'])).toEqual({ components: ['a/b'] });
    expect(componentsBody([])).toEqual({});
  });
});

describe('component:offer / component:used', () => {
  const ev = { type: 'component:offer', turnId: 't1', offerId: 'o1', componentId: 'design/charts', name: 'Charts', reason: 'matched "bar chart"' };
  it('becomes a DecisionCard model with Use it / Not now', () => {
    const o = componentOfferFromEvent(ev)!;
    expect(o.offerId).toBe('o1');
    expect(o.decision.kind).toBe('options');
    expect(o.decision.questions[0]!.options.map((x) => [x.label, x.send])).toEqual([['Use it', 'accept:o1'], ['Not now', 'decline:o1']]);
    expect(o.decision.questions[0]!.options[0]!.detail).toBe('matched "bar chart"');
  });
  it('ignores other and malformed events', () => {
    expect(componentOfferFromEvent({ type: 'acp:update' })).toBeNull();
    expect(componentOfferFromEvent({ ...ev, offerId: '' })).toBeNull();
    expect(componentOfferFromEvent(null)).toBeNull();
    expect(componentUsedFromEvent({ type: 'component:used', turnId: 't', componentId: 'a/b', name: 'Charts' })!.line).toBe('Used the Charts component');
    expect(componentUsedFromEvent({ type: 'component:offer' })).toBeNull();
  });
});

describe('fetch helpers', () => {
  it('hit the contract routes', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const f = async (u: string, i?: RequestInit): Promise<Response> => {
      calls.push([u, i]);
      return ok({ enabled: true, mode: 'approve', groups: [] });
    };
    await fetchComponents(f);
    await putComponentsSettings({ mode: 'auto' }, f);
    await setComponentInWorkspace('design/charts', true, f);
    await answerComponentOffer('o 1', true, f);
    expect(calls.map(([u, i]) => `${i?.method ?? 'GET'} ${u}`)).toEqual([
      'GET /api/components',
      'PUT /api/components/settings',
      'POST /api/components/design/charts/workspace',
      'POST /api/components/offer/o%201',
    ]);
    expect(JSON.parse(calls[3]![1]!.body as string)).toEqual({ accept: true });
  });
  it('turns a refused answer into an error with the server words', async () => {
    await expect(putComponentsSettings({ mode: 'auto' }, async () => new Response('{"error":"nope"}', { status: 400 }))).rejects.toThrow('nope');
  });
});
