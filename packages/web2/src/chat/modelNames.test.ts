/* ══════════════════════════════════════════════════════════════════════════
   packages/web2/src/chat/modelNames.test.ts

   The defect this locks is the owner's, reported against ml-harness with nine
   models connected: seven rows, six of them reading `Ollama`. A default name
   taken from the ENDPOINT is the same string for every local model, so the list
   that exists to tell models apart told them apart by nothing.
   ══════════════════════════════════════════════════════════════════════════ */

import { describe, expect, it } from 'vitest';

import { defaultNickname } from './modelNames';

describe('defaultNickname', () => {
  it('drops :latest, because every row carries it', () => {
    expect(defaultNickname('granite4-hermes:latest')).toBe('granite4-hermes');
    expect(defaultNickname('QWEN3:LATEST')).toBe('QWEN3');
  });

  it('KEEPS a tag that is not :latest — that one is doing the distinguishing', () => {
    expect(defaultNickname('qwen2.5-coder:32b-instruct-q4_K_M')).toBe(
      'qwen2.5-coder:32b-instruct-q4_K_M',
    );
  });

  it('a namespaced id keeps only its last segment', () => {
    expect(defaultNickname('hf.co/prism-ml/Bonsai-27B-gguf')).toBe('Bonsai-27B-gguf');
    expect(defaultNickname('hf.co/unsloth/gpt-oss-20b-GGUF:latest')).toBe('gpt-oss-20b-GGUF');
    /* A trailing separator is not a segment. */
    expect(defaultNickname('hf.co/prism-ml/Bonsai-27B-gguf/')).toBe('Bonsai-27B-gguf');
  });

  it('two local models never collapse to the same label', () => {
    const rows = ['granite4-hermes:latest', 'hf.co/prism-ml/Bonsai-27B-gguf', 'qwen3:8b'];
    const names = rows.map((m) => defaultNickname(m));
    expect(new Set(names).size).toBe(rows.length);
  });

  it('an empty id falls back rather than drawing a row with nothing on it', () => {
    /* A BLANK LABEL IS WORSE THAN A REPEATED ONE: it is a row in the picker
       with no way to tell what activating it would do. */
    expect(defaultNickname('')).toBe('local model');
    expect(defaultNickname('   ')).toBe('local model');
    expect(defaultNickname(':latest')).toBe(':latest');
    expect(defaultNickname('', 'anthropic')).toBe('anthropic');
    expect(defaultNickname(undefined)).toBe('local model');
  });
});
