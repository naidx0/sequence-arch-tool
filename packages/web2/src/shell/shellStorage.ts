import {
  DEFAULT_SHELL_TOKENS,
  SHELL_PERSISTED_VERSION,
  type PaneName,
  type ShellPersisted,
} from './shellModel';
import type { ThemePreference } from '../state/types';

/**
 * THE PANE WIDTHS, REMEMBERED.
 *
 * Sheet 11 states this as a product requirement rather than a nicety: "The
 * width is the user's. It is dragged within the clamps and remembered, because
 * re-sizing a panel on every launch is the definition of not customisable."
 *
 * Everything here is about the READ path. The write path cannot really fail;
 * the read path is where a persisted layout turns into a broken one, because
 * localStorage is a string under a name that another tab, an older build or
 * five seconds in devtools can write. A reader that trusts it hands NaN to a
 * grid template and paints a zero-width pane no drag can recover — strictly
 * worse than the default it replaced. So: parse, validate each field on its
 * own, and fall back per field. Never to a partial record.
 */

/** Namespaced and versioned in the key as well as the payload, so a future
 *  shape can land beside this one instead of having to migrate it. */
export const SHELL_STORAGE_KEY = 'sequence.shell.v1';

const THEMES: readonly ThemePreference[] = ['dark', 'light', 'system'];
const PANES: readonly PaneName[] = ['chat', 'rail'];

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function readShellPersisted(): ShellPersisted | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(SHELL_STORAGE_KEY);
  } catch {
    // Storage can throw outright — a SecurityError under a third-party-cookie
    // block, for one. A remembered pane width is not worth a boot failure.
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  // A record from a different shape is discarded whole rather than field-wise:
  // the fields it happens to share may not mean the same thing, and guessing
  // which ones do is how a migration bug becomes a layout bug.
  if (record.version !== SHELL_PERSISTED_VERSION) return null;

  return {
    version: SHELL_PERSISTED_VERSION,
    chatWidth: num(record.chatWidth, DEFAULT_SHELL_TOKENS.chat.base),
    railWidth: num(record.railWidth, DEFAULT_SHELL_TOKENS.rail.base),
    chatOpen: bool(record.chatOpen, true),
    railOpen: bool(record.railOpen, true),
    priority: oneOf(record.priority, PANES, 'chat'),
    theme: oneOf(record.theme, THEMES, 'dark'),
  };
}

export function writeShellPersisted(value: ShellPersisted): void {
  try {
    window.localStorage.setItem(SHELL_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Safari in private mode throws QuotaExceededError from setItem. The
    // failure mode of "we could not remember your layout" is the default
    // layout, which is what a first-time visitor gets anyway.
  }
}
