import type { ReviewScope } from '../state/types';

/* ══════════════════════════════════════════════════════════════════════════
   THE FIVE SCOPES, AND WHAT THE ENGINE CAN ACTUALLY ANSWER — item 5.4
   packages/web2/src/review/reviewScopes.ts

   §5.2 item 2 says to steal the segmented control verbatim: Unstaged / Staged /
   Commit / Branch / Last turn, with "Last turn" singled out — *what did the
   agent just do to me*, one click.

   AND THEN THE ENGINE WAS READ, AND IT SERVES TWO OF THE FIVE.

     GET /api/git/status  server/repoServer.ts → gitWorkspace.ts
       `git status --porcelain=v1 -b --no-renames`, and `classifyStatus`
       (gitWorkspace.ts) COLLAPSES the porcelain XY pair into one word.
       A 'modified' is X='M' (staged) or Y='M' (unstaged) and nothing on the
       wire tells them apart.

     GET /api/git/diff    server/repoServer.ts → gitWorkspace.ts `gitDiff`
       takes `?path` and NOTHING ELSE, and runs `git diff --no-color HEAD --
       <path>` (or the index diff when there is no HEAD). No `--cached`, no
       revision, no merge base.

   So the wire answers exactly one git question — what is different between the
   working tree and the last commit — and cannot answer "what is staged", "what
   did commit X change", or "what does this branch change against its base".

   WHY THE UNSERVED THREE ARE STILL IN THE CONTROL. Deleting them would hide
   the gap; rendering them and showing the same diff under all five names would
   be the product lying in five places at once. They render, they are marked
   unserved, and selecting one produces the route that would have to change.
   CANON: "If the engine cannot supply it, render the honest empty state and
   say what is missing."

   AND WHY 'unstaged' CARRIES A CAVEAT RATHER THAN A CLEAN TICK. `git diff HEAD`
   INCLUDES staged changes. Labelling that segment "Unstaged" and saying nothing
   is a quiet lie, so the provenance line under the control states what was
   actually measured. Sheet 12.3's own rule for a count — "the quantity told
   the truth about where it came from".

   THIS FILE IS THE ONE PLACE THAT KNOWLEDGE LIVES. When a route lands, this
   register changes and `reviewScopes.test.ts` fails until it is re-measured.
   ══════════════════════════════════════════════════════════════════════════ */

/** Where a scope's content comes from — git, or the session's own record. */
export type ScopeSource = 'git' | 'session';

export interface ScopeSupport {
  scope: ReviewScope;
  /** The segment's word. Short: it sits in a compact segmented control. */
  label: string;
  source: ScopeSource;
  served: boolean;
  /** What the engine actually measures for this scope. '' when unserved. */
  measures: string;
  /** The honest qualification on a served scope, or null. */
  caveat: string | null;
  /** What the engine lacks, naming the route. null when served. */
  missing: string | null;
}

export const REVIEW_SCOPES: readonly ScopeSupport[] = [
  {
    scope: 'unstaged',
    label: 'Unstaged',
    source: 'git',
    served: true,
    measures: 'git diff HEAD — the working tree against the last commit',
    caveat:
      'GET /api/git/diff has no --cached form, so this includes staged changes as well as unstaged ones',
    missing: null,
  },
  {
    scope: 'staged',
    label: 'Staged',
    source: 'git',
    served: true,
    measures: 'git diff --cached HEAD — the index against the last commit',
    caveat:
      'GET /api/git/status still collapses the porcelain XY pair into one word, so the FILE LIST cannot yet separate staged from unstaged; the diff for each file can',
    missing: null,
  },
  {
    scope: 'commit',
    label: 'Commit',
    source: 'git',
    served: true,
    measures: 'one commit against its parent — git diff <rev>^ <rev>',
    caveat:
      'a root commit has no parent, so it is shown as the addition it is (git diff-tree --root)',
    missing: null,
  },
  {
    scope: 'branch',
    label: 'Branch',
    source: 'git',
    served: true,
    measures: 'this branch against where it diverged — git diff <base>...HEAD',
    caveat:
      'three dots, so changes that landed on the base after the branch was cut are NOT counted as yours',
    missing: null,
  },
  {
    scope: 'last-turn',
    label: 'Last turn',
    source: 'session',
    served: true,
    measures: 'the edit:proposal events the last assistant turn emitted',
    caveat: 'nothing here has touched the disk — propose_files stages, a human accepts',
    missing: null,
  },
];

const BY_SCOPE = new Map(REVIEW_SCOPES.map((s) => [s.scope, s]));

export function scopeSupport(scope: ReviewScope): ScopeSupport {
  const found = BY_SCOPE.get(scope);
  /* TOTAL, and the fallback is a REFUSAL rather than a default. A scope this
     register has never heard of must not render as "unstaged" — it renders as
     something the engine cannot serve, which is the truth about it. */
  return (
    found ?? {
      scope,
      label: String(scope),
      source: 'git',
      served: false,
      measures: '',
      caveat: null,
      missing: `no route is registered for the scope ${JSON.stringify(scope)}`,
    }
  );
}

/** The scopes with a route behind them, in control order. */
export function servedScopes(): ReviewScope[] {
  return REVIEW_SCOPES.filter((s) => s.served).map((s) => s.scope);
}
