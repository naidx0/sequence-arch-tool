/**
 * AN AGENT'S SPENT USAGE LIMIT, REMEMBERED (round 7, A4 follow-up).
 *
 * The probe asks codex whether it is signed in, and it is: "Ready, ChatGPT".
 * But Jaden's Codex usage limit was spent until Oct 12, so Ready was not
 * true. Codex says so only when a turn fails (usageLimitExceeded, with the
 * reset time), so the server keeps that reset from the turn's recovery here,
 * in the user store, and the providers answer reads "limited" until it
 * passes. Nothing probes codex to find out; a later turn that succeeds
 * clears it.
 *
 * File: <user store>/agent-limits.json  { "<provider>": { "resetsAt": ms, "at": ms } }
 */

import fs from 'node:fs';
import path from 'node:path';

const FILE = 'agent-limits.json';

type Limits = Record<string, { resetsAt: number; at: number }>;

function read(storeDir: string): Limits {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(storeDir, FILE), 'utf8')) as unknown;
    return j && typeof j === 'object' ? (j as Limits) : {};
  } catch {
    return {};
  }
}

function write(storeDir: string, limits: Limits): void {
  try {
    fs.mkdirSync(storeDir, { recursive: true });
    fs.writeFileSync(path.join(storeDir, FILE), JSON.stringify(limits, null, 2) + '\n');
  } catch {
    /* A limit we could not remember is only a less honest status line. */
  }
}

/** A turn failed on the provider's usage limit, which resets at `resetsAt` (epoch ms). */
export function recordUsageLimit(storeDir: string, provider: string, resetsAt: number, now: number = Date.now()): void {
  if (!Number.isFinite(resetsAt)) return;
  const limits = read(storeDir);
  limits[provider] = { resetsAt, at: now };
  write(storeDir, limits);
}

/** A turn on the provider worked: whatever limit was remembered is over. */
export function clearUsageLimit(storeDir: string, provider: string): void {
  const limits = read(storeDir);
  if (!(provider in limits)) return;
  delete limits[provider];
  write(storeDir, limits);
}

/** The reset time of the provider's spent limit, or null when there is none still in force. */
export function activeUsageLimit(storeDir: string, provider: string, now: number = Date.now()): number | null {
  const l = read(storeDir)[provider];
  return l && typeof l.resetsAt === 'number' && l.resetsAt > now ? l.resetsAt : null;
}
