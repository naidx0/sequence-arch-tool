/* ══════════════════════════════════════════════════════════════════════════
   ROLE → BOARD ICON — owner mix 2026-08-27
   packages/web2/src/canvas/roleIconMap.ts

   Label heuristics map to existing book BoardIcon glyphs only — no invented
   emoji chips. Graph drawing and propose_topology ghosts use the same atlas.
   ══════════════════════════════════════════════════════════════════════════ */

import type { BoardIconName } from './BoardIcon.js';
import type { BoardKind, KindPresentation } from './kinds.js';
import { silhouetteGlyph } from './kinds.js';

/** Lowercase label tokens for role matching — split on non-alphanumeric runs. */
function labelTokens(label: string): string[] {
  return label.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function labelIncludes(label: string, words: readonly string[]): boolean {
  const tokens = labelTokens(label);
  return words.some((word) => tokens.includes(word));
}

/** Kind silhouette glyph — entry position keeps the base kind, not entry glyph. */
function kindGlyph(kind: BoardKind): BoardIconName {
  return silhouetteGlyph(kind);
}

/** Path-shaped or extension-bearing labels read as files on the board. */
function looksLikeFileLabel(label: string): boolean {
  const trimmed = label.trim();
  if (!trimmed) return false;
  if (trimmed.includes('/')) return true;
  if (/\.\w{1,8}(?:\.\w{1,8})?$/.test(trimmed.toLowerCase())) return true;
  if (labelIncludes(trimmed, ['file', 'filesystem', 'fs', 'tool', 'toolbox'])) return true;
  return false;
}

/** Directory-shaped labels read as folders while keeping the kind chassis. */
function looksLikeFolderLabel(label: string): boolean {
  const trimmed = label.trim();
  if (!trimmed) return false;
  if (/\/$/.test(trimmed)) return true;
  if (labelIncludes(trimmed, ['folder', 'directory', 'dir'])) return true;
  return false;
}

/**
 * Board header icon for a node label and presentation.
 *
 * Heuristics prefer book glyphs; gateway/router/ingress and entry position
 * never swap away from the kind silhouette; skill maps to agent (ic-skill banned
 * on board). Filesystem-ish labels get file/folder glyphs while the card keeps
 * its service/module chassis.
 */
export function roleIconFor(label: string, present: KindPresentation): BoardIconName {
  if (present.entry) {
    return kindGlyph(present.kind);
  }

  if (labelIncludes(label, ['gateway', 'router', 'ingress'])) {
    return kindGlyph(present.kind);
  }

  if (looksLikeFolderLabel(label)) {
    return 'folder';
  }

  if (looksLikeFileLabel(label)) {
    return 'file';
  }

  if (labelIncludes(label, ['skill'])) {
    return 'agent';
  }

  if (labelIncludes(label, ['model', 'llm'])) {
    return 'model';
  }

  if (labelIncludes(label, ['adapter'])) {
    return 'module';
  }

  if (
    labelIncludes(label, [
      'datastore',
      'memory',
      'cache',
      'redis',
      'vault',
      'secret',
      'secrets',
      'keystore',
    ])
  ) {
    return 'database';
  }

  if (
    labelIncludes(label, [
      'queue',
      'bus',
      'stream',
      'broker',
      'kafka',
      'rabbitmq',
      'pubsub',
    ])
  ) {
    return 'topic';
  }

  if (labelIncludes(label, ['proxy', 'cdn', 'loadbalancer', 'lb'])) {
    return 'filter';
  }

  return kindGlyph(present.kind);
}
