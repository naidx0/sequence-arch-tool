import { describe, expect, it } from 'vitest';

import { createStore } from '../state';
import { acpReadinessActions, acpReadinessNote, type AcpReadiness } from './acpReadiness';

describe('acpReadinessNote', () => {
  it('is silent while the probe has not answered', () => {
    expect(acpReadinessNote({ kind: 'unknown' })).toBeNull();
  });

  it('quotes the engine reason when ACP is unavailable', () => {
    const r: AcpReadiness = { kind: 'unavailable', reason: 'ACP is not available' };
    expect(acpReadinessNote(r)).toBe('ACP is not available');
  });

  it('says no agent is connected without telling the reader to type a command', () => {
    const note = acpReadinessNote({ kind: 'no-agents' });
    expect(note).toMatch(/No agent is connected yet/i);
    expect(note).not.toMatch(/sequence agent|`|--command|<id>/);
  });

  it('offers two clicks: open the agents list, or draft the setup into the chat', () => {
    const app = createStore({});
    app.dispatch({ type: 'composer/model', model: { model: 'm', origin: 'api-key' } });
    const acts = acpReadinessActions({ kind: 'no-agents' }, app);
    expect(acts.map((a) => a.label)).toEqual(['Connect an agent', 'Set up in chat']);
    acts[0]!.onClick();
    expect(app.getState().shell.overlay).toEqual({ kind: 'settings', pane: 'agents' });
    acts[1]!.onClick();
    expect(app.getState().composer.draft).toMatch(/connect a coding agent to Sequence/);
    expect(app.getState().shell.overlay).toBeNull();
  });

  it('with no model either, nothing can answer a draft: Copy setup prompt and Connect a model instead of Set up in chat', () => {
    const app = createStore({});
    const acts = acpReadinessActions({ kind: 'no-agents' }, app);
    expect(acts.map((a) => a.label)).toEqual(['Connect an agent', 'Copy setup prompt', 'Connect a model']);
    expect(acts[1]!.copyText).toMatch(/connect a coding agent to Sequence/);
    acts[2]!.onClick();
    expect(app.getState().shell.overlay).toEqual({ kind: 'settings', pane: 'models' });
    expect(app.getState().composer.draft ?? '').toBe('');
  });

  it('offers nothing when agents exist, the probe is pending, or there is no store', () => {
    const app = createStore({});
    expect(acpReadinessActions({ kind: 'ready', count: 1 }, app)).toEqual([]);
    expect(acpReadinessActions({ kind: 'unknown' }, app)).toEqual([]);
    expect(acpReadinessActions({ kind: 'unavailable', reason: 'x' }, app)).toEqual([]);
    expect(acpReadinessActions({ kind: 'no-agents' }, null)).toEqual([]);
  });

  it('does not invent a green ready strip when agents exist', () => {
    expect(acpReadinessNote({ kind: 'ready', count: 2 })).toBeNull();
  });
});
