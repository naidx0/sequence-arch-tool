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
  /* A gateway or a router is a service the traffic passes THROUGH, so it keeps
     the service's box; the way in from outside (an edge, an ingress, a public
     web front) draws the globe (Decision 49, the picked mix). */
  if (labelIncludes(label, ['gateway', 'router', 'ingress'])) {
    return kindGlyph(present.kind);
  }

  if (present.entry) {
    return silhouetteGlyph('entry');
  }

  if (looksLikeFolderLabel(label)) {
    return 'b-folder';
  }

  if (looksLikeFileLabel(label)) {
    return 'b-file';
  }

  if (labelIncludes(label, ['skill'])) {
    return 'b-spark';
  }

  if (labelIncludes(label, ['model', 'llm'])) {
    return 'b-model';
  }

  if (labelIncludes(label, ['adapter'])) {
    return 'b-module';
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
    return 'b-db';
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
    return 'b-queue';
  }

  if (labelIncludes(label, ['proxy', 'cdn', 'loadbalancer', 'lb'])) {
    return 'b-filter';
  }

  return kindGlyph(present.kind);
}
