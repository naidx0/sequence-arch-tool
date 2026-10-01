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
  /\b(draw|diagram|mermaid|flowchart|visuali[sz]e|map out|sketch|chart|plot|mockup|wireframe|ai[\s-]?canvas|on(?:to)? the (?:\w+[ -])?(board|canvas)|tui|show (it |this )?on the board)\b/i;

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

/*
 * PLOT / MATH DRAWS — not architecture.
 *
 * Owner walk 2026-09-15: "draw a parabola" armed the architecture belt
 * (`propose_topology` / `diagram.upsert`) and landed invented service modules
 * on the Architecture board. A math/plot ask is still `draw` for the contract,
 * but it must prefer `propose_chart` / math plot — never topology IR.
 *
 * ARCHITECTURE SCOPE WINS: "draw the auth topology" names the board and stays
 * on the architecture path even if it also says "chart".
 */
const PLOT_MATH_PATTERN =
  /\b(parabola|sin(?:e)?|cos(?:ine)?|tangent|polynomial|equation|plot|scatter|histogram|line chart|bar chart|curve|graph (?:of|the)|y\s*=\s*|f\s*\(\s*x\s*\)|math(?:s|ematics)?)\b/i;

const ARCHITECTURE_DRAW_SCOPE_PATTERN =
  /\b(architecture|topology|microservice|service(?:s)?|on(?:to)? the (?:\w+[ -])?board|system design|seqd|propose_topology|diagram\.upsert)\b/i;

/** True when the ask wants a math/plot/chart picture, not repo architecture IR. */
export function isPlotOrMathDrawAsk(question: string): boolean {
  const q = question.trim();
  if (!q) return false;
  if (!PLOT_MATH_PATTERN.test(q)) return false;
  if (ARCHITECTURE_DRAW_SCOPE_PATTERN.test(q)) return false;
  return true;
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

/* -------------------------------------- the home workspace's two asks ------ */

/**
 * AN EXPLANATION, NOT A SYSTEM TO BUILD.
 *
 * Owner, walking the installed app 2026-09-17: in the blank workspace he asked
 * "explain LLMs and their internal architecture using visuals in 3D" and got
 * back an instruction read out loud — "stage three to five assumptions, then
 * emit an SEQD diagram". He wanted it BUILT on the AI Canvas.
 *
 * The blank workspace sends `design: { title: 'Blank workspace' }` with
 * `proposeArchitecture: true` on every non-teach turn, because the flag was
 * written for the person who opened an empty board to DESIGN something. It is
 * the wrong flag for the person who opened the same empty board to be SHOWN
 * something, and the two share one branch only because neither has a
 * repository.
 *
 * So the explanatory shapes are listed first and they WIN. "architecture" is a
 * noun that appears in both kinds of ask — it is the subject of his question
 * and the deliverable of a design brief — so a pattern that reads it as a
 * design request reads every explanation of a system as one too.
 */
const HOME_EXPLANATORY_PATTERN =
  /\b(?:explain|explains|explaining|eli5|teach|illustrate|demonstrate|visuali[sz]e|visuals?)\b|\bshow me (?:how|what|why)\b|\bwalk me through\b|\bwhat (?:is|are|does)\b|\bhow (?:does|do|did|is|are|would|can)\b[^.?!]{0,60}\bwork/i;

/**
 * The shapes that really are a request to design a system that does not exist.
 *
 * Request VERBS with an object, never bare nouns: "design a checkout system",
 * "I want to build a trading bot", "propose an architecture". A sentence that
 * merely MENTIONS architecture is caught by nothing here, which is the whole
 * difference between this and explain.ts's `prefersSeqdDiagramAsk`.
 */
const ARCHITECTURE_DESIGN_PATTERN =
  /\bbreak(?:ing)? (?:it |this |that )?down\b|\bmap (?:it|this|that) out\b|\bsystem design\b|\btopolog(?:y|ies)\b|\bmicroservices?\b|\bseqd\b|\bpropose_topology\b|\bdesign(?:ing)? (?:a|an|the|me|my|our)\b|\bpropose (?:a|an|the)\b|\barchitect (?:a|an|the)\b|\barchitecture for (?:a|an|the|this)\b|\bi want to (?:create|build|make|design|launch)\b|\b(?:build|create|make|launch) (?:a|an|the|my|our)\b|\bon(?:to)? the (?:\w+[ -])?board\b|\bscaffold\b|\bgreenfield\b/i;

/**
 * Is this home-workspace ask a DESIGN BRIEF (seqd, architecture board) rather
 * than something to draw on the AI Canvas?
 *
 * The route calls it to decide whether the client's `proposeArchitecture` flag
 * is honoured, and the belt calls it to decide which of the two sections a
 * repo-less turn gets. ONE predicate for both, because a belt that armed the
 * canvas while the prompt ordered an architecture proposal is the shape of
 * every prompt-fight already recorded in this file.
 *
 * A LESSON IS NEVER A DESIGN BRIEF — `classifyAskIntent` already owns "is this
 * teaching", and teach mode has its own contract this must not reach past.
 */
/**
 * Is this an EXPLANATION — "explain X", "show me how X works", "what is X" —
 * rather than a request to design or break a system down? The first clause of
 * `isArchitectureDesignAsk`, exported on its own because the base design
 * prompt needs exactly this half: it keeps honouring the client's
 * `proposeArchitecture` flag for "break down X" / "map it out" (a structural
 * ask, product law since the design breakdown shipped) and drops it only for
 * an explanation, which is the shape the owner read the assumptions-then-seqd
 * directive back from (2026-09-17).
 */
export function isExplanatoryHomeAsk(question: string): boolean {
  const q = question.trim();
  if (q === '') return false;
  /* No teach exclusion here, unlike `isArchitectureDesignAsk`: "explain LLMs
     to me" classifies as a lesson AND is an explanation — both are reasons
     not to order an architecture proposal. */
  return HOME_EXPLANATORY_PATTERN.test(q);
}

export function isArchitectureDesignAsk(question: string): boolean {
  const q = question.trim();
  if (q === '') return false;
  if (classifyAskIntent(q) === 'teach') return false;
  if (HOME_EXPLANATORY_PATTERN.test(q)) return false;
  return ARCHITECTURE_DESIGN_PATTERN.test(q);
}

/* ------------------------------------ explain this file, on the canvas ---- */

/**
 * "EXPLAIN THIS FILE" IS THE COMMONEST ASK IN A CODE-READING TOOL, AND IT WAS
 * THE ONE SHAPE THAT COULD NOT DRAW.
 *
 * Measured 2026-09-18 (`docs/research/ai-canvas-moat-audit.md`): with a repo
 * attached, `canvasToolsEnabled` reduces to {@link isDrawishAskQuestion}, and
 * "explain src/server/askPipeline.ts", "what does canvasTools.ts do" and
 * "walk me through the scanner" match NOTHING in `DRAW_PATTERN`. The canvas
 * writers were refused at the door for exactly the turn the product exists for.
 *
 * TWO HALVES, BOTH REQUIRED — an explain VERB and a SUBJECT that is a piece of
 * code. "Explain the tradeoff" is an explanation and there is nothing to draw
 * a structure of; "open src/index.ts" names a file and asks for no explanation.
 * Requiring both is what keeps this from becoming a second `DRAW_PATTERN` that
 * fires on half the turns in the product.
 */
const EXPLAIN_VERB_PATTERN =
  /\b(?:explain|explains|explaining|walk (?:me|us) through|talk (?:me|us) through|show me how|give me a tour of|tour of|what does|what is|how does|how do)\b/i;

/*
 * A PATH, OR A FILENAME WITH A REAL EXTENSION. The extension list is closed on
 * purpose: a bare `foo.bar` in prose is not a file, and treating it as one
 * arms the canvas on sentences about version numbers and domain names.
 */
const EXPLAIN_SUBJECT_PATH_PATTERN =
  /(?:[\w@.\-]+\/)+[\w@.\-]+|\b[\w@\-]+\.(?:tsx?|jsx?|mjs|cjs|mts|cts|py|go|rs|java|kt|rb|php|cs|cc|cpp|hpp|swift|scala|sh|bash|sql|ya?ml|json|toml|md|css|scss|less|html|vue|svelte|proto|graphql|tf)\b/i;

/** A symbol the user marked as one: backticked, or spelled with call parens. */
const EXPLAIN_SUBJECT_SYMBOL_PATTERN = /`[^`\n]+`|\b[A-Za-z_$][\w$]*\s*\(\s*\)/;

/*
 * "this file", "that component", "the handler" — a subject the user points at
 * rather than names. The noun list is deliberately SMALLER than
 * `TEACH_CONCEPT_EXCLUDES_PATTERN`'s: `service`, `endpoint` and `route` are
 * architecture nouns, and "what does this service return" is a question about
 * behaviour, not a request for a picture of a file.
 */
const EXPLAIN_SUBJECT_DEICTIC_PATTERN =
  /\b(?:this|that|the)\s+(?:[\w-]+\s+)?(?:file|files|module|modules|class|classes|function|functions|method|component|components|script|hook)\b/i;

/**
 * Is this an ask to explain a FILE or a SYMBOL of the attached repository?
 *
 * The canvas gate and the explain prompt section both call it, so the belt
 * cannot arm the writers on a turn whose instructions never mention them, nor
 * order a drawing on a turn whose tools are refused — the prompt-fight shape
 * this tree has a scar about in `askPipeline.ts`.
 */
export function isExplainFileAsk(question: string): boolean {
  const q = question.trim();
  if (q === '') return false;
  if (!EXPLAIN_VERB_PATTERN.test(q)) return false;
  return (
    EXPLAIN_SUBJECT_PATH_PATTERN.test(q) ||
    EXPLAIN_SUBJECT_SYMBOL_PATTERN.test(q) ||
    EXPLAIN_SUBJECT_DEICTIC_PATTERN.test(q)
  );
}
