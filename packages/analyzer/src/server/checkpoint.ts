/* ══════════════════════════════════════════════════════════════════════════
   THE LESSON CHECKPOINT
   packages/analyzer/src/server/checkpoint.ts

   ── WHAT IT ADDS ─────────────────────────────────────────────────────────

   `lesson.json` and `canvas.json` already persist a lesson and its pictures.
   Neither says WHICH BUILD WROTE THEM, so a chart saved before a scanner fix is
   indistinguishable from one saved after it, and reopening a session serves the
   old picture with no sign that it is old.

   That is not hypothetical: `docs/journeys/teach-mode.md` carries a screen with
   four inbound arrows and no outbound one, correct when it was taught and wrong
   about the repository since — and the page has to say so in prose, because
   nothing in the file could say it.

   A checkpoint is those two files plus three fields: a **schema version**, the
   **build that wrote it**, and the **turn it belongs to**. With them, *stale*
   becomes a property of a saved lesson rather than only of a running process —
   the same move `/api/build` made for the server, one layer down.

   ── THE MIGRATION RULE ───────────────────────────────────────────────────

   On open, when the build differs, every DERIVED thing is re-derived from the
   graph and the stored derivation is discarded. `buildConceptChart` and
   `deriveCheckIn` are already pure functions of the graph, which is what makes
   this possible at all — and it is why the same rule cannot be applied to the
   prose, which is the model's and cannot be recomputed.

   **A stale derivation is never served.** Not shown with a warning, not shown
   greyed: replaced, or refused. A chart that disagrees with the current scan is
   a false claim about the repository, and this product's first law is that a
   claim traces to evidence.

   ── WHAT IS REFUSED ──────────────────────────────────────────────────────

   A checkpoint that cannot be read is refused with the field named, and the
   session is left untouched. Reading a half-parsed lesson as an empty one would
   silently discard a learner's place — the same reasoning as the lock that must
   say "cannot be decided" rather than guess a holder alive.
   ══════════════════════════════════════════════════════════════════════════ */

import type { ArchGraph, SeqChart } from '@sequence/schema';
import { buildConceptChart, deriveCheckIn } from './conceptChart.js';
import type { LessonShape } from './lessonState.js';
import { readLesson, readSessionCanvas, writeLesson } from './sessionsStore.js';

/** Bumped when the on-disk shape changes in a way a reader must know about. */
export const CHECKPOINT_VERSION = 1;

export interface Checkpoint {
  /** 0 means "written before checkpoints existed" — read, never guessed. */
  schemaVersion: number;
  /** The `builtAt` of the build that wrote it, or null when it did not say. */
  writtenBy: string | null;
  /** The turn this checkpoint belongs to. */
  turn: number;
  lesson: LessonShape | undefined;
  charts: readonly SeqChart[];
}

export interface CheckpointRead {
  checkpoint?: Checkpoint;
  /** Present when the checkpoint could not be read; names the field. */
  refused?: string;
}

/**
 * Read the two files as one checkpoint.
 *
 * A missing lesson is not a refusal — a session with no lesson is the ordinary
 * case. A lesson that is present and unreadable IS a refusal, because the
 * difference between "no lesson" and "a lesson I could not parse" is the whole
 * point of the distinction.
 */
export function readCheckpoint(repoRoot: string, id: string): CheckpointRead {
  let lesson: LessonShape | undefined;
  try {
    lesson = readLesson(repoRoot, id);
  } catch (e) {
    return { refused: `lesson.json is unreadable: ${e instanceof Error ? e.message : String(e)}` };
  }
  let canvas;
  try {
    canvas = readSessionCanvas(repoRoot, id);
  } catch (e) {
    return { refused: `canvas.json is unreadable: ${e instanceof Error ? e.message : String(e)}` };
  }

  const stamped = lesson as (LessonShape & { writtenBy?: unknown; turn?: unknown }) | undefined;
  const writtenBy = typeof stamped?.writtenBy === 'string' ? stamped.writtenBy : null;
  /*
   * NO STAMP MEANS VERSION 0, NOT VERSION 1. A checkpoint that does not say
   * which build wrote it cannot be assumed to be current; treating it as
   * current is exactly the guess this file exists to stop.
   */
  const schemaVersion = writtenBy === null ? 0 : CHECKPOINT_VERSION;
  return {
    checkpoint: {
      schemaVersion,
      writtenBy,
      turn: typeof stamped?.turn === 'number' ? stamped.turn : (lesson?.taught.length ?? 0),
      lesson,
      /*
       * `CanvasDocShape.charts` is `unknown[]` on disk — deliberately, because a
       * persisted chart is data a previous build wrote and this build has not
       * validated. Narrowed here rather than trusted: the migration re-derives
       * anything from another build, so the only charts served unvalidated are
       * ones this same build wrote and already checked.
       */
      charts: (canvas?.charts ?? []) as readonly SeqChart[],
    },
  };
}

/** Write the lesson with the three checkpoint fields on it. */
export function writeCheckpoint(
  repoRoot: string,
  id: string,
  lesson: LessonShape,
  stamp: { writtenBy: string | null; turn: number },
): void {
  writeLesson(repoRoot, id, {
    ...lesson,
    ...(stamp.writtenBy === null ? {} : { writtenBy: stamp.writtenBy }),
    turn: stamp.turn,
  } as LessonShape);
}

export interface Migration {
  /** True when the stored derivation was discarded and rebuilt. */
  migrated: boolean;
  /** Why, in one line, for the transcript. */
  reason: string;
  /** The charts to serve — re-derived when migrated, the stored ones otherwise. */
  charts: readonly SeqChart[];
  /** The check-in for the current concept, re-derived when migrated. */
  checkIn?: string;
}

/**
 * Decide what to serve on open.
 *
 * `migrated 0 of 1` on a same-build open is the expected case and is not a
 * failure — it is the statement that nothing needed changing, which is only
 * worth anything because the same code would have changed it if it had.
 */
export function migrateCheckpoint(input: {
  checkpoint: Checkpoint;
  graph: Pick<ArchGraph, 'nodes' | 'edges'> | undefined;
  /** The build doing the opening. */
  builtAt: string | null;
}): Migration {
  const { checkpoint, graph, builtAt } = input;
  const sameBuild = checkpoint.writtenBy !== null && checkpoint.writtenBy === builtAt;
  if (sameBuild && checkpoint.schemaVersion === CHECKPOINT_VERSION) {
    return {
      migrated: false,
      reason: `same build (${builtAt ?? 'unknown'}) and schema ${CHECKPOINT_VERSION}`,
      charts: checkpoint.charts,
    };
  }
  /*
   * RE-DERIVED, OR NOTHING. If there is no graph to derive from, the stored
   * chart is not served as a fallback — a picture whose provenance cannot be
   * checked is exactly what this refuses. An empty canvas is honest; a stale one
   * is not.
   */
  /*
   * THE CONCEPT THE STORED CHART DEPICTED, which is the one last TAUGHT — not
   * the one queued next.
   *
   * Written the other way round first, and the planted case caught it: a lesson
   * with `taught: [brief.ts]` and `queue: [cli.ts, ...]` re-derived a chart of
   * cli.ts and served it in place of the brief.ts chart the learner had. That is
   * worse than serving a stale picture — it is a picture of something else,
   * arriving with no sign that the subject changed.
   *
   * `queue[0]` is the fallback for a lesson whose first turn has not completed,
   * where nothing is taught yet and the head of the queue IS the current
   * concept.
   */
  const concept = checkpoint.lesson?.taught.at(-1) ?? checkpoint.lesson?.queue[0];
  const chart = graph === undefined ? undefined : buildConceptChart(graph, concept);
  return {
    migrated: true,
    reason:
      checkpoint.schemaVersion === 0
        ? 'the checkpoint names no build, so it cannot be assumed current'
        : `written by ${checkpoint.writtenBy}, opened on ${builtAt ?? 'unknown'}`,
    charts: chart === undefined ? [] : [chart],
    ...(chart === undefined ? {} : { checkIn: deriveCheckIn(chart) }),
  };
}

/**
 * Open a lesson at turn N as a NEW branch.
 *
 * The source is not modified. Two branches from one first turn is how the
 * next-picture bands get their comparison without paying for the first turn
 * twice — and the only way to compare two second turns honestly is for them to
 * share a first one exactly, rather than to be told they do.
 */
export function forkCheckpoint(input: {
  repoRoot: string;
  from: string;
  to: string;
  atTurn: number;
  writtenBy: string | null;
}): { forked: true; lesson: LessonShape } | { forked: false; refused: string } {
  const read = readCheckpoint(input.repoRoot, input.from);
  if (read.refused !== undefined) return { forked: false, refused: read.refused };
  const lesson = read.checkpoint?.lesson;
  if (lesson === undefined) return { forked: false, refused: `${input.from} has no lesson to fork` };
  if (input.atTurn < 0 || input.atTurn > lesson.taught.length) {
    return {
      forked: false,
      refused: `turn ${input.atTurn} is outside this lesson's ${lesson.taught.length} taught turns`,
    };
  }
  /*
   * REWOUND, NOT TRUNCATED. Concepts taught after the fork point go back on the
   * front of the queue in their original order, so the branch has the same
   * lesson ahead of it that the original had at that turn — a fork that dropped
   * them would be a different lesson wearing the same name.
   */
  const kept = lesson.taught.slice(0, input.atTurn);
  const rewound = lesson.taught.slice(input.atTurn).map(({ turn: _t, ...c }) => c);
  const branch: LessonShape = {
    ...lesson,
    sessionId: input.to,
    taught: kept,
    queue: [...rewound, ...lesson.queue],
    open: undefined,
  };
  writeCheckpoint(input.repoRoot, input.to, branch, {
    writtenBy: input.writtenBy,
    turn: input.atTurn,
  });
  return { forked: true, lesson: branch };
}
