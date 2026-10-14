import fs from 'node:fs';
import path from 'node:path';
import type { ArchGraph } from '@sequence/schema';
import { buildDigest, type Digest } from '../explain/explain.js';
import { INSTRUCTION_FILES, readRepoInstructions, type RepoInstructions } from '../explain/instructions.js';
import { probeEffectiveContext } from './localProviders.js';
import { buildTree } from './tree.js';

/* ══════════════════════════════════════════════════════════════════════════
   WHAT AN ASK USED TO REBUILD EVERY TIME — 0.1.8.1 D4 (audit M4)
   packages/analyzer/src/server/askMemo.ts

   Every `/api/ask` rebuilt the digest from a fresh walk of the repository
   (`buildTree`), re-read AGENTS.md / CLAUDE.md, and probed a local Ollama's
   `/api/show`. None of them change between two questions in a row, so each is
   remembered against what WOULD change it:

     digest + tree    the graph served (its identity: a rescan or an attach
                      replaces it) and the repository's change counter (bumped
                      by the file watcher and by every write through the app).
                      Not remembered at all while the watcher is not running,
                      because then nothing would say the tree moved.
     instructions     each candidate file's size and mtime (a stat, not a read),
                      so an edit applies on the next question as before.
     Ollama window    the base URL and model, for PROBE_TTL_MS; a changed
                      Modelfile `num_ctx` is picked up within that.

   `askMemoStats` counts builds and hits so the lock test can see the skip.
   ══════════════════════════════════════════════════════════════════════════ */

export const askMemoStats = {
  digestBuilds: 0,
  digestHits: 0,
  instructionReads: 0,
  instructionHits: 0,
  probeCalls: 0,
  probeHits: 0,
};

export interface DigestKey {
  root: string;
  graph: ArchGraph;
  /** The repository's change counter. */
  revision: number;
  /** False when no watcher would bump `revision`: then nothing is remembered. */
  watching: boolean;
}

/** One server's remembered digest. */
export function createDigestMemo(build: (graph: ArchGraph, root: string) => Digest = (g, root) => buildDigest(g, buildTree(root))) {
  let memo: { root: string; graph: ArchGraph; revision: number; digest: Digest } | null = null;
  return {
    get(key: DigestKey): Digest {
      if (key.watching && memo && memo.root === key.root && memo.graph === key.graph && memo.revision === key.revision) {
        askMemoStats.digestHits += 1;
        return memo.digest;
      }
      askMemoStats.digestBuilds += 1;
      const digest = build(key.graph, key.root);
      memo = key.watching ? { root: key.root, graph: key.graph, revision: key.revision, digest } : null;
      return digest;
    },
    clear(): void {
      memo = null;
    },
  };
}

/* ── instruction files, by stat ─────────────────────────────────────────── */

const instructionMemo = new Map<string, { stamp: string; value: RepoInstructions | null }>();

function instructionStamp(repoRoot: string): string {
  return INSTRUCTION_FILES.map((rel) => {
    try {
      const st = fs.statSync(path.join(repoRoot, rel));
      return `${rel}:${st.size}:${st.mtimeMs}`;
    } catch {
      return `${rel}:-`;
    }
  }).join('|');
}

/**
 * `readRepoInstructions`, remembered per repository while every candidate
 * file keeps its size and mtime. The read itself (with its jail) is unchanged.
 */
export function readRepoInstructionsCached(repoRoot: string): RepoInstructions | null {
  const stamp = instructionStamp(repoRoot);
  const hit = instructionMemo.get(repoRoot);
  if (hit && hit.stamp === stamp) {
    askMemoStats.instructionHits += 1;
    return hit.value;
  }
  askMemoStats.instructionReads += 1;
  const value = readRepoInstructions(repoRoot);
  instructionMemo.set(repoRoot, { stamp, value });
  if (instructionMemo.size > 16) instructionMemo.delete(instructionMemo.keys().next().value as string);
  return value;
}

/* ── the local Ollama window ───────────────────────────────────────────── */

export const PROBE_TTL_MS = 60_000;
const probeMemo = new Map<string, { at: number; value: number | null }>();

/** `probeEffectiveContext`, remembered for PROBE_TTL_MS per base URL and model. */
export async function probeEffectiveContextCached(
  baseUrl: string,
  model: string,
  fetchImpl: typeof fetch,
  now: () => number = Date.now,
  probe: typeof probeEffectiveContext = probeEffectiveContext,
): Promise<number | null> {
  const key = `${baseUrl}\u0000${model}`;
  const hit = probeMemo.get(key);
  if (hit && now() - hit.at < PROBE_TTL_MS) {
    askMemoStats.probeHits += 1;
    return hit.value;
  }
  askMemoStats.probeCalls += 1;
  const value = await probe(baseUrl, model, fetchImpl);
  probeMemo.set(key, { at: now(), value });
  return value;
}

/** Tests: forget everything remembered (a fresh process). */
export function resetAskMemo(): void {
  instructionMemo.clear();
  probeMemo.clear();
  for (const k of Object.keys(askMemoStats) as (keyof typeof askMemoStats)[]) askMemoStats[k] = 0;
}
