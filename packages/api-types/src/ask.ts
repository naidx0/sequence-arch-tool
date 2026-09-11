/**
 * Ask — the assistant contract. `POST /api/ask` (JSON) and `POST /api/ask/stream`
 * (SSE), both in `server/repoServer.ts`.
 *
 * Both routes take the SAME body. The client sends its three things separately —
 * the user's typed words, which capabilities were invoked, and the compiled
 * grounded scope — and the SERVER composes the prompt. Nothing is concatenated
 * onto the front of the question.
 *
 * DESIGN MODE: with no repo attached, a `design` payload carrying a non-empty
 * `outline` becomes the grounding context instead of a scan digest. No repo AND no
 * usable design ⇒ an honest 409.
 *
 * AUTH ASYMMETRY, verified against `SENSITIVE_EXACT` in `server/repoServer.ts`:
 * `/api/ask` is in the sensitive set and 401s without a session when auth is on;
 * **`/api/ask/stream` is not.** Both fall back to `requireOwner()`, which returns
 * false when no owner is recorded — so on a loopback+auth server started with
 * `--repo`, the streaming twin answers anonymously while the JSON one refuses.
 * Same class as gap G15; a client must not assume the two routes are gated alike.
 */

import type { SeqChart } from '@sequence/schema';

/* ------------------------------- the request ------------------------------ */

/** One invoked capability. `subjectNodeId` (a real graph node id) beats `subject`. */
export interface AskIntentInvocation {
  id: string;
  /** The label of whatever the user had selected when they attached the chip. */
  subject?: string;
  /** The real graph node id of that selection, when there was one. */
  subjectNodeId?: string;
}

/**
 * The compiled grounded scope. The per-turn TOKEN BUDGET is enforced client-side,
 * which is why this arrives pre-compiled; the server re-bounds it anyway (64 lines,
 * ~2,000 tokens) and leaves a visible "…N more lines omitted" marker rather than
 * silently truncating.
 */
export interface AskContext {
  lines: string[];
}

/** The tab kinds a question can point at (`askSurface.ts:54-66`). */
export type AskSurfaceId =
  | 'architecture'
  | 'agents'
  | 'task-board'
  | 'terminal'
  | 'localhost'
  | 'settings'
  | 'editor'
  | 'design'
  | 'domain'
  | 'scratch'
  /** Typed artifact blocks — markdown, mermaid, HTML, React, SVG (`ai-canvas-tool-contract.md`). */
  | 'ai-canvas';

/** One step of the workflow on screen — the Program's own node, nothing added. */
export interface AskSurfaceStep {
  title: string;
  kind: string;
}

/** The object focused on the active surface, when the surface has one. */
export interface AskSurfaceFocus {
  kind: 'workflow' | 'component' | 'file';
  title: string;
  /** Workflow only. */
  nodeCount?: number;
  /** Workflow only. */
  edgeCount?: number;
  /** Workflow only: the steps themselves, in the Program's own order. */
  steps?: AskSurfaceStep[];
}

/**
 * What the user is looking at. ABSENT ⇒ nothing is added to the prompt.
 * PRESENT BUT MALFORMED ⇒ a 400, deliberately: silently dropping it is the bug
 * this field exists to fix.
 */
export interface AskSurfaceContext {
  id: AskSurfaceId;
  /** The tab's own title, when it differs from the surface's generic name. */
  title?: string;
  focus?: AskSurfaceFocus;
}

/**
 * Prior-turn evidence carried beside prose (assistant turns only).
 *
 * B3.1 — chat memory already persisted work/evidence on disk; without this
 * field the next ask only saw role+text and lost grounded prior tool work.
 */
export interface AskHistoryEvidence {
  filesRead?: string[];
  tools?: string[];
  proposals?: string[];
}

/** Prior turns replayed into the prompt. Any other `role` is dropped server-side. */
export interface AskHistoryTurn {
  role: 'user' | 'assistant';
  text: string;
  /** Compact prior work verbs (assistant only). */
  work?: string[];
  /** Compact prior evidence (assistant only). */
  evidence?: AskHistoryEvidence;
}

/** Design-mode grounding. Honoured only when `outline` is a non-empty string. */
export interface AskDesignContext {
  title?: string;
  outline: string;
  proposeArchitecture?: boolean;
}

/**
 * `question` may be the empty string ONLY when at least one intent came with it
 * (a chip-only send is a complete request). Every other field is optional, and a
 * body carrying only `{ question }` produces a byte-identical prompt to the
 * pre-intent shape.
 */
export interface PostAskRequest {
  question: string;
  /**
   * The conversation this ask belongs to — the one the CLIENT is displaying.
   *
   * A teach turn's lesson is filed under it. It used to be absent from this type
   * and from every request web2 sent, so the server fell back to the session
   * index's `activeId`: a guess about which conversation the person meant. When
   * that guess was wrong the lesson was written to a DIFFERENT session from the
   * chat, and the conversation on screen ended with no lesson — hence no concept,
   * no chart, and no check-in.
   *
   * The client knows which conversation it is showing. It says so.
   */
  threadId?: string;
  intents?: AskIntentInvocation[];
  context?: AskContext;
  /** Default `implementation`; anything that is not `'research'` means implementation. */
  mode?: 'implementation' | 'research';
  surface?: AskSurfaceContext;
  history?: AskHistoryTurn[];
  /**
   * How many prior turns the client omitted under {@link AskHistoryTurn} cap
   * (B3.2). Rendered into the PRIOR CHAT header so the model — and the seat
   * note — know memory was trimmed, not silently forgotten.
   */
  historyDropped?: number;
  /**
   * How many tool rounds this question may use.
   *
   * Absent means the server's default. CLAMPED server-side to a ceiling —
   * every round is a metered provider call, so this raises a limit and never
   * removes one, and a client cannot spend without bound by sending a large
   * number.
   */
  /**
   * Attachments this turn refers to, by id.
   *
   * IDS, NOT CONTENT. The text is already stored under `.sequence/attachments`
   * and re-sending it would push the same log through the request body once
   * per follow-up. An id that no longer resolves is skipped, not refused: a
   * sweep can remove one the client still shows, and losing the question
   * because a piece of evidence aged out would be the worse failure.
   */
  attachmentIds?: string[];
  maxRounds?: number;
  /**
   * What the user said the agent may do, from the control under the composer.
   *
   * `plan` narrows tools; `propose` stages edits; `autoEdit` writes without
   * Accept; `full` also allows `run_command` under permission rules.
   */
  permission?: 'plan' | 'propose' | 'autoEdit' | 'full';
  /** Work planning does not advertise the coding shell tool. */
  jobMode?: 'work' | 'code';
  /**
   * Teach Mode (docs/teach-mode.md): the turn's deliverable is a verified
   * understanding, not an edit. The pipeline delivers ONE concept, ONE board
   * action, ONE check-in question per turn and then ends — the lesson is a
   * client-driven turn sequence, never a text dump. Absent means off.
   */
  teach?: boolean;
  /**
   * What the learner already knows about this subject — ONE CLICK, never a form.
   *
   * `new` teach it from the ground up · `used-it` they have used it and want the
   * mechanism · `ship-it` they ship this and want only what is specific here.
   *
   * THERE ARE EXACTLY THREE AND THERE IS NO FOURTH. The one somebody will want to
   * add is "not sure, ask me some questions" — and that is the interrogation bug
   * re-entering through the UI. A lesson that opens by quizzing the learner about
   * themselves has taught nothing, which is the same failure as opening by asking
   * which chart kind they want. The union is closed here so a fourth option
   * cannot be added without deleting this comment.
   *
   * IT IS A CLAIM ABOUT THE LEARNER, NOT ABOUT THE REPOSITORY. It licenses
   * skipping an explanation; it never licenses asserting anything as true of the
   * code. The rendered belt says so in the same breath it says the skip.
   *
   * Absent means "not stated", which is not the same as `new` — the belt simply
   * adds no skip.
   */
  teachKnown?: 'new' | 'used-it' | 'ship-it';
  design?: AskDesignContext;
  /**
   * The checkpoint session this turn's agent writes are filed under — the
   * same id `PutFileRequest.sessionId` carries.
   *
   * Under `autoEdit` / `full` the agent writes on its own, and until this
   * field existed those writes reached disk through a path no checkpoint knew
   * about: the Rewind panel promised a restore point before a turn edits
   * files and could not restore one. With it, the server takes a checkpoint
   * BEFORE the turn's first write and baselines every file it touches. An id
   * that fails the server's session-id contract is ignored, never a refusal —
   * the question still gets answered.
   */
  sessionId?: string;
  /**
   * THE ACCEPTANCE GATE FOR A WRITE TURN. When the turn writes at least one
   * file, the server runs `cmd` at the repo root after the last write and
   * reports the outcome as `verify` on the result (and in the answer's
   * closing sentence). A `skip` declines the gate ON THE RECORD — `reason` is
   * required, and a skip without one is a 400, not a silent no-gate. Absent
   * means no gate. A failing gate never reverts the edit; the checkpoint under
   * `sessionId` is the rollback point.
   *
   * Declared here AND in the analyzer's `verifyGate.ts` (`AskDoneWhen`) —
   * change both identically.
   */
  doneWhen?: AskDoneWhen;
}

/** See {@link PostAskRequest.doneWhen}. Mirrors the analyzer's `AskDoneWhen`. */
export type AskDoneWhen =
  | { kind: 'command'; cmd: string }
  | { kind: 'skip'; reason: string };

/**
 * One done-when run, as the turn reports it. Only `status: 'passed'` is a pass:
 * a refusal is `failed` WITH `refuseReason` set, a skip carries the caller's
 * reason. Mirrors the analyzer's `AskVerifyResult` in `verifyGate.ts`.
 */
export interface AskVerifyResult {
  status: 'passed' | 'failed' | 'skipped';
  /** Human-readable reason for `skipped`, `failed` or a refusal. */
  reason?: string;
  /** The command that ran (or was refused). Absent for `skip`. */
  cmd?: string;
  /** Exit code when the command ran; `null` when it never started. */
  exitCode?: number | null;
  /** Captured stdout+stderr (head+tail capped) when the command ran. */
  output?: string;
  /** Set when the gate refused to start the command — never a pass. */
  refuseReason?: string;
}

/** `/api/ask/stream` takes the identical body. */
export type PostAskStreamRequest = PostAskRequest;

/* ------------------------------ the response ------------------------------ */

/**
 * WHAT THE ANSWER DID NOT READ.
 *
 * CANON calls this "the single strongest thing we have and nothing else on the
 * list is close": Codex and Claude Code structurally cannot report what they did
 * not look at, because neither holds a complete model of the repository to
 * subtract a read-set from.
 *
 * It lives here, in the shared contract, because it was drifting. The server
 * already computed it and already put it on the `result` event — `askPipeline.ts`
 * says "a streaming client is told the same" — while the shape itself was
 * declared only inside `analyzer/src/explain/explain.ts`. So the field was on
 * the wire and absent from the type every client reads, which is the exact
 * category `packages/api-types` exists to end.
 */
export interface AskCoverage {
  /** Edges that actually reached the model, in the digest as rendered. */
  edgesSeen: number;
  /** Edges in the whole scanned graph. The cap cannot shrink this number. */
  edgesTotal: number;
  /**
   * Top-level components (a monorepo's packages; a polyrepo's services) with at
   * least one edge in what the model saw, by their real `path`, `/`-separated.
   */
  packagesSeen: string[];
  /**
   * Components that HAVE edges in the graph and contributed none to this ask —
   * the cut, named. Empty is a real and common answer: for a whole-system ask
   * ranked selection reaches every package and the loss shows up as depth rather
   * than absence. A SCOPED ask is where it bites.
   */
  packagesMissed: string[];
}

export interface AskUsage {
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
}

/**
 * What filled the last ask's prompt window (B3.4).
 *
 * Sections use `approxTokens` (chars/4) unless noted — same honesty as
 * `tokenBudget.ts`. `totalMeasured` is the provider's input count when present.
 */
export interface AskContextSection {
  id: 'grounding' | 'instructions' | 'tools' | 'other';
  label: string;
  tokens: number;
  /** True when counted via approxTokens, not a provider tokenizer. */
  estimated: boolean;
}

export interface AskContextBreakdown {
  sections: AskContextSection[];
  /** Sum of section tokens (approx). */
  totalApprox: number;
  /** Provider-reported input tokens for the turn, when metered. */
  totalMeasured?: number;
}

/** Heuristic ask intent — teach / draw / explore / edit / chat (B1.1). */
export type AskClassifiedIntent = 'teach' | 'draw' | 'explore' | 'edit' | 'chat';

/** Per-turn harness metrics — rounds, stop reason, token totals when metered. */
export interface AskMetrics {
  wallMs?: number;
  rounds: number;
  stopReason: 'complete' | 'ceiling' | 'no-progress' | 'breaker';
  designMode: boolean;
  /** Heuristic intent bucket for this question (B1.1). */
  intent?: AskClassifiedIntent;
  inputTokens?: number;
  outputTokens?: number;
  /** Per callProvider invocation — diagnoses slow provider vs tool-loop churn. */
  providerCallMs?: number[];
}

export interface AskDiagram {
  type: 'flow' | 'sequence';
  scopeNodeIds: string[];
}

export type AdvisorSeverity = 'aside' | 'concern' | 'blocker';

/** `note` is capped at 280 chars server-side. */
export interface AdvisorNote {
  severity: AdvisorSeverity;
  note: string;
}

/**
 * The JSON answer. Every optional field is OMITTED rather than nulled — the route
 * builds the payload key by key (the `POST /api/ask` handler in `server/repoServer.ts`).
 *
 * `source: 'surface'` means the text came off the on-screen Program, not a
 * provider: nothing was metered and nothing was generated.
 *
 * Note the asymmetry with the stream: `AskPipelineResult` carries an `advisor`
 * note and the SSE `result` event forwards it, but this JSON route never copies
 * it onto the payload.
 */
export interface PostAskResponse {
  text: string;
  diagram?: AskDiagram;
  unsupportedIntents?: string[];
  usage?: AskUsage;
  source?: 'surface' | 'provider';
}

/* ---------------------------- the SSE event union ------------------------- */

/**
 * `POST /api/ask/stream` is **SSE**, framed as `data: <AskStreamEvent>\n\n`
 * (the `POST /api/ask/stream` handler in `server/repoServer.ts`). Sixteen variants, verbatim from
 * `askPipeline.ts:82-114`.
 *
 * **There is no text-delta variant.** The `result` event carries the entire answer
 * at once, so time-to-first-token equals full generation time. Wave 1 item 1.2
 * adds a `delta` variant; until it lands, a streaming UI has nothing to stream.
 */
/**
 * WHAT THE GRAPH COULD NOT CONFIRM ABOUT THIS ANSWER.
 *
 * The first real answer this product gave said the system used "MySQL
 * databases" when zero files mention MySQL and `db.py` calls
 * `sqlite3.connect`. Nothing checked, because nothing could. A confident false
 * sentence reads exactly like a true one, and a GROUNDED tool that ships one
 * spends the credibility grounding was supposed to earn.
 *
 * Only two categories are checked, because only two are genuine closed worlds:
 * a datastore technology the scan enumerates, and a cited file path the scan
 * holds. Everything else a model writes is prose a scan cannot refute, and
 * flagging it would produce warnings that teach a reader to click past the one
 * that mattered.
 *
 * IT IS A FLAG, NEVER A VERDICT. Nothing is suppressed or rewritten on its
 * say-so — the model may be contrasting, quoting the user, or discussing a
 * migration. Absent when there is nothing to report OR nothing could be
 * checked, and `checked` says which.
 */
export interface AskClaimCheck {
  /** Technologies named in the answer that the scan did not find anywhere. */
  unsupportedTechnologies: {
    term: string;
    /** What the scan DID find, so the correction is in hand. */
    found: string[];
    /** The sentence it appeared in, so a reader can judge intent. */
    quote: string;
  }[];
  /** Cited paths that resolve to no file in the scan. */
  unknownPaths: { path: string; quote: string }[];
  /** Which checks actually ran — an empty finding list from a check that could
   *  not run is not a clean bill of health. */
  checked: { datastores: boolean; files: boolean };
}

export type AskStreamEvent =
  /**
   * ONE CHUNK OF THE ANSWER, AS IT IS GENERATED.
   *
   * The provider layer has always been able to stream — `provider.ts` takes an
   * `onDelta` and reads the SSE body chunk by chunk — and the client reducer has
   * always known how to append one. What was missing was the middle: the ask
   * pipeline's `callProvider` had no parameter to pass a token through, so the
   * whole answer arrived in the `result` frame after the full generation.
   *
   * `text` is a FRAGMENT, not the answer so far. The reducer appends; nothing
   * here restates what it already sent, because a stream that re-sends its own
   * prefix is a stream that renders quadratically.
   */
  | { type: 'delta'; text: string }
  | { type: 'intent:start'; id: string }
  | { type: 'intent:done'; id: string }
  | { type: 'file:read'; path: string }
  | { type: 'file:done'; path: string }
  | { type: 'step:start'; id: string }
  | { type: 'step:done'; id: string }
  | { type: 'tool:start'; id: string; name?: string; evidence?: string }
  | { type: 'tool:done'; id: string; name?: string; evidence?: string }
  | {
      /**
       * ONE TYPED BLOCK LANDED ON AI CANVAS.
       *
       * Emitted when a `canvas.write_*` tool completes — structured data the
       * client paints without scraping prose. `status: 'live'` marks the block
       * still streaming; `'landed'` when the turn settles or a newer block
       * took the highlight.
       */
      type: 'canvas:block';
      id: string;
      blockType: 'markdown' | 'mermaid' | 'html' | 'react' | 'svg';
      title?: string;
      payload: string;
      status: 'live' | 'landed';
    }
  | {
      /**
       * A chart the model asked Sequence to DRAW (propose_chart). The payload is
       * a validated SeqChart spec — data, never render code — so the client owns
       * the pixels and the harness owned the truth check.
       *
       * TYPED, because the sentence above was already the contract. This was
       * `unknown`, and the client could not read a title off it without a cast
       * — which is part of why `SeqChartView` sat with no caller while every
       * spec landed in state unread. The server emits this only after
       * `validateChart` has passed, so the wire genuinely carries a `SeqChart`
       * and saying so costs nothing: `@sequence/schema` is already a dependency
       * of this package.
       */
      type: 'chart:proposal';
      chart: SeqChart;
    }
  | {
      /**
       * ONE STEP OF A LESSON — `docs/teach-mode.md` §3. Emitted only on a teach
       * turn, and only alongside the chart it describes.
       *
       * IT RIDES THE CHART, AND THAT IS THE WHOLE DESIGN. A first attempt took
       * the caption from the answer text and was reverted (604fa893): the
       * harness overwrites `text` with its own apology when a turn ends badly,
       * so a failed lesson captioned the board with harness prose while this
       * type promised "the model's own words". A `SeqChart` cannot be
       * overwritten that way — `title` and `caption` are fields `validateChart`
       * already passed, written about ONE concept, which is exactly what a step
       * is. Same for the lit set: `litNodeIds` are `nodeId`s the chart carried,
       * every one of them checked against the scanned graph before the chart
       * was allowed through. The harness never invents an id here.
       *
       * `flow` and `fit` are in the doc and are NOT here. The ask loop has no
       * tracer, so it cannot build a `FlowPlayback` honestly; and `canvas/fit`
       * needs world-space bounds only the board computes. Declaring fields the
       * server cannot fill is the "field nothing sets" this repo deletes on
       * sight — they go in when something can produce them.
       */
      type: 'teach:step';
      /** The model's own sentence about this concept, from the chart. */
      caption: string;
      /** Grounded node ids the chart cited. Absent when it cited none. */
      litNodeIds?: string[];
    }
  | {
      /**
       * A SYMBOL LOOKUP FOUND WHERE IT IS DECLARED — ids and nothing else.
       *
       * Measured on `teach/symbol-index`: asking where a symbol is declared
       * answered 4 of 4 in the chat rail and THE MAP DID NOT MOVE. The only
       * server-fed way to light the board was `teach:step`, and the teach lane
       * refused to use it for a lookup: that event's caption asserts a lesson,
       * so emitting it here would stamp the turn as a lesson step it is not —
       * the same fault as a verb claiming an outcome the engine never supplied.
       *
       * Hence a separate event carrying no caption, no lesson state and no
       * chart. A lookup has nothing to SAY on the canvas, only somewhere to
       * point, and this event is exactly that much and no more.
       *
       * The ids are graph node ids, resolved from the located files through
       * `resolveGraphTargets` — the same resolver `who_calls` uses, which never
       * invents a node. Absent entirely when a lookup located nothing, so the
       * board is never handed an empty spotlight.
       */
      type: 'lookup:located';
      nodeIds: string[];
    }
  | {
      type: 'canvas:story';
      title: string;
      steps: Array<{ blockId: string; caption: string }>;
    }
  | {
      type: 'edit:proposal';
      title?: string;
      /**
       * WHY this is the right change, in the model's own words.
       *
       * A topology proposal has carried one from the start and the board
       * renders it; a CODE proposal could not, so the most consequential thing
       * this product does arrived as a title and a diff. A title names the
       * change; a rationale is what a reviewer needs in order to disagree.
       */
      rationale?: string;
      files: { path: string; content: string }[];
      /**
       * P3 — true when Auto-edit / Full already wrote these files. The Review
       * pane treats them as landed rather than pending Accept.
       */
      applied?: boolean;
    }
  | {
      /*
       * ── THE AGENT PROPOSES ARCHITECTURE ────────────────────────────────
       *
       * The board's ghost layer — a proposed service drawn dashed, with Accept
       * running back through the same edit funnel a human rename uses and Deny
       * dropping the layer — was complete, rendered and covered by fourteen
       * tests, and NO ANSWER COULD ENTER IT: `canvas/proposal` was dispatched
       * by nothing in the whole client.
       *
       * A STRUCTURED EVENT, NOT A FENCE. The prompt asked the model for a
       * ```seqd block and no code anywhere parsed one. `edit:proposal` above
       * already settled the shape for the code half — a tool call produces a
       * result the server emits as an event — and this is the same shape for
       * the architecture half, for the same reason its own comment gives:
       * a proposal must not be scraped out of the model's prose.
       */
      type: 'topology:proposal';
      title?: string;
      /** WHY this shape, in the model's own words. The board renders it. */
      rationale?: string;
      /** Proposed nodes. NEVER carry `evidenceRef` — see the tool. */
      nodes: { id: string; label: string; kind: string }[];
      edges: { id: string; from: string; to: string; family: string; label?: string }[];
    }
  | {
      type: 'command:log';
      cmd: string;
      exitCode: number | null;
      output: string;
      ok: boolean;
    }
  | { type: 'provider:start' }
  | { type: 'provider:done' }
  | { type: 'advisor'; severity: AdvisorSeverity; note: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number; estimated: boolean }
  | {
      type: 'trajectory:start';
      runId: string;
      /** sha256 (truncated) of the instruction belt: tool/canvas/plan-mode hints. */
      instructionHash: string;
    }
  | {
      type: 'result';
      text: string;
      diagram?: AskDiagram;
      unsupportedIntents?: string[];
      usage?: AskUsage;
      metrics?: AskMetrics;
      /** Named slices of what filled the prompt (B3.4). Absent when unmeasured. */
      contextBreakdown?: AskContextBreakdown;
      source?: 'surface' | 'provider';
      advisor?: AdvisorNote;
      /** What this answer did NOT read. The server has always sent it. */
      coverage?: AskCoverage;
      /** What the graph could not confirm — see {@link AskClaimCheck}. */
      claims?: AskClaimCheck;
      /** The done-when receipt — absent unless a gate ran. See {@link AskVerifyResult}. */
      verify?: AskVerifyResult;
    }
  | {
      type: 'error';
      error: string;
      providerResponse?: string;
      httpStatus?: number;
      /**
       * WHAT WOULD FIX THIS, as a value rather than as prose.
       *
       * Present only when the failure has a route out that a surface can
       * offer. `'provider'` means the turn failed because no usable model is
       * configured, and the fix is the Settings provider pane.
       *
       * It exists because the alternative is a client MATCHING THE SENTENCE to
       * decide whether to show a way out - and a surface that re-derives the
       * server's meaning from its wording breaks the moment the wording
       * improves. The sentence stays the server's; the ROUTE is data.
       *
       * ABSENT IS THE COMMON CASE and must stay that way. An outage, a rate
       * limit and a bad request are not fixed by opening Settings, and
       * offering that route for them sends the reader somewhere useless and
       * teaches them the control is noise.
       */
      fix?: 'provider';
    };

/**
 * The stream's terminal event. `trajectory:start` is always FIRST (the server
 * emits it before the pipeline runs), and exactly one of these ends the run.
 */
export type AskStreamTerminalEvent = Extract<AskStreamEvent, { type: 'result' | 'error' }>;
