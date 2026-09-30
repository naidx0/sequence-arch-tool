/**
 * LESSON STATE — what a Teach session must keep so that "continue" means something.
 *
 * The teach contract promises one concept per turn, built on what was already
 * taught. `TeachTurnContext` has had slots for exactly that since it was
 * written — `concept`, `taught`, `open`, `anchors` — and the product filled
 * NONE of them: `repoServer.ts` passes `{ known }` and nothing else, and only
 * when the learner has clicked a level.
 *
 * The cost was measured, not guessed. Of the 47 turns in the 20-conversation
 * bench, 17 never became lessons at all, and 10 of those were "continue to the
 * next point" — a turn where the contract demands exactly one concept and the
 * pipeline hands it none. The model answers in ten words because there is
 * nothing to answer with.
 *
 * ── WHERE A QUEUE MAY COME FROM, AND WHERE IT MAY NOT ──────────────────────
 *
 * The ask sets the GRAIN and the COUNT; the graph sets the CANDIDATES and the
 * ORDER. That division is the whole design:
 *
 *   - "Teach me how makemore works — bit by bit" is a sequence, and how many
 *     concepts it is cannot be read off a graph. The ask says so.
 *   - "Why is the dot marker used at both ends?" is ONE concept, and a queue
 *     that pads it to five would be inventing a lesson nobody asked for.
 *   - Which files, and in what order, is exactly what the graph knows and the
 *     ask does not.
 *
 * So a one-concept ask gets a queue of one, and when it is taught the lesson is
 * DONE — a state this module reports rather than hides, because the honest
 * sentence ("that is the lesson you asked for; here is what touches it") is a
 * better turn than a tenth fragment.
 */
import type { ArchEdge, ArchGraph, ArchNode } from '@sequence/schema';

export interface Concept {
  title: string;
  nodeId?: string;
}

export interface LessonShape {
  version: 1;
  sessionId: string;
  subject: { ask: string; nodeIds: string[] };
  queue: Concept[];
  taught: Array<Concept & { turn: number }>;
  /** The closing prediction awaiting its reveal. Text, never a boolean. */
  /**
   * `arrow` is the edge that decides the answer, carried so the reveal can name
   * the REASON and not only the verdict (ruled 2026-09-06). Optional because
   * the comprehension form has no arrow to name.
   */
  open?: { question: string; expect?: string; askedAt: number; arrow?: string } | undefined;
  known?: string | undefined;
}

/**
 * Asks whose shape is a SEQUENCE — several concepts, in order — as opposed to a
 * single question about one thing.
 *
 * Deliberately a small list of phrases a learner actually types, and
 * deliberately NOT a model call: getting this wrong in the permissive direction
 * invents a lesson, and one wrong queue is worse than no queue because the
 * learner cannot see it to correct it.
 */
const SEQUENCE_ASK =
  /\b(bit by bit|step by step|point to point|walk me through|walk through|how .{1,40} works|the full |end to end|end-to-end|from .{1,30} to |overview of)\b/i;

/*
 * A REQUEST FOR A LESSON, as opposed to a pointed question.
 *
 * SEQUENCE_ASK alone decided whether a lesson got neighbours, and it is a proxy
 * for the wrong thing: it detects "bit by bit" phrasing, not whether the learner
 * asked to be taught. Measured on the shopfront fixture, all three of these
 * named the same node and only the third got more than one concept:
 *
 *   "Why does orders.ts use the retry flag at both ends?"   -> 1
 *   "Teach me what orders.ts does here."                    -> 1
 *   "Teach me how orders.ts works — bit by bit."            -> 6
 *
 * The middle one is a lesson, and a lesson on any repository should see its
 * neighbours; it was getting a single file because it did not happen to contain
 * a sequence phrase. On the thirteen bench conversations this is not a corner
 * case — cs-05, link-04, mix-03, mix-06 and harness-07 are all "Teach me" asks
 * with no sequence phrase, and every one of them ran on a queue of one.
 *
 * The FIRST one must stay at one, and that is why this is a separate signal
 * rather than a widening of SEQUENCE_ASK. "Why does X use Y at both ends" wants
 * one explanation; padding it with neighbours invents a syllabus the learner
 * never asked for and cannot see to correct. That rule is older than this one
 * and still right — it is pinned by its own case in lesson-state.test.ts.
 */
/*
 * FIRST-PERSON INTENT, added 2026-09-09 from the owner's own sentence.
 *
 * Driven end to end, *"I want to learn about machine learning. What is it?"*
 * produced a repo-grounded answer naming where that phrase occurs in the
 * codebase — two test files, `askIntent.ts:38`, `docs/PIVOT-V2.md:67` — at
 * 145,904 input tokens and 0 of 2,902 edges of coverage. No refusal, no lesson.
 *
 * The refusal clause was PRESENT and correct; it self-gated on this pattern,
 * which listed five imperative forms and not one way a person says they want to
 * learn something. The queue was empty, so the second gate would have passed.
 *
 * WHY INTENT AND NOT THE WORD. "The model learns from labelled data" is a claim
 * about code, and a recogniser that fired on the bare verb would refuse ordinary
 * questions about ML source. Every alternative below requires the asker to say
 * they want it, which a description of someone else's system never does.
 */
const TEACH_ASK =
  /\b(teach me|teach us|give me a lesson|take me through|walk me through|(?:i want|i'd like|i would like|i'm trying|i am trying)\s+to\s+learn|help me learn)\b/i;

const MAX_QUEUE = 6;

/**
 * WHAT A LEARNER TYPES IS NOT WHAT THE SCANNER SPELLS.
 *
 * Measured at the seat: "teach me how the bigram counts work" produced an EMPTY
 * queue on a graph containing `file:bigram_counts.py` — no concept, no derived
 * chart, no lesson — while "teach me how bigram_counts.py works" produced the
 * whole lesson. The underscore was the entire difference, because this was a
 * substring test and `bigram_counts` does not occur in *the bigram counts*.
 *
 * Nobody types underscores and extensions, and the phrasing that failed is the
 * phrasing the mode exists to serve.
 */

/** Extensions are how a scanner spells a file, not how a person names one. */
const NAME_EXTENSIONS = new Set([
  'py', 'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'java', 'go', 'rb', 'rs', 'php',
  'c', 'h', 'cpp', 'cs', 'kt', 'swift', 'md', 'json', 'yaml', 'yml', 'sql',
]);

/**
 * Two suffixes and no more: plural and the gerund. "counts" and "counting" both
 * mean `count`, and a learner uses all three forms in the same breath. Anything
 * beyond this starts inventing relationships between words, which is the thing
 * the every-token rule is here to prevent.
 */
const stem = (word: string): string => {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
};

/**
 * The words in a name: split on separators AND on camelCase, extension dropped.
 * `bigram_counts.py` -> [bigram, count]; `readSessionMeta` -> [read, session, meta].
 */
const nameTokens = (name: string): string[] => {
  const spaced = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced
    .split(/[^A-Za-z0-9]+/)
    .map((t) => t.toLowerCase())
    /*
     * TWO characters, not three. `nn_bigram.py` is `nn` + `bigram`, and dropping
     * `nn` left a single token, which falls back to the substring rule and
     * misses "the nn bigram" entirely. A two-letter token is safe HERE because
     * every token must match: `nn` alone proves nothing, `nn` AND `bigram` does.
     */
    .filter((t) => t.length >= 2 && !NAME_EXTENSIONS.has(t))
    .map(stem);
};

/** Does the ask name this node — by label, by path, by basename, or by its words? */
const askNames = (ask: string, node: ArchNode): boolean => {
  const hay = ask.toLowerCase();
  const candidates: string[] = [node.label];
  if (node.path !== undefined) {
    const p = node.path.split('\\').join('/');
    const base = p.slice(p.lastIndexOf('/') + 1);
    candidates.push(p, base);
    const dot = base.lastIndexOf('.');
    if (dot > 0) candidates.push(base.slice(0, dot));
  }
  /*
   * THE FILE THE GRAPH KNOWS WINS OVER ANY GUESS: an ask that spells the name
   * literally matches on the substring rule first, exactly as it always did.
   */
  const literal = candidates.some((c) => {
    const needle = c.toLowerCase().trim();
    // 3 characters minimum: a two-letter label matches half the English language.
    return needle.length >= 3 && hay.includes(needle);
  });
  if (literal) return true;

  /*
   * EVERY token, not any. "the bigram counts" carries both `bigram` and `count`
   * and matches; "teach me the counts" carries one of the two and must NOT —
   * one common word is not evidence that an ask is about a file. That single
   * rule is what lets this find the real concept and still leave
   * `names_nothing` asks empty, which is the half that matters: an invented
   * concept becomes a confident chart about a file nobody asked about.
   */
  const asked = new Set(nameTokens(ask));
  return candidates.some((c) => {
    const tokens = nameTokens(c);
    /* A single-token name keeps the substring rule alone. `index.ts` matching
       any sentence containing "index" would be guessing with extra steps. */
    return tokens.length >= 2 && tokens.every((t) => asked.has(t));
  });
};

const titleFor = (node: ArchNode): string => node.label || node.id;

/**
 * Build the concept queue for an ask over a scanned graph.
 *
 * Order is the graph's own edge order — a data-flow edge puts its source before
 * its sink — so a lesson walks the system the way the system runs, not the way
 * a node list happens to sort. Nodes the ask names come first, then their
 * one-hop neighbours in the order the edges appear.
 *
 * Returns an EMPTY queue when the ask names nothing and the graph offers no
 * services, which is the honest answer for an attached article or a maths note:
 * those lessons have no nodes, and this module will not manufacture them. The
 * belt then behaves exactly as it does today.
 */
export function buildQueue(graph: Pick<ArchGraph, 'nodes' | 'edges'>, ask: string): Concept[] {
  /*
   * CONTAINER NODES ARE NOT CONCEPTS, and they are what a repo-shaped ask hits
   * first. Measured: "Teach me how makemore works — bit by bit" produced the
   * queue ["makemore", "makemore"] — the repo and service nodes, twice, because
   * both carry the repository's own name as their label. A turn told its concept
   * is "makemore" has been told nothing.
   *
   * A concept has a FILE behind it. Nodes without a path are containers, and a
   * label shared by more than one node cannot identify either of them.
   */
  const all = graph.nodes ?? [];
  const labelCount = new Map<string, number>();
  for (const n of all) labelCount.set(n.label, (labelCount.get(n.label) ?? 0) + 1);
  /*
   * A CONCEPT IS A FILE, AND `path !== undefined` DOES NOT MEAN THAT.
   *
   * The rule above intended to exclude containers -- its comment says "a
   * concept has a FILE behind it" -- and tested for a path, on the belief that
   * containers have none. They do: measured on this repository, 10 services and
   * 30 modules carry a path, and ALL FORTY have zero edges.
   *
   * So a container could be chosen as the concept, and then `buildConceptChart`
   * correctly drew nothing, because a node with no edges has no relationship to
   * show. Six of the thirteen `sequence` conversations were teaching "harness",
   * "acp", "server" -- module and service names -- and silently getting no
   * picture.
   *
   * makemore never hit it by luck rather than by rule: its service node is
   * labelled `makemore`, the same as its repo node, so the duplicate-label test
   * removed it. The twenty makemore queues are byte-identical after this change
   * -- checked, not assumed -- and the rule is now the one the comment claimed.
   */
  const nodes = all.filter(
    (n) => n.kind === 'file' && n.path !== undefined && (labelCount.get(n.label) ?? 0) === 1,
  );
  const named = nodes.filter((n) => askNames(ask, n));

  /*
   * A CONTAINER NAME IS A SIGNAL, NOT A CONCEPT.
   *
   * "Teach me how makemore works — bit by bit" names the repository, and the
   * only nodes carrying that name are containers this function has just
   * excluded — so the first version returned an empty queue for the very ask
   * the design was written around. Measured: 3 of 5 bank asks got no queue at
   * all, which is why feeding lesson state to the bench changed nothing.
   *
   * Naming the repository says the lesson is ABOUT this repository. Combined
   * with a sequence-shaped ask, that is enough to seed from the repo's own
   * files in edge order. An ask that names neither a file nor the repository
   * still gets nothing: an attached law primer has no place in a queue built
   * from makemore's files, and the empty queue is what keeps it out.
   */
  /*
   * NAMING THE REPOSITORY WITHOUT NAMING A FILE.
   *
   * Measured across the twenty bench conversations: 12 of 20 asks name no node
   * at all — "Teach me what a bigram is and how this repo counts them",
   * "softmax as it appears in this training loop". They are lessons ABOUT this
   * repository that happen to describe the subject rather than the file, which
   * is how a learner talks. Requiring a filename made the queue empty for the
   * majority, and an empty queue is the fragment this module exists to remove.
   *
   * A phrase pointing at the repository is the same signal as naming it: the
   * lesson is about the code that is attached. An ask with NO such reference
   * still gets nothing — "teach me the doctrine of consideration from my
   * attached primer" has no business drawing a queue out of makemore's files.
   */
  const REPO_REFERENCE =
    /\b(this (repo|repository|codebase|project|code)|in this (code|repo|repository|codebase|training loop|implementation|file)|the code here|this training loop|in the repo)\b/i;
  const namesContainer = all.some(
    (n) => n.path === undefined && askNames(ask, n) && (n.label?.length ?? 0) >= 3,
  );
  const aboutThisRepo = namesContainer || REPO_REFERENCE.test(ask);
  const seeds = named.length > 0 ? named : aboutThisRepo ? nodes : [];
  if (seeds.length === 0) return [];

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out: Concept[] = [];
  const seen = new Set<string>();
  const push = (n: ArchNode | undefined): void => {
    if (n === undefined || seen.has(n.id)) return;
    seen.add(n.id);
    out.push({ title: titleFor(n), nodeId: n.id });
  };

  for (const n of seeds) push(n);

  /*
   * A POINTED QUESTION STOPS HERE. "Why is the dot marker used at both ends"
   * names one node and wants one explanation; adding its neighbours would turn
   * a question into a syllabus the learner never asked for.
   *
   * A REQUEST FOR A LESSON DOES NOT STOP HERE, even without a sequence phrase —
   * see TEACH_ASK above for the measurement that changed this line. The test is
   * "was I asked to teach", not "did the ask contain the words bit by bit".
   */
  if (!SEQUENCE_ASK.test(ask) && !TEACH_ASK.test(ask)) return out.slice(0, 1);

  const edges: readonly ArchEdge[] = graph.edges ?? [];
  for (const e of edges) {
    if (seen.has(e.srcId)) push(byId.get(e.dstId));
    if (seen.has(e.dstId)) push(byId.get(e.srcId));
    if (out.length >= MAX_QUEUE) break;
  }
  return out.slice(0, MAX_QUEUE);
}

/**
 * A LESSON REQUEST WITH NO SUBJECT — refuse, and name what is missing.
 *
 * Designed in `docs/research/design-the-subjectless-lesson.md` before it was
 * built. Four of the thirteen bench asks name no file and carry no repository
 * reference, so `buildQueue` returns nothing for them — before the walk and
 * after it, because there is nothing to walk from.
 *
 * ── WHAT THEY GET WITHOUT THIS, AND WHY IT IS WORSE THAN NOTHING ─────────
 *
 * Not silence. Measured in `seq-new-2`: 87 to 242 words a turn, every one with
 * no concept and no picture, in which the model paraphrases the architecture
 * digest — twice returning the SAME sentence in two different conversations,
 * and once volunteering "the full file list wasn't scanned. I can describe
 * what's...". So the learner is handed confident prose with nothing behind it
 * and no sign that no subject was ever found. A guess wearing the clothes of a
 * grounded answer is the exact failure this product's first law forbids.
 *
 * ── WHY A REFUSAL AND NOT A SEEDED SUBJECT ───────────────────────────────
 *
 * The obvious seeds were measured first and both are wrong. "Entry points" as
 * zero-inbound nodes means "nothing imports it", which on a repository with
 * tests is every test — the top six roots here are all `.test.tsx`. And
 * most-depended-on gives a barrel (`index.ts`, 253 inbound), a list of names
 * that teaches nothing about the system. A filtered ranking produces plausible
 * subjects, but every exclusion is a rule invented to make one repository look
 * good, and a seed that is not grounded in the ask substitutes a subject the
 * learner cannot see being substituted. **A wrong subject delivered confidently
 * is worse than no subject delivered honestly**, and only the refusal can be
 * wrong visibly. A seeder may sit in front of this later; the refusal stays as
 * the fallback for when the seeder also finds nothing.
 *
 * Returns the refusal text, or undefined when there is nothing to refuse.
 */
/**
 * THE MOST CONNECTED FILES IN THIS SCAN — the ones a lesson can actually draw.
 *
 * Degree, not name, because what makes a concept teachable here is that it has
 * relationships to show: `buildConceptChart` draws one hop around its focus, so
 * a file with no edges yields a lone box, and §10's control is that a drawing of
 * an ARCHITECTURE needs edges rather than just nodes. Degree ≥ 1 is therefore
 * the honest floor, and it is checked rather than assumed —
 * `teach-refusal-names-real-subjects.test.ts` builds a chart for every name this
 * returns and requires at least one link.
 *
 * Ties break alphabetically so the same repository always suggests the same
 * files and two runs can be compared.
 */
function drawableSubjects(
  graph: Pick<ArchGraph, 'nodes' | 'edges'> | undefined,
  limit = 3,
): string[] {
  if (graph === undefined) return [];
  const degree = new Map<string, number>();
  for (const edge of graph.edges ?? []) {
    degree.set(edge.srcId, (degree.get(edge.srcId) ?? 0) + 1);
    degree.set(edge.dstId, (degree.get(edge.dstId) ?? 0) + 1);
  }
  return (graph.nodes ?? [])
    .filter((n) => n.kind === 'file' && (degree.get(n.id) ?? 0) > 0)
    .map((n) => ({
      base: String(n.path ?? n.label ?? n.id).replace(/\\/g, '/').split('/').pop() ?? '',
      d: degree.get(n.id) ?? 0,
    }))
    .filter((x) => x.base !== '')
    .sort((a, b) => b.d - a.d || a.base.localeCompare(b.base))
    .slice(0, limit)
    .map((x) => x.base);
}

/**
 * Words too common to mean anything as a filename match.
 *
 * Deliberately small: it holds the ask's own scaffolding ("teach me what … is")
 * and nothing domain-specific, because a stop list that grew opinions would
 * start deciding which subjects are teachable.
 */
const ASK_STOPWORDS = new Set(
  ('teach me the what a an is are how why and it this here in of to from does do when they its be ' +
    'for on that which you i about using as example real code repo repository codebase step by bit ' +
    'depth visually exists exist spends loop demands works work show tell explain lesson').split(' '),
);

/**
 * FILES WHOSE NAME CARRIES A WORD FROM THE ASK.
 *
 * `buildQueue` matches filenames, so a subject named by CONCEPT rather than by
 * file produces an empty queue — and the refusal was reporting that as "not in
 * this repository". Measured on the refusal's own registered bank: all four asks
 * it fires on have their subject in the tree (`verifyGate.ts`, `askTools.ts`,
 * `explain.ts`), and a word match off the ask finds every one.
 *
 * IT RETURNS THE WORD IT MATCHED, and the caller states it. The same match
 * offers `learningLoop.ts` for "machine learning" — the autonomous loop, nothing
 * to do with the subject — and from inside the check that is indistinguishable
 * from the good cases. Showing the word is what lets a reader see that only a
 * generic term matched, and it is the difference between a suggestion and a
 * claim.
 */
function askRelatedSubjects(
  graph: Pick<ArchGraph, 'nodes' | 'edges'> | undefined,
  ask: string,
  limit = 3,
): { word: string; files: string[] } | undefined {
  if (graph === undefined) return undefined;
  const words = [...new Set(ask.toLowerCase().match(/[a-z][a-z0-9]{2,}/g) ?? [])].filter(
    (w) => !ASK_STOPWORDS.has(w),
  );
  if (words.length === 0) return undefined;
  const degree = new Map<string, number>();
  for (const edge of graph.edges ?? []) {
    degree.set(edge.srcId, (degree.get(edge.srcId) ?? 0) + 1);
    degree.set(edge.dstId, (degree.get(edge.dstId) ?? 0) + 1);
  }
  const hits: { base: string; word: string; test: boolean; d: number }[] = [];
  const seen = new Set<string>();
  for (const n of graph.nodes ?? []) {
    if (n.kind !== 'file') continue;
    const full = String(n.path ?? n.label ?? n.id).replace(/\\/g, '/');
    const base = full.split('/').pop() ?? '';
    if (base === '' || seen.has(base)) continue;
    /* Drawable, for the same reason the fallback is: a file with no edges gives
       the reader a lone box when they follow the suggestion. */
    const d = degree.get(n.id) ?? 0;
    if (d === 0) continue;
    const lower = base.toLowerCase();
    const word = words.find((w) => lower.includes(w));
    if (word === undefined) continue;
    seen.add(base);
    hits.push({ base, word, test: /\.test\.|[/.]test[/.]|__tests__/.test(full.toLowerCase()), d });
  }
  if (hits.length === 0) return undefined;
  /* Source before tests: a test named for a concept is evidence about it, but
     the file that IMPLEMENTS the concept is the lesson. Then by degree, then
     alphabetically so two runs of the same repository agree. */
  hits.sort((a, b) => Number(a.test) - Number(b.test) || b.d - a.d || a.base.localeCompare(b.base));
  /*
   * ONE WORD, AND ONLY THE FILES THAT MATCHED IT.
   *
   * The first version took the top three hits and announced the FIRST one's
   * word, so "the verify contract" produced: these files have "verify" in their
   * name — verifyGate.ts, verifyGate.test.ts, teach-contract-end-to-end.test.ts.
   * The third matched "contract", not "verify", and the sentence was simply
   * false about it. Caught in a seat check, not by a test, which is why the test
   * for it exists now.
   *
   * The claim and the list have to be the same thing: filter to the chosen
   * word so every name the sentence covers really does carry it.
   */
  const word = hits[0]!.word;
  const files = hits.filter((h) => h.word === word).slice(0, limit).map((h) => h.base);
  return { word, files };
}

export function subjectlessRefusal(
  ask: string,
  queue: readonly Concept[],
  graph?: Pick<ArchGraph, 'nodes' | 'edges'>,
): string | undefined {
  /*
   * GATED ON "WAS I ASKED TO TEACH", NOT ON "IS THE QUEUE EMPTY".
   *
   * A pointed question with no match in the graph ("Why does the retry flag
   * exist?") also has an empty queue, and handing it a refusal written for
   * lessons would answer a question it never asked. That ask keeps today's
   * behaviour — a known gap, named in the design page rather than hidden, and
   * pinned by its own case.
   */
  if (!TEACH_ASK.test(ask)) return undefined;
  if (queue.length > 0) return undefined;
  const opening =
    'I could not find a subject for this lesson in the scanned repository: nothing in the ask ' +
    'names a file, and nothing points at the repository itself.\n\n';
  /*
   * BOTH REMEDIES SURVIVE. These are the two signals `buildQueue` actually uses
   * — a file, or a reference to the repository — and naming only one leaves the
   * reader guessing at the other. The first draft of this change dropped the
   * file remedy along with the fabricated filename and `subjectless-lesson`
   * case 1 caught it; what had to go was the invented EXAMPLE, not the remedy.
   */
  const tail =
    'Or name a file from this repository in your ask, or say the lesson is about this code, as ' +
    'in "...in this repo", and I will start from the graph.';
  /*
   * THE SUGGESTION USED TO BE `jail.ts`, HARDCODED — and that is a file in THIS
   * repository and in nobody else's. The one concrete thing the product offered,
   * at the exact moment it was admitting it could not find a subject, was a
   * guess: the first law broken inside the message whose whole job is honesty.
   *
   * §10 established that the drawing is not the gap — the architecture IS drawn
   * whenever the concept is in the graph — so for an out-of-graph subject the
   * refusal IS the deliverable, and a refusal that shrugs is the worst outcome
   * available: the reader cannot tell whether the product failed, is thinking,
   * or has nothing to say. It has 1,101 nodes to enumerate from; it should say
   * what it CAN teach.
   *
   * NO GRAPH, NO NAMES. Without a scan there is nothing to enumerate, and
   * reaching for an example there would be the same bug again.
   */
  /*
   * THE ASK'S OWN WORDS FIRST. Measured on the registered bank: all four asks
   * this refusal fires on have their subject in the tree, and the most-connected
   * list pointed every one of them at `index.ts, repoServer.ts, scan.ts` — a
   * confident answer to a question nobody asked. A related file, with the word
   * that found it stated, is the honest version.
   */
  const related = askRelatedSubjects(graph, ask);
  if (related !== undefined) {
    const list = related.files.join(', ');
    return (
      opening +
      `I did not build a lesson from it, but these files have "${related.word}" in their name and ` +
      `may be what you meant: ${list}. Naming one of them directly — "teach me ${related.files[0]}" ` +
      `— will start a lesson from the graph.`
    );
  }
  const subjects = drawableSubjects(graph);
  if (subjects.length === 0) return opening + tail;
  const named =
    subjects.length === 1
      ? `"teach me ${subjects[0]}"`
      : `${subjects.slice(0, -1).map((s) => `"teach me ${s}"`).join(', ')} or "teach me ${subjects[subjects.length - 1]}"`;
  return (
    opening +
    `This repository does have subjects I can draw — the most connected files in the scan are ` +
    `${subjects.join(', ')}. Try ${named}. ${tail}`
  );
}

/**
 * CARRY (or clear) THE PREDICTION A TURN LEFT OPEN.
 *
 * The next-picture check-in is a TWO-TURN contract: turn N asks which file would
 * break, turn N+1 reveals the answer and names the arrow it came from. The
 * question is derived at the end of turn N and nothing recomputes it at N+1 —
 * re-deriving would answer about whatever concept is current then, which may not
 * be the one the learner was asked about, and a true sentence in the wrong place
 * is worse than none.
 *
 * SO THE PREDICTION HAS TO RIDE THE LESSON, and that is one rule. It lived
 * inline in `teachTurn.finish` and the bench had no copy at all, so
 * `tools/bench/teach-eval.mjs` asked seven next-picture questions across two card
 * runs and produced ZERO reveals — not rarely, never, because nothing carried
 * `open` from one turn to the next. The band those runs were meant to score had
 * no denominator. Extracted here so both callers apply the same rule and a third
 * caller cannot invent a fourth.
 *
 * `undefined` CLEARS it. A turn that asked nothing must not leave the previous
 * turn's question standing, or the reveal arrives a turn late and answers a
 * question the learner was never asked.
 */
/**
 * DID THIS TURN TEACH? — the one definition, for the product and the bench.
 *
 * ── THE RULING, 2026-09-06 ────────────────────────────────────────────────
 *
 * A turn that wrote a lesson and drew its chart HAS TAUGHT, and the queue
 * advances on that, whether or not it managed to ask a check-in.
 *
 * It used to require the check-in too, and that coupling stalled the syllabus.
 * Measured on the ceiling arms: over the turns past a lesson's scripted replies,
 * concepts given and charts drawn were IDENTICAL to the first turns — 18 of 26
 * each — while the concept repeated 17 and 18 times out of 18 and the queue never
 * moved from 6. No check-in meant no advance, so the same concept was re-taught
 * and the same picture redrawn, and every surface said the lesson was working.
 *
 * The check-in stays a separate feature. Its absence is a defect in the turn; it
 * is not a reason to freeze the lesson behind it.
 *
 * ── WHY IT IS HERE AND NOT AT ITS TWO CALL SITES ─────────────────────────
 *
 * `teachTurn.finish` and `tools/bench/teach-eval.mjs` each computed this
 * separately, and had already drifted once: the bench advanced on a trailing
 * question mark while the product advanced on an honest check, so a turn closing
 * "would you like me to show the diagram?" consumed a concept in the bench and
 * did not in the product. A rule that lives in two places is one rule until it is
 * measured.
 */
export function taughtThisTurn(input: { visual: boolean; endsWithCheck?: boolean }): boolean {
  /* `endsWithCheck` is accepted and deliberately unused: the callers pass what
     they grade, and a signature that silently dropped it would make the ruling
     invisible at the call site. */
  return input.visual === true;
}

export function carryPrediction(
  lesson: LessonShape,
  openPrediction: { question: string; expect: string; arrow: string } | undefined,
  askedAt: number,
): LessonShape {
  return openPrediction === undefined
    ? { ...lesson, open: undefined }
    : { ...lesson, open: { ...openPrediction, askedAt } };
}

export function newLesson(
  sessionId: string,
  ask: string,
  graph: Pick<ArchGraph, 'nodes' | 'edges'> | undefined,
  known?: string,
): LessonShape {
  const queue = graph ? buildQueue(graph, ask) : [];
  return {
    version: 1,
    sessionId,
    subject: {
      ask,
      nodeIds: queue.map((c) => c.nodeId).filter((x): x is string => x !== undefined),
    },
    queue,
    taught: [],
    known,
  };
}

/** The concept this turn should deliver, or undefined when the lesson is done. */
export function nextConcept(lesson: LessonShape | undefined): Concept | undefined {
  return lesson?.queue[0];
}

/**
 * The lesson has delivered everything it planned. Reported rather than hidden:
 * a "continue" with nothing queued deserves the honest sentence, not a
 * fragment.
 */
export function lessonExhausted(lesson: LessonShape | undefined): boolean {
  return lesson !== undefined && lesson.queue.length === 0 && lesson.taught.length > 0;
}

/**
 * Advance the queue — ONLY when the turn actually taught.
 *
 * `passed` is the grader's own verdict, not a guess made here. A turn the
 * harness bounced does not consume a concept: the next turn re-teaches it, which
 * is what the existing one-bounce loop already does for the text, now with the
 * concept staying put underneath it.
 *
 * Returns a NEW object; the caller writes it. Mutating in place would let a
 * failed write leave memory ahead of disk, which is the reload bug this whole
 * file exists to avoid.
 */
export function advanceLesson(
  lesson: LessonShape,
  outcome: { passed: boolean; turn: number },
): LessonShape {
  if (!outcome.passed || lesson.queue.length === 0) return lesson;
  const [head, ...rest] = lesson.queue;
  return {
    ...lesson,
    queue: rest,
    taught: [...lesson.taught, { ...head, turn: outcome.turn }],
  };
}

/* ------------------------------------------- source three: the model's plan -- */

/**
 * THE OPENING-TURN PLAN, for asks the graph cannot order.
 *
 * Measured across the twenty bench conversations: 12 of 20 asks name no node and
 * are not sequence-shaped, so neither the ask nor the graph can produce a queue.
 * An attached law primer is the clearest case — its concepts live in the
 * article, and no amount of edge-walking will find them.
 *
 * For those, the model writes the plan ONCE, at the opening turn, and the
 * pipeline stores it. Never re-asked: a plan re-derived each turn is not a plan,
 * it is a fresh opinion, and the lesson would wander.
 *
 * VALIDATED THE WAY A CHART IS. A concept may carry a nodeId, and if it does the
 * id must be a real node — the same refusal `propose_chart` applies, for the
 * same reason: a lesson that claims to be about `softmax_output` when no such
 * node exists is inventing structure. A concept with NO nodeId is fine and
 * common: the law primer's concepts have no file behind them, and demanding one
 * would make the source useless for the case it exists to serve.
 *
 * A plan with ANY invented id is refused WHOLE. Accepting the good half would
 * leave a queue the learner cannot see, half of which points at nothing.
 */
export interface PlanResult {
  ok: boolean;
  concepts: Concept[];
  /** Why it was refused, in the same shape propose_chart uses. */
  reason?: string;
}

export function validatePlan(raw: unknown, knownNodeIds: ReadonlySet<string> | undefined): PlanResult {
  const list = Array.isArray(raw)
    ? raw
    : ((raw as { concepts?: unknown } | null)?.concepts ?? null);
  if (!Array.isArray(list) || list.length === 0) {
    return { ok: false, concepts: [], reason: 'a plan needs at least one concept' };
  }
  const concepts: Concept[] = [];
  const invented: string[] = [];
  for (const entry of list) {
    if (entry === null || typeof entry !== 'object') continue;
    const title = (entry as { title?: unknown }).title;
    if (typeof title !== 'string' || title.trim() === '') {
      return { ok: false, concepts: [], reason: 'every concept needs a title' };
    }
    const nodeId = (entry as { nodeId?: unknown }).nodeId;
    if (nodeId !== undefined && nodeId !== null) {
      if (typeof nodeId !== 'string') {
        return { ok: false, concepts: [], reason: 'nodeId must be a string when present' };
      }
      if (knownNodeIds !== undefined && !knownNodeIds.has(nodeId)) {
        invented.push(nodeId);
        continue;
      }
      concepts.push({ title: title.trim(), nodeId });
      continue;
    }
    concepts.push({ title: title.trim() });
  }
  if (invented.length > 0) {
    return {
      ok: false,
      concepts: [],
      reason:
        `${invented.map((x) => JSON.stringify(x)).join(', ')} ` +
        `${invented.length === 1 ? 'is not a node' : 'are not nodes'} in this repository — ` +
        'a plan may not invent structure. Omit the nodeId for a concept that has no file behind it.',
    };
  }
  return { ok: true, concepts: concepts.slice(0, MAX_QUEUE) };
}

/**
 * Install a validated plan — ONLY into a lesson that has no queue.
 *
 * A plan never overwrites a queue the graph produced, and never replaces itself
 * on a later turn. Both would let the lesson wander away from what the learner
 * was promised at the opening turn.
 */
export function applyPlan(lesson: LessonShape, concepts: readonly Concept[]): LessonShape {
  if (lesson.queue.length > 0 || lesson.taught.length > 0 || concepts.length === 0) return lesson;
  return {
    ...lesson,
    queue: [...concepts],
    subject: {
      ...lesson.subject,
      nodeIds: concepts.map((c) => c.nodeId).filter((x): x is string => x !== undefined),
    },
  };
}

/** Does this lesson still need a plan? The belt asks for one only when it does. */
export function needsPlan(lesson: LessonShape | undefined): boolean {
  return lesson !== undefined && lesson.queue.length === 0 && lesson.taught.length === 0;
}

/**
 * What touches the concept just taught — the proposal a finished one-concept
 * lesson offers instead of a fragment.
 *
 * One hop, from the graph, so the suggestion is grounded in something real
 * rather than invented to fill a turn.
 */
/**
 * THE ONE PLACE `teachContext` IS ASSEMBLED.
 *
 * It used to be assembled twice — once in the ask handler from `lesson.json`,
 * once in `tools/bench/teach-eval.mjs` from an in-memory lesson — and the two
 * drifted. The product passed `lessonDone: {}` where the bench passed
 * `lessonDone: { neighbours }`, and an empty object takes the belt's OTHER
 * branch: ask the learner what they want next, instead of proposing a grounded
 * step from what touches the last concept. That is the turn shape of 10 of the
 * 20 bench conversations, so every belt number on record was measured against a
 * contract the product did not render on the commonest follow-up there is.
 *
 * A test comparing the two assemblies would have been a mirror of both and
 * could not fail when either moved. One function can: drift is now a
 * compile-time impossibility rather than something a gate has to notice.
 */
export function buildTeachContext(input: {
  lesson?: LessonShape;
  graph?: Pick<ArchGraph, 'nodes' | 'edges'>;
  known?: string;
  beltVariant?: 'full' | 'short' | 'mid' | 'pad';
}): Record<string, unknown> {
  const { lesson, graph, known, beltVariant } = input;
  const concept = nextConcept(lesson);
  /*
   * THE ONE AFTER THIS ONE. `queue[0]` is what this turn delivers, so `queue[1]`
   * is the concept whose picture the product already holds and has not shown.
   * Carried only so the next-picture check-in can ask about it; nothing renders
   * it, and no chart for it is emitted this turn.
   */
  const upcoming = lesson?.queue[1];
  const taught = lesson?.taught.map((t) => t.title) ?? [];
  return {
    ...(upcoming !== undefined ? { nextConcept: upcoming } : {}),
    /* The prediction the LAST turn left open, so this turn can reveal it. */
    ...(lesson?.open !== undefined ? { open: lesson.open } : {}),
    ...(known !== undefined && known !== '' ? { known } : {}),
    ...(beltVariant !== undefined ? { beltVariant } : {}),
    ...(concept !== undefined ? { concept } : {}),
    /*
     * A REPOSITORY IS ATTACHED AND THE SUBJECT IS NOT IN IT — the one case
     * nothing had an answer for.
     *
     * Measured §12: asked "what is machine learning" with teach on, the turn
     * answered "ML is defined in mod:analyzer/3 ... packages/analyzer/src/llm/"
     * — the LLM client — and presented it as a lesson. The belt demands
     * "Ground the concept in THIS repository", and for a subject the scan does
     * not contain there is no honest way to obey that. The model did not ignore
     * the contract; it followed the contract into a fabrication.
     *
     * MEASURED COST, 2026-09-10, and it is named here rather than in a commit
     * message because the flag's name overstates what it knows. `buildQueue`
     * matches FILENAMES, so an empty queue means "no filename matched", NOT
     * "absent from this repository" — the same conflation this lane already
     * measured in the refusal. Run over the 13 registered bank asks, this flag
     * fires on FOUR whose subjects are demonstrably here: harness-03 (the verify
     * contract, `verifyGate.ts`), harness-05 and harness-06 (`askTools.ts`), and
     * harness-08 (`explain/explain.ts`). They are named by concept rather than
     * by file, and the queue cannot see that.
     *
     * So nothing downstream may claim the subject is ABSENT. The belt slot and
     * the chart caption both state PROVENANCE instead — "general knowledge, not
     * from this repository's scan" — which is true whether or not the subject
     * also happens to live here. Those four still get a remembered picture where
     * a graph one would be better, which is a real cost and a `buildQueue`
     * problem, not something the caption should paper over.
     *
     * A LESSON whose queue came back empty, with a graph to have searched, is
     * exactly that situation. It is distinct from three neighbours, and the
     * third cost a test:
     *   - no graph at all is design mode, and the plot builders cover it;
     *   - a queue with a head is an ordinary grounded lesson;
     *   - NO LESSON AT ALL is not this case either. The first draft omitted that
     *     and set the flag whenever `concept` was undefined, which invented a
     *     claim about the repository out of the absence of a `lesson.json` —
     *     caught by `ask-teach-context-equivalence`'s "no lesson yields an empty
     *     context — never an invented finished one", which is the same rule this
     *     flag exists to serve.
     */
    ...(graph !== undefined && lesson !== undefined && concept === undefined
      ? { subjectNotInRepo: true as const }
      : {}),
    ...(taught.length > 0 ? { taught } : {}),
    ...(needsPlan(lesson) ? { needsPlan: true } : {}),
    ...(lessonExhausted(lesson)
      ? {
          lessonDone: {
            neighbours: neighboursOf(graph, lesson?.taught[lesson.taught.length - 1]?.nodeId),
          },
        }
      : {}),
  };
}

export function neighboursOf(
  graph: Pick<ArchGraph, 'nodes' | 'edges'> | undefined,
  nodeId: string | undefined,
): string[] {
  if (graph === undefined || nodeId === undefined) return [];
  const byId = new Map((graph.nodes ?? []).map((n) => [n.id, n]));
  const out: string[] = [];
  for (const e of graph.edges ?? []) {
    const other = e.srcId === nodeId ? e.dstId : e.dstId === nodeId ? e.srcId : undefined;
    const n = other === undefined ? undefined : byId.get(other);
    if (n !== undefined && n.path !== undefined && !out.includes(n.label)) out.push(n.label);
  }
  return out.slice(0, 4);
}
