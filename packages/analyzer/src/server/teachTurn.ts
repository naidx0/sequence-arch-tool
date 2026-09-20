/**
 * ONE ASSEMBLY OF A TEACH TURN, because a rule that lives in two handlers is
 * one rule until it is measured.
 *
 * `/api/ask` and `/api/ask/stream` are separate blocks with separate
 * `callProvider` closures, and the lesson lived entirely in the first: thread
 * resolution, `readLesson`, `newLesson`, `writeLesson`, the `teachContext`
 * assembly and the reasoning narrowing. Inside the stream handler the count of
 * those symbols was ZERO — and the stream route is the one the web client
 * drives. So no `lesson.json` was ever written for a real user turn, no concept
 * reached the belt, and the derived chart, which correctly draws nothing
 * without a concept, could never fire.
 *
 * Every lesson-state number on record — the queue, the concept per turn, the
 * finished-lesson slot, the derived visual at 14/21 and 20/26 — was measured
 * through the bench and reached the product only on a route nothing drives.
 *
 * That was the THIRD time in one session that one rule lived in two places with
 * one of them quietly different (`teachContext`, then `reasoningEffort`, then
 * this). The first was fixed by unifying an assembly and the second by a
 * per-route gate; this file is the first fix applied to the whole turn, so the
 * stream route gets the lesson BY CONSTRUCTION rather than by copy.
 */
import type { ArchGraph } from '@sequence/schema';

import { gradeCheckIn } from './checkIn.js';
import type { AiConfig } from './provider.js';
import {
  advanceLesson,
  buildQueue,
  buildTeachContext,
  carryPrediction,
  newLesson,
  taughtThisTurn,
  subjectlessRefusal,
  type LessonShape,
} from './lessonState.js';
import { resolveAskThreadId } from './askSession.js';
import { readLesson, writeLesson } from './sessionsStore.js';

export interface TeachTurn {
  /** The conversation this ask belongs to, when one could be resolved. */
  readonly threadId?: string;
  /** Spread into the pipeline input: `...turn.contextField()`. */
  contextField(): Record<string, unknown>;
  /**
   * The provider config for this turn.
   *
   * A teach turn does not think out loud, because the bench does not and the
   * two must run the same configuration. Measured: the same turn took 288
   * seconds with reasoning on and 27 with it off, generating 8,000–14,700
   * tokens a call against a few hundred. An explicit value in config still
   * wins.
   */
  configFor(cfg: AiConfig): AiConfig;
  /**
   * The refusal text when this ask is a lesson request with no subject in the
   * graph, or undefined. Consulted BEFORE any provider call — a refusal that
   * cost a model call would be a worse answer that also spent money.
   *
   * On the TeachTurn rather than at the two call sites, because a rule that
   * lives in two handlers is one rule until it is measured, and `/api/ask` and
   * `/api/ask/stream` have drifted before.
   */
  refusal(): string | undefined;
  /** Grade the finished turn and persist the lesson. Never throws. */
  finish(result: {
    text?: unknown;
    diagram?: unknown;
    chartsThisTurn: number;
    /** The next-picture prediction this turn asked, to be revealed next turn. */
    openPrediction?: { question: string; expect: string; arrow: string };
  }): void;
}

/** A turn that is not teaching: every method is a no-op with the right shape. */
const NOT_TEACHING = (known?: string): TeachTurn => ({
  contextField: () => (known ? { teachContext: { known } } : {}),
  configFor: (cfg) => cfg,
  /* Not teaching, so there is no lesson to refuse. */
  refusal: () => undefined,
  finish: () => {},
});

export function beginTeachTurn(input: {
  teach: boolean;
  question: string;
  threadIdFromRequest: unknown;
  sessionsRoot: string | null;
  graph?: Pick<ArchGraph, 'nodes' | 'edges'>;
  teachKnown?: string;
}): TeachTurn {
  const { teach, question, sessionsRoot, graph, teachKnown } = input;
  if (teach !== true) return NOT_TEACHING(teachKnown);

  const resolved = resolveAskThreadId(input.threadIdFromRequest, sessionsRoot);
  /*
   * ONLY A THREAD THE CALLER NAMED, never the index's `activeId`.
   *
   * `resolveAskThreadId` falls back to whichever session the index calls active
   * when the request names none. For most things that is a reasonable default;
   * for a LESSON it is a guess about which conversation the person is looking
   * at, and when it is wrong the lesson is filed under a different session from
   * the chat — so the conversation on screen has no lesson, no concept, no chart
   * and no check-in. Reproduced card-free in
   * `test/lesson-thread-resolution.test.ts`.
   *
   * A guess is exactly what this product's first law forbids, and the honest
   * alternative is to write nothing: a missing lesson is recoverable, a lesson
   * filed against the wrong conversation is a false record of what somebody was
   * taught.
   *
   * The fallback is not removed from the resolver, which other callers may
   * legitimately want — it is refused HERE, where the consequence lives. The
   * only client that reached this without naming a thread was `packages/web2`,
   * and it now sends `threadId`; the CLI calls `runAskPipeline` directly and
   * never comes through here.
   */
  const threadId = resolved.source === 'request' ? resolved.threadId : undefined;
  const existing =
    threadId === undefined || sessionsRoot === null
      ? undefined
      : readLesson(sessionsRoot, threadId);
  /*
   * THE LESSON IS CREATED BEFORE THE FIRST TURN, not after it.
   *
   * Read from disk and, failing that, built now — so turn one already has a
   * concept and the derived chart can fire on it. Creating it only on the way
   * out is what made the first turn of every thread conceptless, and the first
   * turn is the one a person judges the mode by.
   */
  const lesson: LessonShape | undefined =
    threadId === undefined
      ? undefined
      : (existing ?? newLesson(threadId, question, graph, teachKnown));

  return {
    ...(threadId === undefined ? {} : { threadId }),
    contextField: () => ({
      teachContext: buildTeachContext({
        ...(lesson === undefined ? {} : { lesson }),
        ...(graph ? { graph } : {}),
        ...(teachKnown ? { known: teachKnown } : {}),
      }),
    }),
    /*
     * A lesson whose queue came back empty has no subject. Refused here, before
     * the provider is called and before any lesson is written to disk, so a
     * refused turn is not a lesson: nothing is taught, nothing is derived, and
     * the corrected statistic cannot count it as a lesson turn.
     */
    /*
     * THE REFUSAL DOES NOT DEPEND ON A THREAD, and tying it to one shipped a
     * hole worse than the defect it was part of.
     *
     * This read `lesson === undefined ? undefined : subjectlessRefusal(...)`.
     * When a180b036 made the server refuse to file a lesson under a thread the
     * caller had not named, `lesson` became undefined for any client that did
     * not send `threadId` — and the client half of that same commit lives in
     * packages/web2, which the running app serves from a SEPARATE build. The
     * server had the new rule, the browser had last night's bundle, and a
     * subject-less teach ask went straight to a model call instead of being
     * refused. Seen from the seat at 2026-09-06T12:1x, ten seconds of somebody
     * else's GPU card.
     *
     * One rule in two places again — except this time the two places were two
     * PACKAGES with separate build steps, and each half had passing tests.
     *
     * Whether the ask names a subject is a property of the ASK and the GRAPH.
     * It has nothing to do with which conversation the ask belongs to, so it is
     * computed from those two and nothing else. The queue is built the same way
     * `newLesson` builds it, so a refusal and a lesson can never disagree about
     * whether there was a subject.
     */
    refusal: () => subjectlessRefusal(question, graph ? buildQueue(graph, question) : [], graph),
    configFor: (cfg) =>
      cfg.params?.reasoningEffort === undefined
        ? { ...cfg, params: { ...(cfg.params ?? {}), reasoningEffort: 'none' as const } }
        : cfg,
    finish: ({ text, diagram, chartsThisTurn, openPrediction }) => {
      if (threadId === undefined || lesson === undefined || sessionsRoot === null) return;
      /*
       * The grader's own two hard rules — a visual and a closing CHECK, not a
       * trailing question mark: 15 of 31 measured closing questions were
       * clarifying offers the contract bans and every one satisfied the old
       * test. A chart proposal counts as the visual, as it does in the bench;
       * counting only `diagram` made the product stricter than the bench that
       * measures it.
       */
      const taught = taughtThisTurn({
        visual: chartsThisTurn > 0 || diagram !== undefined,
        endsWithCheck: gradeCheckIn(String(text ?? '')).endsWithCheck,
      });
      const advanced = advanceLesson(lesson, { passed: taught, turn: lesson.taught.length });
      /*
       * THE PREDICTION IS CARRIED, NOT RE-DERIVED. Re-deriving it next turn from
       * the queue would answer whatever concept happens to be current, which is
       * not necessarily the one the learner was asked about — a true sentence in
       * the wrong place. Cleared when nothing was asked, so a stale reveal
       * cannot survive a turn that asked nothing.
       */
      const after: typeof advanced = carryPrediction(advanced, openPrediction, lesson.taught.length);
      try {
        writeLesson(sessionsRoot, threadId, after);
      } catch {
        /* A lesson that cannot be written must not fail the answer the reader is
           waiting on — the turn happened either way. */
      }
    },
  };
}
