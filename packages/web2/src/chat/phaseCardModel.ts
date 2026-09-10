import type { WorkRow } from '../state/types';
import { liveLabelFor } from './workRowModel';

/** Active live row for the Codex-style phase card — prefer canvas / provider. */
export function activePhaseRow(rows: readonly WorkRow[]): WorkRow | null {
  const live = rows.filter((r) => r.status === 'running');
  if (live.length === 0) return null;
  const canvas = live.find(
    (r) => r.from === 'canvas:block' || r.opens === 'ai-canvas' || /canvas\.write_/.test(r.verb),
  );
  if (canvas) return canvas;
  const provider = live.find((r) => r.from === 'provider:start');
  if (provider) return provider;
  const topology = live.find((r) => r.from === 'topology:proposal' || r.opens === 'canvas');
  if (topology) return topology;
  /* Skip pipeline bookkeeping steps (intents / file-research / advisor) when
     a more specific live row exists — those step ids are not surfaces. */
  const substantive = live.find(
    (r) =>
      !(
        r.from === 'step:start' &&
        (r.identifier === 'intents' ||
          r.identifier === 'file-research' ||
          r.identifier === 'advisor' ||
          r.identifier === 'provider')
      ),
  );
  return substantive ?? live[0] ?? null;
}

/**
 * Path-style crumb: product / surface. Swaps as the turn targets Chat,
 * AI Canvas, Architecture, Review, or Files — not a file path.
 */
export function phaseSurfaceCrumb(row: WorkRow): string {
  if (row.from === 'canvas:block' || row.opens === 'ai-canvas') return 'sequence / AI Canvas';
  if (row.from === 'topology:proposal' || row.opens === 'canvas') return 'sequence / Architecture';
  if (row.from === 'edit:proposal' || row.opens === 'review') return 'sequence / Review';
  if (row.from === 'file:read') return 'sequence / Files';
  return 'sequence / Chat';
}

export function phaseLiveLabel(row: WorkRow, reasoningProvider?: string | null): string {
  return liveLabelFor(row, reasoningProvider).replace(/…$/, '');
}
