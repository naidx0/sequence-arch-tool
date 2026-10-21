import { afterEach, describe, expect, it } from 'vitest';

import { agentRuns } from '../agents/agentRuns';
import { createStore } from './store';
import { applyContextWindowFromConfig, bumpModelGen, currentModelGen, syncComposerModelFromConfig } from './connect';

const cfg = (model: string, extra: Record<string, unknown> = {}) => ({ configured: true, provider: 'openai-compatible', model, ...extra });

afterEach(() => agentRuns.patch((s) => ({ ...s, agents: {} })));

describe('syncComposerModelFromConfig, the server\'s active model is the composer\'s', () => {
  it('follows a different top-level model, with its origin', () => {
    const store = createStore({});
    store.dispatch({ type: 'composer/model', model: { model: 'a', origin: 'api-key' } });
    syncComposerModelFromConfig(store, cfg('b'));
    expect(store.getState().composer.model).toEqual({ model: 'b', origin: 'local' });
    syncComposerModelFromConfig(store, { configured: true, mode: 'default', model: 'deepseek-v4-flash' });
    expect(store.getState().composer.model).toEqual({ model: 'deepseek-v4-flash', origin: 'default' });
  });
  it('does nothing for an unconfigured or malformed answer', () => {
    const store = createStore({});
    store.dispatch({ type: 'composer/model', model: { model: 'a', origin: 'api-key' } });
    syncComposerModelFromConfig(store, { configured: false });
    syncComposerModelFromConfig(store, null);
    expect(store.getState().composer.model.model).toBe('a');
  });
  it('follows in an agent chat too, so a Sequence chat is never left stale', () => {
    const store = createStore({});
    const id = store.getState().session.activeId ?? '';
    store.dispatch({ type: 'composer/model', model: { model: 'a', origin: 'api-key' } });
    agentRuns.patch((s) => ({ ...s, agents: { ...s.agents, [id]: 'codex' } }));
    syncComposerModelFromConfig(store, cfg('b'));
    expect(store.getState().composer.model.model).toBe('b');
  });
  it('a body whose request started before a local switch is dropped', () => {
    const store = createStore({});
    store.dispatch({ type: 'composer/model', model: { model: 'a', origin: 'api-key' } });
    const started = currentModelGen();
    bumpModelGen();
    syncComposerModelFromConfig(store, cfg('old'), started);
    expect(store.getState().composer.model.model).toBe('a');
    syncComposerModelFromConfig(store, cfg('new'), currentModelGen());
    expect(store.getState().composer.model.model).toBe('new');
  });
  it('applyContextWindowFromConfig applies the new model\'s window with the sync, and skips a stale body whole', () => {
    const store = createStore({});
    const started = currentModelGen();
    bumpModelGen();
    applyContextWindowFromConfig(store, { ...cfg('x'), contextWindow: 12345 }, undefined, started);
    expect(store.getState().composer.model.model).toBe('');
    applyContextWindowFromConfig(store, { ...cfg('x'), contextWindow: 12345 }, undefined, currentModelGen());
    expect(store.getState().composer.model.model).toBe('x');
    expect(store.getState().composer.contextWindow).toBe(12345);
  });
});
