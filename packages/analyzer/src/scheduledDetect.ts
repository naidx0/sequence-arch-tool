import type { FileFacts } from './types.js';

/** Grounded cron / scheduler signals in source — detection only, never invented. */
const SCHEDULE_PATTERNS: RegExp[] = [
  /\bcron(?:tab)?\b/i,
  /\bAPScheduler\b/,
  /\b@scheduled\b/,
  /\bnode-cron\b/,
  /\barq\.cron\b/,
  /\bCronTrigger\b/,
  /\bschedule\.every\b/,
  /\bBackgroundScheduler\b/,
  /['"][\d*,\-/]+\s+[\d*,\-/]+\s+[\d*,\-/]+\s+[\d*,\-/]+\s+[\d*,\-/]+['"]/, // cron expression literal
];

/** One file's share of {@link factsSuggestScheduledJob}; the scan memoises it per unchanged file. */
export function fileSuggestsScheduledJob(f: Pick<FileFacts, 'lines'>): boolean {
  const hay = f.lines.join('\n');
  return SCHEDULE_PATTERNS.some((re) => re.test(hay));
}

/**
 * True when any file in the service's facts carries scheduler evidence.
 * Honest: no match ⇒ no badge on the Architecture card.
 */
export function factsSuggestScheduledJob(facts: readonly FileFacts[]): boolean {
  for (const f of facts) {
    if (fileSuggestsScheduledJob(f)) return true;
  }
  return false;
}
