/**
 * The ask routes, moved out of repoServer.ts unchanged:
 *
 *   POST /api/ask          one buffered answer as JSON
 *   POST /api/ask/stream   the same turn as an SSE feed with a resumable log and a trajectory
 *
 * Owner and live-state reads arrive as callbacks and getters; nothing here closes over createRepoServer state.
 */

import { PLAN_SURFACE,  writePlanDocument } from './planTurn.js';
import http from 'node:http';
import crypto from 'node:crypto';
import {  readAgentSettings } from './askAgentMap.js';
import { openAskTurnLog } from './askTurnLog.js';
import { StreamCoalescer, askTextOf, askWithText } from './streamCoalescer.js';
import { capAskEvent, streamBodyDir } from './streamBodies.js';
import { runAskPipeline, computeAskInstructionHash,   type AskPipelineResult, type AskStreamEvent } from './askPipeline.js';
import { buildRunReceipt, writeRunReceipt } from './runReceipt.js';
import { writeTrajectory, buildAskTrajectoryGraph, askMetricsFromTerminal } from './trajectoryStore.js';
import { recordTurn } from '../harness/refineSignals.js';
import { runSignalLoop } from '../harness/learningLoop.js';
import { runLearningLoop } from '../harness/learningLoop.js';
import { ProviderError } from './provider.js';
import { sendJson, startSse, sendAborted, writeSseEvent, isRequestAbortedError } from './routeHttp.js';
import { prepareAskTurn, buildAskPipelineInput, makeAskCallProvider, finishAskTurn, type AskEnv } from './askTurnCore.js';

export interface AskRouteContext extends AskEnv {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
  method: string;

}

export function isAskRoutePath(pathname: string): boolean {
  return pathname === '/api/ask' || pathname === '/api/ask/stream';
}

/** Handle the /api/ask and /api/ask/stream routes. Returns false when the request is not one of ours. */
export async function handleAskRoute(ctx: AskRouteContext): Promise<boolean> {
  const { req, res, url, method } = ctx;
  const { pathname } = url;
  const { userConfigDir, opts, askWorkspaceRoot, getRoot } = ctx;
  // ---- POST /api/ask  { question, intents?, context?, mode?, design? } ----
  // A minimal board-level "ask the AI about your system": it sends the SAME
  // deterministic structure digest used by /api/explain plus the question to the
  // CONFIGURED provider (the v6 BYO-key path — never a new provider path) and
  // returns { text }. It is an assistant OVER the real digest; it never invents
  // structure. No provider configured ⇒ a clear 400 the UI shows verbatim. The
  // key is loaded via loadAiConfig and only ever put on the wire by provider.ts
  // (same key hygiene as generate/explain); it is never logged.
  //
  // DESIGN MODE (owner report: "I just started a new file, why would I need a
  // repo?"): a from-scratch designer has no repo to attach, so a hard requireRepo
  // made the assistant unusable in Design mode. When NO repo is attached and the
  // body carries `design: { title, outline }` with a non-empty outline, the design
  // outline becomes the grounding context instead of a scan digest — same provider
  // path, same key hygiene, and a prompt that forbids scan claims and file:line
  // citations (buildDesignAskPrompt). No repo AND no design ⇒ the honest 409.
  //
  // INTENTS AS CAPABILITIES (owner: "It shouldn't be seen. It should just be
  // added as a tool, and our backend runs that way."). The composer's `+`
  // picks used to be PROSE the client concatenated onto the front of the
  // user's typed words, so the instruction genuinely WAS the user's message on
  // the wire. Now the client sends its own three things separately:
  //
  //   question : the user's typed words, and nothing else
  //   intents  : [{ id, subject?, subjectNodeId? }] — which capabilities were invoked
  //   context  : { lines } — the compiled grounded scope (budgeted client-side)
  //   mode     : 'research' | 'implementation'
  //
  // and the SERVER composes the prompt: `explain/askIntents.ts` executes each
  // intent (deterministically off the real graph where it can — blast radius
  // and component breakdown are computed by the same engines the canvas uses)
  // and `buildAskPrompt` renders the result as labelled sections ALONGSIDE the
  // question, never inside it.
  //
  // BACKWARDS COMPATIBLE BY CONSTRUCTION: every new field is optional, and each
  // composition section is skipped when empty, so a request carrying only
  // `{question}` (or `{question, design}`) produces a byte-identical prompt to
  // before — locked by ask-intents.test.ts.
  //
  // NO NATIVE TOOL-CALL ROUND TRIP, and that is deliberate rather than a gap:
  // the user already chose the capability by clicking the chip, so handing the
  // model a tool list to "choose" it would add a provider round trip and a
  // hallucination surface for nothing, and the capabilities that matter are
  // computed here, not by the model. Every provider — Anthropic api-key, any
  // openai-compatible BYO key, the hosted default gateway — therefore takes the
  // SAME server-composed path; there is no provider capability branch and so
  // no invisible degradation. See the header of `explain/askIntents.ts`.
  if (pathname === '/api/ask' && method === 'POST') {
    // requireOwner runs BEFORE requireRepo here because the repo check is now
    // conditional; repo-less ⇒ unowned ⇒ requireOwner is a no-op (same stance as
    // /api/design-suggest), so no auth behaviour changes for an attached repo.
    const prologue = await prepareAskTurn(ctx, req, res, 'buffered');
    if (prologue.kind === 'handled') return true;
    if (prologue.kind === 'surface') {
      // `source` is the honest marker: this text came off the surface, not
      // from a provider, so nothing was metered and nothing was generated.
      sendJson(res, 200, { text: prologue.text, source: 'surface' });
      return true;
    }
    if (prologue.kind === 'lesson') {
      sendJson(res, 200, { text: prologue.text, source: 'lesson' });
      return true;
    }
    const turn = prologue.turn;
    const { askAbort } = turn;
    try {
      /*
       * A SINK ONLY FOR WHAT THE LESSON NEEDS TO KNOW.
       *
       * This route does not stream, so it passed no observer and could see a
       * visual only as `result.diagram`. The bench calls the pipeline directly
       * WITH an observer and counts `chart:proposal`, so the two disagreed
       * about whether a turn taught: a turn that drew a chart advanced the
       * lesson in the bench and did not in the product. A bench that measures a
       * more generous rule than the product ships is measuring the wrong
       * product.
       */
      let chartsThisTurn = 0;
      const result = await runAskPipeline(
        { ...buildAskPipelineInput(ctx, turn), callProvider: makeAskCallProvider(ctx, turn, { streaming: false }) },
        (e) => {
          if (e.type === 'chart:proposal') chartsThisTurn += 1;
        },
      );
      finishAskTurn(turn, result, chartsThisTurn);
      const payload: Record<string, unknown> = { text: result.text };
      if (result.diagram) payload.diagram = result.diagram;
      if (result.unsupportedIntents?.length) payload.unsupportedIntents = result.unsupportedIntents;
      if (result.usage) payload.usage = result.usage;
      if (result.source) payload.source = result.source;
      // ITEM 1.1's WIRING. The pipeline computes coverage and `resultPayload`
      // already puts it on the SSE `result` event; this hand-built JSON payload
      // was the one place it was dropped, so the buffered route answered without
      // the one claim a terminal agent structurally cannot make. Copied, never
      // recomputed — the two routes must not be able to disagree.
      if (result.coverage) payload.coverage = result.coverage;
      /* AND `claims` IS THE SECOND ONE, dropped the same way and for longer. The
         pipeline runs checkAnswerClaims against the scanned graph and attaches the
         result ONLY when it has something to say, so its presence means "look at
         this". resultPayload() puts it on the SSE result event; this hand-built
         payload did not, so the buffered route answered with the fabrication and no
         sign that the product had already noticed. Copied, never recomputed. */
      if (result.claims) payload.claims = result.claims;
      /* AND `premise` IS THE THIRD, caught the same night it was written. It is
         the mirror of `claims`: that one checks what the MODEL said, this one
         checks what the USER said, and it exists because a false premise steered
         a whole turn while only its consequence was examined. A verdict no caller
         can observe is a verdict that cannot be made to fail, so it rides here as
         a machine-readable field — no prose, no tone taken, which keeps the
         surfacing decision the owner's. Copied, never recomputed. */
      if (result.premise) payload.premise = result.premise;
      /* AND `contextFit` — whether the prompt fit the window the local model
         actually runs. Same rule as the three above: on both routes or on
         neither, copied and never recomputed. */
      if (result.contextFit) payload.contextFit = result.contextFit;
      /* AND `verify` WAS THE FOURTH — the done-when receipt, on the streaming
         route and undeclared, so this file's own rule ("a field absent from the
         buffered payload and not named as streaming-only is a bug, not a choice")
         had been quietly broken. A buffered caller that just wrote files has no
         transcript to watch, so it needs the gate result MORE than a streaming
         one, not less. */
      if (result.verify) payload.verify = result.verify;
      sendJson(res, 200, payload);
    } catch (e) {
      if (isRequestAbortedError(e)) {
        sendAborted(res);
        return true;
      }
      if (e instanceof ProviderError) {
        const errBody: Record<string, unknown> = { error: e.message };
        if (e.body !== undefined) errBody.providerResponse = e.body;
        sendJson(res, e.httpStatus ?? 502, errBody);
        return true;
      }
      throw e;
    } finally {
      askAbort.dispose();
    }
    return true;
  }


  if (pathname === '/api/ask/stream' && method === 'POST') {
    const prologue = await prepareAskTurn(ctx, req, res, 'stream');
    if (prologue.kind === 'handled') return true;
    if (prologue.kind === 'surface') {
      const surfaceAnswer = prologue.text;
      const { surface, jobMode, teach, askTurn, askPermission, question } = prologue.head;
      const runId = crypto.randomUUID();
      const startedAt = new Date().toISOString();
      const askTrace: Array<Record<string, unknown>> = [];
      startSse(res);
      const surfaceInstructionHash = computeAskInstructionHash({
        designMode: false,
        repoRoot: getRoot(),
        jobMode,
      teach,
      ...askTurn.contextField(),
        permission: askPermission,
        surface,
        question,
      });
      writeSseEvent(res, {
        type: 'trajectory:start',
        runId,
        instructionHash: surfaceInstructionHash,
      });
      const surfaceResult = { type: 'result', text: surfaceAnswer, source: 'surface' } as AskStreamEvent;
      writeSseEvent(res, surfaceResult);
      askTrace.push(surfaceResult as Record<string, unknown>);
      res.end();
      if (getRoot() !== null) {
        try {
          writeTrajectory(getRoot()!, {
            version: 1,
            runId,
            kind: 'ask',
            startedAt,
            finishedAt: new Date().toISOString(),
            question,
            askTrace,
            askTerminal: { type: 'result', text: surfaceAnswer, source: 'surface' },
            graph: buildAskTrajectoryGraph(runId, askTrace),
          });
        } catch {
          /* trajectory persistence is best-effort; the stream already succeeded */
        }
      }
      return true;
    }
    if (prologue.kind === 'lesson') {
      /* No askTrace here: a refusal has no trajectory to record — nothing ran. The JSON handler writes none
         either, so the two stay identical. The stream carries the same `source: 'lesson'` marker. */
      startSse(res);
      writeSseEvent(res, { type: 'result', text: prologue.text, source: 'lesson' } as AskStreamEvent);
      res.end();
      return true;
    }
    const turn = prologue.turn;
    const { question, jobMode, teach, askPermission, surface, designMode, askCheckpoint, cfg, carryThreadId, askAbort } = turn;
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const askTrace: Array<Record<string, unknown>> = [];
    // Item 1.3 — on a streamed ask the reader IS the response socket, so its
    // close is the cancellation signal. Registered before the first frame so a
    // client that disconnects immediately is still observed.
    /*
     * THE TURN IS WRITTEN DOWN AS IT HAPPENS, so losing the socket does not
     * lose the answer.
     *
     * It would be reasonable to think the tradeoff here is "keep going after
     * a disconnect and burn spend on an abandoned tab". It is not.
     * `requestAbort` builds a signal from the socket close and hands it to
     * the provider layer and the ask pipeline. Stop tears down the outbound
     * provider fetch, stops the tool loop, and the metering race ensures an
     * aborted turn is not charged.
     *
     * Absent a repository there is nowhere to write, and the design path
     * legitimately answers without one - so the log is optional and every
     * use of it is guarded. A turn that cannot be recorded still streams.
     */
    const turnLog =
      getRoot() === null
        ? null
        : (() => {
            try {
              return openAskTurnLog(getRoot()!, runId);
            } catch {
              /* A statistic-grade failure must never fail the turn. */
              return null;
            }
          })();
    startSse(res);
    /*
     * COMMIT BEFORE YIELD. The append happens first and the socket write
     * second, so an event a client saw is always an event on disk. The other
     * order produces the one unrecoverable case: a client that received
     * event 7 reconnects asking for 8 and is told the turn only reached 6.
     */
    /* S6: deltas merge within 50 ms on the socket (a merged frame carries
       its last part's seq, so Last-Event-ID resumes after all of it); the
       log keeps every event as it was. A command's output over 8 KB is cut
       and kept for GET /api/stream-body (streamBodies.ts). */
    const askBodyDir = streamBodyDir({ repoRoot: getRoot(), chatId: null, userConfigDir });
    const askOut = new StreamCoalescer<AskStreamEvent, number | null>({
      textOf: askTextOf,
      withText: askWithText,
      write: (event, seq) => {
        if (!res.writableEnded) writeSseEvent(res, event, seq ?? null);
      },
      clock: opts.streamCoalesce?.clock,
      windowMs: opts.streamCoalesce?.windowMs,
    });
    res.once('close', () => askOut.dispose());
    const record = (raw: AskStreamEvent): void => {
      const event = capAskEvent(raw, askBodyDir);
      let seq: number | null = null;
      try {
        seq = turnLog?.append(event as unknown as Record<string, unknown>).seq ?? null;
      } catch {
        /* Disk full, or the directory went away. Stream anyway - the live
           reader is the one actually waiting on this. */
      }
      askOut.push(event, seq);
    };

    /*
     * `trajectory:start` IS STREAMED AND LOGGED BUT NEVER TRACED.
     *
     * It is a CONTROL event - it announces the run id so a client knows what
     * to resume - and `askTrace` is the record of what the assistant
     * actually did. `trajectory-capture.test.ts` asserts every askTrace entry
     * was really streamed as a payload event and excludes this one by name,
     * so tracing it turns that suite red. It goes in the DURABLE log, though,
     * because a client replaying a turn from scratch needs the run id as much
     * as a live one does.
     */
    const instructionHash = computeAskInstructionHash({
      designMode,
      repoRoot: designMode ? null : getRoot(),
      /* It adds a belt section, so it must change the hash by construction. */
      workspaceRoot: askWorkspaceRoot(),
      jobMode,
      teach,
      permission: askPermission,
      surface,
      question,
    });
    record({ type: 'trajectory:start', runId, instructionHash });
    /*
     * THE ONE GENUINELY NEW MEASUREMENT IN THE RUN RECEIPT. Every provider
     * call this turn reports how many retries `requestModelTextWithUsage`
     * took before answering; they are summed here, per request, and land
     * in `.sequence/receipts/<runId>.json` via `finalizeTrajectory`. Stays
     * `undefined` until a call reports — a receipt must not say `0` about
     * a turn whose provider path never counted.
     */
    let providerRetriesThisTurn: number | undefined;

    /*
     * THE PLAN DOCUMENT IS A FILE TOO (docs/OWNER-WALK-2026-09-22.md, /plan):
     * every Markdown block written to the Plan tab this turn is kept, in
     * order, at `.sequence/plans/<thread>.md`, so the plan opens in Files
     * beside chat and outlives the canvas. Best effort: a plan that cannot be
     * saved is still on the canvas, and a turn is never failed for it.
     */
    const planBlocks = new Map<string, string>();
    const savePlanDocument = (event: AskStreamEvent): void => {
      if (event.type !== 'canvas:block' || event.surface !== PLAN_SURFACE) return;
      if (event.blockType !== 'markdown' || getRoot() === null) return;
      planBlocks.set(event.id, event.payload);
      writePlanDocument(getRoot()!, carryThreadId, planBlocks);
    };
    const emit = (event: AskStreamEvent): void => {
      record(event);
      askTrace.push(event as Record<string, unknown>);
      savePlanDocument(event);
    };
    const finalizeTrajectory = (
      terminal: { type: 'result' | 'error' } & Record<string, unknown>,
      /** The pipeline's return on an ok terminal; an error terminal has none. */
      pipelineResult?: AskPipelineResult,
    ): void => {
      if (getRoot() === null) return;
      /*
       * THE TURN'S ROLLBACK POINT IS IN SCOPE HERE: `askCheckpoint.rollbackPoint()`
       * is the `seq` of the checkpoint taken before this turn's first agent
       * write, or `undefined` when the turn wrote nothing (or came without a
       * session id). It is deliberately NOT written into the trajectory —
       * `writeTrajectory`'s record has no field for it and nothing reads one,
       * and this repo does not add fields nothing reads. The run receipt
       * below is what reads it.
       */
      const finishedAt = new Date().toISOString();
      /*
       * THE CHANGE RECEIPT (audit G3), written FIRST and in its own guard so
       * a trajectory failure cannot take it down, and vice versa. Every
       * terminal gets one — an error turn that wrote files before the
       * provider died is the turn a reader most needs a receipt for. Best
       * effort like the trajectory: a receipt that cannot be written is one
       * stderr line, never a failed turn the client already saw succeed.
       */
      try {
        writeRunReceipt(
          getRoot()!,
          buildRunReceipt({
            runId,
            startedAt,
            finishedAt,
            terminal: terminal.type,
            ...(typeof terminal.error === 'string' ? { error: terminal.error } : {}),
            events: askTrace,
            ...(pipelineResult ? { result: pipelineResult } : {}),
            instructionHash,
            cfg,
            ...(askPermission !== undefined ? { permissionMode: askPermission } : {}),
            ...(providerRetriesThisTurn !== undefined ? { providerRetries: providerRetriesThisTurn } : {}),
            ...(askCheckpoint.rollbackPoint() !== undefined ? { rollbackPoint: askCheckpoint.rollbackPoint() } : {}),
          }),
        );
      } catch (e) {
        process.stderr.write(`sequence: run receipt for ${runId} not written: ${(e as Error).message}\n`);
      }
      try {
        const askTerminal: { type: 'result' | 'error' } & Record<string, unknown> = { ...terminal };
        if (askTerminal.type === 'result' && typeof askTerminal.text === 'string' && askTerminal.text.length > 2000) {
          askTerminal.text = askTerminal.text.slice(0, 2000);
        }
        const askMetrics = askMetricsFromTerminal(askTerminal);
        writeTrajectory(getRoot()!, {
          version: 1,
          runId,
          kind: 'ask',
          startedAt,
          finishedAt,
          question,
          askTrace,
          askTerminal,
          ...(askMetrics ? { askMetrics } : {}),
          graph: buildAskTrajectoryGraph(runId, askTrace),
        });
      } catch {
        /* trajectory persistence is best-effort; the stream already succeeded */
        return;
      }
      /*
       * THE LEARNING LOOP'S ONLY AUTOMATIC CALLER. A failed turn is the
       * evidence `planRefineFromTrajectories` reads, and until this hook
       * nothing ran the planner after one (audit G4: five /api/harness/*
       * routes, no caller). It runs only on an ERROR terminal — a successful
       * turn is skill-distill material, not a failure pattern — and only
       * after `writeTrajectory` returned, so the run that just failed is in
       * the set it reads. Fire-and-forget: the stream has already ended and
       * nothing on the request path waits for it. It PROPOSES under
       * `.sequence/refinements/`; the target is written only by the
       * verify-gated accept route. `runLearningLoop` never throws, so the
       * `.catch` is for a rejection the contract says cannot happen.
       */
      /* The refine loop's all-provider log: this local ask, with its pipeline error if it had one, next to
         the Claude and Codex turns the run-node route logs. Off the request path; never throws. */
      const loopRoot = getRoot()!;
      const loopAuto = readAgentSettings(userConfigDir).autoRefine;
      setImmediate(() => {
        try {
          recordTurn(loopRoot, {
            id: runId,
            chat: carryThreadId ?? 'local',
            agent: 'local',
            at: Date.parse(startedAt) || Date.now(),
            text: question,
            status: terminal.type === 'error' ? 'failed' : 'done',
            pipelineError: terminal.type === 'error' ? String(terminal.error ?? 'error') : null,
          });
          runSignalLoop(loopRoot, { auto: loopAuto });
        } catch {
          /* best effort */
        }
      });
      if (terminal.type === 'error') {
        void runLearningLoop(getRoot()!)
          .then((outcome) => {
            if (outcome.error) {
              process.stderr.write(`sequence: learning loop after ${runId}: ${outcome.error}\n`);
            }
          })
          .catch((e) => {
            process.stderr.write(`sequence: learning loop after ${runId} threw: ${(e as Error).message}\n`);
          });
      }
    };
    try {
      const pipelineResult = await runAskPipeline(
        {
          ...buildAskPipelineInput(ctx, turn),
          callProvider: makeAskCallProvider(ctx, turn, {
            streaming: true,
            onRetries: (retries) => {
              providerRetriesThisTurn = (providerRetriesThisTurn ?? 0) + retries;
            },
          }),
        },
        emit,
      );
      /* THE LESSON, WRITTEN BEFORE THE READER IS RELEASED. Counted off the
         trace this route already keeps, so a chart the pipeline derived counts
         as the turn's visual exactly as it does on /api/ask. */
      finishAskTurn(turn, pipelineResult, askTrace.filter((e) => e.type === 'chart:proposal').length);
      askOut.close();
      res.end();
      const resultEvent = askTrace.find((e) => e.type === 'result') as
        | { type: 'result'; text: string; [k: string]: unknown }
        | undefined;
      if (resultEvent) finalizeTrajectory(resultEvent, pipelineResult);
    } catch (e) {
      if (isRequestAbortedError(e)) {
        // The reader is gone; there is nobody to send an error frame to. The
        // trajectory still records the turn as ABORTED rather than leaving a
        // run with a start and no ending — a cancelled turn is a fact about
        // what happened, not an absence of one.
        const abortedEvent = { type: 'error' as const, error: 'aborted by the client' };
        if (!res.writableEnded) {
          emit(abortedEvent);
          res.end();
        } else {
          askTrace.push(abortedEvent as unknown as Record<string, unknown>);
        }
        finalizeTrajectory(abortedEvent);
        return true;
      }
      if (e instanceof ProviderError) {
        const errorEvent: AskStreamEvent = {
          type: 'error',
          error: e.message,
          ...(e.body !== undefined ? { providerResponse: e.body } : {}),
          httpStatus: e.httpStatus ?? 502,
          /* Carried through UNCHANGED from the throw site, which is the only
             place that knows whether this failure has a route out. Spread
             conditionally so an ordinary outage does not claim a fix it does
             not have. */
          ...(e.fix !== undefined ? { fix: e.fix } : {}),
        };
        emit(errorEvent);
        res.end();
        /* The call that exhausted its retries never returned a count; the
           provider layer pins it on the error instead (see the retry loop
           in `requestModelTextWithUsage`). Summed here so the error
           receipt counts the retries the turn actually spent. */
        const failedRetries = (e as { retries?: unknown }).retries;
        if (typeof failedRetries === 'number') {
          providerRetriesThisTurn = (providerRetriesThisTurn ?? 0) + failedRetries;
        }
        finalizeTrajectory(errorEvent);
        return true;
      }
      /*
       * ANYTHING ELSE ENDS IN AN `error` FRAME, NOT SILENCE (2026-09-22).
       * Live, teach battery r3: "tool:start propose_chart at 410 s, then
       * nothing". This used to `throw e`; the last-resort guard then found
       * the headers sent and ended the socket with no frame, no receipt and
       * no stderr line, so the reader, the trajectory and the engine log all
       * lost the one fact that mattered. The stream has started, so the
       * error goes down it like a provider failure does.
       */
      const message = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').trim().slice(0, 300);
      process.stderr.write(`sequence: ask stream failed: ${message}\n`);
      const failedEvent = { type: 'error' as const, error: message || 'the turn failed' };
      if (!res.writableEnded) {
        emit(failedEvent);
        res.end();
      } else {
        askTrace.push(failedEvent as unknown as Record<string, unknown>);
      }
      finalizeTrajectory(failedEvent);
      return true;
    } finally {
      askAbort.dispose();
    }
    return true;
  }

  return false;
}

