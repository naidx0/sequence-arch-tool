/* ══════════════════════════════════════════════════════════════════════════
   AGENTS AS TERRITORIES — what this product's parallel work actually looks like
   packages/web2/src/activity/territoriesModel.ts

   The gap study asked for a spatial view because "Claude Code's own agent-teams
   limitations are dominated by OBSERVABILITY failures — task status can lag,
   teammates fail to mark tasks completed", and their UI for a five-way debate
   is "five rows of one-line summaries, three of which collapse into `2 idle
   agents` after 30 seconds".

   ── THE CONFLICT IT DESCRIBES CANNOT HAPPEN HERE, AND THAT IS THE POINT ───

   That study's failure class is two agents editing one file. This product does
   not put two agents in one tree: `gitHandoffWorktree` gives each its own
   working tree on its own branch, so overlap is prevented structurally rather
   than detected. `schema/territories.ts` computes the overlap and has no
   producer, because `.sequence/program.md` carries ONE "Agent may edit"
   allowlist for the repository rather than one per agent — recorded plainly
   rather than fed with something invented, the same way "Waiting on you" was.

   So the observability worth building is not a conflict detector. It is the
   answer to "who is where, and is anything actually moving" — which is the
   question the five collapsing rows failed at.

   PURE AND REACT-FREE, so the arithmetic is answerable without a DOM.
   ══════════════════════════════════════════════════════════════════════════ */

export interface WorktreeEntry {
  path: string;
  branch: string | null;
  head: string | null;
  bare: boolean;
  detached: boolean;
}

export interface Territory {
  /** The working tree's own path — the territory itself. */
  path: string;
  /** The last path segment, which is what a person recognises. */
  name: string;
  branch: string | null;
  /** Short commit, for telling two trees on the same branch apart. */
  head: string | null;
  /** True for the checkout the app is attached to. */
  isMain: boolean;
  /** Why this row cannot be worked in, or null. */
  note: string | null;
}

export interface TerritoryView {
  territories: Territory[];
  /** Trees other than the main checkout — the parallel work. */
  parallel: number;
  /**
   * Branches claimed by more than one tree.
   *
   * git refuses this, so it should be empty — and reporting it rather than
   * assuming it is how a wrong assumption becomes visible instead of becoming
   * a silence.
   */
  sharedBranches: string[];
  /** One sentence, or null when there is nothing worth saying. */
  summary: string | null;
}

function basename(p: string): string {
  const norm = p.replace(/\\/g, '/').replace(/\/+$/, '');
  const cut = norm.lastIndexOf('/');
  return cut >= 0 ? norm.slice(cut + 1) : norm;
}

/**
 * Turn git's worktree list into territories.
 *
 * `mainPath` is the attached repo. git lists the main checkout first, but
 * matching on POSITION would silently mislabel every row the day that changes;
 * matching on the path is a fact.
 */
export function territoryView(
  entries: readonly WorktreeEntry[],
  mainPath: string | null,
): TerritoryView {
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const main = mainPath ? norm(mainPath) : null;

  const territories: Territory[] = entries.map((e) => ({
    path: e.path,
    name: basename(e.path),
    branch: e.branch,
    head: e.head ? e.head.slice(0, 7) : null,
    isMain: main !== null && norm(e.path) === main,
    /* A bare tree has no working files and a detached one is on no branch.
       Both are real states, and a row that said nothing about them would look
       like an agent that had simply stopped reporting — the exact failure this
       view exists to avoid. */
    note: e.bare
      ? 'bare — no working files'
      : e.detached
        ? 'detached — not on a branch'
        : null,
  }));

  /* Sorted with the main checkout first and the rest by name, so a list two
     agents are watching does not reorder under them. */
  territories.sort(
    (a, b) => Number(b.isMain) - Number(a.isMain) || a.name.localeCompare(b.name),
  );

  const byBranch = new Map<string, number>();
  for (const t of territories) {
    if (!t.branch) continue;
    byBranch.set(t.branch, (byBranch.get(t.branch) ?? 0) + 1);
  }
  const sharedBranches = [...byBranch.entries()]
    .filter(([, n]) => n > 1)
    .map(([b]) => b)
    .sort();

  const parallel = territories.filter((t) => !t.isMain).length;

  const parts: string[] = [];
  if (sharedBranches.length > 0) {
    parts.push(`${sharedBranches.join(', ')} is checked out in more than one tree`);
  }
  const summary =
    parallel === 0
      ? /* Said plainly, because "no parallel work" and "the view is broken" look
           identical when a surface renders nothing. */
        'No parallel work: only the main checkout.'
      : `${parallel} working tree${parallel === 1 ? '' : 's'} beside the main checkout` +
        (parts.length > 0 ? ` — ${parts.join('; ')}` : '') +
        '.';

  return { territories, parallel, sharedBranches, summary };
}
