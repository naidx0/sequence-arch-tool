/**
 * find_files: Sequence's trained file ranker as one MCP tool.
 *
 * A thin wrapper over analyzer/src/explain/findFiles.ts, which owns the index,
 * the ranking, the reasons, the snippets, the token budget and the per-repo
 * learning, and findFilesHost.ts, which shares one index per repo across
 * sessions. This file is the tool's text and shape, and its jail.
 */
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { findFilesShared, FIND_FILES_DEFAULT_BUDGET, FIND_FILES_DEFAULT_K, FIND_FILES_MAX_K, FIND_FILES_MAX_QUERY_CHARS } from '@sequence/analyzer';

/* Every core session pays for this listing (the prime "smaller tool listing" goal): one sentence of what, one of when. */
export const FIND_FILES_DESCRIPTION =
  'The files a question or task is about, ranked by a model trained on code history, each with a reason and its best lines. ' +
  'Call this BEFORE grep or glob when you do not know which file to open.';

export const findFilesShape = {
  repoPath: z.string().describe('Absolute path to the repository.'),
  query: z.string().min(1).max(FIND_FILES_MAX_QUERY_CHARS).describe('In plain words.'),
  k: z.number().int().min(1).max(FIND_FILES_MAX_K).optional().describe(`Files. Default ${FIND_FILES_DEFAULT_K}.`),
};

const real = (p: string): string => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};

/**
 * The root find_files may search. In a session Sequence started (`sessionRepo`
 * = SEQUENCE_REPO, the repo or the chat's worktree) it is that directory and
 * nothing else: a `repoPath` outside it (another checkout, a home directory, a
 * symlink out) is refused, one inside it searches the session's repository.
 * Standalone (no session repo) it is the `repoPath` the user's own client sent.
 */
export function findFilesRoot(repoPath: string | undefined, sessionRepo: string | undefined): { root: string } | { error: string } {
  if (!sessionRepo) return repoPath ? { root: path.resolve(repoPath) } : { error: 'repoPath is required' };
  const jail = real(sessionRepo);
  if (repoPath === undefined) return { root: jail };
  const asked = real(path.resolve(jail, repoPath));
  const rel = path.relative(jail, asked);
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return { root: jail };
  return { error: `find_files searches this session's repository only (${jail}).` };
}

export async function findFilesTool(a: { repoPath?: string; query: string; k?: number }, sessionRepo?: string): Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }> {
  try {
    const where = findFilesRoot(a.repoPath, sessionRepo);
    if ('error' in where) return { content: [{ type: 'text', text: where.error }], isError: true };
    /* The answer budget scales with k (~150 tokens a file), so no budget knob in the listing. */
    const r = await findFilesShared(where.root, a.query, { k: a.k, budgetTokens: a.k && a.k > FIND_FILES_DEFAULT_K ? Math.min(4000, 160 * a.k) : FIND_FILES_DEFAULT_BUDGET });
    return { content: [{ type: 'text', text: r.text }] };
  } catch (e) {
    return { content: [{ type: 'text', text: `find_files failed: ${(e as Error).message}` }], isError: true };
  }
}
