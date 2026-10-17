/**
 * Program routes (customer autoresearch), moved out of repoServer.ts unchanged:
 *
 *   GET  /api/program/strategy        `.sequence/program.md`
 *   GET|POST /api/program/run-log     `.sequence/runs/results.tsv`
 *   POST /api/program/run             start a run (the runner is built by createRepoServer and handed in)
 *   GET  /api/program/runs            every run for this repo, newest first
 *   GET  /api/program/runs/:runId     one run (+ /events as SSE, + /cancel)
 *
 * The repo-attached and owner checks stay in repoServer and arrive as callbacks. Nothing here closes over
 * createRepoServer state: the runner, the agent registry and the ACP gate are passed in.
 */

import http from 'node:http';
import { validateProgram, isProgramRunLogRow, parseProgramEditAllowlist, type Program } from '@sequence/schema';
import type { Unvalidated, GetProgramRunLogResponse, PostProgramRunRequest, PostProgramRunResponse, GetProgramRunsResponse, GetProgramRunResponse, PostProgramRunCancelResponse, ProgramInvalidResponse, ProgramRunEvent } from '@sequence/api-types';
import { type AgentEntry } from './agentsStore.js';
import { TooManyRunsError, type ProgramRunner } from './programRunner.js';
import { isRunId } from './programRunStore.js';
import { appendProgramRunLog, readProgramRunLog, readProgramStrategy } from './programMemory.js';
import { MAX_BODY_BYTES, sendJson, sendError, isJsonRequest, readBody, startSse } from './routeHttp.js';

export interface ProgramRouteContext {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  method: string;
  requireRepo: (res: http.ServerResponse) => boolean;
  requireOwner: () => boolean;
  activeRoot: () => string;
  programRunner: ProgramRunner;
  /** The metering identity of this request. */
  identity: string;
  acpGate: () => { available: boolean; originOk: boolean; reason?: string };
  resolveProgramAgent: (agentRef: string) => AgentEntry;
  defaultProgramAgentRef: string;
}

export function isProgramRoutePath(pathname: string): boolean {
  return pathname.startsWith('/api/program/');
}

/** Handle the /api/program/* routes. Returns false when the request is not one of ours. */
export async function handleProgramRoute(ctx: ProgramRouteContext): Promise<boolean> {
  const { req, res, url, method } = ctx;
  const { pathname } = url;
  const { requireRepo, requireOwner, activeRoot, programRunner, identity, acpGate, resolveProgramAgent } = ctx;
  const DEFAULT_PROGRAM_AGENT_REF = ctx.defaultProgramAgentRef;
  // ---- GET /api/program/strategy  (`.sequence/program.md` — customer autoresearch) ----
  // Human-edited loop rules for BYO-key Program runs. Key-free read; absent ⇒ 404.
  if (pathname === '/api/program/strategy' && method === 'GET') {
    if (requireRepo(res)) return true;
    if (requireOwner()) return true;
    const text = readProgramStrategy(activeRoot());
    if (text === undefined) {
      sendError(res, 404, 'no program strategy — add .sequence/program.md');
      return true;
    }
    const editAllowlist = parseProgramEditAllowlist(text);
    const body: { path: string; content: string; editAllowlist?: string[] } = {
      path: '.sequence/program.md',
      content: text,
    };
    if (editAllowlist) body.editAllowlist = editAllowlist;
    sendJson(res, 200, body);
    return true;
  }

  // ---- POST /api/program/run-log  (append `.sequence/runs/results.tsv`) ----
  // Harness-owned experiment log (autoresearch results.tsv). Agents cannot write
  // via /api/file; only this append endpoint updates the TSV. Key-free.
  if (pathname === '/api/program/run-log' && method === 'POST') {
    if (requireRepo(res)) return true;
    if (requireOwner()) return true;
    if (!isJsonRequest(req)) {
      sendError(res, 415, 'expected content-type application/json');
      return true;
    }
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
    } catch (e) {
      sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
      return true;
    }
    if (!isProgramRunLogRow(body)) {
      sendError(
        res,
        400,
        'body must be a run log row: { runId, programId, metric, status, description }',
      );
      return true;
    }
    appendProgramRunLog(activeRoot(), body);
    sendJson(res, 200, { ok: true, path: '.sequence/runs/results.tsv' });
    return true;
  }

  // ---- GET /api/program/run-log  (read `.sequence/runs/results.tsv`) ----
  if (pathname === '/api/program/run-log' && method === 'GET') {
    if (requireRepo(res)) return true;
    const rows = readProgramRunLog(activeRoot());
    const runLog: GetProgramRunLogResponse = { rows };
    sendJson(res, 200, runLog);
    return true;
  }

  /* ================= P8 — SERVER-SIDE RUNS: THE ROUTES ======================
   * `POST /api/program/run` starts one and answers with a run id; the run is
   * NOT tied to that request. `GET /api/program/runs` lists, `GET
   * /api/program/runs/:id` reads one, `GET /api/program/runs/:id/events`
   * tails/replays, `POST /api/program/runs/:id/cancel` stops.
   *
   * THE ONE THING TO NOT GET WRONG, written here because it is invisible in a
   * diff: NONE of these routes wires `requestAbort(res)` into the run. That
   * helper exists to stop work when the caller goes away, and it is exactly
   * right for an ask — but wiring it here would mean closing the tab kills the
   * run, which is the bug being closed. A disconnect ends a SUBSCRIPTION.
   * Cancelling ends a RUN, and it is a separate verb.
   */

  // ---- POST /api/program/run  { program, inputs?, timeoutMs?, maxSteps? } ----
  if (pathname === '/api/program/run' && method === 'POST') {
    if (requireRepo(res)) return true;
    if (requireOwner()) return true;
    if (!isJsonRequest(req)) {
      sendError(res, 415, 'expected content-type application/json');
      return true;
    }
    let body: Unvalidated<PostProgramRunRequest>;
    try {
      body = JSON.parse(await readBody(req, MAX_BODY_BYTES));
    } catch (e) {
      sendError(res, 400, `invalid JSON body: ${(e as Error).message}`);
      return true;
    }
    if (!body.program || typeof body.program !== 'object') {
      sendError(res, 400, 'body must include a "program" object');
      return true;
    }
    const program = body.program as Program;
    // The SAME validator the CLI runs. A program that would not survive
    // `sequence program run` must not survive this route either, or the two
    // entry points disagree about what a valid program is.
    const validation = validateProgram(program);
    if (!validation.ok) {
      const invalid: ProgramInvalidResponse = {
        error: `program is not valid (${validation.errors.length} problem${validation.errors.length === 1 ? '' : 's'})`,
        problems: validation.errors,
      };
      sendJson(res, 400, invalid);
      return true;
    }
    /*
     * The ACP gate is evaluated HERE, against the request that starts the run,
     * and never again. A detached run has no request to check `isOriginAllowed`
     * against, so the choice is to check it at the door or not at all — and a
     * local-only capability that stops being checked once it is behind a run id
     * is not local-only. A program with no acp node is unaffected.
     */
    const wantsAcp = program.nodes.some((n) => n.kind === 'agent' && n.agent?.runtime === 'acp');
    if (wantsAcp) {
      const g = acpGate();
      if (!g.available) {
        sendError(res, 403, g.reason ?? 'ACP is not available');
        return true;
      }

      /*
       * RESOLVE BEFORE ACCEPTING. The runner is deliberately detached from
       * this request, so an executor-construction error otherwise arrives
       * only after a 202 and becomes a failed row. Every ACP ref the executor
       * will ask for is knowable from the validated program right now; a
       * request the server already knows cannot start is a 400 and creates no
       * run record.
       */
      const refs = new Set(
        program.nodes
          .filter((node) => node.kind === 'agent' && node.agent?.runtime === 'acp')
          .map((node) => node.agent?.acp?.agentRef ?? DEFAULT_PROGRAM_AGENT_REF),
      );
      try {
        for (const agentRef of refs) resolveProgramAgent(agentRef);
      } catch (e) {
        sendError(res, 400, (e as Error).message);
        return true;
      }
    }
    const inputs: Record<string, string> = {};
    if (body.inputs && typeof body.inputs === 'object') {
      for (const [k, v] of Object.entries(body.inputs as Record<string, unknown>)) {
        if (typeof v === 'string') inputs[k] = v;
      }
    }
    let started;
    try {
      started = programRunner.start({
        repoRoot: activeRoot(),
        program,
        identity,
        ...(Object.keys(inputs).length > 0 ? { inputs } : {}),
        ...(typeof body.timeoutMs === 'number' ? { timeoutMs: body.timeoutMs } : {}),
        ...(typeof body.maxSteps === 'number' ? { maxSteps: body.maxSteps } : {}),
        ...(typeof body.sourceDiagramId === 'string'
          ? { sourceDiagramId: body.sourceDiagramId }
          : {}),
        ...(typeof body.sourceDiagramHash === 'string'
          ? { sourceDiagramHash: body.sourceDiagramHash }
          : {}),
      });
    } catch (e) {
      if (e instanceof TooManyRunsError) {
        sendError(res, 429, e.message);
        return true;
      }
      throw e;
    }
    const accepted: PostProgramRunResponse = {
      runId: started.runId,
      status: started.status,
      startedAt: started.startedAt,
      // 0, deliberately, and NOT `started.lastEventSeq`. This field is the
      // caller's resume CURSOR, and this caller has seen nothing yet. The run
      // may already have committed `run:started` synchronously; echoing that
      // number back would make the client's first reconnect skip it.
      lastEventSeq: 0,
    };
    // 202, not 200: the run is ACCEPTED and registered, and has not finished.
    // A 200 here would read as "done", which is the one thing it is not.
    sendJson(res, 202, accepted);
    return true;
  }

  // ---- GET /api/program/runs  → every run for this repo, newest first ----
  if (pathname === '/api/program/runs' && method === 'GET') {
    if (requireRepo(res)) return true;
    if (requireOwner()) return true;
    const runs: GetProgramRunsResponse = { runs: programRunner.list(activeRoot()) };
    sendJson(res, 200, runs);
    return true;
  }

  // ---- /api/program/runs/:runId  (+ /events, /cancel) ----
  if (pathname.startsWith('/api/program/runs/')) {
    if (requireRepo(res)) return true;
    if (requireOwner()) return true;
    const rest = pathname.slice('/api/program/runs/'.length);
    const slash = rest.indexOf('/');
    const runId = decodeURIComponent(slash === -1 ? rest : rest.slice(0, slash));
    const tail = slash === -1 ? '' : rest.slice(slash + 1);
    // `isRunId` is a whitelist over the exact alphabet this server mints, so a
    // traversal attempt never reaches `path.join` — the store refuses to build
    // a path for anything else, and this refuses before it even asks.
    if (!isRunId(runId)) {
      sendError(res, 404, 'run not found');
      return true;
    }

    // ---- POST /api/program/runs/:runId/cancel ----
    if (tail === 'pause' && method === 'POST') {
      /*
       * PAUSE IS NOT CANCEL. Cancel aborts mid-node and the run is over;
       * pause lets the node in flight finish and halts before the next, which
       * is what makes the scheduler's `paused` status resumable from its own
       * checkpoint.
       *
       * It is the producer "Waiting on you" never had. `shouldPause` is the
       * only thing that yields `paused` and nothing called it, so that bucket
       * counted zero on every real list — honestly, and uselessly.
       */
      const outcome = programRunner.pause(activeRoot(), runId);
      if (!outcome.found) {
        sendError(res, 404, 'run not found');
        return true;
      }
      /* 200 even when nothing was paused, for cancel's reason: a run that has
         already finished satisfies "stop going" too, and a 409 would make
         "you were too late" look like a failure to act on. */
      sendJson(res, 200, {
        ok: true,
        runId,
        paused: outcome.cancelled,
        status: outcome.status,
      });
      return true;
    }

    if (tail === 'resume' && method === 'POST') {
      /*
       * THE OTHER HALF OF PAUSE, WHICH DID NOT EXIST.
       *
       * `pause` set `pauseRequested` and nothing anywhere cleared it, so a
       * paused run was paused permanently — while `runProgram` had supported
       * resuming from a checkpoint since Harness W4 and the checkpoint was
       * already persisted on every node. The primitive was complete and
       * every layer above it was missing, and a notification was telling
       * users the run "can be resumed".
       */
      const outcome = programRunner.resume(activeRoot(), runId);
      if (!outcome.found) {
        sendError(res, 404, 'run not found');
        return true;
      }
      /* 200 even when nothing restarted, for pause's reason: a run that is
         already running, or long finished, does not need resuming and a 409
         would make "there was nothing to do" look like a failure. The
         `resumed` flag is what says which happened. */
      sendJson(res, 200, {
        ok: true,
        runId,
        resumed: outcome.cancelled,
        status: outcome.status,
      });
      return true;
    }

    if (tail === 'cancel' && method === 'POST') {
      const outcome = programRunner.cancel(activeRoot(), runId);
      if (!outcome.found) {
        sendError(res, 404, 'run not found');
        return true;
      }
      const cancelled: PostProgramRunCancelResponse = {
        ok: true,
        runId,
        cancelled: outcome.cancelled,
        status: outcome.status,
      };
      // 200 even when nothing was cancelled: the caller's intent — this run
      // must not keep going — is already satisfied by a run that finished.
      // A 409 would make "you were too late" look like a failure to act on.
      sendJson(res, 200, cancelled);
      return true;
    }

    // ---- GET /api/program/runs/:runId/events  (SSE, resumable) ----
    if (tail === 'events' && method === 'GET') {
      const stored = programRunner.read(activeRoot(), runId);
      if (!stored) {
        sendError(res, 404, 'run not found');
        return true;
      }
      const sinceParam = url.searchParams.get('since');
      const lastEventId = req.headers['last-event-id'];
      /*
       * `?since=` wins over `Last-Event-ID` when both are present. The header
       * is what a browser `EventSource` sends BY ITSELF on an automatic
       * reconnect; the query is what a client that manages its own cursor
       * sends deliberately. When they disagree, the deliberate one is the one
       * that reflects what the client has actually processed.
       */
      const rawSince =
        sinceParam !== null ? sinceParam : typeof lastEventId === 'string' ? lastEventId : '';
      const parsedSince = Number.parseInt(rawSince, 10);
      const since = Number.isFinite(parsedSince) && parsedSince > 0 ? parsedSince : 0;

      startSse(res);
      let lastSent = since;
      /**
       * One writer for both replayed and live events.
       *
       * The `seq <= lastSent` drop is what makes a reconnect idempotent
       * regardless of which path an event arrives on — the property ml-harness
       * §1.1 calls "idempotent by construction rather than by timing". The
       * `id:` line is the cursor the client sends back; the ask stream has no
       * such line, which is exactly why a blip there loses the turn.
       */
      const sendEvent = (event: ProgramRunEvent): void => {
        if (event.seq <= lastSent || res.writableEnded) return;
        lastSent = event.seq;
        res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
      };

      /*
       * SUBSCRIBE FIRST, THEN REPLAY, and never await between the two.
       *
       * `subscribe` and `programRunner.events` are both synchronous, and Node
       * runs this handler to completion before the run's next `await` boundary
       * can commit anything — so there is no interleaving window at all. The
       * ORDER still matters: subscribing after the read would open one, and a
       * future edit that adds an await between them is caught by the
       * `lastSent` guard rather than by silently dropping an event.
       */
      const unsubscribe = programRunner.subscribe(runId, (event) => {
        sendEvent(event);
        // Nothing follows the terminal event, so the response ends with it
        // rather than holding a socket open on a run that is over.
        if (event.type === 'run:finished') {
          unsubscribe?.();
          if (!res.writableEnded) res.end();
        }
      });
      for (const event of programRunner.events(activeRoot(), runId, since)) sendEvent(event);

      if (!unsubscribe) {
        // Not live: the durable log is complete, so there is nothing further to
        // wait for. This is the same code path a finished run's tail takes.
        res.end();
        return true;
      }
      // A disconnect drops the SUBSCRIPTION and nothing else. The run keeps
      // going; the client reconnects with `?since=<lastSeq>` and misses nothing.
      res.on('close', () => unsubscribe());
      return true;
    }

    // ---- GET /api/program/runs/:runId ----
    if (tail === '' && method === 'GET') {
      const stored = programRunner.read(activeRoot(), runId);
      if (!stored) {
        sendError(res, 404, 'run not found');
        return true;
      }
      const one: GetProgramRunResponse = { run: stored.run, events: stored.events };
      sendJson(res, 200, one);
      return true;
    }

    sendError(res, 404, 'not found');
    return true;
  }

  return false;
}
