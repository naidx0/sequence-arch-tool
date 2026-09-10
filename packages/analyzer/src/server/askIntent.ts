/**
 * B1.1 — heuristic ask intent classification for metrics and future routing.
 *
 * Pure function: no I/O, no graph access. Draw / explore / edit / chat are
 * coarse buckets — enough to tag telemetry and gate design-draw caps, not to
 * replace the model's own tool choice.
 */

export type AskClassifiedIntent = 'teach' | 'draw' | 'explore' | 'edit' | 'chat';

export interface ClassifyAskIntentOptions {
  /** Reserved for future context-aware routing (surface tab, job mode, etc.). */
  designMode?: boolean;
}

/*
 * "on(to) the … board/canvas" admits ONE optional word between "the" and the
 * surface: measured on a real journey walk (hoppscotch, 2026-08-29), "propose
 * adding a rate-limiter … on the architecture board" classified `chat`, so the
 * canvas tools never armed, the draw contract never fired, and the user got
 * prose about the board instead of anything on it. The product's own hints
 * call the surface "the architecture board" — the classifier has to hear its
 * own vocabulary.
 */
const DRAW_PATTERN =
  /\b(draw|diagram|mermaid|flowchart|visuali[sz]e|map out|sketch|chart|mockup|wireframe|ai[\s-]?canvas|on(?:to)? the (?:\w+[ -])?(board|canvas)|tui|show (it |this )?on the board)\b/i;

const EDIT_PATTERN =
  /\b(change|fix|refactor|implement|update|modify|rewrite|patch|rename|add|remove|delete|create|propose_files|edit|replace|migrate|correct|repair|adjust)\b/i;

const EXPLORE_PATTERN =
  /\b(what calls|who calls|who depends|what depends|callers?|callees?|dependenc(?:y|ies)|search(?:ing)? for|find where|grep|look up|trace|where is|where are|show me (?:the )?files?|which files?|list (?:the )?files?|how does .+ work|explain how)\b/i;

/*
 * ═══ TEACHING, IN THREE TIERS — the 2026-09-02 owner failure ════════════════
 *
 * He typed "teach me this: AI Overview — Learn Supervised Learning, which is
 * the foundational machine learning concept …" with the composer's Teach row
 * UNSELECTED. Nothing here matched, so the turn classified `chat`, the teach
 * contract never entered the belt, and the model interrogated him in our own
 * vocabulary ("SeqDiagram v1", "system-architecture or data-flow") before
 * dropping one generic markdown block on the canvas. A product whose headline
 * mechanic is teaching could not hear the word "teach".
 *
 * Three tiers, because "is this a lesson?" is not one question:
 *
 *   1 IMPERATIVE — the learner asks to be taught, in so many words. Beats every
 *     other bucket including edit: "teach me how to fix the routing bug" is a
 *     lesson about a fix, not a fix.
 *   2 MATERIAL — the learner asks FOR teaching material: "give me a crash
 *     course on X". Same intent, but these are NOUNS, and a noun can be
 *     mentioned without being wanted, so this tier loses to edit.
 *   3 TO-ME — "explain X to me". A lesson UNLESS the same sentence also orders
 *     a change: "fix the bug and explain it to me" is an edit that owes an
 *     explanation, and teach mode refuses the very tool it needs.
 *   4 CONCEPT — "what is X", "what does X mean". Loses to edit for the same
 *     reason, and ALSO to explore, because "what are the callers of foo" is a
 *     graph lookup wearing a concept question's grammar.
 *
 * EXPLORE-vs-TEACH, DECIDED: a bare "how does X work" stays EXPLORE and is
 * deliberately absent from every pattern below. In a tool whose subject is the
 * user's own repository that sentence is the commonest grounded lookup there
 * is, and answering it in 150-word one-concept slices with a check-in question
 * would make ordinary questions unanswerable. Teaching is opt-in by phrasing:
 * "teach me how X works", "explain how X works to me" and "help me understand
 * how X works" all reach tier 1 or 2 and win, because the learner is in the
 * sentence. Nothing infers a lesson from a lookup.
 */
/*
 * EVERY ALTERNATIVE HERE PUTS THE LEARNER IN THE SENTENCE, because this tier
 * outranks edit and a false hit refuses the very tools the user asked for.
 *
 * `tutorial`, `crash course` and `beginner'?s guide` used to sit in this tier
 * as BARE NOUNS matching anywhere in the sentence, so "Fix the broken step in
 * deploy.yml — the docs tutorial says it needs a cache key" was a lesson: tier
 * 1 returned before the EDIT short-circuit below, `edit_file` /
 * `propose_files` / `run_command` were refused for the whole turn, and the
 * only trace was a work row reading "Taught this as a lesson". A noun someone
 * MENTIONS is not a noun they asked for — those three moved to
 * TEACH_MATERIAL_PATTERN, which is checked after edit and needs the material
 * to be requested.
 */
const TEACH_IMPERATIVE_PATTERN =
  /\b(?:teach (?:me|us|myself)|eli5|explain (?:it |this |that )?like i'?m|walk (?:me|us) through|talk (?:me|us) through|help (?:me|us) understand)\b/i;

/*
 * Tier 2 — the learner asks FOR teaching material. The request verb is part of
 * the pattern on purpose: "give me a crash course on backpressure" is a
 * lesson, "the crash course in the README is wrong, fix it" is an edit.
 */
const TEACH_MATERIAL_PATTERN =
  /\b(?:give|gimme|write|make|send|share|want|need|looking for|do you have)\s+(?:me\s+|us\s+)?(?:an?\s+|the\s+)?(?:tutorial|crash course|beginner'?s guide|primer|intro|introduction|overview|walkthrough)\b/i;

const TEACH_TO_ME_PATTERN = /\bexplain\b[^.?!]{0,80}?\bto (?:me|us)\b/i;

const TEACH_CONCEPT_PATTERN = /\bwhat (?:is|are)\b|\bwhat does\b[^.?!]{1,60}?\bmean\b/i;

/*
 * "WHAT IS <state>" IS A STATUS QUESTION, NOT A CONCEPT QUESTION.
 *
 * The repo-noun excludes below cannot catch these, because the commonest
 * debugging phrasings name no noun at all: "what is failing in CI right now",
 * "what is wrong with this code", "what is broken here". Each classified
 * `teach`, which capped the answer at ~150 words on ONE concept, demanded a
 * chart, and refused `run_command` — so the agent could not run the suite that
 * would have answered the question.
 *
 * The listed words are STATES (an adjective or a status participle), a closed
 * grammatical class — NOT a vocabulary of nouns. A gerund concept ("what is
 * caching", "what is sharding") is deliberately absent: those are things, not
 * states, and they are exactly the lessons this tier exists for.
 */
const TEACH_CONCEPT_STATE_PATTERN =
  /\bwhat (?:is|are)\s+(?:wrong|broken|failing|breaking|crashing|hanging|missing|left|happening|going on|different|new|slow|flaky|fragile|brittle|risky|unstable|stale)\b/i;

/*
 * A REPO DEICTIC SCOPES THE QUESTION TO THE ARTIFACT, WITH NO NOUN TO MATCH.
 *
 * `TEACH_CONCEPT_EXCLUDES_PATTERN` needs a determiner AND a repo noun ("this
 * repo", "the auth module"). The commonest scoping phrase supplies neither:
 * "what is fragile HERE?" — which is what `/api/ask`'s byte-identical-prompt
 * test asks. It classified `teach`, so a plain lookup engaged the teach
 * contract and spent three provider calls where it had spent one (the test
 * caught it as `6 !== 2` prompts), and mutating tools would have been refused
 * for the turn.
 *
 * Adding "fragile" to the state list above fixes that ONE sentence; this fixes
 * the family. These are place/time adverbs that point at the attached
 * repository, a closed class like the states above — NOT a vocabulary of
 * topics. "What is sharding" stays a lesson; "what is slow here" does not.
 */
const TEACH_CONCEPT_DEICTIC_PATTERN =
  /\b(?:here|right now|currently|at the moment|in here|so far)\b/i;

/*
 * "What is X" is a concept question ONLY when X is a concept. Pointed at the
 * user's own material — "what is the purpose of this repo?", "what is the auth
 * module?" — it is a question about the artifact in front of them, which this
 * product has always answered as chat and which a paced one-concept-per-turn
 * lesson would answer worse. The named nouns are the repo vocabulary, not a
 * general stop-list: nothing here tries to decide whether "supervised learning"
 * is abstract, only whether the sentence is about THIS codebase.
 *
 * SEQUENCE'S OWN SURFACES ARE PART OF THAT VOCABULARY, and their absence was
 * measured, not theoretical: "what are the current risks" and "what are the
 * cycles in the graph" — the grounded-logic questions this product exists to
 * answer — classified `teach` and came back as a 150-word one-concept lesson
 * ending in a check-in question instead of a lookup. Risks, cycles, impact,
 * the graph and the board are as much "the artifact in front of them" as a
 * file is. The debugging artifacts (error, log, diff, build) are here for the
 * same reason: "what is this error?" is a diagnosis request, and teach mode
 * refuses the tools a diagnosis needs.
 */
const TEACH_CONCEPT_EXCLUDES_PATTERN =
  /\b(?:this|these|that|those|our|the|my|your)\s+(?:[\w-]+\s+){0,2}(?:repo|repos|repository|codebase|code ?base|code|project|file|files|module|modules|service|services|function|functions|package|packages|app|component|components|endpoint|endpoints|test|tests|suite|branch|commit|pr|graph|graphs|node|nodes|edge|edges|flow|flows|risk|risks|cycle|cycles|impact|topology|board|canvas|architecture|error|errors|bug|bugs|exception|exceptions|log|logs|stack ?trace|diff|diffs|build|builds|change|changes|script|scripts|config|route|routes|pipeline)\b/i;

/** Draw / diagram / show-on-board intent — shared signal with the canvas tool gate. */
export function isDrawishAskQuestion(question: string): boolean {
  return DRAW_PATTERN.test(question);
}

/**
 * "Teach me …" — the shared signal, so the belt, the hash and the pipeline all
 * decide a turn is a lesson from ONE function rather than three guesses. The
 * server recomputes the instruction hash from the same request fields the
 * pipeline builds the belt from (repoServer's `trajectory:start`), and a second
 * copy of this rule would let those two disagree about the same turn.
 */
export function isTeachAskQuestion(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  if (TEACH_IMPERATIVE_PATTERN.test(q)) return true;
  if (EDIT_PATTERN.test(q)) return false;
  if (TEACH_MATERIAL_PATTERN.test(q)) return true;
  if (TEACH_TO_ME_PATTERN.test(q)) return true;
  return (
    TEACH_CONCEPT_PATTERN.test(q) &&
    !TEACH_CONCEPT_STATE_PATTERN.test(q) &&
    !TEACH_CONCEPT_DEICTIC_PATTERN.test(q) &&
    !TEACH_CONCEPT_EXCLUDES_PATTERN.test(q) &&
    !EXPLORE_PATTERN.test(q)
  );
}

/**
 * Classify the user's natural-language ask into a coarse intent bucket.
 *
 * Order: teach → draw → edit → explore → chat (default).
 *
 * Teach is first because a teaching question that says "diagram" is still a
 * lesson — "teach me this and draw it" must not become a bare draw turn, which
 * is the shape that lost the 2026-09-02 turn to a single markdown block.
 */
export function classifyAskIntent(
  question: string,
  _opts?: ClassifyAskIntentOptions,
): AskClassifiedIntent {
  const q = question.trim();
  if (!q) return 'chat';
  if (isTeachAskQuestion(q)) return 'teach';
  if (DRAW_PATTERN.test(q)) return 'draw';
  if (EDIT_PATTERN.test(q)) return 'edit';
  if (EXPLORE_PATTERN.test(q)) return 'explore';
  return 'chat';
}
