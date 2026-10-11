import type { GitStatusFile } from '@sequence/api-types';

import { parseUnifiedDiff, type DiffFileChange } from './diffModel';
import type { LineComment, ReviewScope, RepoPath, TurnId } from '../state/types';

/* ══════════════════════════════════════════════════════════════════════════
   THE REVIEW REDUCER — items 5.2, 5.3, 5.4
   packages/web2/src/review/reviewModel.ts

   PURE, AND IT LIVES HERE RATHER THAN IN state/store.ts FOR THE SAME REASON
   canvasReduce DOES. `store.ts` ships eighteen actions and not one of them
   writes a review; adding the family means editing a file this lane does not
   own, and twelve agents sharing files cost this project a full repair cycle.
   The shapes it produces are the FROZEN ones — `state/types.ts` already
   declares `FileEditProposal`, `ProposedFile`, `LineComment`, `ReviewScope`
   and `GitState`, with a comment saying they exist "from day 0 or the retrofit
   reaches every turn record". Nothing here invents a second vocabulary.

   THE FOLD, when the store lane takes it: add `ReviewAction` to `Action`, add
   one case returning `{...state, review: reviewReduce(state.review, action)}`,
   and change one `useReducer` to `useStore`. Nothing else moves.

   THE ONE RULE THIS FILE EXISTS TO MAKE TRUE. A decision is per FILE. v1's
   whole review vocabulary was one Accept and one Deny over a set
   (`fileEditProposalModel.ts:56-73`), which means the only way to reject one
   file of three was to reject all three and ask again. Every decision below is
   keyed by path, and `acceptPlan` is the ONLY thing an accept may write from.
   ══════════════════════════════════════════════════════════════════════════ */

export type FileDecision = 'pending' | 'accepted' | 'rejected';
export type DiffState = 'idle' | 'loading' | 'ready' | 'empty' | 'failed';
export type ApplyState = 'writing' | 'written' | 'failed';

export interface ReviewFile {
  path: RepoPath;
  /** git's normalised word, or the proposal's own description. */
  status: string;
  decision: FileDecision;
  /** Selective staging: is this path in the next commit's `paths`. */
  staged: boolean;
  expanded: boolean;
  diff: DiffFileChange | null;
  diffState: DiffState;
  failure: string | null;
  comments: LineComment[];
  /**
   * The whole new content an accept would write, for a proposed file.
   *
   * NULL FOR A GIT FILE, AND THAT IS LOAD-BEARING. A git-scope change is
   * already on disk; there is nothing to write. If such a file could reach
   * `acceptPlan`, Accept would PUT `undefined` and truncate it.
   */
  content: string | null;
  applied: ApplyState | null;
}

export interface ReviewState {
  scope: ReviewScope;
  /** The proposal being reviewed, when the scope is `last-turn`. */
  proposalId: string | null;
  title: string | null;
  /**
   * WHY the assistant believes this is the right change, or null.
   *
   * A title NAMES the change; this is what a reviewer needs in order to
   * disagree with it. Null is ordinary and draws nothing.
   */
  rationale: string | null;
  branch: string | null;
  files: ReviewFile[];
  loading: boolean;
  failure: string | null;
  /** The open comment composer, or null. One at a time, on purpose. */
  composing: { path: RepoPath; line: number } | null;
  /** The commit message being typed, for selective staging. */
  message: string;
  /** The last commit's sha, so the surface can say what it did. */
  committed: string | null;
}

/**
 * A comment has reached the agent, but not via a turn that exists yet.
 *
 * A comment is steered into the COMPOSER, where it sits until the reader
 * presses send — so at the moment it is handed over there is no turn and
 * therefore no id. Recording one would mean inventing it.
 *
 * Lives here rather than in `state/types.ts`, which declares types only and
 * has a test enforcing that no runtime value escapes the contract.
 */
export const COMMENT_HANDED = 'handed-to-composer';

export type ReviewAction =
  | { type: 'scope/set'; scope: ReviewScope }
  | { type: 'git/loading' }
  | { type: 'git/status'; branch: string; files: GitStatusFile[] }
  | { type: 'git/failed'; message: string }
  | { type: 'git/committed'; commit: string | null }
  | {
      type: 'proposal/load';
      proposalId: string;
      title: string | null;
      /** Why the assistant believes this is the right change, or null. */
      rationale: string | null;
      files: {
        path: string;
        content: string;
        decision?: FileDecision;
      }[];
    }
  | { type: 'diff/loading'; path: string }
  | { type: 'diff/loaded'; path: string; text: string }
  | { type: 'diff/set'; path: string; diff: DiffFileChange }
  | { type: 'diff/failed'; path: string; message: string }
  | { type: 'file/toggle'; path: string }
  | { type: 'file/decide'; path: string; decision: FileDecision }
  | { type: 'file/stage'; path: string; staged: boolean }
  | { type: 'apply/start'; path: string }
  | { type: 'apply/done'; path: string }
  | { type: 'apply/failed'; path: string; message: string }
  | { type: 'comment/open'; path: string; line: number }
  | { type: 'comment/cancel' }
  | { type: 'comment/add'; path: string; line: number; text: string; id: string; at: number }
  | { type: 'comment/sent'; ids: string[]; turnId: TurnId | typeof COMMENT_HANDED }
  | { type: 'message/draft'; text: string };

export function emptyReview(): ReviewState {
  return {
    scope: 'unstaged',
    proposalId: null,
    title: null,
    rationale: null,
    branch: null,
    files: [],
    loading: false,
    failure: null,
    composing: null,
    message: '',
    committed: null,
  };
}

/** One file, freshly listed. Optional decision seeds Accept/Deny from the store. */
function newFile(
  path: string,
  status: string,
  content: string | null,
  decision: FileDecision = 'pending',
): ReviewFile {
  return {
    path,
    status,
    decision,
    staged: false,
    /* EXPANDED BY DEFAULT, and this is a considered choice rather than a
       default that happened. Sheet 12's register is that work is quieter than
       talk — a tool row is one line — but this surface is not the transcript:
       the user opened it to read a diff, and a list of collapsed filenames is
       precisely what v1 shipped and what §5.1 P2 calls the gap. The header
       stays clickable so a long change can be folded down. */
    expanded: true,
    diff: null,
    diffState: 'idle',
    failure: null,
    comments: [],
    content,
    applied: null,
  };
}

/** Replace one file by path, or return the state unchanged when it is gone. */
function patch(
  state: ReviewState,
  path: string,
  change: (file: ReviewFile) => ReviewFile,
): ReviewState {
  const index = state.files.findIndex((f) => f.path === path);
  /* A RESPONSE FOR A FILE THAT IS NOT LISTED IS DROPPED, NOT APPENDED.
     A scope change while a request is in flight lands a diff for a path the
     surface is no longer showing; appending it would put a file on screen that
     the current scope never listed, which is a fabricated row. */
  if (index === -1) return state;
  const files = state.files.slice();
  files[index] = change(files[index]);
  return { ...state, files };
}

export function reviewReduce(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case 'scope/set': {
      if (action.scope === state.scope) return state;
      /* THE PREVIOUS SCOPE'S FILES ARE DROPPED, NEVER RELABELLED. Keeping them
         under a new heading is how "Staged" ends up showing the unstaged list
         and nobody notices, because the rows are all plausible. */
      return {
        ...emptyReview(),
        scope: action.scope,
        message: state.message,
      };
    }

    case 'git/loading':
      return { ...state, loading: true, failure: null };

    case 'git/status':
      return {
        ...state,
        loading: false,
        failure: null,
        branch: action.branch,
        proposalId: null,
        title: null,
        files: action.files.map((f) => newFile(f.path, f.status, null)),
      };

    case 'git/failed':
      /* A FAILURE IS NOT AN EMPTY TREE. "Nothing changed" and "the engine
         refused" paint the same the moment a failure is dropped, and the first
         is a good state while the second is not. */
      return { ...state, loading: false, failure: action.message, files: [] };

    case 'git/committed':
      return { ...state, committed: action.commit, message: '' };

    case 'proposal/load':
      return {
        ...state,
        scope: 'last-turn',
        loading: false,
        failure: null,
        proposalId: action.proposalId,
        title: action.title ?? null,
        rationale: action.rationale ?? null,
        branch: null,
        files: action.files.map((f) =>
          newFile(f.path, 'proposed', f.content, f.decision ?? 'pending'),
        ),
      };

    case 'diff/loading':
      return patch(state, action.path, (f) => ({ ...f, diffState: 'loading', failure: null }));

    case 'diff/loaded':
      return patch(state, action.path, (f) => {
        const parsed = parseUnifiedDiff(action.text);
        /* AN EMPTY DIFF IS "EMPTY", NOT "READY WITH NO HUNKS". The route
           documents an empty body for an untracked or unchanged file. Ready
           renders an expanded panel showing nothing, which reads as a broken
           viewer; empty renders a sentence saying why. */
        const own = parsed.find((p) => p.path === action.path) ?? parsed[0] ?? null;
        if (own === null || own.empty) {
          return { ...f, diff: null, diffState: 'empty', failure: null };
        }
        return { ...f, diff: own, diffState: 'ready', failure: null };
      });

    case 'diff/set':
      return patch(state, action.path, (f) => ({
        ...f,
        diff: action.diff,
        diffState: action.diff.empty ? 'empty' : 'ready',
        failure: null,
      }));

    case 'diff/failed':
      return patch(state, action.path, (f) => ({
        ...f,
        diffState: 'failed',
        failure: action.message,
      }));

    case 'file/toggle':
      return patch(state, action.path, (f) => ({ ...f, expanded: !f.expanded }));

    case 'file/decide':
      return patch(state, action.path, (f) => ({
        ...f,
        decision: action.decision,
        /* YOU CANNOT COMMIT WHAT YOU REFUSED. Leaving a rejected file staged
           is how a reject becomes decorative — the checkbox still carries it
           into `paths` and the commit lands anyway. */
        staged: action.decision === 'rejected' ? false : f.staged,
      }));

    case 'file/stage':
      return patch(state, action.path, (f) => ({ ...f, staged: action.staged }));

    case 'apply/start':
      return patch(state, action.path, (f) => ({ ...f, applied: 'writing', failure: null }));

    case 'apply/done':
      return patch(state, action.path, (f) => ({ ...f, applied: 'written' }));

    case 'apply/failed':
      return patch(state, action.path, (f) => ({
        ...f,
        applied: 'failed',
        failure: action.message,
      }));

    case 'comment/open':
      return { ...state, composing: { path: action.path, line: action.line } };

    case 'comment/cancel':
      return state.composing === null ? state : { ...state, composing: null };

    case 'comment/add': {
      /* A BLANK COMMENT IS REFUSED RATHER THAN ANCHORED. An empty marker on a
         line is a claim that somebody said something about it. */
      const text = action.text.trim();
      if (text === '') return state;
      const next = patch(state, action.path, (f) => ({
        ...f,
        comments: [
          ...f.comments,
          { id: action.id, line: action.line, text, sentWith: null, at: action.at },
        ],
      }));
      return next === state ? state : { ...next, composing: null };
    }

    case 'comment/sent': {
      const ids = new Set(action.ids);
      return {
        ...state,
        files: state.files.map((f) =>
          f.comments.some((c) => ids.has(c.id))
            ? {
                ...f,
                comments: f.comments.map((c) =>
                  ids.has(c.id) ? { ...c, sentWith: action.turnId } : c,
                ),
              }
            : f,
        ),
      };
    }

    case 'message/draft':
      return action.text === state.message ? state : { ...state, message: action.text };

    default:
      return state;
  }
}

/* ── the selectors, which are where the locks actually live ──────────────── */

/**
 * The exact writes an Accept must issue — and the only list it may write from.
 *
 * THIS IS THE LOCK IN ITS PURE FORM: "accepting one file of three writes only
 * that path". A file with no `content` cannot be written, so a git-scope row
 * can never reach a PUT even if it were somehow marked accepted; a file
 * already written is not written twice.
 */
export function acceptPlan(state: ReviewState): { path: string; content: string }[] {
  return state.files
    .filter((f) => f.decision === 'accepted' && f.content !== null && f.applied !== 'written')
    .map((f) => ({ path: f.path, content: f.content as string }));
}

/**
 * The `paths` body of `POST /api/git/commit` — selective staging.
 *
 * Ordered by the listing, not by click order, so two people who checked the
 * same three files produce byte-identical requests.
 */
export function stagedPaths(state: ReviewState): string[] {
  return state.files.filter((f) => f.staged).map((f) => f.path);
}

/** Every comment that has not been carried into a turn yet, with its file. */
export function pendingComments(state: ReviewState): { path: string; comment: LineComment }[] {
  const out: { path: string; comment: LineComment }[] = [];
  for (const file of state.files) {
    for (const comment of file.comments) {
      if (comment.sentWith === null) out.push({ path: file.path, comment });
    }
  }
  return out;
}

/**
 * The steering line a comment becomes in the composer — item 5.3.
 *
 * §5.2 item 3 calls this "the cheapest high-value item on the list", because it
 * turns review from a verdict into a steering instrument. The plan's own
 * locking test is "comment on line 42, assert the next turn's context carries
 * `path:42`" — so the ANCHOR IS IN THE TEXT, not only in a data attribute the
 * model never sees. The backticks are there for the same reason: a path in a
 * prompt reads as a path when it is fenced and as prose when it is not.
 *
 * Whitespace is collapsed so a pasted block stays one clause. Sheet 12.2's rule
 * for a tool row — "a row is one short clause" — is the same instinct: a
 * multi-line comment silently becomes a multi-paragraph instruction, and the
 * steering gets lost inside its own formatting.
 */
export function commentSteer(path: string, line: number, text: string): string {
  const clause = text.trim().replace(/\s+/g, ' ');
  return `\`${path}:${line}\` — ${clause}`;
}
