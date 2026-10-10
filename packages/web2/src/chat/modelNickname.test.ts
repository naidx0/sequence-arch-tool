import { describe, expect, it } from 'vitest';

import { displayModelName, modelNickname } from './modelNickname';

describe('modelNickname', () => {
  it.each([
    ['claude-sonnet-5-5', 'Sonnet 5.5'],
    ['claude-sonnet-5.5', 'Sonnet 5.5'],
    ['anthropic/claude-sonnet-5-5[1m]', 'Sonnet 5.5'],
    ['claude-opus-5-5', 'Opus 5.5'],
    ['claude-haiku-5-5', 'Haiku 5.5'],
    ['claude-fable-5-1', 'Fable 5.1'],
    ['claude-sonnet-4-20250929', 'Sonnet 4'],
    ['claude-3-5-sonnet-20241022', 'Sonnet 3.5'],
    ['gpt-5.1-codex', 'GPT-5.1 Codex'],
    ['gpt-5-codex-mini', 'GPT-5 Codex Mini'],
    ['gpt-4o', 'GPT-4o'],
    ['o3', 'o3'],
    ['o4-mini', 'o4 Mini'],
    ['minicpm5:latest', 'MiniCPM 5'],
    ['qwen2.5-coder:7b', 'Qwen 2.5 Coder'],
    ['hf.co/prism-ml/bonsai-27b-gguf', 'bonsai'],
    ['my-custom-model-20250929', 'my-custom-model'],
    ['Acme_Proto-7', 'Acme_Proto-7'],
    ['qwen2.5-coder:32b-instruct-q4_K_M', 'Qwen 2.5 Coder'],
    ['llama3.1:8b-instruct-q8_0', 'Llama 3.1'],
    ['mistral:7b-instruct-fp16', 'Mistral'],
    ['my-model:q4_K_M', 'my-model'],
    ['gpt-oss:20b', 'GPT-OSS'],
    ['gpt-oss:120b', 'GPT-OSS'],
    ['openai/gpt-oss-20b', 'GPT-OSS'],
    ['us.anthropic.claude-sonnet-5-5-v1:0', 'Sonnet 5.5'],
    ['anthropic.claude-opus-5-5', 'Opus 5.5'],
    ['eu.anthropic.claude-haiku-5-5-20260101-v1:0', 'Haiku 5.5'],
    ['claude-sonnet-5-5@20260101', 'Sonnet 5.5'],
    ['gemma3:27b-it-qat', 'Gemma 3'],
    ['bartowski/Qwen2.5-7B-Instruct-GGUF', 'Qwen 2.5'],
    ['openai/gpt-oss-120b:free', 'GPT-OSS'],
    ['mistral-large-latest', 'Mistral Large'],
    ['qwen3:30b-a3b', 'Qwen 3'],
    ['grok-4', 'Grok 4'],
    ['gemini-2.5-pro', 'Gemini 2.5 Pro'],
    ['deepseek-v4-flash', 'DeepSeek V4 Flash'],
    ['deepseek-ai/DeepSeek-V4-Flash', 'DeepSeek V4 Flash'],
    ['DeepSeek V4 Flash', 'DeepSeek V4 Flash'],
    ['deepseek-r1:70b', 'DeepSeek R1'],
    ['Qwen/Qwen2.5-Coder-32B-Instruct', 'Qwen 2.5 Coder'],
    ['Qwen3-30B-A3B-Instruct-2507', 'Qwen 3'],
    ['meta-llama/Llama-3.3-70B-Instruct', 'Llama 3.3'],
    ['llama-3.1-405b-instruct:latest', 'Llama 3.1'],
    ['openbmb/MiniCPM-5-8B', 'MiniCPM 5'],
    ['mistral-small-3.1-24b-instruct-2503', 'Mistral Small 3.1'],
    ['mixtral-8x7b-instruct', 'Mixtral'],
    ['gemma-3-27b-it', 'Gemma 3'],
    ['phi4:14b', 'Phi 4'],
    ['granite3.3:8b', 'Granite 3.3'],
    ['glm-4.5-air', 'GLM 4.5 Air'],
    ['mistral-large-latest', 'Mistral Large'],
    ['', ''],
  ])('%s -> %s', (raw, want) => {
    expect(modelNickname(raw)).toBe(want);
  });
});

describe('displayModelName', () => {
  it('a user nickname wins over the auto one', () => {
    expect(displayModelName('claude-sonnet-5-5', 'Daily driver')).toBe('Daily driver');
  });
  it('a nickname equal to the raw id is not a choice', () => {
    expect(displayModelName('claude-sonnet-5-5', 'claude-sonnet-5-5')).toBe('Sonnet 5.5');
  });
  it('falls back to the raw text when nothing can be said', () => {
    expect(displayModelName('???', null)).toBe('???');
  });
});
