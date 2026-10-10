/* ══════════════════════════════════════════════════════════════════════════
   WHAT ONE TURN HANDS THE NEXT
   packages/analyzer/src/server/turnCarry.ts

   ── WHAT IT ADDS ─────────────────────────────────────────────────────────

   The prompt already carries prior PROSE, and the product also carries the
   NAMES of files read, work verbs and proposal titles. What nothing carries is
   the material itself: the content of a file that was read, the structure of the
   chart that was drawn, and what was actually taught about a concept.

   So a turn that read `brief.ts` hands the next turn the name `brief.ts`, a
   paragraph of its own prose about it, and none of `brief.ts`. The next turn
   reads it again, or answers without it. Measured on this repository: 5.4
   provider calls a turn, each carrying ~5,300 tokens of which 5,330 are the
   digest and the instruction belt rebuilt unchanged.

   This carries the three things the re-read exists to recover:

     · files ALREADY READ, with the excerpt that was read
     · the chart ALREADY DRAWN, as its focus and neighbours rather than a title
     · concepts ALREADY TAUGHT, with the one line that was said about each

   ── WHAT IT REFUSES TO CARRY ─────────────────────────────────────────────

   Anything not traceable to a real event in a real turn. A carry is prompt
   material, and prompt material that nobody produced is the same fabrication as
   an invented edge — the first law does not stop at the answer. `note` on a
   taught concept is the turn's own first sentence, never a summary this module
   writes.

   ── WHY IT IS BOUNDED, AND HOW ───────────────────────────────────────────

   A twenty-turn lesson must not grow the prompt without limit. Oldest detail
   DEGRADES before it is dropped: an excerpt becomes a name, and only then does
   the entry leave. Dropping is reported in the rendered block, because a model
   told nothing about what it has forgotten will speak as though it forgot
   nothing — the same rule as the memory-trimmed marker on prior chat.
   ══════════════════════════════════════════════════════════════════════════ */

/** One file this conversation has already read. */
export interface CarriedFile {
  path: string;
  /** The excerpt that was read, or absent once it has degraded to a name. */
  excerpt?: string;
  /** The turn it was read on, so the block can say how old it is. */
  turn: number;
}

/** The picture the conversation last drew, as structure rather than a title. */
export interface CarriedChart {
  title: string;
  focus: string;
  neighbours: readonly string[];
  turn: number;
}

/** A concept already taught, with the turn's own opening line. */
export interface CarriedConcept {
  title: string;
  /** The turn's first sentence, verbatim. Never written by this module. */
  note?: string;
  turn: number;
}

export interface TurnCarry {
  files: readonly CarriedFile[];
  chart?: CarriedChart;
  concepts: readonly CarriedConcept[];
  /** The last list an answer was built from. See THE FOURTH SLOT below. */
  referents?: CarriedReferents;
  /** How many entries have been dropped entirely, for the honest marker. */
  dropped: number;
}

export const EMPTY_CARRY: TurnCarry = { files: [], concepts: [], dropped: 0 };

/** Caps, chosen so a long lesson cannot outgrow the prompt it rides in. */
const MAX_FILES = 8;
const MAX_CONCEPTS = 8;
const MAX_EXCERPT = 600;
/** Beyond this many files, the oldest keep their names and lose their excerpts. */
const FULL_EXCERPTS = 3;

const firstSentence = (text: string): string | undefined => {
  const t = text.trim();
  if (t === '') return undefined;
  const m = /^(.{20,300}?[.!?])(\s|$)/s.exec(t);
  return (m?.[1] ?? t.slice(0, 300)).replace(/\s+/g, ' ').trim();
};

/**
 * Fold one turn's real events into the carry.
 *
 * Every argument is something the turn actually produced. A caller with nothing
 * to add passes nothing and gets the carry back unchanged, which is what makes
 * a refused or errored turn leave no trace.
 */
export function extendCarry(
  carry: TurnCarry,
  turn: number,
  found: {
    filesRead?: readonly { path: string; excerpt?: string }[];
    chart?: { title: string; focus: string; neighbours: readonly string[] };
    concept?: { title: string; text?: string };
    referents?: { tool: string; subject: string; items: readonly string[]; total: number };
  },
): TurnCarry {
  const byPath = new Map(carry.files.map((f) => [f.path, f]));
  for (const f of found.filesRead ?? []) {
    if (typeof f?.path !== 'string' || f.path.trim() === '') continue;
    byPath.set(f.path, {
      path: f.path,
      turn,
      ...(typeof f.excerpt === 'string' && f.excerpt.trim() !== ''
        ? { excerpt: f.excerpt.slice(0, MAX_EXCERPT) }
        : {}),
    });
  }
  let files = [...byPath.values()].sort((a, b) => a.turn - b.turn);
  let dropped = carry.dropped;
  /* DEGRADE, THEN DROP. The oldest entries lose their excerpt first, so a name
     survives long after the text does — a name is enough to say "already read"
     and stop a re-read, which is most of the value. */
  if (files.length > FULL_EXCERPTS) {
    const keepFull = files.slice(-FULL_EXCERPTS);
    const degraded = files.slice(0, -FULL_EXCERPTS).map(({ path, turn: t }) => ({ path, turn: t }));
    files = [...degraded, ...keepFull];
  }
  if (files.length > MAX_FILES) {
    dropped += files.length - MAX_FILES;
    files = files.slice(-MAX_FILES);
  }

  const concepts = [...carry.concepts];
  if (found.concept?.title) {
    const note = found.concept.text === undefined ? undefined : firstSentence(found.concept.text);
    const at = concepts.findIndex((c) => c.title === found.concept!.title);
    const entry: CarriedConcept = { title: found.concept.title, turn, ...(note ? { note } : {}) };
    if (at >= 0) concepts[at] = entry;
    else concepts.push(entry);
  }
  let kept = concepts;
  if (kept.length > MAX_CONCEPTS) {
    dropped += kept.length - MAX_CONCEPTS;
    kept = kept.slice(-MAX_CONCEPTS);
  }

  /*
   * REFERENTS REPLACE rather than accumulate. "Those" in a follow-up means the
   * list the LAST answer produced; keeping a stack of older lists would make
   * the pronoun ambiguous in the prompt in exactly the way it was ambiguous in
   * the conversation. A turn that produces no list keeps the previous one,
   * because the follow-up may be two turns downstream.
   */
  const referents: CarriedReferents | undefined = found.referents
    ? {
        tool: found.referents.tool,
        subject: found.referents.subject,
        items: found.referents.items.slice(0, MAX_REFERENTS),
        total: found.referents.total,
        turn,
      }
    : carry.referents;

  return {
    files,
    concepts: kept,
    dropped,
    ...(referents ? { referents } : {}),
    ...(found.chart ? { chart: { ...found.chart, turn } } : carry.chart ? { chart: carry.chart } : {}),
  };
}

/**
 * The block that goes in the prompt, or an empty array when nothing is carried.
 *
 * Empty is the honest answer for a fresh conversation: a header promising
 * continuity with nothing under it invites the model to invent the continuity.
 */
export function renderCarry(carry: TurnCarry | undefined): string[] {
  if (carry === undefined) return [];
  const { files, chart, concepts, referents, dropped } = carry;
  if (files.length === 0 && concepts.length === 0 && chart === undefined && referents === undefined)
    return [];
  const lines = [
    dropped > 0
      ? `--- ALREADY IN THIS CONVERSATION (${dropped} older item${dropped === 1 ? '' : 's'} dropped) ---`
      : '--- ALREADY IN THIS CONVERSATION ---',
  ];
  for (const f of files) {
    lines.push(
      f.excerpt === undefined
        ? `Read ${f.path} (turn ${f.turn}) — text no longer carried; do not re-read to confirm it exists`
        : `Read ${f.path} (turn ${f.turn}):\n${f.excerpt}`,
    );
  }
  if (chart !== undefined) {
    lines.push(
      `Drew "${chart.title}" (turn ${chart.turn}): ${chart.focus} with ${
        chart.neighbours.length === 0 ? 'no neighbours' : chart.neighbours.join(', ')
      }`,
    );
  }
  for (const c of concepts) {
    lines.push(c.note === undefined ? `Taught ${c.title} (turn ${c.turn})` : `Taught ${c.title} (turn ${c.turn}): ${c.note}`);
  }
  if (referents !== undefined) {
    /*
     * SAYS HOW MANY OF HOW MANY. Eight names out of 84 rendered as a bare list
     * is a model's invitation to answer "which one first" as though it had seen
     * all 84 -- the denominator travels with the number, in a prompt as much as
     * in a report. And it says these are NAMES: the files were not read, so an
     * answer describing what is inside one of them is inventing it.
     */
    const shown = referents.items.length;
    const of = shown < referents.total ? ` (${shown} of ${referents.total})` : ` (${referents.total})`;
    /*
     * DESCRIBE OR INSTRUCT — the last untested variable.
     *
     * Twelve informative arms established that SHOWING the list does not get it
     * used: three positions, two question wordings, zero mentions of the names
     * only this block holds. The block has always DESCRIBED itself. Whether an
     * INSTRUCTION changes that is a different intervention, and it is one line.
     *
     * The honesty clause survives in both voices. It is a fabrication guard, not
     * decoration: the files were not read, and an answer describing what is
     * inside one of them is inventing it. An instruction to USE a list must not
     * become licence to invent its contents.
     *
     * Registered in docs/research/carry-instruct-registration.md.
     */
    lines.push(
      carryVoice() === 'instruct'
        ? `USE THIS LIST to answer the next question about "${referents.subject}"${of}: ` +
            `${referents.items.join(', ')}. When the question says "those", "which one" or "of them", ` +
            'answer with one of these names rather than from earlier prose. ' +
            'Names only, from the scanned graph; their contents were not read.'
        : `Answered "${referents.subject}" from ${referents.tool} (turn ${referents.turn})${of} -- ` +
            `a follow-up saying "those" or "which one" means these: ${referents.items.join(', ')}. ` +
            'Names only, from the scanned graph; their contents were not read.',
    );
  }
  return lines;
}

/* ══════════════════════════════════════════════════════════════════════════
   THE FOURTH SLOT — THE PREVIOUS ANSWER'S REFERENTS

   The other three slots carry what the turn READ, DREW or TAUGHT. None of them
   carries what the turn's answer was ABOUT, and that is the thing a follow-up
   question points at.

   The seat read of 2026-09-06: turn 1 asked which files depend on `scan.ts` and
   answered from a `who_calls` result — five names and a count of 84. Turn 2
   asked "of those, which one would I have to change first?" **The carry had no
   slot for a tool result at all**, so the word "those" referred to something the
   next turn had never been given. It ranked nothing and told the engineer to
   edit `scan.ts`, the file they already knew about.

   This slot is names and a count, not bytes: eight names and "84" is under 40
   tokens, and it is the exact object the next question is about.

   THE CAP IS 8 AND WAS REGISTERED BEFORE THE RUN — see
   `docs/research/carry-redesign-registration.md`. It is stated here so it
   cannot later be chosen to flatter a result. The treatment arm plants the
   item the follow-up must name INSIDE the cap; the control arm plants it
   BEYOND, and the two differ in that position and nothing else.

   NAMES ARE CARRIED AS NAMES. The model gets a list it may refer to, never a
   claim about what is in those files — it has not read them. That is the
   registered fabrication risk of this change and the reason the rendering says
   what the list is and where it came from.
   ══════════════════════════════════════════════════════════════════════════ */

/** Registered before the run. Do not tune this to a result. */
export const MAX_REFERENTS = 8;

/**
 * Whether the referent block DESCRIBES itself or INSTRUCTS the model to use it.
 *
 * Default `describe` — the shipped wording and the one twelve arms measured. A
 * function rather than a constant so a test can vary it in-process.
 */
export const carryVoice = (): 'describe' | 'instruct' =>
  process.env.SEQUENCE_ASK_CARRY_VOICE === 'instruct' ? 'instruct' : 'describe';

export interface CarriedReferents {
  tool: string;
  subject: string;
  items: string[];
  /** The FULL size, which is usually larger than `items` after the cap. */
  total: number;
  turn: number;
}

/* ══════════════════════════════════════════════════════════════════════════
   WHICH SLOTS A TURN CAN ACTUALLY FILL

   The carry has three slots and every one of them is written behind a gate
   that lives somewhere else in the pipeline. Read together — which nobody had
   done until 2026-09-06 — those gates say something the module header does
   not:

     · `filesRead`  is written ONLY by the issue-driven pre-read, which needs
                    edit intent, auto-write permission, AND a path containing a
                    slash (a bare `scan.ts` is rejected as ambiguous).
     · `chart`      is written ONLY from `lastChartThisTurn`, and the single
                    assignment to that variable sits inside `input.teach ===
                    true`. A `propose_chart` TOOL call does not set it, so a
                    picture the model draws on an engineer's turn is not
                    recorded.
     · `concept`    is written ONLY from `input.teachContext`, which is
                    constructed nowhere but `teachTurn.ts`.

   So on a first-tier ask — an engineer asking a question about a system, no
   teach mode, no edit intent — ALL THREE are unreachable and the carry is
   empty on every turn, forever. It was measured in stage one as though it were
   carrying something; on that tier it never was.

   `excerptsReachable` exists so that claim is a gate rather than a reading.
   The pre-read in `askPipeline` CALLS it — it is not a copy of the condition,
   because a rule in two handlers is one rule until measured, and this file has
   already paid for that law once.
   ══════════════════════════════════════════════════════════════════════════ */

/** Paths in a question the pre-read will consider. Exported so the gate and the
 *  pre-read cannot disagree about what counts as a path. */
export function pathsNamedIn(question: string): string[] {
  const pathLike = question.match(/[\w][\w./\\-]*\.[a-z]{1,4}\b/g) ?? [];
  const out: string[] = [];
  for (const raw of pathLike) {
    const rel = raw.replace(/\\/g, '/').replace(/^\.\//, '');
    /* Bare names are too ambiguous to resolve — `scan.ts` matches four files. */
    if (rel.includes('/') && !out.includes(rel)) out.push(rel);
  }
  return out;
}

/**
 * Can this turn put a file EXCERPT into the carry at all?
 *
 * Answers the question stage four asks before it spends anything: an
 * experiment about how much of a file to carry is meaningless on a tier that
 * carries no file. Returns false for every ask-intent turn, which is every
 * turn an engineer takes.
 */
export function excerptsReachable(x: {
  askIntent: string;
  autoWrites: boolean;
  question: string;
}): boolean {
  if (x.askIntent !== 'edit') return false;
  if (!x.autoWrites) return false;
  return pathsNamedIn(x.question).length > 0;
}
