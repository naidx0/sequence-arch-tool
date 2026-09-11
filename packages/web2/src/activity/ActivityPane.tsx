import { useEffect, useMemo, useState } from 'react';
import type { GetProgramRunResponse, ProgramRunSummary } from '@sequence/api-types';
import { BUILTIN_PROGRAMS } from '@sequence/schema';

import { ACTIVITY } from './anchors';
import { authorProblems } from './runAuthor';
import { changedLabel,
  ACTIVITY_BUCKETS,
  NODE_STATES,
  countByBucket,
  filterRuns,
  needsYou,
  nodeStatesFrom,
  programLabel,
  progressOf,
  spanLabel,
  spanMs,
  stateOf,
  RUN_STEP_BUDGETS,
  RUN_TIME_BUDGETS,
  type ActivityFilter,
} from './activityModel';
import type { TerritoryView } from './territoriesModel';

/**
 * What Confirm posts. A built-in id becomes the catalogue Program; custom
 * fields become `programFrom` — never a blurb pasted into an agent prompt.
 */
export type AuthorStart = (
  | { kind: 'custom'; name: string; instruction: string }
  | { kind: 'builtin'; id: string }
) & {
  /**
   * What this run may spend, when the reader chose something other than the
   * engine's default. ABSENT means they left both selects alone, and the
   * caller must then send NOTHING rather than the number that happens to be
   * the default today - the engine owns that number.
   */
  timeoutMs?: number;
  maxSteps?: number;
};

/* ══════════════════════════════════════════════════════════════════════════
   P9 — THE ACTIVITY VIEW
   packages/web2/src/activity/ActivityPane.tsx

   "Which of my N threads needs me", answerable in one glance.

   ── PROPS ONLY. NO STORE, NO FETCH, NO CLOCK. ────────────────────────────
   Everything on screen arrives as a prop, including `now`. That is not
   ceremony: an elapsed figure read from `Date.now()` inside the render is a
   number this component made up on a frame the engine knows nothing about, and
   it is the one figure here that would look completely plausible while being
   the component's own invention. The caller owns the clock and the caller owns
   the poll; `ConnectedActivity.tsx` is the only file on this lane that has
   either.

   ── THE THREE ABSENCES, AND WHY THEY ARE THREE ───────────────────────────
   The whole class of defect this package is held to is a surface asserting
   something the engine never supplied, and a run list has three genuinely
   different ways of not being here. Folding them into one empty state is how a
   dead engine and an idle repository come to look the same on screen — the
   exact confusion `bootClient.ts` records v1 shipping:

     `runs === null`     the engine has NOT answered. No count is drawn, no
                         bucket bar is drawn, no status word appears anywhere on
                         this surface. There is nothing to count and saying
                         "0 runs" would be a measurement of a list nobody read.
     `runs === []`       the engine answered and listed nothing. THAT IS A
                         MEASUREMENT, and zero is its honest value: this
                         repository has recorded no program run.
     `failure !== null`  the engine refused or could not be reached, in its own
                         words — "no repository attached" is something a reader
                         can act on and "HTTP 400" is not.

   A fourth, smaller one: the engine listed runs and the FILTER matches none of
   them. That is a fact about the filter, not about the engine, and it says so.

   ── THE HUE BUDGET, AND WHY THIS SURFACE IS ALLOWED ONE ──────────────────
   `docs/brand/graphite/pages/12-the-agentic-surfaces.html` §12.5 draws
   exactly this register: a row per state, "each an alias (--st-*) rather than a
   verdict token", every state written out as a WORD as well as drawn as a dot,
   and running the only animated object — "a spinner says 'wait', a pulse says
   'still true'". A run's state is a CLAIM about what the engine is doing, which
   is what earns it a hue at all; nothing else on this surface is coloured.
   Render it in greyscale and no row becomes ambiguous, because every state is a
   word before it is a colour. `activityModel.ts` decides which word and which
   tone; `activity.css` decides once what each tone is worth.

   ── COMPACT IS THE ONLY DENSITY ──────────────────────────────────────────
   26–28px rows, 10/11/12px type. "Airy is a defect."
   ══════════════════════════════════════════════════════════════════════════ */

/** The engine's answer for ONE run: its record and its whole committed log. */
export type RunDetail = GetProgramRunResponse;

export interface ActivityPaneProps {
  /**
   * Every run `GET /api/program/runs` returned, newest first.
   *
   * `null` IS NOT AN EMPTY LIST and the two render differently. See the header.
   */
  runs: readonly ProgramRunSummary[] | null;
  /** The engine's own refusal sentence, or null when it answered. */
  failure?: string | null;
  /** True while the first request is outstanding and nothing has arrived yet. */
  loading?: boolean;
  /** Epoch ms every elapsed figure is measured against. The caller's clock. */
  now: number;

  filter: ActivityFilter;
  onFilter: (filter: ActivityFilter) => void;
  /** Absent means no caller can refresh, and the control is not drawn. */
  onRefresh?: () => void;

  /** The run the reader clicked, whether or not its record has arrived. */
  openId?: string | null;
  /** That run's record and log, once the engine has answered for it. */
  open?: RunDetail | null;
  openFailure?: string | null;
  openLoading?: boolean;
  onOpen: (runId: string) => void;
  onCloseRun: () => void;

  /* ── starting a run ────────────────────────────────────────────────────
     The authoring view REPLACES the list inside this same overlay rather than
     opening a second one. CANON: "The workspace is ONE live canvas… there is
     no inspector column. If you find yourself building a fourth column, stop."
     An overlay that replaces the view is the established shape for an expanded
     surface, and this is that shape one level down. */

  /** True while the reader is composing a run instead of reading the list. */
  authoring?: boolean;
  /** Prefill from toolbelt Start a workflow (P4). */
  authorDraft?: { name: string; instruction: string } | null;
  /** Absent means this build cannot start a run and the control is not drawn. */
  onAuthor?: () => void;
  onAuthorCancel?: () => void;
  onStart?: (start: AuthorStart) => void;
  /** True between the POST and its answer. */
  starting?: boolean;
  /** The engine's refusal, verbatim — "ACP is not available" is what to fix. */
  startFailure?: string | null;
  /**
   * P4 preflight — ACP available / agents probe result as calm copy.
   * `null` = probe pending or agents ready (no invented green bar).
   */
  acpNotice?: string | null;

  /* ── steering a run that is already going ─────────────────────────────── */
  /** Absent means this build cannot pause, and no control is drawn. */
  onPause?: (runId: string) => void;
  onResume?: (runId: string) => void;
  onCancel?: (runId: string) => void;
  /** True between the POST and the answer that establishes what happened. */
  steering?: boolean;
  /** The engine's own refusal to pause or resume. */
  steerFailure?: string | null;

  /** Open a board-launched run on Architecture with overlay reconnect. */
  onOpenOnBoard?: (run: ProgramRunSummary) => void;

  /**
   * Parallel working trees for the attached repo (`territoryView`).
   * `null` = not asked / not attached / engine refused — do not invent rows.
   */
  territories?: TerritoryView | null;
}

/** The em dash is the absence. A digit here would be a claim. */
const ABSENT = '—';

export function ActivityPane({
  runs,
  failure = null,
  loading = false,
  now,
  filter,
  onFilter,
  onRefresh,
  openId = null,
  open = null,
  openFailure = null,
  openLoading = false,
  onOpen,
  onCloseRun,
  authoring = false,
  authorDraft = null,
  onAuthor,
  onAuthorCancel,
  onStart,
  starting = false,
  startFailure = null,
  acpNotice = null,
  onPause,
  onResume,
  onCancel,
  steering = false,
  steerFailure = null,
  onOpenOnBoard,
  territories = null,
}: ActivityPaneProps) {
  const counts = useMemo(() => (runs === null ? null : countByBucket(runs)), [runs]);
  const visible = useMemo(() => (runs === null ? [] : filterRuns(runs, filter)), [runs, filter]);
  const attention = runs === null ? null : needsYou(runs);

  return (
    <section
      className="ac-scope ac-pane"
      data-testid={ACTIVITY.root}
      data-bucket={filter}
      role="dialog"
      aria-label="Activity"
    >
      <header className="ac-head">
        <h2 className="ac-title">Activity</h2>
        {/* THE HEADLINE, AND IT IS DRAWN ONLY WHEN THERE IS A LIST BEHIND IT.
            With `runs === null` this whole element is absent rather than
            showing a zero — the difference between "nothing needs you" and
            "nobody looked" is the entire point of the surface. */}
        {attention !== null ? (
          <span className="ac-needs" data-attention={attention > 0 ? 'yes' : 'no'}>
            {attention > 0 ? `${attention} waiting on you` : 'Nothing is waiting on you'}
          </span>
        ) : null}
        <span className="ac-spacer" />
        {onRefresh && !authoring ? (
          <button
            type="button"
            className="ac-btn"
            data-testid={ACTIVITY.refresh}
            onClick={onRefresh}
          >
            Refresh
          </button>
        ) : null}
        {onAuthor && !authoring ? (
          <button
            type="button"
            className="ac-btn ac-btn-solid"
            data-testid={ACTIVITY.newRun}
            onClick={onAuthor}
          >
            New run
          </button>
        ) : null}
      </header>

      {/* ── composing one, in place of reading them ─────────────────────── */}
      {authoring && onStart ? (
        <RunAuthorView
          onStart={onStart}
          onCancel={onAuthorCancel}
          starting={starting}
          failure={startFailure}
          acpNotice={acpNotice}
          initialName={authorDraft?.name ?? ''}
          initialInstruction={authorDraft?.instruction ?? ''}
        />
      ) : null}

      {/* Everything below is the LIST, and it stands down while the form is
          up: two surfaces in one overlay, one at a time, which is the same
          rule the shell applies to overlays themselves. */}
      {authoring ? null : (
        <>
      {/* Territories — who is where (git worktrees). Absent when unattached
          or the engine has not answered; never invent a parallel row. */}
      {territories !== null ? (
        <section className="ac-territories" data-testid={ACTIVITY.territories}>
          <h3 className="ac-territories-title">Territories</h3>
          {territories.summary ? (
            <p className="ac-territories-summary" data-testid={ACTIVITY.territoriesSummary}>
              {territories.summary}
            </p>
          ) : null}
          {territories.territories.length === 0 ? (
            <p className="ac-note" data-testid={ACTIVITY.territoriesEmpty}>
              No parallel work — only the attached checkout.
            </p>
          ) : (
            <ul className="ac-territory-list">
              {territories.territories.map((t) => (
                <li
                  key={t.path}
                  className="ac-territory"
                  data-testid={ACTIVITY.territoryRow}
                  data-main={t.isMain ? 'yes' : 'no'}
                  data-path={t.path}
                >
                  <span className="ac-territory-name">{t.name}</span>
                  <span className="ac-territory-meta mono">
                    {t.isMain ? 'main' : 'parallel'}
                    {t.branch ? ` · ${t.branch}` : ''}
                    {t.head ? ` · ${t.head}` : ''}
                  </span>
                  {t.note ? <span className="ac-territory-note">{t.note}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {/* ── the engine refused, in its own words ─────────────────────────── */}
      {failure !== null ? (
        <p className="ac-note ac-note-fail" data-testid={ACTIVITY.failure}>
          {failure}
        </p>
      ) : null}

      {/* ── the engine has not answered ──────────────────────────────────── */}
      {runs === null && failure === null ? (
        <p className="ac-note" data-testid={ACTIVITY.unanswered}>
          {loading
            ? 'Asking the engine which runs it has.'
            : 'The engine has not answered with a run list, so this surface knows of no run — not that there are none.'}
        </p>
      ) : null}

      {/* ── the filter bar. Every count is over the list the engine sent ─── */}
      {counts !== null ? (
        <nav
          className="ac-buckets"
          data-testid={ACTIVITY.bucketBar}
          role="group"
          aria-label="Filter runs by what they need"
        >
          {ACTIVITY_BUCKETS.map((bucket) => (
            <button
              key={bucket.id}
              type="button"
              className="ac-bucket"
              data-testid={ACTIVITY.bucketBtn}
              data-bucket={bucket.id}
              data-count={counts[bucket.id]}
              aria-pressed={filter === bucket.id}
              onClick={() => onFilter(bucket.id)}
            >
              <span className="ac-bucket-l">{bucket.label}</span>
              <span className="ac-bucket-n mono">{counts[bucket.id]}</span>
            </button>
          ))}
        </nav>
      ) : null}

      {/* ── the engine answered, and listed nothing ──────────────────────── */}
      {runs !== null && runs.length === 0 ? (
        <p className="ac-note" data-testid={ACTIVITY.empty}>
          The engine has recorded no program run for this repository.
        </p>
      ) : null}

      {/* ── it listed runs, and the filter matches none of them ──────────── */}
      {runs !== null && runs.length > 0 && visible.length === 0 ? (
        <p className="ac-note" data-testid={ACTIVITY.noMatch}>
          No run is in this state right now.
        </p>
      ) : null}

      {visible.length > 0 ? (
        <ul className="ac-list" data-testid={ACTIVITY.list}>
          {visible.map((run) => (
            <RunRow
              key={run.runId}
              run={run}
              now={now}
              open={run.runId === openId}
              onOpen={onOpen}
            />
          ))}
        </ul>
      ) : null}

      {openId !== null ? (
        <RunDetailPanel
          runId={openId}
          detail={open}
          failure={openFailure}
          loading={openLoading}
          onClose={onCloseRun}
          onPause={onPause}
          onResume={onResume}
          onCancel={onCancel}
          steering={steering}
          steerFailure={steerFailure}
          onOpenOnBoard={onOpenOnBoard}
        />
      ) : null}
        </>
      )}
    </section>
  );
}

/* ── composing a run ───────────────────────────────────────────────────── */

/**
 * The authoring view. Built-in catalogue OR two freeform fields.
 *
 * WHAT IT REFUSES TO OFFER, and why each one is a refusal rather than an
 * omission: a model picker (nothing routes on `agent.model`), a tool
 * allow-list (no executor enforces `agent.tools`), a review gate
 * (`agent.requiresReview` promises a guarantee the runtime does not provide),
 * a skills list (nothing activates the ids). The curated catalogue is the
 * one library that is real — each entry builds a validateProgram-clean
 * Program, not a prompt pasted into `programFrom`.
 *
 * The runtime is a LABEL, not a choice. There is exactly one local agent and
 * the route gates on it; a select with one option is a question with one
 * answer.
 *
 * THE BUDGETS ARE OFFERED, AND THAT IS A CORRECTION. This docblock used to
 * list "a timeout and a step cap" among the refusals, on the grounds that "the
 * runner's own defaults are the honest answer". They are an honest answer to
 * "what will this run be held to" and the wrong answer to "can this product run
 * a two-hour task": the route has accepted `timeoutMs` and `maxSteps` since it
 * was written, no client ever sent either, and so every run from every surface
 * was capped at ten minutes with no way to say otherwise. Unlike the fields
 * above, these two are enforced by the scheduler and reported back on the
 * record - which is exactly the test the other refusals fail.
 */
function RunAuthorView({
  onStart,
  onCancel,
  starting,
  failure,
  acpNotice = null,
  initialName = '',
  initialInstruction = '',
}: {
  onStart: (start: AuthorStart) => void;
  onCancel?: () => void;
  starting: boolean;
  failure: string | null;
  acpNotice?: string | null;
  initialName?: string;
  initialInstruction?: string;
}) {
  const [name, setName] = useState(initialName);
  const [instruction, setInstruction] = useState(initialInstruction);
  const [builtinId, setBuiltinId] = useState<string | null>(null);
  /*
   * PROBLEMS ARE SHOWN AFTER AN ATTEMPT, NOT WHILE TYPING. A form that goes
   * red on the first keystroke is a form that calls you wrong for not having
   * finished. `authorProblems` is pure and cheap, so this is a rendering
   * decision rather than a computational one.
   */
  const [attempted, setAttempted] = useState(false);
  /* Indices into the two lists, so "the reader chose nothing" is a real state
     and not a number that happens to equal the default. */
  const [timeIdx, setTimeIdx] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const problems = useMemo(
    () => (builtinId !== null ? [] : authorProblems(name, instruction)),
    [builtinId, name, instruction],
  );
  const selected = builtinId === null ? null : BUILTIN_PROGRAMS.find((e) => e.id === builtinId) ?? null;

  /* Only what was actually chosen. A key with `undefined` would still be a key
     the caller has to decide about; absence is the message. */
  const budget = {
    ...(RUN_TIME_BUDGETS[timeIdx].value !== null
      ? { timeoutMs: RUN_TIME_BUDGETS[timeIdx].value }
      : {}),
    ...(RUN_STEP_BUDGETS[stepIdx].value !== null
      ? { maxSteps: RUN_STEP_BUDGETS[stepIdx].value }
      : {}),
  };

  const submit = () => {
    setAttempted(true);
    if (builtinId !== null) {
      onStart({ kind: 'builtin', id: builtinId, ...budget });
      return;
    }
    if (problems.length > 0) return;
    onStart({ kind: 'custom', name, instruction, ...budget });
  };

  return (
    <form
      className="ac-author"
      data-testid={ACTIVITY.author}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="ac-builtins" data-testid={ACTIVITY.authorBuiltins}>
        <span className="ac-label">Built-in workflows</span>
        <ul className="ac-builtin-list">
          {BUILTIN_PROGRAMS.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className="ac-builtin"
                data-testid={ACTIVITY.authorBuiltin}
                data-builtin-id={entry.id}
                data-selected={builtinId === entry.id ? 'yes' : 'no'}
                aria-pressed={builtinId === entry.id}
                disabled={starting}
                onClick={() => {
                  setBuiltinId(entry.id);
                  setAttempted(false);
                }}
              >
                <span className="ac-builtin-title">{entry.title}</span>
                <span className="ac-builtin-blurb">{entry.blurb}</span>
              </button>
            </li>
          ))}
        </ul>
        {selected !== null ? (
          <button
            type="button"
            className="ac-btn"
            data-testid={ACTIVITY.authorCustom}
            disabled={starting}
            onClick={() => {
              setBuiltinId(null);
              setAttempted(false);
            }}
          >
            Write your own instead
          </button>
        ) : null}
      </div>

      {selected !== null ? (
        <p className="ac-runtime" data-testid="activity-author-builtin-picked">
          Starting <strong>{selected.title}</strong> — the curated program graph, not a freeform prompt.
        </p>
      ) : (
        <>
          <label className="ac-field">
            <span className="ac-label">Name</span>
            <input
              className="ac-input"
              data-testid={ACTIVITY.authorName}
              value={name}
              disabled={starting}
              onChange={(event) => setName(event.target.value)}
              placeholder="what this run is for"
            />
          </label>

          <label className="ac-field">
            <span className="ac-label">Instruction</span>
            <textarea
              className="ac-input ac-textarea"
              data-testid={ACTIVITY.authorInstruction}
              value={instruction}
              disabled={starting}
              rows={5}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder="what the agent should do"
            />
          </label>
        </>
      )}

      {/* ── what this run may spend ───────────────────────────────────────
          Both are enforced by the scheduler: it checks the wall clock and the
          step count before every node AND races each executor await against
          the remaining time, so these are budgets rather than intentions. The
          engine clamps what it is given, which is why the sentence below does
          not promise the number back. */}
      <div className="ac-budgets" data-testid={ACTIVITY.authorBudgets}>
        <label className="ac-field">
          <span className="ac-label">Time budget</span>
          <select
            className="ac-input"
            data-testid={ACTIVITY.authorTimeBudget}
            value={timeIdx}
            disabled={starting}
            onChange={(event) => setTimeIdx(Number(event.target.value))}
          >
            {RUN_TIME_BUDGETS.map((choice, i) => (
              <option key={choice.label} value={i}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>

        <label className="ac-field">
          <span className="ac-label">Step budget</span>
          <select
            className="ac-input"
            data-testid={ACTIVITY.authorStepBudget}
            value={stepIdx}
            disabled={starting}
            onChange={(event) => setStepIdx(Number(event.target.value))}
          >
            {RUN_STEP_BUDGETS.map((choice, i) => (
              <option key={choice.label} value={i}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <p className="ac-budget-note">
          The engine clamps what it is asked for; the run’s own record says which
          budgets it was actually held to.
        </p>
      </div>

      {/* The runtime is stated, not chosen. It is also the thing most likely
          to refuse at the door, so naming it here means the refusal is not a
          surprise. */}
      <p className="ac-runtime">
        Runs on the local agent, on this machine, against the attached repository.
      </p>

      {/* P4 — probe /api/acp/available (+ agents) before Start so the reader
          sees the same sentence the 403 would print, without wasting a POST. */}
      {acpNotice !== null ? (
        <p className="ac-note" data-testid={ACTIVITY.authorAcpNote}>
          {acpNotice}
        </p>
      ) : null}

      {/* ── everything wrong with the form, at once ─────────────────────── */}
      {attempted && problems.length > 0 ? (
        <ul className="ac-problems" data-testid={ACTIVITY.authorProblems}>
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}

      {/* ── and what the engine said, in its own words ──────────────────── */}
      {failure !== null ? (
        <p className="ac-note ac-note-fail" data-testid={ACTIVITY.authorFailure}>
          {failure}
        </p>
      ) : null}

      <div className="ac-authoractions">
        {onCancel ? (
          <button
            type="button"
            className="ac-btn"
            data-testid={ACTIVITY.authorBack}
            disabled={starting}
            onClick={onCancel}
          >
            Back
          </button>
        ) : null}
        <button
          type="submit"
          className="ac-btn ac-btn-solid"
          data-testid={ACTIVITY.authorStart}
          disabled={starting}
        >
          {starting ? 'Starting…' : 'Start run'}
        </button>
      </div>
    </form>
  );
}

/* ── one run ───────────────────────────────────────────────────────────── */

function RunRow({
  run,
  now,
  open,
  onOpen,
}: {
  run: ProgramRunSummary;
  now: number;
  open: boolean;
  onOpen: (runId: string) => void;
}) {
  const state = stateOf(run.status);
  const progress = progressOf(run);
  const changed = changedLabel(run);
  const name = programLabel(run);

  return (
    <li className="ac-row-host">
      {/*
       * THE WHOLE ROW IS THE BUTTON. §5.2's requirement is that clicking a run
       * opens it, and a row with a small "open" affordance at one end makes the
       * other 90% of it a dead target — which in a list whose job is triage is
       * the difference between a glance and a hunt.
       */}
      <button
        type="button"
        className="ac-row"
        data-testid={ACTIVITY.row}
        data-run-id={run.runId}
        data-status={run.status}
        data-tone={state.tone}
        data-bucket={state.bucket}
        data-live={state.live ? 'yes' : 'no'}
        data-open={open ? 'yes' : 'no'}
        aria-expanded={open}
        onClick={() => onOpen(run.runId)}
      >
        {/* THE STATE, AS A WORD. The dot beside it carries the same tone and
            says nothing the word does not. */}
        <span className="ac-state" data-testid={ACTIVITY.rowState} title={state.meaning}>
          <span className="ac-dot" aria-hidden="true" />
          {state.word}
        </span>

        {/* WHAT IT IS RUNNING. The engine has already fallen back from a
            program's name to its id, so an empty name here means the engine
            sent one — and the em dash says so rather than putting the RUN id
            in the slot a program NAME belongs in. */}
        <span className="ac-program" data-testid={ACTIVITY.rowProgram}>
          {name ?? ABSENT}
        </span>

        <span className="ac-meta mono" data-testid={ACTIVITY.rowMeta}>
          {/* Nodes done of nodes declared. `nodesTotal` is the program's own
              `nodes.length`, carried on the summary so no client counts its own
              frames; with no denominator nothing is drawn at all. */}
          {progress !== null ? (
            <span className="ac-progress" data-testid={ACTIVITY.rowProgress}>
              {progress.done}/{progress.total} nodes
              {progress.error > 0 ? <span className="ac-err-n"> {progress.error} in error</span> : null}
            </span>
          ) : null}
          {/* HOW MUCH IT CHANGED — the number that made this list triageable.
              Rendered only when the engine measured it: `changedLabel` answers
              null for a run still going, and null must draw NOTHING rather
              than "no files changed", which is a measurement. */}
          {changed !== null ? (
            <span className="ac-changed" data-testid={ACTIVITY.rowChanged}>
              {changed}
            </span>
          ) : null}
          <span className="ac-span">{spanLabel(spanMs(run, now))}</span>
          <span className="ac-runid">{run.runId}</span>
        </span>
      </button>

      {/* The engine's own run-level sentence, never one composed here.
          `firstNodeError` on the server takes "the executor's own message
          rather than composing a summary sentence, because a composed sentence
          is a claim the engine did not make". */}
      {run.error !== undefined && run.error !== '' ? (
        <p className="ac-rowerr" data-testid={ACTIVITY.rowError}>
          {run.error}
        </p>
      ) : null}

      {/* WHY THE RESULT WAS REJECTED, in the words of whatever rejected it.
          The word "Violations" in the state cell says THAT a gate said no; a
          reader triaging a list needs to know WHICH one without opening the
          run, and every line here is a string the checker or the scheduler
          wrote — nothing on this row is composed. Rendered for any status that
          carries them, because a run stopped after its checker had already
          said no still owes the reader that sentence. */}
      {run.violations !== undefined && run.violations.length > 0 ? (
        <ul className="ac-rowviol" data-testid={ACTIVITY.rowViolations}>
          {run.violations.map((v, i) => (
            <li key={`${i}-${v}`}>{v}</li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/* ── one run, opened ───────────────────────────────────────────────────── */

function RunDetailPanel({
  runId,
  detail,
  failure,
  loading,
  onClose,
  onPause,
  onResume,
  onCancel,
  steering = false,
  steerFailure = null,
  onOpenOnBoard,
}: {
  runId: string;
  detail: RunDetail | null;
  failure: string | null;
  loading: boolean;
  onClose: () => void;
  onPause?: (runId: string) => void;
  onResume?: (runId: string) => void;
  onCancel?: (runId: string) => void;
  steering?: boolean;
  steerFailure?: string | null;
  onOpenOnBoard?: (run: ProgramRunSummary) => void;
}) {
  const nodeStates = useMemo(() => nodeStatesFrom(detail?.events ?? []), [detail]);

  /*
   * WHICH CONTROL IS OFFERED IS THE ENGINE'S ANSWER, NOT THIS PANEL'S MEMORY.
   *
   * `detail.run.status` is what the engine last said. Deriving the control from
   * "the reader clicked Pause a second ago" would show Resume on a run that
   * refused to pause — the same optimistic-state defect the start path refuses,
   * one screen along. With no detail yet there is no status, and no control:
   * absent is not "not pausable", it is "nobody has been told yet".
   */
  /* `detail?.run?.status`, both hops. Guarding only the first threw on a
     detail whose `run` is absent — a shape the pane already renders elsewhere,
     and one the suite supplies. Caught as an unhandled render error under a
     green run, which is how the reload crash hid too. */
  const status = detail?.run?.status ?? null;
  const cancellable = status === null ? false : stateOf(status).cancellable;
  /*
   * RESUME IS OFFERED ON BOTH OF THE ENGINE'S CONDITIONS, NOT ONE.
   *
   * `programRunner.restart` picks a run up only when its status is one of
   * paused / stopped / interrupted AND the record carries a checkpoint — a
   * halt before the first node reached a terminal status has nothing to resume
   * FROM and the engine refuses it with a reason. This used to render on
   * `status === 'paused'` alone, which was wrong in both directions at once: a
   * run halted by its ten-minute budget or by a dev-server restart had a
   * complete checkpoint on disk and no button, and a paused run with no
   * checkpoint had a button that could only ever be refused.
   */
  const resumable =
    status !== null && stateOf(status).resumable && detail?.run?.checkpoint !== undefined;
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  /* A confirmation is a gesture in progress, not run state. A different run
     or a new engine status gets a fresh gesture rather than inheriting it. */
  useEffect(() => setConfirmingCancel(false), [runId, status]);

  return (
    <section className="ac-detail" data-testid={ACTIVITY.detail} data-run-id={runId}>
      <header className="ac-detail-head">
        {/*
          THE RUN ID IS THE FALLBACK HERE AND IT IS THE EM DASH IN THE ROW, AND
          THE TWO ARE NOT INCONSISTENT. The row's `ac-program` cell is the slot
          for a program's NAME, so putting an id in it would read as a program
          called `run-…`. This line is the panel's IDENTITY — the answer to
          "which run am I looking at" — and a run id is the honest answer to
          that question, not a substitute for a different one.
        */}
        <span className="ac-detail-title">
          {detail?.run ? (programLabel(detail.run) ?? runId) : runId}
        </span>
        <span className="ac-spacer" />
        {/* Worded, not reddened. §12.5: "a destructive or declining action in
            this design is worded, never reddened." */}
        {onPause && status === 'running' && !confirmingCancel ? (
          <button
            type="button"
            className="ac-btn"
            data-testid={ACTIVITY.pause}
            disabled={steering}
            onClick={() => onPause(runId)}
          >
            Pause
          </button>
        ) : null}
        {onResume && resumable ? (
          <button
            type="button"
            className="ac-btn"
            data-testid={ACTIVITY.resume}
            disabled={steering}
            onClick={() => onResume(runId)}
          >
            Resume
          </button>
        ) : null}
        {onOpenOnBoard && detail?.run?.sourceDiagramId ? (
          <button
            type="button"
            className="ac-btn"
            data-testid={ACTIVITY.openOnBoard}
            disabled={steering}
            onClick={() => onOpenOnBoard(detail.run)}
          >
            Open on board
          </button>
        ) : null}
        {onCancel && cancellable && !confirmingCancel ? (
          <button
            type="button"
            className="ac-btn"
            data-testid={ACTIVITY.cancel}
            disabled={steering}
            onClick={() => setConfirmingCancel(true)}
          >
            Cancel run
          </button>
        ) : null}
        <button
          type="button"
          className="ac-btn"
          data-testid={ACTIVITY.detailClose}
          onClick={onClose}
        >
          Close
        </button>
      </header>

      {onCancel && cancellable && confirmingCancel ? (
        <div
          className="ac-cancel-gate"
          data-testid={ACTIVITY.cancelGate}
          role="group"
          aria-label="Confirm stopping this run"
        >
          <p className="ac-cancel-copy">
            Stop this run? The active agent process will be stopped. Changes already written to the repository remain.
          </p>
          <div className="ac-cancel-actions">
            <button
              type="button"
              className="ac-btn"
              data-testid={ACTIVITY.cancelBack}
              disabled={steering}
              onClick={() => setConfirmingCancel(false)}
            >
              Keep running
            </button>
            <button
              type="button"
              className="ac-btn"
              data-testid={ACTIVITY.cancelConfirm}
              disabled={steering}
              onClick={() => {
                setConfirmingCancel(false);
                onCancel(runId);
              }}
            >
              Stop run
            </button>
          </div>
        </div>
      ) : null}

      {steerFailure !== null ? (
        <p className="ac-note ac-note-fail" data-testid={ACTIVITY.steerFailure}>
          {steerFailure}
        </p>
      ) : null}

      {failure !== null ? (
        <p className="ac-note ac-note-fail" data-testid={ACTIVITY.detailFailure}>
          {failure}
        </p>
      ) : null}

      {detail === null && failure === null ? (
        <p className="ac-note" data-testid={ACTIVITY.detailLoading}>
          {loading
            ? 'Reading this run from the engine.'
            : 'The engine has not answered for this run, so none of its steps can be shown.'}
        </p>
      ) : null}

      {detail !== null ? (
        <>
          {/* WHY THIS RUN'S RESULT WAS REJECTED — first, above the steps,
              because it is the answer to the only question a reader opens a
              `Violations` run to ask. Every line is the checker's own joined
              violation string or the scheduler's own note detail. */}
          {detail.run.violations !== undefined && detail.run.violations.length > 0 ? (
            <ul className="ac-violations">
              {detail.run.violations.map((v, i) => (
                <li
                  key={`${i}-${v}`}
                  className="ac-violation"
                  data-testid={ACTIVITY.detailViolation}
                >
                  {v}
                </li>
              ))}
            </ul>
          ) : null}

          {/* THE STEPS, FROM THE PROGRAM STORED WITH THE RUN. The record carries
              "the program AS SUBMITTED … so a reader needs no client", which is
              why this list is the run's own steps and not the currently-open
              editor's. */}
          <ul className="ac-nodes">
            {detail.run.program.nodes.map((node) => {
              const status = nodeStates[node.id];
              const state = status === undefined ? null : NODE_STATES[status];
              const result = detail.run.nodeResults[node.id];
              return (
                <li
                  key={node.id}
                  className="ac-node"
                  data-testid={ACTIVITY.detailNode}
                  data-node-id={node.id}
                  data-node-status={status ?? 'none'}
                  data-tone={state?.tone ?? 'neutral'}
                >
                  <span className="ac-node-state">
                    {state === null ? (
                      /* NOT "Queued". The scheduler emits `queued` for the nodes
                         it has queued; a node it has not reached has had nothing
                         said about it, and writing a status here would be this
                         surface speaking on the scheduler's behalf. */
                      <span title="the run’s log records no event for this step">{ABSENT}</span>
                    ) : (
                      <>
                        <span className="ac-dot" aria-hidden="true" />
                        {state.word}
                      </>
                    )}
                  </span>
                  <span className="ac-node-title">{node.title}</span>
                  <span className="ac-node-kind mono">{node.kind}</span>
                  {result?.error !== undefined && result.error !== '' ? (
                    <span className="ac-node-err">{result.error}</span>
                  ) : null}
                  {result?.detail !== undefined && result.detail !== '' ? (
                    <span className="ac-node-detail mono" data-testid="activity-node-detail">
                      {result.detail}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {/* Loud run-level signals — today the one case is a loop that exited
              by hitting its cap while its predicate was still true. The plan
              promised loops exit "loudly"; this is where a reader hears it. */}
          {detail.run.notes.length > 0 ? (
            <ul className="ac-notes">
              {detail.run.notes.map((note, i) => (
                <li
                  key={`${note.nodeId}-${note.kind}-${i}`}
                  className="ac-noteline"
                  data-testid={ACTIVITY.detailNote}
                >
                  <span className="mono">{note.nodeId}</span> {note.kind}
                  {note.detail !== undefined ? ` — ${note.detail}` : ''}
                </li>
              ))}
            </ul>
          ) : null}

          {/* THE DURABLE LOG ITSELF, newest first. `seq` is the row's own id —
              1-based, gap-free, and the same number a reconnecting client
              passes back as `?since=`. It is printed because it is the one
              figure on this surface a reader can check against the file. */}
          {detail.events.length > 0 ? (
            <ol className="ac-events">
              {[...detail.events]
                .sort((a, b) => b.seq - a.seq)
                .map((event) => (
                  <li
                    key={event.seq}
                    className="ac-event"
                    data-testid={ACTIVITY.detailEvent}
                    data-seq={event.seq}
                    data-event-type={event.type}
                  >
                    <span className="ac-event-seq mono">{event.seq}</span>
                    <span className="ac-event-type mono">{event.type}</span>
                    <span className="ac-event-what">
                      {event.type === 'node:status'
                        ? `${event.nodeId} ${event.status}`
                        : event.type === 'run:note'
                          ? `${event.nodeId} ${event.kind}`
                          : event.type === 'run:finished'
                            ? event.status
                            : event.type === 'run:started'
                              ? event.programId
                              : ''}
                    </span>
                  </li>
                ))}
            </ol>
          ) : (
            <p className="ac-note" data-testid={ACTIVITY.detailEventsEmpty}>
              This run’s log is empty — it has committed no event yet.
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}
