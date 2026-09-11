import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ArchGraph, FunctionGraph } from '@sequence/schema';

import { DiffView } from './DiffView';
import { ImpactPanel } from './ImpactPanel';
import { REVIEW } from './anchors';
import type { GitRevisionsResponse } from './reviewClient';
import { REVIEW_SCOPES, scopeSupport } from './reviewScopes';
import { ReviewIcon } from './ReviewIcon';
import { changedRanges, diffFromProposedContent, diffTotals } from './diffModel';
import { computeReviewImpact } from './impactModel';
import { wireMessage, type ReviewClient } from './reviewClient';
import {
  acceptPlan,
  commentSteer,
  emptyReview,
  reviewReduce,
  stagedPaths,
  type ReviewFile,
} from './reviewModel';
import { COMMENT_HANDED } from './reviewModel';
import type { ContextChip, ReviewScope } from '../state/types';

/* ══════════════════════════════════════════════════════════════════════════
   THE REVIEW SURFACE — WAVE 5
   packages/web2/src/review/ReviewPane.tsx

   WHAT IT REPLACES, exactly. `FileEditProposalBar.tsx:24,40` rendered a LIST OF
   BARE FILENAMES (`fileEditProposalModel.ts:96-98`) with one whole-set Accept
   and one Deny (`:56-73`). No diff. No per-file control. No line comments.
   §5.1 P2 calls that the largest par gap on the list and prices it at 6–8 days.

   THIS FILE TAKES PROPS AND OWNS NO STORE. `ConnectedReview.tsx` is the only
   file on this lane that knows a store exists — the shape `state/connect.tsx`
   uses for the chat column and `ConnectedBoard.tsx` for the canvas. The
   reducer is `reviewReduce`, pure, over shapes `state/types.ts` already froze.

   ── THE FOUR THINGS THIS SURFACE REFUSES TO DO ───────────────────────────

     1. IT NEVER FABRICATES A DIFF. An empty body from GET /api/git/diff is an
        empty state with a sentence, not a rendered nothing.
     2. IT NEVER SHOWS THE SAME CONTENT UNDER FIVE NAMES. Three of the five
        scopes have no route behind them (`reviewScopes.ts`), and selecting one
        produces the route that would have to change — and fetches nothing.
     3. IT NEVER WRITES WHAT WAS NOT ACCEPTED. `acceptPlan` is the ONLY list
        the apply loop reads, and a file with no `content` cannot be in it.
     4. IT NEVER SAYS A NUMBER NOBODY MEASURED. Every count on the impact panel
        comes from a schema engine over the real graph, and the things that
        cannot be computed are printed as gaps.

   ── WHAT IS UNSHEETED HERE, DECLARED RATHER THAN ASSUMED ────────────────

   §5.6: the diff inspector "adapted from a training-metrics context" is one of
   ELEVEN surfaces the book does not cover, and the scope control, the accept
   ladder and the line-comment composer are not drawn anywhere in graphite/.
   The geometry is taken from the token file's §8 `--diffx-*` block and the
   control ladder (28px control, 26px icon button, compact type), which are the
   book's; the arrangement is this lane's, and it is design work, not
   transcription.
   ══════════════════════════════════════════════════════════════════════════ */

/** A proposal as the session holds it, reduced to what this surface needs. */
export interface ProposalSnapshot {
  id: string;
  title: string | null;
  /** Why the assistant believes this is the right change, or null. */
  rationale: string | null;
  files: {
    path: string;
    content: string;
    /** B4.2 — mirrored from `session.proposals` so remount keeps Accept/Deny. */
    decision?: 'pending' | 'accepted' | 'rejected';
  }[];
}

export interface ReviewPaneProps {
  client: ReviewClient;
  /** The last turn's `edit:proposal`, or null when it proposed nothing. */
  proposal: ProposalSnapshot | null;
  /** The attached graph. null when nothing is attached — never a stand-in. */
  graph: ArchGraph | null;
  functions: FunctionGraph | null;
  /** The scope to open on. Defaults to `unstaged`. */
  scope?: ReviewScope;
  /** Item 5.3: a line comment leaving for the composer. */
  onSteer: (steer: { text: string; chip: ContextChip }) => void;
  /** Fired with the paths a write actually landed on, so the host can mark the
   *  graph stale — PUT /api/file clears the cache without re-scanning. */
  onWrote?: (paths: string[]) => void;
  /** B4.2 — mirror per-file Accept/Deny into `session.proposals`. */
  onFileDecide?: (
    proposalId: string,
    path: string,
    decision: 'pending' | 'accepted' | 'rejected',
  ) => void;
  /** B4.2 — after Apply, sync written paths into the store proposal. */
  onApplyFinished?: (proposalId: string, writtenPaths: string[]) => void;
}

let commentSeq = 0;

export function ReviewPane({
  client,
  proposal,
  graph,
  functions,
  scope,
  onSteer,
  onWrote,
  onFileDecide,
  onApplyFinished,
}: ReviewPaneProps) {
  const [state, dispatch] = useReducer(reviewReduce, undefined, () => ({
    ...emptyReview(),
    scope: scope ?? 'unstaged',
  }));
  const [draft, setDraft] = useState('');
  /* The confirm arm for Revert. Local, because it is a gesture in progress
     rather than anything the store or a reload needs to agree about. */
  const [reverting, setReverting] = useState(false);

  const support = scopeSupport(state.scope);

  /* ── loading the scope ─────────────────────────────────────────────────
   *
   * ONE EFFECT, KEYED ON THE SCOPE, AND IT FETCHES NOTHING FOR A SCOPE THE
   * ENGINE CANNOT SERVE. A request fired for an unserved scope would put a
   * plausible list on screen under a name the engine never answered.
   *
   * The abort controller is not decoration here: a user stepping across the
   * segmented control fires a status request per segment, and without it the
   * last response to arrive wins rather than the last one asked for.
   * ─────────────────────────────────────────────────────────────────────── */
  /*
   * WHAT THE COMMIT AND BRANCH SCOPES WERE MISSING. The routes have existed
   * since the diff learned `?scope=`; a Commit scope that always meant HEAD
   * would have been the worktree scope wearing another word, so the pane needed
   * a way for a person to NAME one.
   *
   * `null` means "not chosen yet", which is a rendered state and not a default:
   * picking a revision on the reader's behalf is the thing this avoids.
   */
  const [revisions, setRevisions] = useState<GitRevisionsResponse | null>(null);
  const [rev, setRev] = useState<string | null>(null);
  const [base, setBase] = useState<string | null>(null);

  const clientRef = useRef(client);
  clientRef.current = client;

  useEffect(() => {
    if (!support.served) return undefined;

    if (support.source === 'session') {
      if (proposal === null) return undefined;
      dispatch({
        type: 'proposal/load',
        proposalId: proposal.id,
        title: proposal.title,
        rationale: proposal.rationale,
        files: proposal.files,
      });

      const controller = new AbortController();
      let live = true;
      void (async () => {
        for (const file of proposal.files) {
          if (!live) return;
          dispatch({ type: 'diff/loading', path: file.path });
          const one = await clientRef.current.diff(file.path, controller.signal);
          if (!live) return;
          if (one.outcome !== 'ok') {
            dispatch({ type: 'diff/failed', path: file.path, message: wireMessage(one) });
            continue;
          }
          const text = one.body.diff.trim();
          if (text === '') {
            dispatch({
              type: 'diff/set',
              path: file.path,
              diff: diffFromProposedContent(file.path, file.content),
            });
          } else {
            dispatch({ type: 'diff/loaded', path: file.path, text: one.body.diff });
          }
        }
      })();

      return () => {
        live = false;
        controller.abort();
      };
    }

    const controller = new AbortController();
    let live = true;
    dispatch({ type: 'git/loading' });

    void (async () => {
      const answer = await clientRef.current.status(controller.signal);
      if (!live) return;
      if (answer.outcome !== 'ok') {
        dispatch({ type: 'git/failed', message: wireMessage(answer) });
        return;
      }
      /*
       * ══ THE SCOPE FILTERS THE LIST, NOT JUST THE DIFF ════════════════════
       *
       * Requesting the staged diff per file was only half of it: the FILE LIST
       * was the whole dirty tree regardless of scope, so Staged showed rows
       * for files with nothing staged and each one rendered an empty diff.
       *
       * `staged` / `unstaged` now come off porcelain's two columns —
       * previously `classifyStatus` collapsed them into one word, so the wire
       * could not express the distinction and every file looked identical to
       * this filter.
       *
       * Only the two working-tree scopes filter. `commit` and `branch` are
       * diffs against a revision, where "staged" is not a property a file has.
       */
      const scoped =
        state.scope === 'staged'
          ? /* `!== false` rather than `=== true`: an OLDER SERVER does not send
               these flags at all, and hiding a real change because the server
               was old is a worse failure than showing one that turns out to be
               unstaged. Absent means "not told", never "no". */
            answer.body.files.filter((f) => f.staged !== false)
          : state.scope === 'unstaged'
            ? answer.body.files.filter((f) => f.unstaged !== false || f.status === 'untracked')
            : answer.body.files;

      dispatch({ type: 'git/status', branch: answer.body.branch, files: scoped });

      /* THE DIFFS ARE FETCHED PER FILE BECAUSE THE ROUTE IS PER FILE. GET
         /api/git/diff requires `?path` and 400s without it (`server/repoServer.ts`)
         — there is no whole-tree form. Sequential rather than parallel so a
         hundred dirty files do not open a hundred sockets at once. */
      for (const file of scoped) {
        if (!live) return;
        dispatch({ type: 'diff/loading', path: file.path });
        /* THE SCOPE REACHES THE WIRE. Requesting `staged` and rendering the
           worktree diff would be a segmented control that changes a label and
           nothing else — worse than the segment being marked unavailable,
           because the reader cannot tell. */
        /*
         * `state.scope`, NOT the `scope` PROP.
         *
         * The prop is optional and defaults to `unstaged`, and App.tsx mounts
         * <ConnectedReview /> with no props — so this read a value the user
         * could not change while the control beside it wrote and rendered
         * `state.scope`. Clicking Staged relabelled the segment and fetched the
         * worktree diff, which is precisely the failure the comment above says
         * this code exists to prevent: the reader cannot tell.
         *
         * Every test caught nothing because they all pass `scope` at mount,
         * which the application does not.
         */
        const one = await clientRef.current.diff(
          file.path,
          controller.signal,
          state.scope === 'staged'
            ? { kind: 'staged' }
            : state.scope === 'commit' && rev
              ? { kind: 'commit', rev }
              : state.scope === 'branch' && base
                ? { kind: 'branch', base }
                : { kind: 'worktree' },
        );
        if (!live) return;
        if (one.outcome === 'ok') {
          dispatch({ type: 'diff/loaded', path: file.path, text: one.body.diff });
        } else {
          dispatch({ type: 'diff/failed', path: file.path, message: wireMessage(one) });
        }
      }
    })();

    return () => {
      live = false;
      controller.abort();
    };
    /*
     * `rev` and `base` ARE dependencies. They arrive asynchronously — the
     * revision list is fetched after the scope changes — so without them the
     * pane fetched once with no revision chosen, rendered the worktree diff,
     * and never asked again. The reader would have been looking at the wrong
     * change under the right label, which is the exact defect the scope work
     * exists to prevent. Found by the test.
     */
  }, [state.scope, support.served, support.source, proposal, rev, base]);

  /* ── the impact, derived from what is actually on screen ───────────────── */
  const impact = useMemo(
    () =>
      computeReviewImpact({
        graph,
        functions,
        changes: state.files
          .filter((f) => f.diff !== null)
          .map((f) => ({ path: f.path, ranges: changedRanges(f.diff!) })),
      }),
    [graph, functions, state.files],
  );

  const plan = acceptPlan(state);
  const staged = stagedPaths(state);
  const totals = useMemo(
    () => diffTotals(state.files.map((f) => f.diff).filter((d): d is NonNullable<typeof d> => d !== null)),
    [state.files],
  );
  /**
   * The denominator for the +added/-removed beside it. `state.files` is the porcelain
   * status list and includes untracked entries that contribute no lines, so counting
   * it there put two different denominators in one sentence — the gate measured
   * "69 files +807 -57" against git's own "17 files changed, 807 insertions".
   * The untracked rows still render, each saying honestly that git has no committed
   * version to diff against; they are simply not what the line totals describe.
   */
  const diffedCount = useMemo(
    () => state.files.filter((f) => f.diff !== null).length,
    [state.files],
  );
  const headerFileCount =
    support.source === 'session' ? state.files.length : diffedCount;

  /* ── applying: the lock, and the loop that must read only the plan ─────── */
  useEffect(() => {
    /* `state.scope` for the same reason as the fetch above: the prop is not
       what the segmented control writes. */
    if (state.scope !== 'commit' && state.scope !== 'branch') return undefined;
    if (revisions !== null) return undefined;
    const controller = new AbortController();
    let live = true;
    void (async () => {
      const answer = await clientRef.current.revisions(controller.signal);
      if (!live || answer.outcome !== 'ok') return;
      setRevisions(answer.body);
      /* Seeded with the obvious choice and NOT applied until the reader leaves
         it alone: the newest commit, and the branch HEAD is on. Nothing is
         fetched until a choice exists, so the pane never renders a diff of a
         revision nobody picked. */
      setRev((r) => r ?? answer.body.commits[0]?.sha ?? null);
      setBase((b) => b ?? answer.body.branches.find((x) => x !== answer.body.head) ?? null);
    })();
    return () => {
      live = false;
      controller.abort();
    };
    /* `state.scope`, matching the body. A dependency list naming the PROP while
       the body reads the STATE is the stale-closure defect that put the wrong
       revision under the right label in this same component before: the effect
       simply never re-runs when the reader switches scope. */
  }, [state.scope, revisions]);

  const apply = useCallback(async () => {
    const writes = acceptPlan(state);
    if (writes.length === 0) return;

    /*
     * A RESTORE POINT, TAKEN BEFORE THE FIRST BYTE LANDS.
     *
     * The engine tracked every write's pre-write baseline and nothing ever
     * froze one into a checkpoint, so `/api/checkpoints` answered with an
     * empty list forever and the Rewind panel told every real user "No
     * checkpoints yet" - under copy promising one is taken before a turn edits
     * files. The capability was complete on both sides of a call nobody made.
     *
     * HERE is the honest boundary: an apply is the moment the product changes
     * the user's tree on their behalf, and it is the thing they would want
     * undone. Taken BEFORE the loop, because a restore point captured after
     * the writes is a restore point to the state you are trying to escape.
     *
     * Failure to checkpoint does NOT block the apply. The user asked for the
     * edit; refusing it because a safety net could not be hung would trade
     * their actual request for a hypothetical one. It is surfaced instead.
     */
    const point = await clientRef.current.checkpoint(
      `Before applying ${writes.length} ${writes.length === 1 ? 'file' : 'files'}`,
    );
    if (point.outcome !== 'ok') {
      dispatch({
        type: 'apply/failed',
        path: writes[0]!.path,
        message: `could not take a restore point first: ${wireMessage(point)}`,
      });
    }

    const landed: string[] = [];
    for (const write of writes) {
      dispatch({ type: 'apply/start', path: write.path });
      const answer = await clientRef.current.writeFile(write.path, write.content);
      if (answer.outcome === 'ok') {
        dispatch({ type: 'apply/done', path: write.path });
        landed.push(answer.body.path ?? write.path);
      } else {
        dispatch({ type: 'apply/failed', path: write.path, message: wireMessage(answer) });
      }
    }
    if (landed.length > 0) onWrote?.(landed);
    if (proposal !== null) onApplyFinished?.(proposal.id, landed);
  }, [state, onWrote, onApplyFinished, proposal]);

  /*
   * THROW THE SELECTED CHANGES AWAY.
   *
   * Only ever the SELECTED paths - the server refuses an empty list outright
   * ("discard never applies to the whole tree") rather than guessing
   * destructively, and this must never be the caller that loses its argument.
   *
   * The graph is stale afterwards for the same reason it is after an apply:
   * the files on disk no longer say what the board's citations say. `onWrote`
   * is the existing signal for exactly that, so discarding reuses it rather
   * than inventing a second staleness path.
   */
  const discard = useCallback(async () => {
    const paths = stagedPaths(state);
    if (paths.length === 0) return;
    setReverting(false);
    const answer = await clientRef.current.discard(paths);
    if (answer.outcome !== 'ok') {
      dispatch({ type: 'apply/failed', path: paths[0]!, message: wireMessage(answer) });
      return;
    }
    onWrote?.(answer.body.discarded ?? paths);
  }, [state, onWrote]);

  const commit = useCallback(async () => {
    const paths = stagedPaths(state);
    if (paths.length === 0 || state.message.trim() === '') return;
    const answer = await clientRef.current.commit(state.message.trim(), paths);
    if (answer.outcome === 'ok') dispatch({ type: 'git/committed', commit: answer.body.commit ?? null });
    else dispatch({ type: 'git/failed', message: wireMessage(answer) });
  }, [state]);

  const sendComment = useCallback(
    (path: string, line: number, text: string) => {
      const clause = text.trim();
      if (clause === '') return;
      commentSeq += 1;
      const id = `rvc-${commentSeq}`;
      dispatch({ type: 'comment/add', path, line, text: clause, id, at: Date.now() });
      setDraft('');
      /* THE CHIP'S `ref` IS THE PATH AND NOTHING ELSE. `ContextChip` documents
         it as "a real ArchNode.id, a repo-relative path, or a FunctionId", and
         `path:line` is none of those — the store dedupes chips BY REF, so a
         second comment on the same file must resolve to the same chip. The
         line lives in the label and in the steering line, which is what the
         model actually reads. */
      onSteer({
        text: commentSteer(path, line, clause),
        chip: { id: `file:${path}`, kind: 'file', ref: path, label: `${path}:${line}`, nodeKind: null },
      });

      /*
       * AND THE COMMENT IS MARKED AS HANDED OVER.
       *
       * `comment/sent` has had a reducer since comments existed and was
       * dispatched by NOBODY, so every comment read "not sent" forever — the
       * reader could not tell which of their notes the agent already had, and
       * `unsentComments` collected all of them every time.
       *
       * Marked here rather than when the turn is sent, because this is the
       * moment the comment leaves review: it is in the composer, it will go
       * with the next ask, and the product must not offer it again.
       */
      dispatch({ type: 'comment/sent', ids: [id], turnId: COMMENT_HANDED });
    },
    [onSteer],
  );

  return (
    <section
      className="rv-scope rv-pane"
      data-testid={REVIEW.root}
      data-scope={state.scope}
      aria-label="Review"
    >
      {/* ── the scope segmented control — item 5.4 ──────────────────────── */}
      <div className="rv-scopebar" data-testid={REVIEW.scopeBar} role="group" aria-label="Review scope">
        {REVIEW_SCOPES.map((spec) => (
          <button
            key={spec.scope}
            type="button"
            className="rv-seg"
            data-testid={REVIEW.scopeSeg}
            data-scope={spec.scope}
            data-served={spec.served ? 'yes' : 'no'}
            aria-pressed={spec.scope === state.scope}
            onClick={() => dispatch({ type: 'scope/set', scope: spec.scope })}
          >
            {spec.label}
          </button>
        ))}
      </div>

      {/* THE PICKER — the thing the commit and branch scopes were missing.
          Shown only for the two scopes that need a name, because a control that
          is meaningless for three of five segments is worse than no control. */}
      {(state.scope === 'commit' || state.scope === 'branch') && revisions !== null ? (
        <div className="rv-revpicker" data-testid={REVIEW.revPicker}>
          {state.scope === 'commit' ? (
            <label className="rv-revlabel">
              <span>Commit</span>
              <select
                className="rv-revselect"
                data-testid="review-rev-select"
                value={rev ?? ''}
                onChange={(e) => setRev(e.target.value || null)}
              >
                {revisions.commits.length === 0 ? (
                  <option value="">no commits yet</option>
                ) : (
                  revisions.commits.map((c) => (
                    <option key={c.sha} value={c.sha}>
                      {/* The short sha AND the subject: a list of forty-character
                          hashes is a list nobody can choose from. */}
                      {c.shortSha} · {c.subject}
                    </option>
                  ))
                )}
              </select>
            </label>
          ) : (
            <label className="rv-revlabel">
              <span>Base</span>
              <select
                className="rv-revselect"
                data-testid="review-base-select"
                value={base ?? ''}
                onChange={(e) => setBase(e.target.value || null)}
              >
                {revisions.branches.length === 0 ? (
                  <option value="">no branches</option>
                ) : (
                  revisions.branches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                      {b === revisions.head ? ' (current)' : ''}
                    </option>
                  ))
                )}
              </select>
            </label>
          )}
        </div>
      ) : null}

      {/* WHAT WAS ACTUALLY MEASURED. "Unstaged" is the segment's word; `git
          diff HEAD` is the engine's answer, and it includes staged changes.
          Saying only the first would be a quiet lie in the one place the
          reader is deciding whether to trust the rest. */}
      {support.served ? (
        <p className="rv-prov" data-testid={REVIEW.provenance}>
          <span className="rv-prov-tag">Measured</span>
          <span>{support.measures}</span>
          {support.caveat === null ? null : <span className="rv-prov-caveat">{support.caveat}</span>}
        </p>
      ) : null}

      {!support.served ? (
        <div className="rv-gap" data-testid={REVIEW.gap}>
          <ReviewIcon name="alert" size={14} />
          <div>
            <strong>The engine cannot answer this scope yet.</strong>
            <p>It is missing {support.missing}.</p>
          </div>
        </div>
      ) : null}

      {support.served ? (
        <div className="rv-body">
          <div className="rv-files">
            <header className="rv-head" data-testid={REVIEW.head}>
              <span className="rv-head-what">
                {state.title ?? (state.branch === null ? 'Changes' : 'Working tree')}
              </span>
              {state.branch === null ? null : (
                <span className="rv-head-branch mono">
                  <ReviewIcon name="branch" size={12} />
                  {state.branch}
                </span>
              )}
              <span className="rv-totals mono" data-testid={REVIEW.totals}>
                {/*
                  COUNT WHAT THE NUMBERS BESIDE IT DESCRIBE. `state.files` is the
                  porcelain status list, which includes untracked entries that
                  contribute no lines; the +added/-removed beside it come only from
                  files that HAVE a diff. The gate measured the mismatch on this repo:
                  the header read "69 files +807 -57" while `git diff --shortstat`
                  says 17 files changed, 807 insertions, 57 deletions. Two
                  denominators in one sentence is a wrong number, not a rounding.
                */}
                {headerFileCount} file{headerFileCount === 1 ? '' : 's'}
                {totals.added + totals.removed > 0 ? (
                  <>
                    {' '}
                    <span className="rv-stat-add">+{totals.added}</span>{' '}
                    <span className="rv-stat-del">−{totals.removed}</span>
                  </>
                ) : null}
              </span>
            </header>

            {/*
              * WHY THIS CHANGE — the thing a reviewer needs in order to
              * disagree with it.
              *
              * A topology proposal has carried a rationale from the start and
              * the board renders it; a CODE proposal could not, so the most
              * consequential thing this product does arrived as a title and a
              * diff. Null draws NOTHING rather than an empty row: a model with
              * nothing to add beyond the title must not have prose invented
              * for it.
              */}
            {state.rationale === null ? null : (
              <p className="rv-why" data-testid={REVIEW.why}>
                {state.rationale}
              </p>
            )}

            {state.loading && state.files.length === 0 ? (
              <p className="rv-note" data-testid={REVIEW.loading}>
                Reading the working tree…
              </p>
            ) : null}

            {state.failure !== null ? (
              <div className="rv-failure" data-testid={REVIEW.failure}>
                <ReviewIcon name="alert" size={14} />
                <span>{state.failure}</span>
              </div>
            ) : null}

            {state.failure === null && !state.loading && state.files.length === 0 ? (
              <p className="rv-note" data-testid={REVIEW.empty}>
                {support.source === 'session'
                  ? 'The last turn proposed no file edits. Nothing here has touched the disk.'
                  : `Nothing has changed on ${state.branch ?? 'this branch'} since the last commit.`}
              </p>
            ) : null}

            {state.files.map((file) => (
              <FileBlock
                key={file.path}
                file={file}
                composing={state.composing?.path === file.path ? state.composing.line : null}
                draft={draft}
                onDraft={setDraft}
                onToggle={() => dispatch({ type: 'file/toggle', path: file.path })}
                onDecide={(decision) => {
                  dispatch({ type: 'file/decide', path: file.path, decision });
                  if (proposal !== null) {
                    onFileDecide?.(proposal.id, file.path, decision);
                  }
                }}
                onStage={(next) => dispatch({ type: 'file/stage', path: file.path, staged: next })}
                onComment={(line) => {
                  setDraft('');
                  dispatch({ type: 'comment/open', path: file.path, line });
                }}
                onCancel={() => dispatch({ type: 'comment/cancel' })}
                onSend={(line, text) => sendComment(file.path, line, text)}
              />
            ))}

            {/* ── the two actions, and they are different actions ────────
                Apply writes proposed content that is not on disk yet.
                Commit records what IS on disk. Merging them into one "Accept"
                is v1's whole-set button returning by another name. */}
            {support.source === 'session' ? (
              <div className="rv-actions">
                <button
                  type="button"
                  className="rv-btn rv-btn-solid"
                  data-testid={REVIEW.apply}
                  disabled={plan.length === 0}
                  onClick={() => void apply()}
                >
                  <ReviewIcon name="check" size={14} />
                  Apply {plan.length} accepted file{plan.length === 1 ? '' : 's'}
                </button>
                <span className="rv-note">
                  Nothing is written until this is clicked, and only accepted files are written.
                </span>
              </div>
            ) : (
              <div className="rv-actions">
                <input
                  className="rv-field"
                  data-testid={REVIEW.commitMessage}
                  value={state.message}
                  placeholder="Commit message"
                  aria-label="Commit message"
                  onChange={(event) => dispatch({ type: 'message/draft', text: event.target.value })}
                />
                <button
                  type="button"
                  className="rv-btn rv-btn-solid"
                  data-testid={REVIEW.commit}
                  disabled={staged.length === 0 || state.message.trim() === ''}
                  onClick={() => void commit()}
                >
                  <ReviewIcon name="commit" size={14} />
                  Commit {staged.length} file{staged.length === 1 ? '' : 's'}
                </button>
                {/*
                  * REVERT IS LIVE NOW, and its old tooltip had become a lie.
                  *
                  * It sat disabled saying "No route discards a working-tree
                  * change: the engine serves /api/git/status, /api/git/diff and
                  * /api/git/commit only." `/api/git/discard` shipped and the
                  * sentence was never revisited, so the product was telling the
                  * reader a falsehood about itself - worse than the missing
                  * feature, because it teaches them to stop looking.
                  *
                  * A CONFIRM ARM, because this is the one genuinely
                  * irreversible act here: the content is not in the index, not
                  * in a commit, and not recoverable by git once it is gone. The
                  * confirm NAMES THE COUNT rather than asking "are you sure",
                  * which is a question nobody reads.
                  */}
                {reverting ? (
                  <>
                    <button
                      type="button"
                      className="rv-btn rv-btn-solid"
                      data-testid={REVIEW.revertConfirm}
                      onClick={() => void discard()}
                    >
                      Throw away {staged.length} file{staged.length === 1 ? '' : 's'}
                    </button>
                    <button
                      type="button"
                      className="rv-btn"
                      data-testid={REVIEW.revertCancel}
                      onClick={() => setReverting(false)}
                    >
                      Keep them
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="rv-btn"
                    data-testid={REVIEW.revert}
                    disabled={staged.length === 0}
                    title={
                      staged.length === 0
                        ? 'Nothing is selected to throw away.'
                        : 'Throw away the selected changes. This cannot be undone.'
                    }
                    onClick={() => setReverting(true)}
                  >
                    Revert
                  </button>
                )}
                {state.committed === null ? null : (
                  <span className="rv-note mono">committed {state.committed}</span>
                )}
              </div>
            )}
          </div>

          <ImpactPanel impact={impact} />
        </div>
      ) : null}
    </section>
  );
}

/* ── one file ────────────────────────────────────────────────────────────── */

interface FileBlockProps {
  file: ReviewFile;
  composing: number | null;
  draft: string;
  onDraft: (text: string) => void;
  onToggle: () => void;
  onDecide: (decision: 'accepted' | 'rejected' | 'pending') => void;
  onStage: (staged: boolean) => void;
  onComment: (line: number) => void;
  onCancel: () => void;
  onSend: (line: number, text: string) => void;
}

function FileBlock({
  file,
  composing,
  draft,
  onDraft,
  onToggle,
  onDecide,
  onStage,
  onComment,
  onCancel,
  onSend,
}: FileBlockProps) {
  const proposed = file.content !== null;

  return (
    <article
      className="rv-file"
      data-testid={REVIEW.file}
      data-path={file.path}
      data-decision={file.decision}
      data-expanded={file.expanded ? 'yes' : 'no'}
      data-staged={file.staged ? 'yes' : 'no'}
      {...(file.applied === null ? {} : { 'data-applied': file.applied })}
    >
      <header className="rv-file-hd" data-testid={REVIEW.fileHead}>
        <button
          type="button"
          className="rv-disclose"
          aria-expanded={file.expanded}
          aria-label={`${file.expanded ? 'Collapse' : 'Expand'} ${file.path}`}
          onClick={onToggle}
        >
          <ReviewIcon name={file.expanded ? 'chevdown' : 'chevright'} size={12} />
        </button>
        <ReviewIcon name="file" size={12} />
        <span className="rv-file-path mono" data-testid={REVIEW.filePath}>
          {file.path}
        </span>
        <span className="rv-file-status">{file.status}</span>

        {file.diff === null ? null : (
          <>
            <span className="rv-stat-add" data-testid={REVIEW.statAdd}>
              +{file.diff.added}
            </span>
            <span className="rv-stat-del" data-testid={REVIEW.statDel}>
              −{file.diff.removed}
            </span>
          </>
        )}

        <span className="rv-file-controls">
          {proposed ? (
            <>
              {/* ONE DECISION PER FILE. This is the whole of item 5.2: v1's
                  only way to reject one file of three was to reject all three
                  and ask again. */}
              <button
                type="button"
                className="rv-icon-btn"
                data-testid={REVIEW.accept}
                aria-pressed={file.decision === 'accepted'}
                aria-label={`Accept ${file.path}`}
                onClick={() => onDecide(file.decision === 'accepted' ? 'pending' : 'accepted')}
              >
                <ReviewIcon name="check" size={14} />
              </button>
              <button
                type="button"
                className="rv-icon-btn"
                data-testid={REVIEW.reject}
                aria-pressed={file.decision === 'rejected'}
                aria-label={`Reject ${file.path}`}
                onClick={() => onDecide(file.decision === 'rejected' ? 'pending' : 'rejected')}
              >
                <ReviewIcon name="x" size={14} />
              </button>
            </>
          ) : (
            <label className="rv-stage">
              <input
                type="checkbox"
                data-testid={REVIEW.stage}
                checked={file.staged}
                aria-label={`Stage ${file.path}`}
                onChange={(event) => onStage(event.target.checked)}
              />
              <span>Stage</span>
            </label>
          )}
        </span>
      </header>

      {file.expanded ? (
        <>
          {file.diffState === 'loading' ? <p className="rv-note">Reading the diff…</p> : null}

          {file.diffState === 'failed' ? (
            <p className="rv-note rv-note-fail" data-testid={REVIEW.fileFailure}>
              {file.failure}
            </p>
          ) : null}

          {/* AN EMPTY DIFF IS A SENTENCE, NOT A BLANK PANEL. GET /api/git/diff
              documents an empty body for an untracked file — git has nothing to
              compare it against, and saying so is the honest answer. */}
          {file.diffState === 'empty' ? (
            <p className="rv-note" data-testid={REVIEW.fileEmpty}>
              {file.status === 'untracked'
                ? 'Untracked — git has no committed version to diff this against.'
                : 'The engine returned no diff for this path.'}
            </p>
          ) : null}

          {file.diff !== null && file.diff.binary ? (
            <p className="rv-note" data-testid={REVIEW.fileBinary}>
              Binary file — there are no lines to show.
            </p>
          ) : null}

          {file.diff !== null && !file.diff.binary ? (
            <DiffView
              file={file.diff}
              comments={file.comments}
              composing={composing}
              draft={draft}
              onDraft={onDraft}
              onComment={onComment}
              onCancel={onCancel}
              onSend={onSend}
            />
          ) : null}
        </>
      ) : null}
    </article>
  );
}
