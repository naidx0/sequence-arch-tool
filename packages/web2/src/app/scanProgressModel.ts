import type { ScanProgress } from '../state/types';
import { formatElapsed } from '../chat/workRowModel';

/**
 * A6.2 spike: see docs/research/a6-path-scoped-cache-spike.md —
 * W1.4 already partitions cache by package part; progress here is phase +
 * elapsed only, never a fabricated file %.
 */

const PHASE_LABELS: Record<string, string> = {
  enumerate: 'Listing files',
  analyze: 'Analyzing',
  detail: 'Building graph',
  done: 'Finishing',
};

export function scanPhaseLabel(phase: string | undefined): string | null {
  if (!phase) return null;
  return PHASE_LABELS[phase] ?? null;
}

export function scanPercent(progress: ScanProgress | null): number | null {
  if (!progress || progress.total <= 0) return null;
  const pct = Math.round((progress.done / progress.total) * 100);
  if (!Number.isFinite(pct)) return null;
  return Math.min(100, Math.max(0, pct));
}

/** One honest line for rail / board chrome while `repo.phase === 'scanning'`. */
export function deriveScanLiveStatus(input: {
  startedAt: number;
  progress: ScanProgress | null;
  now: number;
  repoName?: string | null;
  /** True when a rescan keeps the previous graph on screen. */
  rescan?: boolean;
}): string {
  const elapsed = formatElapsed(Math.max(0, input.now - input.startedAt));
  const target = input.repoName?.trim() || 'the repository';
  const verb = input.rescan ? 'Rescanning' : 'Scanning';
  const parts = [`${verb} ${target}`];

  const phase = scanPhaseLabel(input.progress?.phase);
  if (phase) parts.push(phase);

  const pct = scanPercent(input.progress);
  if (pct !== null && input.progress && input.progress.done < input.progress.total) {
    parts.push(`${pct}%`);
  }

  parts.push(elapsed);
  return parts.join(' · ');
}
