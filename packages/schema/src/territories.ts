/**
 * AGENTS AS TERRITORIES — who claims what, and where two claims collide.
 *
 * The gap study is unusually specific about why this matters: "Claude Code's
 * own agent-teams limitations are dominated by OBSERVABILITY failures — task
 * status can lag, teammates fail to mark tasks completed. Their UI for a
 * five-way debate is five rows of one-line summaries, three of which collapse
 * into `2 idle agents` after 30 seconds." And the point of doing it spatially:
 * a view of each agent's claimed file ownership "eliminates the failure class
 * rather than documenting it".
 *
 * THE FAILURE CLASS IS THE OVERLAP. Two agents editing one file is not a status
 * that lags — it is a collision that has already happened, or is about to, and
 * it is DECIDABLE from the claims alone. No polling, no self-reporting, nothing
 * that depends on an agent remembering to mark itself done.
 *
 * IT REUSES `pathMatchesProgramEditAllowlist`, which is how "Agent may edit"
 * already works in `program.md`. A territory is not a new concept invented for
 * a picture; it is the claim the program file already makes, read spatially. A
 * second glob matcher would be a second answer to "may this agent touch this
 * file", and the two would disagree on the day it mattered.
 *
 * PURE AND TOTAL, like the engines beside it: no agent is asked anything, and
 * the answer is the same every time for the same claims.
 */

import { pathMatchesRepoGlob } from './programStrategy.js';

/** One agent's declared claim over the repository. */
export interface TerritoryClaim {
  /** Stable id — a run id, a worktree name, whatever the caller keys agents by. */
  agentId: string;
  /** Human label for the board. */
  label?: string;
  /**
   * The globs this agent may edit — `program.md`'s "Agent may edit" list.
   *
   * An EMPTY list is the dangerous case and is treated as such: in
   * `pathMatchesProgramEditAllowlist` an empty allowlist permits everything,
   * which for one agent is a sensible default and for three agents at once is a
   * claim over the whole repository. See {@link CLAIMS_EVERYTHING}.
   */
  globs: string[];
}

/** A file two or more agents both claim. */
export interface TerritoryConflict {
  path: string;
  /** The agents claiming it, sorted. Always length >= 2. */
  agentIds: string[];
}

export interface Territories {
  /** Paths owned by exactly one agent, keyed by agent id. */
  byAgent: Record<string, string[]>;
  /** Paths claimed by more than one — the failure class, made decidable. */
  conflicts: TerritoryConflict[];
  /** Paths no agent claims. Not a problem; a fact worth being able to see. */
  unclaimed: string[];
  /**
   * Agents whose claim covers the WHOLE repository, by declaring no globs.
   *
   * Reported separately because the conflict list would otherwise be every file
   * in the repo, which is true and unreadable — and because the fix is
   * different: this agent needs a narrower claim, not a merge.
   */
  claimsEverything: string[];
}

/** The marker used when an agent declares no globs at all. */
export const CLAIMS_EVERYTHING = '*';

function claimsWholeRepo(claim: TerritoryClaim): boolean {
  return (
    claim.globs.length === 0 ||
    claim.globs.some((g) => g.trim() === CLAIMS_EVERYTHING || g.trim() === '**')
  );
}

/**
 * Divide `paths` among `claims`.
 *
 * `paths` is what exists — repo-relative file paths from the scan — so a
 * territory is over real files rather than over the globs themselves. Two globs
 * can overlap in principle and never collide in fact, and reporting that as a
 * conflict would cry wolf on the first day a team wrote `src/**` and
 * `src/api/**`.
 */
export function territories(
  paths: readonly string[],
  claims: readonly TerritoryClaim[],
): Territories {
  const wide = claims.filter(claimsWholeRepo).map((c) => c.agentId).sort();
  /* An agent claiming everything is excluded from the per-file arithmetic:
     including it would put it in a conflict with every other agent on every
     file, which is true and drowns the specific collisions that can be fixed. */
  const narrow = claims.filter((c) => !claimsWholeRepo(c));

  const byAgent: Record<string, string[]> = {};
  for (const c of narrow) byAgent[c.agentId] = [];

  const conflicts: TerritoryConflict[] = [];
  const unclaimed: string[] = [];

  for (const p of [...new Set(paths)].sort()) {
    const owners = narrow
      .filter((c) => c.globs.some((g) => pathMatchesRepoGlob(p, g)))
      .map((c) => c.agentId)
      .sort();

    if (owners.length === 0) {
      unclaimed.push(p);
      continue;
    }
    if (owners.length === 1) {
      byAgent[owners[0]!]!.push(p);
      continue;
    }
    /* THE FAILURE CLASS. Two agents with a claim on one file is not a status
       that lags; it is a collision, decidable now, from the claims alone. */
    conflicts.push({ path: p, agentIds: owners });
  }

  for (const id of Object.keys(byAgent)) byAgent[id]!.sort();
  conflicts.sort((a, b) => a.path.localeCompare(b.path));

  return { byAgent, conflicts, unclaimed, claimsEverything: wide };
}

/**
 * One sentence, or null when there is nothing wrong.
 *
 * Null rather than "no conflicts": a reassurance on every render of every
 * single-agent run is noise, and noise is what makes the one time it matters
 * easy to miss.
 */
export function territorySentence(t: Territories): string | null {
  const parts: string[] = [];
  if (t.claimsEverything.length > 0) {
    parts.push(
      `${t.claimsEverything.join(', ')} claim${t.claimsEverything.length === 1 ? 's' : ''} the whole repository — ` +
        `narrow the "Agent may edit" list before running others alongside`,
    );
  }
  if (t.conflicts.length > 0) {
    const first = t.conflicts
      .slice(0, 3)
      .map((c) => `${c.path} (${c.agentIds.join(' + ')})`)
      .join(', ');
    const more = t.conflicts.length > 3 ? ` and ${t.conflicts.length - 3} more` : '';
    parts.push(`${t.conflicts.length} file${t.conflicts.length === 1 ? '' : 's'} claimed twice: ${first}${more}`);
  }
  return parts.length === 0 ? null : parts.join('. ') + '.';
}
