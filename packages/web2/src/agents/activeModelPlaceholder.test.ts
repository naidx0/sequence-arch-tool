import { describe, expect, it } from 'vitest';

import { activeAgentModel, modelNamedByDescription } from './activeModel';

const caps = (models: { id: string; name: string; description?: string; isDefault?: boolean }[]) => ({
  runs: [],
  caps: { x: { models: models.map((m) => ({ efforts: [], ...m })), efforts: [], commands: [], skills: [] } },
  config: {},
});

describe('activeAgentModel resolves placeholder "default" entries to a real model name', () => {
  it('Claude Code: id `default` is named by its description', () => {
    const st = { ...caps([{ id: 'default', name: 'Default (recommended)', description: 'Opus 4.5 - Most capable for complex work', isDefault: true }]), config: { x: { model: 'default' } } };
    expect(activeAgentModel(st as never, 'x', null)).toMatchObject({ label: 'Opus 4.5', source: 'chosen' });
  });
  it('a bare description ("Opus") is the name', () => {
    expect(modelNamedByDescription({ description: 'Opus' })).toBe('Opus');
  });
  it('Codex: the isDefault entry from model/list is its own name', () => {
    const st = caps([{ id: 'gpt-5.5', name: 'GPT-5.5', isDefault: true }, { id: 'b', name: 'B' }]);
    expect(activeAgentModel(st as never, 'x', null)).toMatchObject({ id: 'gpt-5.5', label: 'GPT-5.5', source: 'default' });
  });
  it('a placeholder with no usable description keeps its name (the bar words it neutrally); nothing known is "<Agent> default"', () => {
    const st = caps([{ id: 'default', name: 'Default (recommended)', isDefault: true }]);
    expect(activeAgentModel(st as never, 'x', null).source).toBe('default');
    expect(activeAgentModel({ runs: [] } as never, 'x', null)).toEqual({ id: null, label: 'X default', source: 'unknown' });
  });
  it('control: a normal chosen model is untouched', () => {
    const st = { ...caps([{ id: 'm1', name: 'Sonnet 5', description: 'Fast' }]), config: { x: { model: 'm1' } } };
    expect(activeAgentModel(st as never, 'x', null).label).toBe('Sonnet 5');
  });
});
