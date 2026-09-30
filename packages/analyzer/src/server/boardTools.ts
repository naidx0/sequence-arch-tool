/**
 * THE BOARD WRITERS — the four marks the agent is allowed to make on the
 * whiteboard, and every reason one of them is refused.
 *
 * `docs/research/code-canvas-program.md` §0 measured the hole this closes: the
 * whiteboard has had a camera, a document, an edit vocabulary and fifty frames
 * of undo since it was written, and `grep` for it across `packages/analyzer/`
 * returned two comment mentions and no code. The read half landed first
 * (`askSurface.ts`, `AskSurfaceBoard`) so the agent can now SEE the board.
 * This is the other half: the agent can now draw on it.
 *
 * ── WHY FOUR WRITERS AND NOT ONE `wb/add` ────────────────────────────────
 *
 * The client's edit vocabulary (`whiteboardEdit`) takes a whole `WbItem`, and
 * handing that to a model would be handing it the document format. It would
 * then be free to emit a `noderef` with an invented `nodeId`, a stroke of two
 * hundred points, or a `kind` this build does not render — and `readWhiteboard`
 * drops unknown kinds silently, so the failure would be an item the model
 * believes it drew and the reader never sees. A closed set of four named
 * writers is the same stance `canvas.write_*` takes to the AI Canvas document
 * and `propose_topology` takes to the graph: the model describes an intent, the
 * server decides whether it is a legal mark.
 *
 * FREEHAND IS NOT ONE OF THEM, deliberately. `WbStroke` is the human's mark.
 * A model emitting a point path draws a pile, and a stroke carries no words, so
 * the read half (`AskSurfaceBoardItem.label` is absent on a stroke) cannot tell
 * the next turn what it drew. A writer whose output the agent cannot read back
 * is a writer that can never be revised.
 *
 * ── THE GROUNDING SPLIT, WHICH IS THE WHOLE DESIGN ───────────────────────
 *
 * `whiteboardModel.ts`'s own header is the law here: the architecture board is
 * DERIVED and the whiteboard is FREE, and mixing the two is indistinguishable
 * after a week. So the board keeps that split INSIDE itself:
 *
 *   - `board.add_note` is a sketch mark. It may say anything. It is the only
 *     writer in this file that needs no grounding, and it says nothing about
 *     the code by construction — it lands as a `WbText`, which has no node id
 *     and no evidence field and can never acquire one.
 *   - `board.add_card` CLAIMS TO BE CODE. It lands as a `WbNodeRef`, the
 *     pointer type the model file cut for exactly this and nothing ever
 *     produced. A `nodeId` the scan does not have is refused WHOLE, and — the
 *     rule that matters most — it is never quietly demoted to a note. A card
 *     that fails its grounding check and becomes a sticky is the CANON
 *     violation the two-surface split exists to prevent, with the model
 *     believing it cited a file and the reader looking at a box that once
 *     claimed to be one.
 *
 * `board.connect` and `board.frame` are structural marks over items that are
 * already there, so their grounding is the board's own id list rather than the
 * graph's.
 *
 * ── REFUSES, NEVER REPAIRS ───────────────────────────────────────────────
 *
 * Every refusal names the rule so the next round can fix it, which is the
 * shape `validateWalk`, `parseTodos` and `executeCanvasWrite` already use. Two
 * places where this file is STRICTER than its neighbours, both on purpose:
 *
 *  - Over-length text is REFUSED, where `teachWalk.text()` and `parseTodos`
 *    silently `.slice()`. A truncated prose step still reads as itself; a
 *    truncated caption on a grounded card reads as a DIFFERENT file
 *    ("packages/analyzer/src/server/askPipe…"), and this is the one surface
 *    where a caption is a claim about real code.
 *  - A duplicate item id is refused rather than treated as a revision. These
 *    four writers only ADD; `wb/move`, `wb/text` and `wb/delete` are not in
 *    this tool set, so accepting a repeat id would produce two items with one
 *    id, and `whiteboardEdit`'s move/text/delete all match by id — every later
 *    edit would hit whichever came first and the other would be unreachable.
 *
 * ── PURE ─────────────────────────────────────────────────────────────────
 *
 * Specs in, validated items out. No fs, no network, no clock, no React, no
 * registration. Ids come from the model and positions come from the caller, so
 * a test can assert an exact document — the same discipline
 * `whiteboardModel.ts` states in its own header, for the same reason.
 */

/* ============================================================ tool names = */

export type BoardToolName = 'board.add_note' | 'board.add_card' | 'board.connect' | 'board.frame';

export const BOARD_TOOL_NAMES: readonly BoardToolName[] = [
  'board.add_note',
  'board.add_card',
  'board.connect',
  'board.frame',
];

export function isBoardToolName(name: string): name is BoardToolName {
  return (BOARD_TOOL_NAMES as readonly string[]).includes(name);
}

/** JSON-schema fragments for native tool lists when the whiteboard is active. */
export const BOARD_TOOL_SCHEMAS: Record<BoardToolName, object> = {
  'board.add_note': {
    type: 'object',
    properties: {
      id: { type: 'string' },
      text: { type: 'string' },
      at: { type: 'object' },
    },
    required: ['id', 'text', 'at'],
    additionalProperties: true,
  },
  'board.add_card': {
    type: 'object',
    properties: {
      id: { type: 'string' },
      nodeId: { type: 'string' },
      label: { type: 'string' },
      at: { type: 'object' },
    },
    required: ['id', 'nodeId', 'label', 'at'],
    additionalProperties: true,
  },
  'board.connect': {
    type: 'object',
    properties: {
      id: { type: 'string' },
      fromId: { type: 'string' },
      toId: { type: 'string' },
      label: { type: 'string' },
      directed: { type: 'boolean' },
    },
    required: ['id', 'fromId', 'toId'],
    additionalProperties: true,
  },
  'board.frame': {
    type: 'object',
    properties: {
      id: { type: 'string' },
      label: { type: 'string' },
      from: { type: 'object' },
      to: { type: 'object' },
    },
    required: ['id', 'label', 'from', 'to'],
    additionalProperties: true,
  },
};

/* ============================================================ item shapes = */

/*
 * RESTATED, NOT IMPORTED, and that is not an oversight.
 *
 * The definitions live in `packages/web2/src/whiteboard/whiteboardModel.ts`,
 * and `@sequence/analyzer` does not depend on `@sequence/web2` — the server
 * does not import the browser bundle, and adding that edge to make four
 * interfaces shareable would put a React package in the dependency graph of the
 * CLI. So they are written out again here, field for field.
 *
 * The cost of a restatement is silent drift, so `board-tools.test.ts` reads the
 * real model file and asserts every field name and every literal below is still
 * declared there. If someone renames `WbNodeRef.nodeId`, that test fails here
 * rather than a card arriving at the client and being dropped by
 * `readWhiteboard`'s unknown-shape filter with nothing in the log.
 */

export interface BoardPoint {
  x: number;
  y: number;
}

/** A `WbText`. Carries no node id and no evidence, and never can. */
export interface BoardTextItem {
  kind: 'text';
  id: string;
  at: BoardPoint;
  text: string;
}

/** A `WbShape`. The frame's rectangle and the connector's arrow are both this. */
export interface BoardShapeItem {
  kind: 'shape';
  id: string;
  shape: 'rect' | 'ellipse' | 'line' | 'arrow';
  from: BoardPoint;
  to: BoardPoint;
}

/** A `WbNodeRef` — a pointer at a real scanned node, which is the only kind of item that claims to be code. */
export interface BoardNodeRefItem {
  kind: 'noderef';
  id: string;
  at: BoardPoint;
  nodeId: string;
  label: string;
}

export type BoardItem = BoardTextItem | BoardShapeItem | BoardNodeRefItem;

/* ================================================== what the caller knows = */

/**
 * One item the board already holds, as the caller can describe it.
 *
 * Structurally a subset of `AskSurfaceBoardItem`, so the wiring can pass the
 * parsed read half straight in. `at` is OPTIONAL because the read half's is:
 * a stroke has points rather than a point, and an item with no position is an
 * item `board.connect` cannot draw an arrow to — refused with that reason
 * rather than anchored at the origin, which would put every such arrow in the
 * top-left corner of a board nobody is looking at.
 */
export interface BoardKnownItem {
  id: string;
  at?: BoardPoint;
}

/**
 * The grounding the caller supplies. Never read from global state — the same
 * rule `validateWalk(raw, drawnPartIds)` follows, and for the same reason: a
 * validator that reaches for the current graph cannot be tested against a
 * repository that is not the one the process happens to have open.
 */
export interface BoardKnown {
  /**
   * Every node id the scan actually produced. EMPTY MEANS UNGROUNDED, not
   * "allow anything" — design mode is handed no graph, and a permissive empty
   * set would make that the one mode where every invented card is accepted.
   */
  nodeIds: readonly string[];
  /**
   * Every item on the board — NOT only the ones rendered into the prompt.
   * `askSurface.ts` caps the prompt at forty items and reports the rest as a
   * count, so a caller that forwards only what it showed the model would let a
   * duplicate id through against any of the items it hid, and would undercount
   * the board for the capacity check below.
   */
  items: readonly BoardKnownItem[];
  /**
   * Items the caller could not enumerate, when it genuinely cannot. Counted
   * against `MAX_BOARD_ITEMS` so the cap stays honest on a board whose read
   * half was truncated; it cannot help the duplicate-id check, which is why
   * passing the full list is better.
   */
  omitted?: number;
}

/* ========================================================== the result = */

export type BoardWriteResult =
  | {
      ok: true;
      /** One or two items, ready for `wb/add`. Never partial: a refusal yields none. */
      items: BoardItem[];
      /** The short line the work row shows. */
      evidence: string;
      /** What goes back to the model, including the id it must use to connect to this later. */
      content: string;
    }
  | {
      ok: false;
      /** The rule that was broken, phrased so the next round can fix it. */
      reason: string;
      /** `refused: <tool> — <reason>`, the prefix the ask loop's ledger already uses. */
      evidence: string;
    };

/* =============================================================== the caps = */

/**
 * How many items the board may hold in total.
 *
 * Not a storage limit — `whiteboardEdit` would happily hold thousands. It is a
 * READABILITY limit and a Fit limit: `whiteboardBounds` takes the min and max
 * over every item, so each extra mark can only ever grow the box the camera has
 * to fit, and past a few hundred the zoom that shows everything shows nothing.
 * The refusal names the count so the model deletes or reframes rather than
 * discovering the ceiling one silent no-op at a time.
 */
export const MAX_BOARD_ITEMS = 300;

/**
 * A note is a sticky, not an essay.
 *
 * `whiteboardModel.ts` estimates a text's width from its character advances and
 * renders it as a single SVG `<text>`, which does not wrap. A four-thousand
 * character note is therefore one line roughly two thousand board units wide,
 * and Fit shrinks every other item on the board to a smear to accommodate it.
 */
export const MAX_NOTE_CHARS = 500;

/**
 * A caption on a card, a frame or a connector.
 *
 * Tighter than a note by an order of magnitude because these are rendered at
 * `--t-11` (see `WB_NODEREF_EM`) and sit ON a shape rather than beside one; and
 * because a card's label is a claim about the node it points at, so it has to
 * stay short enough to be read at a glance against the real symbol name.
 */
export const MAX_LABEL_CHARS = 80;

/** Matches `MAX_TODO_ID_CHARS`: the model's ids are handles, not sentences. */
export const MAX_BOARD_ID_CHARS = 80;

/** A node id is a path the scanner produced. Longer than this is prose, not an id. */
export const MAX_NODE_ID_CHARS = 400;

/**
 * The furthest from the origin a mark may be placed.
 *
 * A coordinate of 1e12 is not a drawing, it is a broken Fit: `whiteboardBounds`
 * returns the box containing everything, so one item out there makes the
 * zoom-to-fit of a normal diagram indistinguishable from a blank board. NaN and
 * Infinity are worse — `Math.min`/`Math.max` propagate NaN and the bounds
 * become NaN, so Fit stops working for every item, including the ones drawn
 * before this call.
 */
export const MAX_BOARD_COORD = 100_000;

/** A frame thinner than this in either direction is a line wearing a label. */
export const MIN_FRAME_SIZE = 8;

/**
 * The suffix on a derived label item's id.
 *
 * `board.frame` and a labelled `board.connect` each produce TWO items, because
 * `WbShape` has no text field — the label has to be its own `WbText`. Its id is
 * derived from the shape's rather than asked for, so the model cannot name it,
 * cannot connect to it, and cannot collide with it; and a reader of the
 * document can tell at a glance which text belongs to which shape. Model-
 * supplied ids ending in this suffix are refused for the same reason.
 */
export const BOARD_LABEL_ID_SUFFIX = ':label';

/* ============================================================== helpers = */

/**
 * Normalise one string the model wrote, or return null when it is not usable.
 *
 * THREE THINGS HAPPEN HERE AND EACH IS A DEFENCE, not a tidy-up:
 *
 * 1. Control and format characters become a SPACE rather than being deleted.
 *    Deleting them would let `fi<U+200B>le.ts` render as `file.ts` while being
 *    a different string — a caption that reads as a file it is not. The bidi
 *    overrides (U+202A–U+202E, U+2066–U+2069) are the sharp case: U+202E makes
 *    a label render right-to-left, so a card whose `nodeId` points at one file
 *    can be made to display the name of another. On the one surface where a
 *    caption is a claim about real code, that is a forgery, not a formatting
 *    quirk.
 * 2. All whitespace collapses to single spaces. SVG `<text>` does not wrap and
 *    `estimatedTextWidth` measures the whole string as one line, so a newline
 *    in a note is invisible to the reader and enormous to Fit.
 * 3. Over-length REFUSES (returns null with `tooLong`) instead of truncating.
 *    See the header: a truncated caption on a grounded card names the wrong
 *    file.
 */
/**
 * The code points that must never survive into an item, by range.
 *
 * Written as a predicate rather than a character class because a regex of
 * escapes is unreadable at exactly the moment a reader needs to check which
 * ranges are covered, and each range here is a different attack or a different
 * rendering bug. Comments name which.
 */
function isControlOrFormat(code: number): boolean {
  return (
    code <= 0x1f || // the C0 controls, NUL included
    (code >= 0x7f && code <= 0x9f) || // DEL and the C1 controls
    (code >= 0x200b && code <= 0x200f) || // zero-width space and the LTR/RTL marks
    code === 0x2028 || // line separator: a newline the collapse below would miss
    code === 0x2029 || // paragraph separator, same
    (code >= 0x202a && code <= 0x202e) || // the bidi embeddings and overrides - the forgery case
    (code >= 0x2060 && code <= 0x2064) || // word joiner and the invisible operators
    (code >= 0x2066 && code <= 0x2069) || // the bidi isolates
    code === 0xfeff // BOM used mid-string as a zero-width no-break space
  );
}

/** Every one of them becomes a SPACE, never nothing. See `readText` for why. */
function stripControlAndFormat(raw: string): string {
  let out = '';
  for (const character of raw) out += isControlOrFormat(character.codePointAt(0) ?? 0) ? ' ' : character;
  return out;
}

interface TextRead {
  value: string;
  /** True when the model sent something, but more of it than the cap allows. */
  tooLong: boolean;
  /** The length that was refused, so the refusal can quote it. */
  length: number;
}

function readText(raw: unknown, max: number): TextRead {
  if (typeof raw !== 'string') return { value: '', tooLong: false, length: 0 };
  const cleaned = stripControlAndFormat(raw).replace(/\s+/gu, ' ').trim();
  return { value: cleaned.length > max ? '' : cleaned, tooLong: cleaned.length > max, length: cleaned.length };
}

/** A point the board can actually draw at, or null. See `MAX_BOARD_COORD`. */
function readPoint(raw: unknown): BoardPoint | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as { x?: unknown; y?: unknown };
  if (typeof o.x !== 'number' || typeof o.y !== 'number') return null;
  if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) return null;
  if (Math.abs(o.x) > MAX_BOARD_COORD || Math.abs(o.y) > MAX_BOARD_COORD) return null;
  return { x: o.x, y: o.y };
}

function refuse(name: BoardToolName | string, reason: string): BoardWriteResult {
  return { ok: false, reason, evidence: `refused: ${name} — ${reason}` };
}

/**
 * The id a generated caption takes, and the one collision the reserved suffix
 * does not already rule out.
 *
 * Model ids ending in `BOARD_LABEL_ID_SUFFIX` are refused, so nothing the model
 * writes can take a caption's id. What CAN is a caption left behind: delete the
 * rectangle of frame "auth" and `auth:label` stays on the board, and a later
 * `board.frame` reusing the id "auth" would then emit a second item with that
 * id. `whiteboardEdit` matches by id on move, text and delete, so one of the
 * two would be permanently unreachable.
 */
function labelIdFor(id: string): string {
  return `${id}${BOARD_LABEL_ID_SUFFIX}`;
}

function checkLabelIdFree(
  name: BoardToolName,
  id: string,
  known: BoardKnown,
): BoardWriteResult | null {
  const labelId = labelIdFor(id);
  if (known.items.some((it) => it.id === labelId)) {
    return refuse(
      name,
      `the caption this call generates would take id "${labelId}", which is already on the board ` +
        '— most likely a caption whose shape was deleted. Choose a different "id"',
    );
  }
  return null;
}

/** The last meaningful segment of a node id — `svc:src/server/askPipeline.ts` → `askpipeline.ts`. */
function idTail(id: string): string {
  const slashed = id.replace(/\\/g, '/');
  const afterColon = slashed.slice(slashed.lastIndexOf(':') + 1);
  return afterColon.slice(afterColon.lastIndexOf('/') + 1).toLowerCase();
}

/**
 * Node ids that look like the one the model asked for.
 *
 * `lessonState.validatePlan` refuses an invented id and stops, and the model's
 * next round is a guess. `validateWalk` can afford to list every legal id
 * because a chart has at most twelve parts; a scanned repository has thousands,
 * and printing them would cost the rest of the turn. So: the near misses only.
 * Matching on the last path segment is what actually recovers the common
 * failure, which is the model writing a bare filename where the graph uses a
 * prefixed path.
 */
function nearestNodeIds(wanted: string, known: readonly string[], limit = 5): string[] {
  const tail = idTail(wanted);
  if (tail === '') return [];
  const hits = known.filter((id) => {
    const k = idTail(id);
    return k !== '' && (k === tail || k.includes(tail) || tail.includes(k));
  });
  return hits.sort((a, b) => a.length - b.length || (a < b ? -1 : 1)).slice(0, limit);
}

/**
 * The checks every writer shares: the payload is an object, the id is usable,
 * the id is free, and the board has room. Returned as a refusal or as the
 * validated id, so no writer can forget one of them.
 */
type IdCheck = { ok: true; id: string } | { ok: false; refusal: BoardWriteResult };

function checkEnvelope(
  name: BoardToolName,
  raw: unknown,
  known: BoardKnown,
  adds: number,
): IdCheck {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, refusal: refuse(name, 'expected an object of arguments') };
  }
  const o = raw as Record<string, unknown>;
  const read = readText(o.id, MAX_BOARD_ID_CHARS);
  if (read.tooLong) {
    return {
      ok: false,
      refusal: refuse(
        name,
        `"id" is ${read.length} characters; at most ${MAX_BOARD_ID_CHARS}. An id is a short handle you will reuse to connect to this item`,
      ),
    };
  }
  if (read.value === '') {
    return {
      ok: false,
      refusal: refuse(
        name,
        'every item needs a short "id" that YOU choose (e.g. "api", "db1"). It is how you refer ' +
          'to this item from board.connect later in the turn, so it cannot be assigned for you',
      ),
    };
  }
  if (read.value.endsWith(BOARD_LABEL_ID_SUFFIX)) {
    return {
      ok: false,
      refusal: refuse(
        name,
        `an id may not end in "${BOARD_LABEL_ID_SUFFIX}" — that suffix is reserved for the label ` +
          'text a frame or a labelled connector generates for itself',
      ),
    };
  }
  if (known.items.some((it) => it.id === read.value)) {
    return {
      ok: false,
      refusal: refuse(
        name,
        `item id "${read.value}" is already on the board. These writers only ADD — they do not ` +
          'revise, move or delete — so pick an unused id',
      ),
    };
  }
  const present = known.items.length + Math.max(0, known.omitted ?? 0);
  if (present + adds > MAX_BOARD_ITEMS) {
    return {
      ok: false,
      refusal: refuse(
        name,
        `the board already holds ${present} items and the limit is ${MAX_BOARD_ITEMS} — a board ` +
          'that large cannot be fit on screen. Say what should be removed rather than adding more',
      ),
    };
  }
  return { ok: true, id: read.value };
}

/* ========================================================= board.add_note = */

/**
 * A free note at a point. The ONLY writer here that needs no grounding.
 *
 * `whiteboardModel.ts`: "a surface where nothing is a measured claim". A note
 * is that surface's native mark — it may say anything, because a `WbText`
 * cannot be mistaken for a finding: it has no node id, it is drawn in the
 * sketch language, and nothing downstream reads it as evidence. That is exactly
 * why `board.add_card` may NOT fall back to it (see below): the two are
 * different KINDS of statement and the reader has to be able to tell which one
 * they are looking at.
 *
 * Args: `{ id, text, at: { x, y } }`.
 */
export function validateAddNote(raw: unknown, known: BoardKnown): BoardWriteResult {
  const env = checkEnvelope('board.add_note', raw, known, 1);
  if (!env.ok) return env.refusal;
  const o = raw as Record<string, unknown>;

  const body = readText(o.text, MAX_NOTE_CHARS);
  if (body.tooLong) {
    return refuse(
      'board.add_note',
      `"text" is ${body.length} characters; at most ${MAX_NOTE_CHARS}. A note is a sticky, not a ` +
        'paragraph — it is drawn as one unwrapped line and a long one makes the board unfittable',
    );
  }
  if (body.value === '') {
    return refuse('board.add_note', 'a note needs non-empty "text" — an empty note is an invisible item that still answers hit tests');
  }

  const at = readPoint(o.at);
  if (at === null) {
    return refuse(
      'board.add_note',
      `"at" must be {"x":number,"y":number} with finite values within ±${MAX_BOARD_COORD}. Place ` +
        'it near what it is about — the board is spatial and an unplaced note is a pile',
    );
  }

  /*
   * BUILT FIELD BY FIELD, never spread from `o`. If this were `{...o, kind:'text'}`
   * a model could send `kind`, `nodeId`, or `points` and smuggle an item shape
   * past the writer it called — a "note" that arrives as a noderef claiming a
   * file, or as a stroke `readWhiteboard` keeps and nothing renders.
   */
  const item: BoardTextItem = { kind: 'text', id: env.id, at, text: body.value };
  return {
    ok: true,
    items: [item],
    evidence: `note "${body.value.slice(0, 40)}"`,
    content:
      `Added note "${env.id}" at (${at.x}, ${at.y}). It is a sketch mark and claims nothing ` +
      `about the code. Use id "${env.id}" to connect to it.`,
  };
}

/* ========================================================= board.add_card = */

/**
 * A card standing for REAL CODE. The thing `WbNodeRef` was cut for and nothing
 * has ever produced.
 *
 * TWO REFUSALS HERE CARRY THE WHOLE PRODUCT LAW, and neither may be softened:
 *
 *  1. A `nodeId` the scan does not have voids the call. Not the card — the
 *     CALL. This is `propose_topology` refusing an invented node id and
 *     `validateWalk` refusing an unknown partId, one surface further out, and
 *     the argument is the one `code-canvas-program.md` §3 states: a
 *     half-applied board edit is a board the reader cannot trust, because
 *     nothing on it marks which half arrived.
 *
 *  2. A missing `nodeId` is refused and the model is told to call
 *     `board.add_note` instead — it is NEVER quietly written as a note. A
 *     silent demotion would be the worst outcome available: the model reports
 *     that it put the auth service on the board, the reader sees a box in the
 *     sketch language, and neither of them can tell that the item claiming to
 *     be code and the item claiming nothing look the same. That is precisely
 *     the confusion two separate surfaces exist to prevent.
 *
 * An EMPTY `known.nodeIds` refuses everything, which is the correct behaviour
 * in design mode: a turn with no repository attached has no grounding to offer,
 * so every card in it would be invented. The refusal says so rather than
 * blaming the id, the way `validateWalk` blames the missing picture rather than
 * the step.
 *
 * Args: `{ id, nodeId, label, at: { x, y } }`.
 */
export function validateAddCard(raw: unknown, known: BoardKnown): BoardWriteResult {
  const env = checkEnvelope('board.add_card', raw, known, 1);
  if (!env.ok) return env.refusal;
  const o = raw as Record<string, unknown>;

  /* Node ids are paths, and the longest real one this repo produces is far under
     this. A longer string is not a node id that got clipped, it is prose. */
  const wanted = readText(o.nodeId, MAX_NODE_ID_CHARS);
  if (wanted.tooLong) {
    return refuse(
      'board.add_card',
      `"nodeId" is ${wanted.length} characters; a node id is a path from the scan, at most ${MAX_NODE_ID_CHARS}`,
    );
  }
  if (wanted.value === '') {
    return refuse(
      'board.add_card',
      'a card stands for a real node of the scanned repository, so it needs a "nodeId" from the ' +
        'scan. With nothing to point at it is a sketch — call board.add_note instead. A card is ' +
        'never silently turned into a note',
    );
  }
  if (known.nodeIds.length === 0) {
    return refuse(
      'board.add_card',
      'no scanned graph is attached to this turn, so no card can be grounded. Sketch it with ' +
        'board.add_note, which claims nothing about the code',
    );
  }
  if (!known.nodeIds.includes(wanted.value)) {
    const near = nearestNodeIds(wanted.value, known.nodeIds);
    return refuse(
      'board.add_card',
      `"${wanted.value}" is not a node in this repository — a card may not invent code. ` +
        (near.length > 0
          ? `Did you mean: ${near.join(', ')}?`
          : 'Use an id the scan gave you, or draw it with board.add_note if it is only an idea.'),
    );
  }

  const label = readText(o.label, MAX_LABEL_CHARS);
  if (label.tooLong) {
    return refuse(
      'board.add_card',
      `"label" is ${label.length} characters; at most ${MAX_LABEL_CHARS}. It is not truncated for ` +
        'you: a cut caption on a card that claims to be code names a different file',
    );
  }
  if (label.value === '') {
    return refuse(
      'board.add_card',
      'a card needs a "label" a person can read. Without one the board shows a raw node id, which ' +
        'is a path, not a caption',
    );
  }

  const at = readPoint(o.at);
  if (at === null) {
    return refuse(
      'board.add_card',
      `"at" must be {"x":number,"y":number} with finite values within ±${MAX_BOARD_COORD}. Place ` +
        'the card where it belongs relative to what is already drawn',
    );
  }

  const item: BoardNodeRefItem = {
    kind: 'noderef',
    id: env.id,
    at,
    nodeId: wanted.value,
    label: label.value,
  };
  return {
    ok: true,
    items: [item],
    evidence: `card ${label.value} → ${wanted.value}`,
    content:
      `Added code card "${env.id}" for node ${wanted.value} ("${label.value}") at ` +
      `(${at.x}, ${at.y}). Use id "${env.id}" to connect to it.`,
  };
}

/* ========================================================== board.connect = */

/**
 * A link between two items that are already on the board.
 *
 * IT TAKES ITEM IDS AND RESOLVES THEM TO POINTS, which is why `BoardKnown`
 * carries positions and not just ids. `WbShape.from`/`to` are coordinates, so
 * a pure module has no way to know where item "api" sits unless the caller
 * says — and the caller does know, because the read half already carries `at`
 * for exactly this reason ("an agent that places every new item at the origin
 * draws a pile rather than a diagram").
 *
 * An unknown endpoint refuses the WHOLE call. Drawing the half of the arrow
 * that resolved would leave a line pointing into empty space, which reads as a
 * relationship to something the reader cannot see.
 *
 * Directed by default: `WbShape`'s own comment records why `arrow` exists at
 * all — "a sketching surface that could only draw undirected lines could not
 * express 'A calls B', which is most of what anyone draws on one."
 *
 * Args: `{ id, fromId, toId, label?, directed? }`. `fromId`/`toId` rather than
 * `from`/`to` on purpose: the underlying shape's `from`/`to` are POINTS, and
 * one name meaning a coordinate in the document and an id in the tool call is
 * how a wiring bug gets written twice.
 */
export function validateConnect(raw: unknown, known: BoardKnown): BoardWriteResult {
  /* Provisionally one item; re-checked below once we know whether a label was asked for. */
  const env = checkEnvelope('board.connect', raw, known, 1);
  if (!env.ok) return env.refusal;
  const o = raw as Record<string, unknown>;

  const fromId = readText(o.fromId, MAX_BOARD_ID_CHARS);
  const toId = readText(o.toId, MAX_BOARD_ID_CHARS);
  if (fromId.value === '' || toId.value === '') {
    return refuse(
      'board.connect',
      'a connection needs "fromId" and "toId" — the ids of two items already on the board',
    );
  }
  if (fromId.value === toId.value) {
    return refuse(
      'board.connect',
      `"fromId" and "toId" are both "${fromId.value}". An arrow from an item to itself has zero ` +
        'length, so it is invisible and still answers hit tests',
    );
  }

  /*
   * The known ids ARE listed in the refusal, where `board.add_card` refuses to
   * list node ids. The difference is scale and it is the whole reason: a
   * repository has thousands of nodes, a board has tens, so here the complete
   * answer fits and a model that misremembered an id can fix it this round.
   */
  const label = readText(o.label, MAX_LABEL_CHARS);
  if (label.tooLong) {
    return refuse(
      'board.connect',
      `"label" is ${label.length} characters; at most ${MAX_LABEL_CHARS}. A connector label is a ` +
        'verb or two ("writes to", "on failure"), not a sentence',
    );
  }

  const endpoints: BoardPoint[] = [];
  for (const [field, wanted] of [
    ['fromId', fromId.value],
    ['toId', toId.value],
  ] as const) {
    const hit = known.items.find((it) => it.id === wanted);
    if (hit === undefined) {
      const ids = known.items.map((it) => it.id);
      return refuse(
        'board.connect',
        `${field} "${wanted}" is not an item on the board. ` +
          (ids.length === 0
            ? 'Nothing is drawn yet — add the items first, then connect them.'
            : ids.length <= 20
              ? `The items are: ${ids.join(', ')}.`
              : `There are ${ids.length} items; use an id from the board as it was shown to you.`),
      );
    }
    if (hit.at === undefined) {
      return refuse(
        'board.connect',
        `item "${wanted}" has no position on the board, so an arrow to it has nowhere to land. ` +
          'Freehand strokes are like this; connect the note or card it belongs to instead',
      );
    }
    endpoints.push(hit.at);
  }

  const from = endpoints[0] as BoardPoint;
  const to = endpoints[1] as BoardPoint;
  if (from.x === to.x && from.y === to.y) {
    return refuse(
      'board.connect',
      `"${fromId.value}" and "${toId.value}" sit at the same point, so the connector would have ` +
        'zero length and be invisible. Move one of them first',
    );
  }

  if (o.directed !== undefined && typeof o.directed !== 'boolean') {
    return refuse('board.connect', '"directed" must be true or false when present');
  }
  const directed = o.directed !== false;

  /* Re-run the capacity check with the real item count: a labelled connector is two items. */
  if (label.value !== '') {
    const recheck = checkEnvelope('board.connect', raw, known, 2);
    if (!recheck.ok) return recheck.refusal;
    const taken = checkLabelIdFree('board.connect', env.id, known);
    if (taken !== null) return taken;
  }

  const shape: BoardShapeItem = {
    kind: 'shape',
    id: env.id,
    shape: directed ? 'arrow' : 'line',
    from,
    to,
  };
  const items: BoardItem[] = [shape];
  if (label.value !== '') {
    /*
     * The caption goes at the MIDPOINT, which is the only position that is
     * correct for every angle: anchoring it to either end makes a long arrow's
     * label read as belonging to the item it is sitting on.
     */
    items.push({
      kind: 'text',
      id: labelIdFor(env.id),
      at: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
      text: label.value,
    });
  }

  const arrowWord = directed ? '→' : '—';
  return {
    ok: true,
    items,
    evidence: `${fromId.value} ${arrowWord} ${toId.value}${label.value ? ` (${label.value})` : ''}`,
    content:
      `Connected "${fromId.value}" ${arrowWord} "${toId.value}" as item "${env.id}"` +
      (label.value ? ` labelled "${label.value}"` : '') +
      '. A connector on the whiteboard is a sketch: it is not a scanned edge and nothing verifies it.',
  };
}

/* ============================================================ board.frame = */

/**
 * A labelled rectangle grouping a region of the board.
 *
 * TWO ITEMS, because `WbShape` has no text field — the rectangle and its
 * caption are separate items in the document, and the caption's id is derived
 * (`BOARD_LABEL_ID_SUFFIX`) so the model can neither name it nor collide with
 * it.
 *
 * THE LABEL SITS ABOVE THE TOP EDGE, not inside. A frame exists to group items
 * that are already drawn, so a caption placed inside it lands on top of the
 * very things it is grouping — and `WbText.at` is an SVG baseline, so "inside"
 * would have to guess a descent as well.
 *
 * A frame with no area is refused rather than nudged to a minimum: a zero-
 * height rectangle is a line, and `strokeFrom` already establishes the house
 * rule that a mark too small to see is not a mark, because storing it produces
 * invisible items that still answer hit tests.
 *
 * Args: `{ id, label, from: { x, y }, to: { x, y } }`.
 */
export function validateFrame(raw: unknown, known: BoardKnown): BoardWriteResult {
  const env = checkEnvelope('board.frame', raw, known, 2);
  if (!env.ok) return env.refusal;
  const taken = checkLabelIdFree('board.frame', env.id, known);
  if (taken !== null) return taken;
  const o = raw as Record<string, unknown>;

  const label = readText(o.label, MAX_LABEL_CHARS);
  if (label.tooLong) {
    return refuse(
      'board.frame',
      `"label" is ${label.length} characters; at most ${MAX_LABEL_CHARS}. A frame's caption names ` +
        'the group in a few words',
    );
  }
  if (label.value === '') {
    return refuse(
      'board.frame',
      'a frame needs a "label" — an unlabelled rectangle around some items says that they belong ' +
        'together without saying why, which the reader cannot use',
    );
  }

  const from = readPoint(o.from);
  const to = readPoint(o.to);
  if (from === null || to === null) {
    return refuse(
      'board.frame',
      `"from" and "to" must each be {"x":number,"y":number} with finite values within ` +
        `±${MAX_BOARD_COORD} — the two opposite corners of the region you are grouping`,
    );
  }
  const width = Math.abs(to.x - from.x);
  const height = Math.abs(to.y - from.y);
  if (width < MIN_FRAME_SIZE || height < MIN_FRAME_SIZE) {
    return refuse(
      'board.frame',
      `that frame is ${Math.round(width)}×${Math.round(height)} board units and the minimum is ` +
        `${MIN_FRAME_SIZE}×${MIN_FRAME_SIZE}. A frame with no area is a line, and it would still ` +
        'answer hit tests while being invisible',
    );
  }

  const left = Math.min(from.x, to.x);
  const top = Math.min(from.y, to.y);
  const rect: BoardShapeItem = { kind: 'shape', id: env.id, shape: 'rect', from, to };
  const caption: BoardTextItem = {
    kind: 'text',
    id: labelIdFor(env.id),
    /* Baseline four units above the top edge: clear of the frame's contents, attached to its corner. */
    at: { x: left + 4, y: top - 4 },
    text: label.value,
  };
  return {
    ok: true,
    items: [rect, caption],
    evidence: `frame "${label.value}" ${Math.round(width)}×${Math.round(height)}`,
    content:
      `Framed a ${Math.round(width)}×${Math.round(height)} region as "${env.id}" labelled ` +
      `"${label.value}". Use id "${env.id}" to connect to the frame itself.`,
  };
}

/* ============================================================ the dispatch = */

/**
 * Run one board writer by name.
 *
 * One entry point so the wiring has one thing to call and one result shape to
 * translate, and so an unknown name refuses in the same voice as a broken rule
 * rather than throwing into the ask loop.
 */
export function executeBoardTool(
  name: string,
  raw: unknown,
  known: BoardKnown,
): BoardWriteResult {
  switch (name) {
    case 'board.add_note':
      return validateAddNote(raw, known);
    case 'board.add_card':
      return validateAddCard(raw, known);
    case 'board.connect':
      return validateConnect(raw, known);
    case 'board.frame':
      return validateFrame(raw, known);
    default:
      return refuse(name, `not a board writer. The board writers are: ${BOARD_TOOL_NAMES.join(', ')}`);
  }
}

/**
 * THE BELT HINT — what the model is told the board is, and how to draw on it.
 *
 * Lives here rather than in `askTools.ts` because the rules it states are this
 * module's rules: if a refusal changes, the sentence describing it is one file
 * away rather than three. `renderChartToolHintSection` sets that precedent.
 *
 * IT LEADS WITH THE ID RULE because that is the one a model gets wrong first
 * and the one that costs a whole round: ids are SUPPLIED, not returned, and
 * nothing can be connected to until it has been given a name.
 */
export function renderBoardToolHintSection(): string {
  return [
    '--- THE WHITEBOARD (a spatial canvas you can draw on) ---',
    'A freeform board the person can also draw on by hand. Use it to lay out how something is ' +
      'shaped — boxes in space, joined up — when a chart would be too rigid.',
    '```sequence-tool',
    '{"id":"b1","name":"board.add_card","args":{"id":"c1","nodeId":"<real node id>",' +
      '"label":"API","at":{"x":0,"y":0}}}',
    '```',
    'YOU CHOOSE EACH ITEM\'S `id`, and you need it to connect anything later — nothing hands one ' +
      'back to you. Draw the parts first, then join them in the same turn.',
    '  `board.add_card`  {id, nodeId, label, at} — a card standing for REAL scanned code. The ' +
      'nodeId must be one the scan produced; an invented one voids the whole call.',
    '  `board.add_note`  {id, text, at} — free text. A sketch may say anything, so this is the ' +
      'one writer that needs no grounding. Use it when you do NOT have a real node.',
    '  `board.connect`   {id, fromId, toId, label?, directed?} — joins two items already on the ' +
      'board, by their ids.',
    '  `board.frame`     {id, label, from, to} — a labelled rectangle grouping a region.',
    'Positions are board units and the listing above tells you where everything already sits. ' +
      'Place new items in free space NEAR what they relate to: everything at one point is a pile, ' +
      'not a diagram. A card is a CLAIM about this repository and a note is not — never reach for ' +
      'a card because you want the nicer shape.',
  ].join('\n');
}
