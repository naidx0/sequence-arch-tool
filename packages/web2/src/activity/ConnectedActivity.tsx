import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  GetGitWorktreesResponse,
  GetStatusResponse,
  ProgramRunSummary,
} from '@sequence/api-types';

import { ActivityPane, type AuthorStart, type RunDetail } from './ActivityPane';
import { createActivityClient, wireMessage, type ActivityClient } from './activityClient';
import { acpReadinessNote, type AcpReadiness } from './acpReadiness';
import { programFrom } from './runAuthor';
import { takeActivityLaunch } from './activityLaunch';
import type { ActivityFilter } from './activityModel';
import { territoryView, type TerritoryView, type WorktreeEntry } from './territoriesModel';
import { runFinishedNotice } from '../settings/notifyModel';
import { newlyFinished, readNotifyEnabled, statusMap } from '../settings/notifyPreference';
import { buildBuiltinProgram } from '@sequence/schema';
import { isSameOriginPath } from '../boot';
import { requestHostCommand } from '../app/hostCommands.js';
import { beginBoardRunWatch } from '../canvas/workflowRunEvents.js';

const ACTIVE_RUN_STORAGE_KEY = 'sequence:active-program-run';

/* ══════════════════════════════════════════════════════════════════════════
   P9 — THE ACTIVITY VIEW, WIRED
   packages/web2/src/activity/ConnectedActivity.tsx

   The only file on this lane that opens a socket or reads a clock.
   `ActivityPane.tsx` takes props; everything about WHEN to ask the engine and
   WHAT time it is lives here. That is the same split `ConnectedReview.tsx` and
   `ConnectedBoard.tsx` use.

   ── THE STATE IS HELD HERE AND NOT IN `state/store.ts`, ON PURPOSE ───────
   `ConnectedReview.tsx` states the precedent and the reason in the same words:
   the store "ships eighteen actions and not one writes a review; adding the
   family means editing a file this lane does not own". The same argument holds
   with more force here, because a run list is not application state at all — it
   is a remote reading with a timestamp, owned by the engine, and every copy of
   it inside the client is a copy that can be stale in a way the reader cannot
   see. It lives for exactly as long as this overlay is open.

   ── WHY POLLING, AND WHY IT IS NOT A DEFECT ──────────────────────────────
   The engine serves a resumable SSE feed PER RUN (`/api/program/runs/:id/events`,
   with an `id:` line so a reconnect is exact by construction). It does not serve
   one for the LIST — there is no route that pushes "a run changed state", and
   inventing a client-side merge of N per-run feeds into a list would mean the
   list's contents came from a fold this file wrote rather than from an answer
   the engine gave. A poll of the real list route is one request and one whole
   answer. When the engine grows a list feed, this becomes a subscription and
   the pane above does not move.

   THE POLL STOPS WHEN NOTHING IS MOVING. A list whose every run is terminal
   cannot change without something starting a new one, and something starting a
   new one goes through this browser — so a fixed-interval poll over a finished
   list is a request per tick that can only ever return the same bytes. It
   resumes on Refresh and whenever a live run appears.
   ══════════════════════════════════════════════════════════════════════════ */

export interface ConnectedActivityProps {
  /** Injected so a test can hand in a recorder. Defaults to the real client. */
  client?: ActivityClient;
  /**
   * How often to re-ask while at least one run is still moving. 0 disables the
   * timer entirely, which is what a deterministic test wants.
   */
  pollMs?: number;
  /** Injectable clock. The pane never reads one. */
  now?: () => number;
}

/** The stable default, so the pane does not remount every render. */
const DEFAULT_CLIENT = createActivityClient();

/**
 * The engine's status, in the vocabulary the notifier actually speaks.
 *
 * `notifyPreference.NOTIFIABLE_STATUSES` and `notifyModel.RunFinishedInput`
 * were written against six statuses and do not know about
 * `completed-with-violations`. Left alone, a run that finished with its own
 * grounded checks rejecting it would be the ONE terminal outcome that never
 * announced itself — silence on the result a person most wants told about.
 *
 * `failed` is the one word in that older vocabulary that is true of it: the run
 * did not achieve what it set out to. The notification is deliberately coarse
 * ("Open Sequence to see what happened"); the pane behind it is what draws the
 * distinction, with the checker's own sentences under the row. This projection
 * lives here, at the seam, rather than being pushed into the notifier — that
 * file belongs to the settings lane, and the honest fix there is to add the
 * seventh status to both of its lists.
 */
function notifiableWord(status: ProgramRunSummary['status']): string {
  return status === 'completed-with-violations' ? 'failed' : status;
}

/** Between polls while something is still moving. */
export const DEFAULT_POLL_MS = 2_500;

export function ConnectedActivity({
  client = DEFAULT_CLIENT,
  pollMs = DEFAULT_POLL_MS,
  now = Date.now,
}: ConnectedActivityProps) {
  /* `null` until the engine answers. NEVER seeded with `[]` — the pane renders
     those two differently and that difference is the surface's whole claim. */
  const [runs, setRuns] = useState<readonly ProgramRunSummary[] | null>(null);

  /*
   * ══ THE NOTIFICATION THAT COULD NEVER FIRE ═══════════════════════════════
   *
   * `notifyModel.ts` has decided whether to notify and what to say since the
   * day it was written — complete, correct, tested, and called by nobody. A
   * person could grant the browser permission, turn the switch on, and never
   * hear a thing, because no code path anywhere constructed a Notification.
   *
   * THIS IS THE PRODUCER IT NEEDED. The poll below already learns every run's
   * status on a fixed interval; a run crossing into a terminal state between
   * two polls is exactly the event worth announcing, and it is the only such
   * event this client can observe without inventing one.
   *
   * The one line that cannot be unit-tested — `new Notification` — is here and
   * nowhere else. Everything that DECIDES lives in the two pure modules, which
   * is what makes the policy answerable without a browser.
   */
  const seenStatuses = useRef<Map<string, string>>(new Map());

  const announce = useCallback((finished: readonly { id: string; status: string; name: string }[]) => {
    if (finished.length === 0) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (!readNotifyEnabled()) return;

    for (const run of finished) {
      const notice = runFinishedNotice({
        state: { permission: 'granted', enabled: true },
        /* The model refuses to speak while the tab is visible — a desktop
           notification about something already on screen is an interruption
           reporting what the reader can see. Asked here rather than assumed. */
        visible: typeof document !== 'undefined' && document.visibilityState === 'visible',
        /* The PROGRAM's name, not the run id. "nightly finished" is a
           sentence; "run_01J9X… finished" is a lookup the reader has to go
           and perform. `programName` already falls back to the id when a
           program declares no name. */
        runName: run.name,
        status: run.status as Parameters<typeof runFinishedNotice>[0]['status'],
      });
      if (!notice) continue;
      try {
        new Notification(notice.title, { body: notice.body });
      } catch {
        /* Construction can throw on a browser that exposes the API and
           refuses it anyway. A failed notification must never break the poll
           that produced it. */
      }
    }
  }, []);
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [tick, setTick] = useState(() => now());

  const [openId, setOpenId] = useState<string | null>(null);
  const [open, setOpen] = useState<RunDetail | null>(null);
  const [openFailure, setOpenFailure] = useState<string | null>(null);
  const [openLoading, setOpenLoading] = useState(false);
  /* Bumped to re-ask for the OPEN run specifically, the way `asked` re-asks
     for the list. A steer changes one run's status and the panel showing it
     must go and find out rather than keep the answer it had. */
  const [reopen, setReopen] = useState(0);

  /* The reload counter. Bumping it is how Refresh and the poll both say "ask
     again" without either of them holding the request. */
  const [asked, setAsked] = useState(0);

  /* `now` is a fresh closure on every render for most callers, so it is held in
     a ref and never named in a dependency array — the same reason `Shell.tsx`
     holds `onFrame` in one. A dependency on it would re-run the effect every
     render, and the effect issues a request. */
  const clock = useRef(now);
  clock.current = now;

  /* ── the list ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    void (async () => {
      const answer = await client.runs(controller.signal);
      if (!live) return;
      setLoading(false);
      setTick(clock.current());
      if (answer.outcome === 'ok') {
        /* Compared BEFORE the state is replaced, so the previous statuses are
           still the ones this component last saw. */
        /* `runId` is the identity; `programName` is what a person recognises. */
        const seen = answer.body.runs.map((r) => ({
          id: r.runId,
          status: notifiableWord(r.status),
          name: r.programName,
        }));
        const byId = new Map(seen.map((r) => [r.id, r]));
        announce(
          newlyFinished(seenStatuses.current, seen).map((f) => ({
            ...f,
            name: byId.get(f.id)?.name ?? f.id,
          })),
        );
        seenStatuses.current = statusMap(seen);
        setRuns(answer.body.runs);
        setFailure(null);
        return;
      }
      /* THE PREVIOUS LIST IS NOT CLEARED. A poll that fails after a good answer
         has not learned that the runs are gone — it has learned nothing — and
         blanking the list would turn one dropped request into "you have no
         runs". The failure line says what happened; the rows stay as they were,
         and their elapsed figures stop moving because `tick` is what advances
         them and it advanced to the moment of the failure. */
      setFailure(wireMessage(answer));
    })();
    return () => {
      live = false;
      controller.abort();
    };
  }, [client, asked]);

  /* ── the poll, while something is still moving ────────────────────────── */
  const moving = runs !== null && runs.some((run) => run.status === 'running');
  useEffect(() => {
    if (pollMs <= 0 || !moving) return undefined;
    const timer = setInterval(() => setAsked((n) => n + 1), pollMs);
    return () => clearInterval(timer);
  }, [pollMs, moving]);

  /* ── one run, opened ──────────────────────────────────────────────────── */
  useEffect(() => {
    if (openId === null) return undefined;
    const controller = new AbortController();
    let live = true;
    setOpenLoading(true);
    void (async () => {
      const answer = await client.run(openId, controller.signal);
      if (!live) return;
      setOpenLoading(false);
      if (answer.outcome === 'ok') {
        /*
         * A 200 IS NOT A DETAIL UNTIL IT HAS PROVED IT.
         *
         * The same rule the boot ladder applies to `/archgraph.json`: a static
         * file host answers every unknown path with index.html and a 200, and
         * a client that trusts the status renders a payload nobody checked.
         * Measured here as an unhandled render error — a body with no `run`
         * reached `programLabel(detail.run)` and threw inside React, which
         * takes the whole panel down and reports nothing a reader can act on.
         */
        if (answer.body && typeof answer.body === 'object' && answer.body.run) {
          setOpen(answer.body);
          setOpenFailure(null);
          return;
        }
        setOpen(null);
        setOpenFailure('the engine answered for this run with something that is not a run record');
        return;
      }
      setOpen(null);
      setOpenFailure(wireMessage(answer));
    })();
    return () => {
      live = false;
      controller.abort();
    };
    /*
     * ── `asked` IS IN HERE, AND THAT IS THE WHOLE FIX ────────────────────
     *
     * This effect depended on `[client, openId, reopen]`, and `reopen` is
     * bumped in exactly one place: after a pause/resume/cancel POST. The 2.5s
     * poll bumps `asked`, which only the LIST effect reads. So the opened run's
     * panel was frozen at the instant it was clicked — the row behind it
     * counted up to 12 of 12 nodes while the panel in front still drew 2 nodes
     * done and a six-row log, and the only way to see progress was to close the
     * run and open it again, repeatedly, for as long as it ran.
     *
     * It re-reads on the SAME cadence as the list, which means it inherits the
     * list's guard for free: the poll stops when no run is `running`, so an
     * opened terminal run is read once and then left alone rather than
     * re-fetched forever.
     */
  }, [client, openId, reopen, asked]);

  /* ── starting one ─────────────────────────────────────────────────────
     The half of this lane that did not exist. Held here for the same reason
     the list is: it lives exactly as long as the overlay does. */
  const [authoring, setAuthoring] = useState(false);
  const [authorDraft, setAuthorDraft] = useState<{ name: string; instruction: string } | null>(
    null,
  );
  const [starting, setStarting] = useState(false);
  const [startFailure, setStartFailure] = useState<string | null>(null);
  const [acpReadiness, setAcpReadiness] = useState<AcpReadiness>({ kind: 'unknown' });

  /* P4 — toolbelt Start a workflow may have staged a draft before opening. */
  useEffect(() => {
    const draft = takeActivityLaunch();
    if (!draft) return;
    setAuthorDraft(draft);
    setAuthoring(true);
    setStartFailure(null);
  }, []);

  /*
   * P4 — feature-detect ACP before Start. api-types requires /api/acp/available;
   * when available, also list agents so an empty registry is named before POST.
   */
  useEffect(() => {
    if (!authoring) {
      setAcpReadiness({ kind: 'unknown' });
      return;
    }
    const controller = new AbortController();
    let live = true;
    void (async () => {
      try {
        const avail = await client.acpAvailable(controller.signal);
        if (!live) return;
        if (avail.outcome !== 'ok') {
          setAcpReadiness({ kind: 'unavailable', reason: wireMessage(avail) });
          return;
        }
        if (!avail.body.available) {
          setAcpReadiness({
            kind: 'unavailable',
            reason: avail.body.reason ?? 'ACP is not available',
          });
          return;
        }
        const agents = await client.acpAgents(controller.signal);
        if (!live) return;
        if (agents.outcome !== 'ok') {
          setAcpReadiness({ kind: 'unavailable', reason: wireMessage(agents) });
          return;
        }
        const count = agents.body.agents.length;
        setAcpReadiness(count === 0 ? { kind: 'no-agents' } : { kind: 'ready', count });
      } catch {
        /* Abort or a partial test client — never an unhandled rejection that
           greens every assertion then fails the suite (CI Build red on tip). */
        if (live) setAcpReadiness({ kind: 'unavailable', reason: 'ACP readiness could not be checked' });
      }
    })();
    return () => {
      live = false;
      controller.abort();
    };
  }, [authoring, client]);

  const onStart = useCallback(
    (start: AuthorStart) => {
      setStarting(true);
      setStartFailure(null);
      void (async () => {
        /*
         * THE PROGRAM ID IS THE CLOCK for custom runs, and that is the only
         * reason this component reaches for one. Built-ins keep their catalogue
         * ids — `runAuthor` / catalogue builders are pure so the shape is
         * asserted against the real validator without a clock.
         */
        const program =
          start.kind === 'builtin'
            ? buildBuiltinProgram(start.id)
            : programFrom(start.name, start.instruction, `ui-${clock.current()}`);
        if (program === null) {
          setStarting(false);
          setStartFailure(`Unknown built-in workflow: ${start.kind === 'builtin' ? start.id : ''}`);
          return;
        }
        /* Only what the reader actually chose reaches the wire. `AuthorStart`
           omits both keys when they left the selects alone, so the engine's
           own defaults apply and this file never restates them. */
        const answer = await client.start(program, {
          ...(start.timeoutMs !== undefined ? { timeoutMs: start.timeoutMs } : {}),
          ...(start.maxSteps !== undefined ? { maxSteps: start.maxSteps } : {}),
        });
        setStarting(false);

        if (answer.outcome !== 'ok') {
          /*
           * THE FORM STAYS UP, WITH WHAT THEY WROTE STILL IN IT. The likeliest
           * refusal here is the ACP gate — "ACP is not available" — which is a
           * thing the reader has to go and fix and come back from. Closing the
           * form on refusal would make them type the instruction again.
           */
          setStartFailure(wireMessage(answer));
          return;
        }

        /*
         * NO OPTIMISTIC STATUS. The 202 says the run was ACCEPTED, and the
         * route's own comment says why it is not a 200: "a 200 here would read
         * as 'done', which is the one thing it is not". So this asks the list
         * again and opens the new run; every word of state the reader then sees
         * came from the engine. Painting "Running" from the acknowledgement
         * would be inventing a number, which law 4 forbids and which is exactly
         * how a run that failed to start reads as one that is working.
         */
        setAuthoring(false);
        setOpen(null);
        setOpenFailure(null);
        setOpenId(answer.body.runId);
        setTick(clock.current());
        setAsked((n) => n + 1);
      })();
    },
    [client],
  );

  /* ── steering one ─────────────────────────────────────────────────────── */
  const [steering, setSteering] = useState(false);
  const [steerFailure, setSteerFailure] = useState<string | null>(null);

  /**
   * Pause, resume and cancel are ONE handler because they are one shape: a POST that
   * acknowledges, followed by asking the engine what actually happened.
   *
   * Nothing here writes a status. `programRunner.pause` sets a flag the
   * scheduler reads between steps, so a run pauses when it reaches a boundary
   * and not when the button is clicked; a UI that painted "Paused" on the click
   * would be describing an intention as a fact.
   */
  const steer = useCallback(
    (verb: 'pause' | 'resume' | 'cancel') => (runId: string) => {
      setSteering(true);
      setSteerFailure(null);
      void (async () => {
        const answer =
          verb === 'pause'
            ? await client.pause(runId)
            : verb === 'resume'
              ? await client.resume(runId)
              : await client.cancel(runId);
        setSteering(false);
        if (answer.outcome !== 'ok') {
          setSteerFailure(wireMessage(answer));
          return;
        }
        /* Ask, do not assume — both for the open run and for the list, because
           the row carries the same status the panel does. */
        setTick(clock.current());
        setAsked((n) => n + 1);
        setReopen((n) => n + 1);
      })();
    },
    [client],
  );

  const onOpen = useCallback((runId: string) => {
    /* The previous run's record is dropped the instant a different run is
       clicked. Keeping it while the next one loads would draw one run's steps
       under another run's name for as long as the request takes. */
    setOpen(null);
    setOpenFailure(null);
    setOpenId((current) => (current === runId ? null : runId));
  }, []);

  const [territories, setTerritories] = useState<TerritoryView | null>(null);

  /* Territories share the list's ask cadence (`asked`). No inventing — only
     what `/api/git/worktrees` and `/api/status` actually answered. */
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    void (async () => {
      if (!isSameOriginPath('/api/status') || !isSameOriginPath('/api/git/worktrees')) return;
      try {
        const statusRes = await fetch('/api/status', { signal: controller.signal });
        if (!live) return;
        if (!statusRes.ok) {
          setTerritories(null);
          return;
        }
        const status = (await statusRes.json()) as GetStatusResponse;
        if (!('attached' in status) || status.attached !== true || !('root' in status)) {
          setTerritories(null);
          return;
        }
        const mainPath = status.root;
        const wtRes = await fetch('/api/git/worktrees', { signal: controller.signal });
        if (!live) return;
        if (!wtRes.ok) {
          setTerritories(null);
          return;
        }
        const body = (await wtRes.json()) as GetGitWorktreesResponse;
        const entries: WorktreeEntry[] = (body.worktrees ?? []).map((w) => ({
          path: w.path,
          branch: w.branch,
          head: w.head,
          bare: w.bare,
          detached: w.detached,
        }));
        setTerritories(territoryView(entries, mainPath));
      } catch {
        if (live) setTerritories(null);
      }
    })();
    return () => {
      live = false;
      controller.abort();
    };
  }, [asked]);

  const onOpenOnBoard = useCallback((run: ProgramRunSummary) => {
    try {
      sessionStorage.setItem(ACTIVE_RUN_STORAGE_KEY, run.runId);
    } catch {
      /* private mode */
    }
    requestHostCommand('canvas.board');
    void fetch(`/api/program/runs/${encodeURIComponent(run.runId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: RunDetail | null) => {
        const program = body?.run?.program;
        if (!program) return;
        beginBoardRunWatch(
          run.runId,
          program.id,
          program.nodes.map((n) => n.id),
        );
      })
      .catch(() => undefined);
  }, []);

  return (
    <ActivityPane
      runs={runs}
      failure={failure}
      loading={loading}
      now={tick}
      filter={filter}
      onFilter={setFilter}
      onRefresh={() => {
        setTick(clock.current());
        setAsked((n) => n + 1);
      }}
      openId={openId}
      open={open}
      openFailure={openFailure}
      openLoading={openLoading}
      onOpen={onOpen}
      onCloseRun={() => {
        setOpenId(null);
        setOpen(null);
        setOpenFailure(null);
      }}
      authoring={authoring}
      authorDraft={authorDraft}
      onAuthor={() => {
        setAuthoring(true);
        setAuthorDraft(null);
        setStartFailure(null);
      }}
      onAuthorCancel={() => {
        setAuthoring(false);
        setAuthorDraft(null);
      }}
      onStart={onStart}
      starting={starting}
      startFailure={startFailure}
      acpNotice={acpReadinessNote(acpReadiness)}
      onPause={steer('pause')}
      onResume={steer('resume')}
      onCancel={steer('cancel')}
      steering={steering}
      steerFailure={steerFailure}
      onOpenOnBoard={onOpenOnBoard}
      territories={territories}
    />
  );
}
