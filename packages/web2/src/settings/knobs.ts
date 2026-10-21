import { AI_PARAM_BOUNDS } from '@sequence/api-types';

import type { PresetId } from './providerPresets';

/*
 * THE KNOBS, AND THE NUMBERS THE SERVER WILL ACTUALLY ACCEPT.
 *
 * APP-12 (contract change): the bounds are `AI_PARAM_BOUNDS` in @sequence/api-types, the one table
 * the server also refuses with (it imports the same object and stays the authority). The pane now
 * checks them on blur and says so under the box, instead of sending whatever was typed and waiting
 * for a 400. Nothing is clamped: an out-of-range value is an error the reader fixes.
 */
export type KnobKey = keyof typeof AI_PARAM_BOUNDS;

export interface KnobSpec {
  key: KnobKey;
  label: string;
  hint: string;
  placeholder: string;
  /** A slider alongside the box, where the range is small and bounded. `rest` is where it sits while the box is blank. */
  slider?: { min: number; max: number; step: number; rest: number };
}

export const KNOBS: readonly KnobSpec[] = [
  { key: 'temperature', label: 'Temperature', hint: '0 is repeatable, 2 is wild', placeholder: 'default', slider: { min: 0, max: 2, step: 0.1, rest: 1 } },
  { key: 'topP', label: 'Top P', hint: 'How much of the likely words to keep', placeholder: 'default', slider: { min: 0, max: 1, step: 0.05, rest: 1 } },
  { key: 'maxTokens', label: 'Max output tokens', hint: '1–1,000,000', placeholder: 'Default' },
  { key: 'timeoutMs', label: 'Timeout (ms)', hint: '1,000–3,600,000; blank means no deadline', placeholder: 'no deadline' },
  { key: 'maxRetries', label: 'Retries', hint: '0–5; only before the first token', placeholder: '0' },
];

const fmt = (n: number): string => n.toLocaleString('en-US');

/** The sentence under a box whose text is out of range (copy table 9.3), built from the shared bounds. */
export function knobMessage(key: KnobKey): string {
  const b = AI_PARAM_BOUNDS[key];
  switch (key) {
    case 'timeoutMs':
      return `Use a value from ${fmt(b.min)} to ${fmt(b.max)} ms (${b.min / 1000} s to ${b.max / 3_600_000} h).`;
    case 'maxRetries':
      return `Use ${b.min} to ${b.max} retries.`;
    case 'maxTokens':
      return `Use a whole number from ${fmt(b.min)} to ${fmt(b.max)}.`;
    default:
      return `Use a number from ${fmt(b.min)} to ${fmt(b.max)}.`;
  }
}

/**
 * The error for one box's text, or null. Blank is ABSENT (a different fact from 0) and always fine.
 * The text is judged as typed: no trimming beyond whitespace, no comma stripping, no clamping.
 */
export function validateKnob(key: KnobKey, text: string): string | null {
  const raw = text.trim();
  if (raw === '') return null;
  const b = AI_PARAM_BOUNDS[key];
  const n = Number(raw);
  if (!Number.isFinite(n) || (b.integer && !Number.isInteger(n)) || n < b.min || n > b.max) return knobMessage(key);
  return null;
}

/** Where a provider's keys are known to start. Soft: a hint with a way past it, never a refusal. */
const KEY_PREFIX: Partial<Record<PresetId, { name: string; prefix: string }>> = {
  openai: { name: 'OpenAI', prefix: 'sk-' },
  anthropic: { name: 'Anthropic', prefix: 'sk-ant-' },
  openrouter: { name: 'OpenRouter', prefix: 'sk-or-' },
};

/** The warning when the typed key does not start the way this provider's keys do, else null. */
export function keyPrefixWarning(preset: PresetId | undefined, key: string): string | null {
  const known = preset === undefined ? undefined : KEY_PREFIX[preset];
  const typed = key.trim();
  if (!known || typed === '' || typed.startsWith(known.prefix)) return null;
  return `That doesn't look like an ${known.name} key (they start with ${known.prefix}).`;
}
