/* ══════════════════════════════════════════════════════════════════════════
   THE TAB STRIP — what each tab shows in its icon slot, and how wide it is
   packages/web2/src/app/chromeTabStrip.ts

   Pure. Chrome-style strip: 32px tabs on a 36px bar, each tab 72 to 220px
   wide. A tab's icon slot carries its status: a slow ring while a turn is
   drawing on that surface, a dot when the surface is waiting for the reader.
   After a close the remaining tabs keep their widths until the pointer leaves
   the strip, so the next close button lands under the pointer (Chrome does
   the same).
   ══════════════════════════════════════════════════════════════════════════ */

import type { ChromeTabId } from './chromeTabModel';

export const TAB_MIN_W = 72;
export const TAB_MAX_W = 220;

export type TabStatus = 'running' | 'needs-input' | null;

export interface TabStatusInput {
  /** A turn is in flight (queued, streaming, finalizing or stopping). */
  running: boolean;
  /** Surfaces the model draws on while it works (see MODEL_DRAWN_PANES). */
  modelDrawn: ReadonlySet<ChromeTabId>;
  /** An agent run is working (the Agents surface is where it shows). */
  agentsRunning?: boolean;
  /** File edits waiting for Accept or Deny. */
  pendingEdits: number;
  /** An architecture proposal waiting for Accept or Deny. */
  pendingTopology: boolean;
}

/** Waiting for the reader outranks working: it is the one that needs a person. */
export function tabStatus(id: ChromeTabId, input: TabStatusInput): TabStatus {
  if ((id === 'chat' || id === 'files') && input.pendingEdits > 0) return 'needs-input';
  if (id === 'architecture' && input.pendingTopology) return 'needs-input';
  if (id === 'agents' && input.agentsRunning) return 'running';
  if (input.running && (id === 'chat' || input.modelDrawn.has(id))) return 'running';
  return null;
}

/** Widths to hold after a close: every remaining tab keeps the width it had. */
export function freezeWidths(
  measured: ReadonlyArray<{ id: ChromeTabId; width: number }>,
  closed: ChromeTabId,
): Partial<Record<ChromeTabId, number>> {
  const out: Partial<Record<ChromeTabId, number>> = {};
  for (const { id, width } of measured) {
    if (id === closed) continue;
    out[id] = Math.max(TAB_MIN_W, Math.min(TAB_MAX_W, Math.round(width)));
  }
  return out;
}
