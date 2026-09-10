import { describe, expect, it } from 'vitest';

import { UNCONFIGURED, modelFromConfig, modelLabel } from './modelSelection';

/**
 * WHICH MODEL IS ACTUALLY ANSWERING.
 *
 * The composer draws the model name under the field and it was always empty:
 * `ComposerSlice.model` starts as `EMPTY_MODEL` and the `composer/model`
 * action that would replace it has a reducer arm and is dispatched by nobody.
 * A reader with a key configured saw a blank where the answer's author is.
 */

describe('reading the configured model', () => {
  it('reads the funded default gateway', () => {
    expect(modelFromConfig({ configured: true, mode: 'default', model: 'claude-sonnet-4-5' })).toEqual({
      model: 'claude-sonnet-4-5',
      origin: 'default',
    });
  });

  it('reads an api-key configuration', () => {
    expect(
      modelFromConfig({ configured: true, provider: 'anthropic', model: 'claude-opus-4', apiKey: '••••1234' }),
    ).toEqual({ model: 'claude-opus-4', origin: 'api-key' });
  });

  it('reads a keyless OpenAI-compatible configuration as local, not api-key', () => {
    expect(modelFromConfig({
      configured: true,
      provider: 'openai-compatible',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'granite4-hermes:latest',
    })).toEqual({ model: 'granite4-hermes:latest', origin: 'local' });
  });

  it('an unconfigured server is unconfigured', () => {
    expect(modelFromConfig({ configured: false })).toEqual(UNCONFIGURED);
  });

  it('ANYTHING UNRECOGNISED IS UNCONFIGURED, never a guessed name', () => {
    /*
     * The name is a claim about who will answer the next question, and a wrong
     * one is worse than a blank — a reader would believe their expensive model
     * was answering when it was not.
     */
    for (const bad of [null, undefined, 'text', 42, {}, { configured: true }, { configured: true, model: '  ' }]) {
      expect(modelFromConfig(bad)).toEqual(UNCONFIGURED);
    }
  });

  it('never carries the key, even when the response does', () => {
    /* Non-negotiable: never leak a user key. The response holds a mask; the
       selection has no field for it and must not grow one. */
    const selection = modelFromConfig({
      configured: true,
      provider: 'openai',
      model: 'gpt-4o',
      apiKey: '••••9999',
    }) as unknown as Record<string, unknown>;
    expect(selection.apiKey).toBeUndefined();
    expect(Object.keys(selection).sort()).toEqual(['model', 'origin']);
  });
});

describe('what the composer says', () => {
  it('names the model when there is one', () => {
    expect(modelLabel({ model: 'claude-opus-4', origin: 'api-key' })).toBe('claude-opus-4');
  });

  it('NAMES THE NEXT ACTION when there is not', () => {
    /*
     * "No model" tells a reader something is wrong and leaves them looking for
     * the place to fix it. This says where.
     */
    /* THE INTENT, NOT THE INCIDENTAL WORD. This matched /reasoning/i, which was
       a fact about the old phrasing rather than about naming an action — and it
       would have passed on a sentence too long to render. The label is now
       "Connect a model": it names a verb and an object, and it is short enough
       to survive the squeeze `.modelsel` deliberately puts on it. */
    expect(modelLabel(UNCONFIGURED)).toBe('Connect a model');
    expect(modelLabel(UNCONFIGURED)).toMatch(/^connect/i);
  });

  it('treats a configured-but-blank model as unconfigured', () => {
    expect(modelLabel({ model: '', origin: 'api-key' })).toBe('Connect a model');
  });
});
