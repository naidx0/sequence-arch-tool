import { useEffect, useMemo, useState } from 'react';
import type { FunctionGraph } from '@sequence/schema';

import { ReviewPane, type ProposalSnapshot } from './ReviewPane';
import { createReviewClient, type ReviewClient } from './reviewClient';
import { useAppState, useStore } from '../state';
import type { ReviewScope } from '../state/types';

/* ══════════════════════════════════════════════════════════════════════════
   THE REVIEW SURFACE, WIRED — Wave 5
   packages/web2/src/review/ConnectedReview.tsx

   The only file on this lane that knows the store exists. `ReviewPane.tsx`
   takes props; everything about which store, or whether there is one, lives
   here — the shape `state/connect.tsx` uses for the chat column and
   `canvas/ConnectedBoard.tsx` for the board.

   ── ITEM 5.3, AND WHY IT IS TWO DISPATCHES AND NOT ONE ───────────────────

   §5.2 item 3 calls line-anchored comments "the cheapest high-value item on
   the list… it turns review from a verdict into a steering instrument". A
   comment has two halves and they land in two different places:

     THE ANCHOR is a grounded reference, and it goes through `composer/chip-add`
       — the store's OWN action, the same one the `@` picker uses, so a review
       chip and a mention chip are the same object and the composer has one list
       rather than two. The store dedupes chips by `ref`, which is why the ref
       is the PATH: three comments on one file are one chip.

     THE INSTRUCTION is prose, and it goes into `composer/draft`, because the
       draft is what a turn is actually built from. A chip alone would carry
       *which file* and lose *what to do about it*, which is the entire value.

   AND THE USER STILL PRESSES SEND. The comment lands in the composer where it
   can be read, edited and combined with two more before a turn goes out. A
   review comment that dispatched a turn by itself would make every stray note
   an agent run.

   ── THE HANDBACK, STATED PLAINLY ─────────────────────────────────────────

   THE REVIEW SLICE IS REDUCED IN `reviewModel.ts`, NOT IN `state/store.ts`,
   AND THAT IS A FILE-OWNERSHIP DECISION RATHER THAN A DESIGN ONE. `store.ts`
   ships eighteen actions and not one writes a review; adding the family means
   editing a file this lane does not own, and twelve agents sharing files cost
   this project a full repair cycle. The shapes are already frozen in
   `state/types.ts` (`FileEditProposal`, `ProposedFile`, `LineComment`,
   `ReviewScope`, `GitState`), so the fold is mechanical: add `ReviewAction` to
   `Action`, add one case returning `{...state, review: reviewReduce(...)}`,
   and change one `useReducer` to `useStore`.
   ══════════════════════════════════════════════════════════════════════════ */

export interface ConnectedReviewProps {
  /** Injected so a test can hand in a recorder. Defaults to the real client. */
  client?: ReviewClient;
  scope?: ReviewScope;
}

/** The stable empty client, so the pane does not remount every render. */
const DEFAULT_CLIENT = createReviewClient();

export function ConnectedReview({ client = DEFAULT_CLIENT, scope }: ConnectedReviewProps) {
  const store = useStore();
  const state = useAppState();

  /* ── the graph, read off the phase's own payload ────────────────────────
   * `stale` still paints: a stale graph is still a graph, and the staleness
   * bar is what says so. Reading it off an optional field instead would let a
   * failed scan leave a stale graph behind under an `unattached` phase. */
  const repo =
    state.repo.phase === 'attached' || state.repo.phase === 'stale' ? state.repo.repo : null;

  /* ── the last turn's proposal ───────────────────────────────────────────
   *
   * "Last turn" means the LAST one, not the newest proposal that happens to
   * still be pending. `turns` is oldest-first, so the scan walks backwards and
   * stops at the first assistant turn — if that turn proposed nothing, the
   * answer is null and the pane says the last turn proposed nothing. Falling
   * through to an older proposal would answer "what did the agent just do to
   * me" with something the agent did three turns ago. */
  const proposal = useMemo<ProposalSnapshot | null>(() => {
    for (let i = state.session.turns.length - 1; i >= 0; i -= 1) {
      const turn = state.session.turns[i];
      if (turn.role !== 'assistant') continue;
      const ids = turn.evidence?.proposals ?? [];
      if (ids.length === 0) return null;
      /*
       * ALL of the turn's proposals, not the newest one. Under propose there is
       * exactly one (the latch), so this is the same answer. Under Auto-edit /
       * Full a write→test→fix turn lands SEVERAL — and showing only the last
       * would answer "what did the agent just do to me" with a third of it.
       *
       * Merged by path, LAST write wins, because that is what is on disk: a
       * file edited twice in the turn shows its final content once, not two
       * rows disagreeing about the same path. The id is the last proposal's —
       * per-file Accept/Deny only exists while a proposal is pending, and a
       * pending proposal is always the turn's only one.
       */
      const found = ids
        .map((id) => state.session.proposals[id])
        .filter((p): p is NonNullable<typeof p> => p !== undefined);
      if (found.length === 0) return null;
      const last = found[found.length - 1];
      const byPath = new Map<string, { path: string; content: string; decision?: 'pending' | 'accepted' | 'rejected' }>();
      for (const p of found) {
        for (const f of p.files) {
          byPath.set(f.path, { path: f.path, content: f.content, decision: f.decision });
        }
      }
      return {
        id: last.id,
        rationale: last.rationale,
        title:
          found.length === 1
            ? last.title
            : `${found.length} edits this turn${last.title ? ` — latest: ${last.title}` : ''}`,
        files: [...byPath.values()],
      };
    }
    return null;
  }, [state.session.turns, state.session.proposals]);

  /* ── the function graph, for the impact panel's caller claim ────────────
   *
   * SEEDED FROM THE STORE, FETCHED ONCE IF ABSENT. `ScannedRepo.functions` is
   * documented as "absent until /api/functions is asked for — the rail fetches
   * it lazily", and the impact panel's strongest single claim (*you changed
   * lines 40–52, which is inside handleAuth(), which has 14 callers*) is the
   * one thing that needs it. Waiting for the rail to be opened first would
   * make that claim appear and disappear depending on which pane the user
   * happened to visit. The route is read-only and cached server-side.
   *
   * IT IS NOT WRITTEN BACK INTO THE STORE. `repo.functions` belongs to the
   * repo slice and this lane does not own `store.ts`; a second writer of that
   * field is how two panes come to disagree about what was scanned. */
  const [fetched, setFetched] = useState<FunctionGraph | null>(null);
  const functions = repo?.functions?.graph ?? fetched;

  useEffect(() => {
    if (repo === null || functions !== null) return undefined;
    const controller = new AbortController();
    let live = true;
    void (async () => {
      const answer = await client.functions(controller.signal);
      if (!live) return;
      /* A REFUSAL IS SILENCE HERE, ON PURPOSE, AND IT IS NOT A SWALLOWED
         ERROR: `computeReviewImpact` already renders "function-level callers
         need GET /api/functions" as a printed gap when the graph is null. A
         second failure message for the same absence would say the same thing
         twice, in two vocabularies. */
      if (answer.outcome === 'ok') setFetched(answer.body.functionGraph);
    })();
    return () => {
      live = false;
      controller.abort();
    };
  }, [client, repo, functions]);

  return (
    <ReviewPane
      client={client}
      proposal={proposal}
      graph={repo?.graph ?? null}
      functions={functions}
      scope={scope}
      onSteer={({ text, chip }) => {
        const draft = store.getState().composer.draft;
        /* The steering line is APPENDED, on its own line, so three comments
           become three clauses in one prompt rather than three overwrites. */
        store.dispatch({
          type: 'composer/draft',
          text: draft === '' ? text : `${draft}\n${text}`,
        });
        store.dispatch({ type: 'composer/chip-add', chip });
      }}
      /*
       * THE GRAPH IS NOW OUT OF DATE, AND THE APP SAYS SO.
       *
       * `PUT /api/file` clears the persisted graph cache WITHOUT re-scanning, so
       * from the instant an accepted edit lands, every claim the board makes is
       * grounded in a file that may no longer say what the citation says.
       * `RepoStale` and the four surfaces that branch on it have existed the
       * whole time; this prop existed with a doc comment saying exactly what it
       * was for, and nothing consumed it.
       */
      onWrote={(paths) => {
        store.dispatch({
          type: 'repo/stale',
          reason: 'file-written',
          changedPaths: paths,
          at: Date.now(),
        });
      }}
      onFileDecide={(proposalId, path, decision) => {
        store.dispatch({
          type: 'proposal/file-decide',
          proposalId,
          path,
          decision,
        });
      }}
      onApplyFinished={(proposalId, writtenPaths) => {
        store.dispatch({
          type: 'proposal/apply-finished',
          proposalId,
          writtenPaths,
        });
      }}
    />
  );
}
