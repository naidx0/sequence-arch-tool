/**
 * Round 13 (O3): a saved model is never called "daily", "cheap" or "local".
 * The role words are dropped from a profile name; an empty name is the model id.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { plainProfileName, redactAiConfig, validateAiConfig } from '../server/provider.js';

test('only the old default names are renamed', () => {
  assert.equal(plainProfileName('Sonnet daily', 'claude-sonnet-4-5'), 'Sonnet');
  assert.equal(plainProfileName('Sonnet, daily', 'm'), 'Sonnet');
  assert.equal(plainProfileName('Claude Sonnet cheap', 'm'), 'Claude Sonnet');
  assert.equal(plainProfileName('Local, cheap', 'granite4'), 'granite4');
  assert.equal(plainProfileName('local', 'llama3'), 'llama3');
  assert.equal(plainProfileName('Daily', 'm'), 'm');
  assert.equal(plainProfileName('Claude Sonnet', 'm'), 'Claude Sonnet');
});

test('names people chose are never touched', () => {
  for (const name of ['Daily Driver', 'Local Llama 3', 'My local box', 'Work (daily)', 'Cheap & cheerful', 'llama-local']) {
    assert.equal(plainProfileName(name, 'm'), name);
  }
  assert.equal(plainProfileName('llama-local', 'llama-local'), 'llama-local');
});

const base = {
  profiles: [
    { id: 'a', name: 'Sonnet daily', provider: 'anthropic', model: 'claude-sonnet-4-5', apiKey: 'sk-ant-x' },
    { id: 'b', name: 'Local, cheap', provider: 'openai-compatible', model: 'granite4', baseUrl: 'http://127.0.0.1:11434/v1' },
  ],
  defaultProfileId: 'a',
};

test('saving a config plain-names its profiles', () => {
  const v = validateAiConfig(base);
  assert.ok(v.config, v.error);
  assert.deepEqual(v.config!.profiles!.map((p) => p.name), ['Sonnet', 'granite4']);
});

test('a config written earlier reads back plain', () => {
  const cfg = { provider: 'anthropic', model: 'claude-sonnet-4-5', apiKey: 'sk-ant-x', profiles: base.profiles, defaultProfileId: 'a' };
  const view = redactAiConfig(cfg as never) as { profiles?: { name: string }[] };
  assert.deepEqual(view.profiles!.map((p) => p.name), ['Sonnet', 'granite4']);
});
