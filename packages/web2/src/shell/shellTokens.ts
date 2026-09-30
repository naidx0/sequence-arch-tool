import { DEFAULT_SHELL_TOKENS, type ShellTokens } from './shellModel';

/**
 * READ THE LAYOUT NUMBERS OFF THE CASCADE, NOT OUT OF A CONSTANT.
 *
 * tokens/graphite.css is the only file allowed to declare a spacing value, and
 * the seven numbers the shell arranges itself with — --pane-w, --pane-w-min,
 * --pane-w-max, --rail-w, --rail-w-min, --rail-w-max, --col-min, plus --sp-56
 * for the overlay peek — are declared there. This module is how they get into
 * TypeScript without being written down a second time as the truth.
 *
 * DEFAULT_SHELL_TOKENS still exists, for two reasons and neither is laziness.
 * The pure tier has no DOM to read, so it needs a value to compute against;
 * and a token that fails to resolve has to land somewhere honest rather than
 * on NaN, which reaches a grid template as a zero-width column no drag can
 * recover. So a per-field fallback: one unreadable token costs one default,
 * never the whole set.
 *
 * The duplication is guarded rather than tolerated. Shell.test.tsx mounts the
 * real sheet and asserts readShellTokens(document.documentElement) deep-equals
 * DEFAULT_SHELL_TOKENS, so moving --rail-w in the token file without moving
 * the constant is a red test rather than a shell that lays out to last week's
 * number.
 */

/** A CSS length in px, or null if the property is absent or not a px length. */
function readPx(styles: CSSStyleDeclaration, name: string): number | null {
  const raw = styles.getPropertyValue(name).trim();
  if (!raw.endsWith('px')) return null;
  const value = Number.parseFloat(raw.slice(0, -2));
  return Number.isFinite(value) ? value : null;
}

export function readShellTokens(root: Element): ShellTokens {
  const view = root.ownerDocument.defaultView;
  if (!view) return DEFAULT_SHELL_TOKENS;
  const styles = view.getComputedStyle(root);

  const px = (name: string, fallback: number) => readPx(styles, name) ?? fallback;

  return {
    chat: {
      base: px('--pane-w', DEFAULT_SHELL_TOKENS.chat.base),
      min: px('--pane-w-min', DEFAULT_SHELL_TOKENS.chat.min),
      max: px('--pane-w-max', DEFAULT_SHELL_TOKENS.chat.max),
    },
    chatCap: px('--pane-w-cap', DEFAULT_SHELL_TOKENS.chatCap),
    rail: {
      base: px('--rail-w', DEFAULT_SHELL_TOKENS.rail.base),
      min: px('--rail-w-min', DEFAULT_SHELL_TOKENS.rail.min),
      max: px('--rail-w-max', DEFAULT_SHELL_TOKENS.rail.max),
    },
    canvasMin: px('--col-min', DEFAULT_SHELL_TOKENS.canvasMin),
    overlayPeek: px('--sp-56', DEFAULT_SHELL_TOKENS.overlayPeek),
  };
}
