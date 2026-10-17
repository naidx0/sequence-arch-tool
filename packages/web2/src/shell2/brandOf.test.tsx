import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { chatBrandFor, chatIconFor } from '../chat/chatIcon';
import { ProviderIcon, brandOf, modelGroupOf } from './brandIcons';

/* One logo lookup for every surface: real marks for Cursor, Gemini, Hermes and OpenRouter;
   the agents icon (`sequence`) only for Sequence's own agent. */

const drawn = (key: string) => {
  const { container } = render(<ProviderIcon provider={key} />);
  return container.querySelector('[data-brand]');
};

describe('brandOf', () => {
  it.each([
    ['cursor', 'agent:cursor'],
    ['cursor-agent', 'agent:cursor'],
    ['Cursor', 'agent:cursor'],
    ['gemini', 'agent:gemini'],
    ['gemini-cli', 'agent:gemini'],
    ['gemini-2.5-pro', 'agent:gemini'],
    ['hermes', 'agent:hermes'],
    ['Hermes Agent', 'agent:hermes'],
    ['qwen', 'agent:qwen-code'],
    ['copilot', 'agent:github-copilot-cli'],
    ['goose', 'agent:goose'],
    ['opencode', 'agent:opencode'],
    ['openrouter', 'prov:openrouter'],
    ['nebius', 'prov:nebius'],
    ['groq', 'prov:groq'],
    ['deepseek-v4-flash', 'prov:deepseek'],
    ['mistral', 'prov:mistral'],
    ['claude', 'claude'],
    ['claude-acp', 'claude'],
    ['codex', 'codex'],
    ['sequence', 'sequence'],
  ])('%s -> %s', (name, key) => {
    expect(brandOf(name)).toBe(key);
  });

  it('a name with no vendor mark is none, never Sequence', () => {
    expect(brandOf('some-unknown-agent')).toBe('other');
    expect(brandOf(null, undefined, '')).toBe('other');
  });

  it('the agents icon is only for sequence', () => {
    const all = ['cursor', 'gemini', 'hermes', 'openrouter', 'qwen', 'goose', 'groq', 'nebius', 'unknown-thing'];
    for (const n of all) expect(brandOf(n), n).not.toBe('sequence');
    expect(brandOf('sequence')).toBe('sequence');
  });

  it('draws a real mark (shapes in currentColor) for Cursor, Gemini, Hermes and OpenRouter', () => {
    for (const n of ['cursor', 'gemini', 'hermes', 'openrouter']) {
      const el = drawn(brandOf(n))!;
      expect(el, n).not.toBeNull();
      expect(el.getAttribute('data-mark'), n).toBe('logo');
      expect(['currentColor', 'none'], n).toContain(el.getAttribute('fill'));
      expect(el.innerHTML, n).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
      expect(el.querySelectorAll('path,circle,rect,polygon,ellipse,g').length, n).toBeGreaterThan(0);
    }
    expect(drawn('other')).toBeNull();
  });

  it('a hosted model group wears its vendor mark', () => {
    expect(modelGroupOf({ provider: 'openai-compatible', model: 'x', baseUrl: 'https://openrouter.ai/api/v1', keyed: true }).icon).toBe('prov:openrouter');
    expect(modelGroupOf({ provider: 'openai-compatible', model: 'x', baseUrl: 'https://api.groq.com/openai/v1', keyed: true }).icon).toBe('prov:groq');
    expect(modelGroupOf({ provider: 'openai-compatible', model: 'x', baseUrl: 'https://example.invalid/v1', keyed: true }).icon).toBe('other');
  });

  it('a chat on Cursor wears the Cursor mark', () => {
    const entry = { id: 's1', title: '', createdAt: '', updatedAt: '' } as never;
    expect(chatBrandFor(entry, { agents: { s1: 'cursor' } })).toBe('agent:cursor');
    const { container } = render(<>{chatIconFor(entry, { agents: { s1: 'cursor' } })}</>);
    expect(container.querySelector('[data-testid="chat-icon"] [data-brand="cursor"]')).not.toBeNull();
  });
});
