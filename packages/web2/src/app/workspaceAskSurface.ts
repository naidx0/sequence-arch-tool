import type { AskSurfaceContext } from '@sequence/api-types';

import { boardItemsForAsk, inkPhrase } from '../whiteboard/whiteboardAsk';
import type { WhiteboardDoc } from '../whiteboard/whiteboardModel';

/**
 * Map the P2.5 workspace chrome (+ overlays) to the ask wire surface.
 *
 * Chat-alone with no overlay sends nothing — deictic "this" is not a board
 * question. Architecture / Whiteboard name the board. Activity and Settings
 * overlays win when open (owner bug: "this workflow" answered against the
 * repo because Agents/Activity was never on the wire).
 *
 * Wire id for Whiteboard stays `task-board` (server copy already says
 * Whiteboard). Activity uses wire id `agents` (server copy: Agents surface).
 *
 * Files is the IDE panel and its wire id is `editor` — see `askSurfaceFromWorkspace`.
 */
export type WorkspaceSurfaceId = 'chat' | 'files' | 'architecture' | 'whiteboard' | 'ai-canvas';

export type ChromeOverlayKind = 'activity' | 'settings' | 'review' | 'help' | string;

export function askSurfaceFromWorkspace(
  surface: WorkspaceSurfaceId,
): AskSurfaceContext | null {
  if (surface === 'chat') return null;
  if (surface === 'architecture') {
    return { id: 'architecture', title: 'Architecture' };
  }
  if (surface === 'ai-canvas') {
    return { id: 'ai-canvas', title: 'AI Canvas' };
  }
  /*
   * FILES → THE EXISTING `editor` WIRE ID, NOT A NEW ONE.
   *
   * `AskSurfaceId` in `@sequence/api-types` already carries `editor`, and the
   * analyzer's `SURFACE_NAMES` spells it "a file editor tab" — which is what
   * the IDE files panel is. Reusing it keeps this a client-side mapping;
   * minting a `files` id would be a change to `ASK_SURFACE_IDS`, its copy
   * table and `OWN_SURFACES` in `packages/analyzer`, i.e. a server contract
   * change. The TITLE is what the reader sees, so it says Files: the wire id
   * is stable vocabulary, the title is the app's own word for the surface —
   * exactly the split Whiteboard already lives with (`task-board`).
   *
   * Until this arm existed, a question asked over an open files panel was
   * answered against Architecture, because Files was an overlay the wire knew
   * nothing about.
   */
  if (surface === 'files') {
    return { id: 'editor', title: 'Files' };
  }
  return { id: 'task-board', title: 'Whiteboard' };
}

export function askSurfaceFromChrome(args: {
  workspace: WorkspaceSurfaceId;
  overlayKind: ChromeOverlayKind | null | undefined;
}): AskSurfaceContext | null {
  if (args.overlayKind === 'activity') {
    return { id: 'agents', title: 'Activity' };
  }
  if (args.overlayKind === 'settings') {
    return { id: 'settings', title: 'Settings' };
  }
  return askSurfaceFromWorkspace(args.workspace);
}
/* ══════════════════════════════════════════════════════════════════════════
   AND WHAT IS DRAWN ON IT

   `askSurfaceFromWorkspace` names the tab. It has never said what is ON the
   tab, and for the AI Canvas that is the whole question the owner asked:
   "see how the freeform works, how the agent can understand the drawing".

   The wire already has the field — `AskSurfaceContext.board`, carrying ids,
   labels and positions, which `analyzer/src/explain/askSurface.ts` renders as
   "--- ALREADY ON THE WHITEBOARD ---" for ANY surface that sends it. What it
   has never had is a filler that includes the READER's own marks: `store.ts`'s
   `withBoardState` is fed `session.boardAgentItems`, so the only drawing the
   model has ever been shown is its own.

   THE AI CANVAS IS A WHITEBOARD, which is why this reuses the whiteboard's own
   description (`whiteboardAsk.boardItemsForAsk`) instead of minting a second
   one. `app/AiCanvas.tsx` mounts the same `Whiteboard` component over
   `seqDrawKey(sessionId)`; a separate serialiser for the same document would
   be two answers to "what is on this plane", and the two would drift.
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Attach the reader's own drawing to the surface they are asking from.
 *
 * Returns the surface UNCHANGED when there is no surface, or when the document
 * holds nothing describable — so an ordinary turn's request body stays
 * byte-identical to the one it sent before this existed. That is the same
 * stance `withCanvasState` takes, for the same reason.
 *
 * The `focus` is left alone. A drawing has no "open file", and manufacturing
 * one from the first note would put a noun on screen that is not there.
 */
export function withDrawingState(
  surface: AskSurfaceContext | null,
  doc: WhiteboardDoc | null | undefined,
): AskSurfaceContext | null {
  if (!surface || !doc) return surface;
  const board = boardItemsForAsk(doc);
  if (board.items.length === 0) return surface;
  /*
   * MERGED, NOT REPLACED. The agent's own items may already be on this field
   * (`withBoardState`), and dropping them to make room for the human's would
   * cost the model the ids it needs to revise its own marks. Human items win a
   * collision because this reads the live document, which is where an agent
   * item ends up once it has landed.
   */
  const existing = surface.board?.items ?? [];
  const mine = new Set(board.items.map((i) => i.id));
  const merged = [...board.items, ...existing.filter((i) => !mine.has(i.id))];
  const omitted = (surface.board?.omitted ?? 0) + (board.omitted ?? 0);
  return {
    ...surface,
    board: { items: merged, ...(omitted > 0 ? { omitted } : {}) },
  };
}

/**
 * One line naming what the freehand adds up to — "3 rectangles and 2 lines".
 *
 * Exported beside {@link withDrawingState} rather than folded into it, because
 * the two travel on different channels: the items go in the structured
 * `surface.board` field the server renders itself, and this is a sentence for a
 * caller that wants to put the shape of the drawing in front of a person (a
 * composer draft, a tooltip, a work row). `''` when there are no strokes, so a
 * caller says nothing rather than saying "0 marks".
 */
export function drawingSummaryLine(doc: WhiteboardDoc | null | undefined): string {
  if (!doc) return '';
  const phrase = inkPhrase(doc);
  return phrase === '' ? '' : `Freehand on this surface: ${phrase}.`;
}
