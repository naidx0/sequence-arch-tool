import { useEffect, useRef, useState } from 'react';

import './boot.css';

import { AttachDialog } from './AttachDialog';
import type { BootOutcome, BootTransport, ScannedRepoDraft } from './bootSequence';
import { attachFailureCopy } from './attachFailure';
import type { FailureTone } from './attachFailure';
import { Glyph } from './icons';
import type { GlyphName } from './icons';
import { useBoot } from './useBoot';

/**
 * ⚠ NOT MOUNTED, AND THAT IS A DECISION — DO NOT "FIX" IT BY MOUNTING IT.
 *
 * `seat-walk(W1)` (`34b6a38e`, 2026-08-25) removed this third region on purpose:
 * "Unattached no longer mounts an empty BootSurface third region; chat fills the
 * frame with an attach CTA." Four other files already record the same decision
 * (`Shell.tsx`, `Transcript.tsx`, `Board.test.tsx`, `connect.tsx`'s
 * `ConnectedBootHydrate`, which runs this ladder headlessly and paints nothing).
 *
 * IT HAS NOW BEEN PROPOSED TWICE that this is dead code nobody can reach and
 * should be wired up. It is reachable-by-design-decision, not by oversight, and
 * the replacement was checked in the running app on 2026-09-02 rather than
 * assumed:
 *
 *   · UNATTACHED (`app --port 4174`, no `--repo`): the titlebar carries an
 *     enabled, visible "Open a repository" button; the composer says "no repo
 *     attached". Chat fills the frame, exactly as the seat walk describes.
 *   · ATTACHED: the repo-name button is labelled "<repo> — Leave or open
 *     another" and opens "Leave project" / "Open another repository". That also
 *     closes `docs/OWNER-WALK-2026-08-22.md` A1, which reported that every
 *     attach route vanished once a repo was attached — it no longer does.
 *
 * So the surface a reader meets before attaching is chat plus a persistent
 * affordance, which beats a full-frame splash that disappears forever after
 * first use. Mounting this again would reverse the seat walk, and a standing
 * ruling is the owner's to overturn — not a build's, and not a passing reader's.
 *
 * KEPT RATHER THAN DELETED because `useBoot` is independently tested
 * (`useBoot.test.tsx`) and this file plus `preview.tsx` are a working, contrast-
 * audited rendering of every boot outcome — cheap to keep, and the thing anyone
 * would have to rewrite if a real first-run screen is ever specified. If it is
 * still unmounted when someone next reads this: deleting it is a legitimate
 * answer, but it is a deliberate removal to propose, not a tidy-up to perform.
 *
 * ── ORIGINAL HEADER ───────────────────────────────────────────────────────
 *
 * ITEM 2.4 — THE FIRST THING A USER MEETS.
 *
 * WHAT THIS SURFACE IS. It is the state of the world before there is a board:
 * the probe, its answer, and one sentence about it. The shell hosts it in the
 * canvas region; it is not a lid over the app and it is not a splash screen.
 * Sheet 08.5 names the thing it must not be, in the book's own words:
 * docs/brand/graphite/pages/08-board-density-and-overflow.html — "an opaque
 * sheet pinned over the whole canvas carrying one paragraph — no icon, no
 * frame, no radius, and no statement of why. It reads as a crash."
 *
 * THE ONE RULE IT OBEYS EVERYWHERE. Sheet 08.5 again: "Every empty state
 * carries the same three parts: what is not here, why it is not here, and one
 * thing to do about it. The second part is the one that gets dropped, and
 * dropping it turns an empty board into a bug report the reader has to file
 * themselves." Every branch of {@link describe} below returns all three, and
 * the return type makes the third compulsory so an edit cannot quietly lose it.
 *
 * WHAT IT REFUSES TO DO, AND WHY THAT IS THE POINT.
 *   · It never renders a graph it does not have. There is no zeroed summary,
 *     no placeholder board, no skeleton in the shape of a repo. `CLAUDE.md`:
 *     grounded, not guessed.
 *   · It never renders a red wall for a server that is not running. Local-first
 *     is a non-negotiable — an engine that is not up is the supported case, not
 *     a fault — so `no-engine` is `plain`, and the only tone that spends a hue
 *     is a scan that actually threw.
 *   · It never shows an indeterminate spinner as an answer. `probing` is a
 *     real, named, momentary state with its own sentence, and every other state
 *     is terminal.
 *
 * UNSHEETED. The book covers the graph domain; §5.6 of the plan lists the
 * attach dialog among the eleven surfaces it does not cover, and boot is part
 * of the same lane. Everything here that is not the `.empty` box, its three
 * parts, the control ladder or a glyph is designed by this item and is called
 * out as such in `boot.css`.
 */

export interface BootSurfaceProps {
  transport: BootTransport;
  /**
   * WHERE THE BOOT LADDER'S ANSWER GOES, AND THE REASON IT HAD TO EXIST.
   *
   * This lane's own handback (`boot/index.ts`) says the store "maps the
   * outcome onto the frozen `RepoSlice` with one switch", and `store.ts` has
   * that switch — `boot/settled` → `bootSettled`. What did not exist was any
   * way for the outcome to LEAVE this component: `useBoot` is called inside
   * it, the outcome is rendered and then dropped. The Wave 3 gate measured the
   * consequence in the shipped bundle: `boot/settled` was dispatched by
   * nothing, the store never left `unattached`, and the board drew zero nodes
   * against a repository that had been read successfully.
   *
   * `onRepoLoaded` below did NOT cover this. It fires only when the attach
   * DIALOG succeeds — the path a user takes by hand — so an app that boots
   * onto an already-attached engine, or onto a served graph file, reached no
   * store at all. Two callbacks, because they are two different events: "the
   * ladder finished, here is what it found" and "a person just attached
   * something".
   *
   * Optional, like the other two, so the lane still mounts standalone.
   */
  onSettled?: (outcome: BootOutcome) => void;
  /**
   * Where a loaded repo goes. Optional today: item 2.2 owns the store, and
   * until it exists the boot lane can be mounted standalone and still be
   * exercised end to end.
   */
  onRepoLoaded?: (repo: ScannedRepoDraft) => void;
  /**
   * Let the shell own the attach overlay (`shell.overlay = {kind:'attach'}`).
   * When absent, this surface hosts the dialog itself so the lane is complete
   * on its own — see the handback.
   */
  onOpenAttach?: () => void;
}

export function BootSurface({
  transport,
  onSettled,
  onRepoLoaded,
  onOpenAttach,
}: BootSurfaceProps) {
  const { state, retry } = useBoot(transport);
  const [attachOpen, setAttachOpen] = useState(false);

  /*
   * HAND THE OUTCOME ON, ONCE PER OUTCOME.
   *
   * The dependency is the OUTCOME OBJECT, never the callback. `useBoot` holds
   * the outcome in `useState`, so its identity changes exactly when the boot
   * ladder produces a new answer — first settle, and each retry. The callback,
   * by contrast, is rebuilt on every render by whoever composed the props
   * (`bootSurfacePropsFrom` builds a fresh closure each call), so a dependency
   * array containing it is a dispatch on every render, which is a render loop
   * through the store. The ref is what lets the effect always call the CURRENT
   * callback while depending only on the value that actually changed — the
   * same shape, and for the same reason, as the transport ref in `useBoot`.
   */
  const settled = state.phase === 'settled' ? state.outcome : null;
  const handOn = useRef(onSettled);
  handOn.current = onSettled;

  useEffect(() => {
    if (settled !== null) handOn.current?.(settled);
  }, [settled]);

  const described =
    state.phase === 'probing' ? PROBING : describe(state.outcome);
  const kind = state.phase === 'probing' ? 'probing' : state.outcome.kind;
  const repo = state.phase === 'settled' ? repoOf(state.outcome) : null;

  const openAttach = () => {
    if (onOpenAttach) onOpenAttach();
    else setAttachOpen(true);
  };

  return (
    <div
      className="startup"
      data-testid="boot-surface"
      data-state={kind}
      data-tone={described.tone}
    >
      <span className="startup-state" data-testid="boot-state">
        {kind}
      </span>

      <section className="startup-empty">
        <span className="startup-glyph">
          <Glyph name={described.glyph} size={20} />
        </span>

        <h2 className="startup-title" data-testid="boot-title">
          {described.title}
        </h2>

        {/* Part two. The one that gets dropped. */}
        <p className="startup-why" data-testid="boot-message">
          {described.why}
        </p>

        {/* What was actually reported, kept apart from what we wrote. */}
        {described.detail !== null && (
          <p className="startup-detail" data-testid="boot-detail">
            {described.detail}
          </p>
        )}

        {/*
         * The repo strip is rendered ONLY when a repo was actually read. There
         * is no zero state for it: "0 nodes" is a measurement nobody took, and
         * a summary that renders on an absent graph is exactly the fabrication
         * the grounding invariant forbids.
         */}
        {repo !== null && (
          <>
            <span className="startup-repo" data-testid="boot-repo-name">
              {repo.repoName}
            </span>
            <span className="startup-counts" data-testid="boot-summary">
              <span>{repo.summary.nodes} nodes</span>
              <span>{repo.summary.edges} edges</span>
              <span>{repo.summary.services} services</span>
              <span>{repo.summary.datastores} datastores</span>
              <span>{repo.summary.topics} topics</span>
            </span>
          </>
        )}

        {/* Part three. One thing to do. */}
        {described.action !== null && (
          <button
            type="button"
            className={`startup-btn${described.action.emphasis === 'solid' ? ' solid' : ''}`}
            data-testid="boot-action"
            onClick={described.action.intent === 'attach' ? openAttach : retry}
          >
            {described.action.intent === 'retry' && <Glyph name="refresh" size={12} />}
            {described.action.label}
          </button>
        )}
      </section>

      {attachOpen && (
        <div className="attach-scrim">
          <AttachDialog
            transport={transport}
            onAttached={(draft) => {
              setAttachOpen(false);
              onRepoLoaded?.(draft);
              /* The probe is asked again rather than the outcome being written
               * by hand: after an attach the platform's own answer is the
               * truth, and a client that patches its own state here is a second
               * source of it. */
              retry();
            }}
            onClose={() => setAttachOpen(false)}
          />
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- *
 * The copy table. One entry per state, three parts each.
 * -------------------------------------------------------------------------- */

interface Described {
  glyph: GlyphName;
  /** What is not here. */
  title: string;
  /** Why it is not here. */
  why: string;
  /** What was actually reported, when a machine reported anything. Never our
   *  words — see FailureCopy.detail for why it is kept separate. */
  detail: string | null;
  /** One thing to do about it. `null` only while the answer is still unknown. */
  action: { label: string; intent: 'attach' | 'retry'; emphasis?: 'solid' } | null;
  tone: FailureTone;
}

/**
 * The momentary state, and the only one with no action.
 *
 * Offering a control before the answer is known would be offering a guess: on a
 * machine where the engine IS running, "the engine is not running · Try again"
 * flashing for 40ms is a false statement that happens to be brief.
 */
const PROBING: Described = {
  glyph: 'board',
  title: 'Looking for the engine',
  why: 'Asking this page’s own address whether a Sequence engine is running behind it.',
  detail: null,
  action: null,
  tone: 'plain',
};

function describe(outcome: BootOutcome): Described {
  switch (outcome.kind) {
    case 'attached':
      return {
        glyph: 'board',
        title: 'Repository attached',
        why: 'The engine answered and handed over the graph it already holds. The board draws it next.',
        detail: null,
        action: null,
        tone: 'plain',
      };

    case 'unattached':
      /* The book's own copy for this exact state, transcribed from sheet 08.5's
       * first specimen — "No graph yet · Nothing has been read. Point at a
       * folder and the board draws what is actually there. · Open a
       * repository". It is the one state on this surface the book does draw. */
      return {
        glyph: 'board',
        title: 'No graph yet',
        why: 'Nothing has been read. Point at a folder and the board draws what is actually there.',
        detail: null,
        action: { label: 'Open a repository', intent: 'attach', emphasis: 'solid' },
        tone: 'plain',
      };

    case 'static-graph':
      return {
        glyph: 'board',
        title: 'A graph is being served here',
        why: 'This address serves a scanned graph as a file, and it is drawn below. The engine is not running, so nothing here can be rescanned, asked about or changed.',
        detail: outcome.platform.detail,
        action: { label: 'Try again', intent: 'retry' },
        tone: 'plain',
      };

    case 'no-engine':
      return {
        glyph: 'board',
        title: 'The engine is not running',
        why: 'Nothing answered on this page’s own address, so the engine is not running behind it. Sequence keeps its engine local: start it, and this page picks it up on the next try. Nothing was lost — no repository was attached.',
        detail: outcome.platform.detail,
        action: { label: 'Try again', intent: 'retry' },
        tone: 'plain',
      };

    case 'sign-in-required':
      return {
        glyph: 'key',
        title: 'Sign in to continue',
        why: 'The engine is running and asked who you are before it answers. Signing in is handled by the engine itself, not by this page.',
        detail: outcome.platform.detail,
        action: { label: 'Try again', intent: 'retry' },
        tone: 'plain',
      };

    case 'foreign-repo':
      return {
        glyph: 'user',
        title: 'A repository is attached to someone else',
        why: 'This engine serves one repository at a time and the one it holds belongs to another session, so its name, its path and its graph are withheld from this page.',
        detail: outcome.platform.detail,
        action: { label: 'Try again', intent: 'retry' },
        tone: 'plain',
      };

    case 'hydrate-failed': {
      /* One classification, 2.4's, reused verbatim. The attach dialog renders
       * the same seven failures with the same words: a refusal that reads
       * differently depending on which surface met it is two products. */
      const copy = attachFailureCopy(outcome.failure);
      return {
        glyph: copy.tone === 'fault' ? 'alert' : copy.tone === 'note' ? 'info' : 'x',
        title: copy.title,
        why: copy.body,
        detail: copy.detail,
        action: { label: copy.action.label, intent: 'retry' },
        tone: copy.tone,
      };
    }
  }
}

/** The repo an outcome carries, if it carries one. Two of the seven do. */
function repoOf(outcome: BootOutcome): ScannedRepoDraft | null {
  return outcome.kind === 'attached' || outcome.kind === 'static-graph' ? outcome.repo : null;
}
