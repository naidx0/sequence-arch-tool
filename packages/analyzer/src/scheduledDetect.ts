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

/**
 * True when any file in the service's facts carries scheduler evidence.
 * Honest: no match ⇒ no badge on the Architecture card.
 */
export function factsSuggestScheduledJob(facts: readonly FileFacts[]): boolean {
  for (const f of facts) {
    const hay = f.lines.join('\n');
    if (SCHEDULE_PATTERNS.some((re) => re.test(hay))) return true;
  }
  return false;
}
