/**
 * THE LIE DETECTOR — check an answer against the graph that was supposed to
 * ground it.
 *
 * The first real answer this product ever gave contained a fabrication the
 * graph could have refuted on the spot: it said the system used "MySQL
 * databases" when zero files mention MySQL and `db.py` calls
 * `sqlite3.connect`. Nothing checked, because nothing could. A confident false
 * sentence reads exactly like a true one, and a GROUNDED tool that ships one is
 * worse than no tool — it spends the credibility that grounding was supposed to
 * earn.
 *
 * ── IT ONLY CHECKS WHAT THE GRAPH CAN ACTUALLY REFUTE ────────────────────
 *
 * Most of what a model writes is prose, summary or judgement, and none of that
 * is refutable by a scan. A checker that flagged it would produce warnings
 * nobody reads, which is worse than no checker: it teaches a reader to click
 * past the one warning that mattered. Two categories are genuine CLOSED WORLDS,
 * and this checks those two and stops:
 *
 *   1. DATASTORE TECHNOLOGY. The scan enumerates what it found, so a named
 *      technology that is nowhere in the graph is refutable.
 *   2. CITED FILE PATHS. The scan holds every file it read, so a citation that
 *      resolves to nothing is refutable — and a fabricated citation is the most
 *      corrosive error a grounded tool can make, because the citation is the
 *      thing that was supposed to make the claim checkable.
 *
 * ── A FINDING IS A FLAG, NEVER A VERDICT ─────────────────────────────────
 *
 * "The answer says MySQL; the scan found sqlite" is a fact, and putting it in
 * front of a reader is useful. "The answer is wrong" is a judgement this module
 * is not entitled to make: the model may be contrasting, quoting the user, or
 * discussing a migration. So every finding carries the term, the sentence it
 * appeared in, and what the scan DID find — enough for a person to settle it in
 * one glance — and nothing is suppressed or rewritten on its say-so.
 *
 * ── AND IT REFUSES TO CHECK WHAT IT CANNOT SEE ───────────────────────────
 *
 * A graph with no datastores does not refute MySQL; it is a scan that found no
 * datastores, which is the normal state of a library or a front-end. Flagging
 * there would accuse every such repository of hallucinating whenever a model
 * mentioned a database. The report says which checks actually ran.
 */

import type { ArchGraph } from '@sequence/schema';
import { scanCoverage, canRefuteExtension } from '@sequence/schema';

export interface UnsupportedTechnology {
  /** The technology, lower-cased — `mysql`. */
  term: string;
  /** What the scan DID find, so the correction is in hand and not a lookup. */
  found: string[];
  /** The sentence it appeared in, so a reader can judge intent. */
  quote: string;
}

export interface UnknownPath {
  /** The citation as written. */
  path: string;
  quote: string;
}

export interface ClaimReport {
  unsupportedTechnologies: UnsupportedTechnology[];
  unknownPaths: UnknownPath[];
  hasFindings: boolean;
  /**
   * `checked` when the scan knows at least one engine, so an absent one means
   * something; `none-found` when it knows none, in which case NOTHING was
   * refuted and the empty finding list means "could not check", not "all
   * clear". A graph can hold datastores and know no engine — see the gate.
   */
  datastoreEvidence: 'checked' | 'none-found';
  fileEvidence: 'checked' | 'none-found';
}

/**
 * The technologies worth checking.
 *
 * Deliberately short and deliberately only DATASTORES. It is the category the
 * scan enumerates exhaustively, which is what makes absence meaningful; a
 * vocabulary of frameworks or languages would be guessing at a world the graph
 * does not close over.
 */
const DATASTORE_TECHNOLOGIES: readonly string[] = [
  'mysql',
  'mariadb',
  'postgres',
  'postgresql',
  'sqlite',
  'mongodb',
  'mongo',
  'redis',
  'cassandra',
  'dynamodb',
  'elasticsearch',
  'clickhouse',
  'cockroachdb',
  'neo4j',
];

/** Technologies that are the same thing under two names. */
const ALIASES = new Map<string, string>([
  ['postgresql', 'postgres'],
  ['mongo', 'mongodb'],
  ['mariadb', 'mysql'],
]);

const canonical = (t: string): string => ALIASES.get(t) ?? t;

/** Split into sentences, so a finding can quote the one it came from. */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * A path-shaped token.
 *
 * It requires a SLASH or a known source extension, and that is what keeps "e.g."
 * and "vs." and "under 2ms." out. A regex loose enough to catch every citation
 * would flag ordinary prose, and a checker with a false-positive rate produces
 * a warning nobody reads.
 */
const PATH_RE =
  /\b((?:[\w.-]+\/)+[\w.-]+\.\w{1,5}|[\w-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|cs|kt|swift|sql|yml|yaml|json|toml))\b/g;

export function checkAnswerClaims(answer: string, graph: ArchGraph): ClaimReport {
  const text = answer ?? '';

  /* ── the evidence the graph holds ───────────────────────────────────────── */
  const datastores = graph.nodes.filter((n) => n.kind === 'datastore');
  const filePaths = graph.nodes
    .filter((n) => n.kind === 'file' && typeof n.path === 'string')
    .map((n) => n.path!.replace(/\\/g, '/'));

  /* A technology counts as FOUND if it appears anywhere the scan could record
     it: a datastore's tech, its label, its container image, or a file path.
     Missing one of those would make the checker accuse a repository of not
     using what it plainly uses. */
  const evidenceHaystack = [
    ...datastores.flatMap((n) => {
      const meta = (n.meta ?? {}) as { tech?: unknown; image?: unknown };
      return [
        n.label ?? '',
        typeof meta.tech === 'string' ? meta.tech : '',
        typeof meta.image === 'string' ? meta.image : '',
      ];
    }),
    ...filePaths,
  ]
    .join('\n')
    .toLowerCase();

  const foundTech = [
    ...new Set(
      DATASTORE_TECHNOLOGIES.filter((t) => evidenceHaystack.includes(t)).map(canonical),
    ),
  ].sort();

  /*
   * THE GATE IS "DO WE KNOW ANY ENGINE", NOT "ARE THERE DATASTORES", and the
   * difference is a false positive this checker actually produced.
   *
   * `joinAll` mints an inferred datastore from parsed table accesses and
   * deliberately claims no engine — "a SELECT proves a database is there, not
   * which one it is". So a graph can hold datastores while knowing nothing
   * about what they run. Gating on `datastores.length` treated that as a closed
   * world and reported SQLITE as unsupported on a repository whose only
   * database is SQLite.
   *
   * With no engine known, this checker cannot refute any engine claim, and
   * saying nothing is the only honest output. `detectDbEngines` is what usually
   * makes the world closed after all — the driver call names the engine.
   */
  const datastoreEvidence: ClaimReport['datastoreEvidence'] =
    foundTech.length === 0 ? 'none-found' : 'checked';
  const fileEvidence: ClaimReport['fileEvidence'] =
    filePaths.length === 0 ? 'none-found' : 'checked';

  /* ── 1. technologies the scan never saw ─────────────────────────────────── */
  const unsupportedTechnologies: UnsupportedTechnology[] = [];
  if (datastoreEvidence === 'checked') {
    const seen = new Set<string>();
    for (const sentence of sentences(text)) {
      const lower = sentence.toLowerCase();
      for (const term of DATASTORE_TECHNOLOGIES) {
        /* Word-bounded: `redistribute` contains `redis`, and a substring match
           would flag a licence paragraph. */
        if (!new RegExp(`\\b${term}\\b`, 'i').test(lower)) continue;
        const key = canonical(term);
        if (seen.has(key)) continue;
        if (foundTech.includes(key)) continue;
        seen.add(key);
        unsupportedTechnologies.push({ term: key, found: foundTech, quote: sentence });
      }
    }
  }

  /* ── 2. citations that resolve to nothing ───────────────────────────────── */
  const unknownPaths: UnknownPath[] = [];
  if (fileEvidence === 'checked') {
    const known = new Set(filePaths);
    const seen = new Set<string>();
    for (const sentence of sentences(text)) {
      for (const match of sentence.matchAll(PATH_RE)) {
        const raw = match[1]!;
        const cited = raw.replace(/\\/g, '/').replace(/^\.\//, '');
        if (seen.has(cited)) continue;
        /* A SUFFIX match counts. A model writing `db.py` rather than
           `app/db.py` is being terse, not wrong, and calling that a fabrication
           would be the checker hallucinating about the answer. */
        const exists =
          known.has(cited) ||
          filePaths.some((p) => p === cited || p.endsWith(`/${cited}`) || cited.endsWith(`/${p}`));
        if (exists) continue;
        seen.add(cited);
        unknownPaths.push({ path: cited, quote: sentence });
      }
    }
  }

  unsupportedTechnologies.sort((a, b) => a.term.localeCompare(b.term));
  unknownPaths.sort((a, b) => a.path.localeCompare(b.path));

  return {
    unsupportedTechnologies,
    unknownPaths,
    hasFindings: unsupportedTechnologies.length > 0 || unknownPaths.length > 0,
    datastoreEvidence,
    fileEvidence,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE PREMISE IN THE QUESTION — the same moat, pointed one step earlier

   `checkAnswerClaims` checks what the MODEL said. Nothing checked what the USER
   said, so a false premise arrived, was never tested, steered the whole turn,
   and the only thing examined was the answer that premise produced. The bench
   case: "since this repository's backend is written in Django, which settings
   module should I edit" answered "I'll search for Django configuration" on a
   TypeScript monorepo. No fabrication — it did not invent a settings file — but
   it went looking for something that cannot exist, and saying so was the entire
   value of the turn.

   THIS IS A SEPARATE FUNCTION, not a flag on the old one, because the two ask
   different things of the same text. In an ANSWER, a path that resolves to
   nothing means the model may have fabricated it. In a QUESTION, it means the
   user typed a path they were guessing at — ordinary, and not a finding. Only
   the technology claim carries over, so only it is reimplemented here.

   A THIRD CLOSED WORLD, and the bar for adding one is set by this file: "only
   two are genuine closed worlds". Language-by-file-extension clears it. The scan
   enumerates every file whose extension it recognises, `.py` among them, and an
   extension is READ OFF DISK rather than inferred — so a graph holding zero
   `.py` nodes cannot be a Django repository, with the same confidence that a
   repo whose only driver call is sqlite3.connect does not use MySQL.

   IT CLEARS THAT BAR ONLY WITH THE TRUNCATION GATE BELOW, which is the part the
   argument misses. The walk stops at `maxFiles` (20,000 by default) and pushes
   `file limit N reached — remaining files skipped`. Past that point the absence
   of a `.py` node is an artefact of the cap, not a fact about the repository,
   and a checker without this gate would tell someone with a 25,000-file
   monorepo that their Python backend does not exist. That is the same shape as
   the false positive the datastore gate already learned: `joinAll` mints
   datastores claiming no engine, and gating on `datastores.length` once
   reported SQLite as unsupported on a SQLite repo. An enumeration with a cap is
   not a closed world.

   NOT EXTENDED PAST EXTENSIONS. Libraries, patterns and architectural styles
   need dependency resolution the scan does not do; flagging them would produce
   exactly the warnings that teach a reader to click past the one that mattered.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Frameworks and languages whose absence a file walk can actually prove.
 *
 * BARE `go` AND `c` ARE DELIBERATELY ABSENT. "how do I go about this" and "the
 * C in MVC" are ordinary English, and a word-bounded match on either would fire
 * on prose that claims nothing — the false-positive class this whole file is
 * organised against. `golang` is unambiguous and is listed instead.
 */
const LANGUAGE_CLAIMS: ReadonlyArray<{ term: string; exts: readonly string[] }> = [
  { term: 'django', exts: ['.py'] },
  { term: 'flask', exts: ['.py'] },
  { term: 'fastapi', exts: ['.py'] },
  { term: 'python', exts: ['.py'] },
  { term: 'rails', exts: ['.rb'] },
  { term: 'ruby', exts: ['.rb'] },
  { term: 'laravel', exts: ['.php'] },
  { term: 'php', exts: ['.php'] },
  { term: 'spring', exts: ['.java', '.kt'] },
  { term: 'java', exts: ['.java'] },
  { term: 'golang', exts: ['.go'] },
  { term: 'rust', exts: ['.rs'] },
  { term: 'kotlin', exts: ['.kt'] },
  { term: 'swift', exts: ['.swift'] },
];

/** Extension to the name a person would use for it, for the correction text. */
const LANGUAGE_NAMES: ReadonlyMap<string, string> = new Map([
  ['.ts', 'TypeScript'],
  ['.tsx', 'TypeScript'],
  ['.js', 'JavaScript'],
  ['.jsx', 'JavaScript'],
  ['.mjs', 'JavaScript'],
  ['.cjs', 'JavaScript'],
  ['.py', 'Python'],
  ['.rb', 'Ruby'],
  ['.php', 'PHP'],
  ['.java', 'Java'],
  ['.kt', 'Kotlin'],
  ['.go', 'Go'],
  ['.rs', 'Rust'],
  ['.cs', 'C#'],
  ['.swift', 'Swift'],
]);

/**
 * A premise about the PAST or a PLANNED future, which must never be corrected.
 *
 * "we're moving from Django to Node" asserts nothing about what the repository
 * is today — the premise is the migration, and answering it with "there is no
 * Python here" corrects something the user did not claim. This is the case that
 * decides the feature ships as correction-plus-answer rather than refusal, so
 * the guard is deliberately broad: a sentence carrying any migration or
 * past-tense marker is skipped WHOLE. Missing a real false premise inside a
 * migration sentence costs one correction; firing on one costs the reader's
 * trust in every correction after it, and those are not the same price.
 */
const HISTORICAL_PREMISE =
  /\b(?:migrat|mov|port|switch|rewrit|convert|transition|replac)\w*\s+(?:\w+\s+){0,3}(?:from|to)\b|\bused to\b|\bwe were\b|\bformerly\b|\bpreviously\b|\bno longer\b|\binstead of\b|\bmigration\b/i;

/** A premise the scan found but is NOT ENTITLED to refute, and why. */
export interface UnverifiablePremise {
  term: string;
  /** The extensions whose absence cannot be trusted. */
  blockedBy: string[];
  /** What the scan did not cover, in words a turn can quote. */
  reasons: string[];
  quote: string;
}

export interface PremiseReport {
  /** Technologies the question asserts that the scan can refute. */
  unsupportedTechnologies: UnsupportedTechnology[];
  /**
   * Technologies the question asserts that the scan CANNOT speak to.
   *
   * Not a weaker finding — a different one. "There is no Python here" and "I
   * never read the directories where Python would be" are opposite claims, and
   * only the second is true of this repository today.
   */
  unverifiable: UnverifiablePremise[];
  hasFindings: boolean;
  datastoreEvidence: 'checked' | 'none-found';
  /** `truncated` = the file walk hit its cap, so absence proves nothing. */
  languageEvidence: 'checked' | 'none-found' | 'truncated' | 'unknown';
}

export function checkQuestionPremise(question: string, graph: ArchGraph): PremiseReport {
  const text = question ?? '';

  const datastores = graph.nodes.filter((n) => n.kind === 'datastore');
  const filePaths = graph.nodes
    .filter((n) => n.kind === 'file' && typeof n.path === 'string')
    .map((n) => n.path!.replace(/\\/g, '/'));

  const evidenceHaystack = [
    ...datastores.flatMap((n) => {
      const meta = (n.meta ?? {}) as { tech?: unknown; image?: unknown };
      return [
        n.label ?? '',
        typeof meta.tech === 'string' ? meta.tech : '',
        typeof meta.image === 'string' ? meta.image : '',
      ];
    }),
    ...filePaths,
  ]
    .join('\n')
    .toLowerCase();

  const foundTech = [
    ...new Set(DATASTORE_TECHNOLOGIES.filter((t) => evidenceHaystack.includes(t)).map(canonical)),
  ].sort();

  /* Extensions the scan actually holds, and the language names for them. */
  const foundExts = new Set(
    filePaths.map((p) => {
      const dot = p.lastIndexOf('.');
      return dot < 0 ? '' : p.slice(dot).toLowerCase();
    }),
  );
  const foundLanguages = [
    ...new Set([...foundExts].map((e) => LANGUAGE_NAMES.get(e)).filter((n): n is string => !!n)),
  ].sort();

  /*
   * COVERAGE IS ASKED, NOT RE-DERIVED. This used to test the truncation warning
   * itself, which was right as far as it went and missed two signals — and the
   * miss was a real false positive on this very repository. `unscanned` records
   * `tools` (68 files, .mjs .py) and `examples` (6 files, .py .ts): there IS
   * Python here, in directories the walk never entered, so counting file nodes
   * answered "this repo has no Python" about code the scanner never opened.
   *
   * `scanCoverage` is the one place that question lives; W3's graph-gap verdict
   * asks the same function rather than deriving it a third time.
   */
  const coverage = scanCoverage(graph);
  const datastoreEvidence: PremiseReport['datastoreEvidence'] =
    foundTech.length === 0 ? 'none-found' : 'checked';
  const languageEvidence: PremiseReport['languageEvidence'] =
    coverage.verdict === 'unknown'
      ? 'unknown'
      : coverage.truncated
        ? 'truncated'
        : filePaths.length === 0
          ? 'none-found'
          : 'checked';

  const unsupportedTechnologies: UnsupportedTechnology[] = [];
  const unverifiable: UnverifiablePremise[] = [];
  const declined = new Set<string>();
  const seen = new Set<string>();
  for (const sentence of sentences(text)) {
    if (HISTORICAL_PREMISE.test(sentence)) continue;
    const lower = sentence.toLowerCase();

    if (datastoreEvidence === 'checked') {
      for (const term of DATASTORE_TECHNOLOGIES) {
        if (!new RegExp(`\\b${term}\\b`, 'i').test(lower)) continue;
        const key = canonical(term);
        if (seen.has(key) || foundTech.includes(key)) continue;
        seen.add(key);
        unsupportedTechnologies.push({ term: key, found: foundTech, quote: sentence });
      }
    }

    if (languageEvidence === 'checked') {
      for (const { term, exts } of LANGUAGE_CLAIMS) {
        if (!new RegExp(`\\b${term}\\b`, 'i').test(lower)) continue;
        if (seen.has(term)) continue;
        /* Present if ANY of its extensions is present: Spring is Java or Kotlin,
           and refuting it because one of the two is missing would be wrong. */
        if (exts.some((e) => foundExts.has(e))) continue;
        /*
         * The graph holds none of them — but an absence only speaks when the
         * walk could have seen them. EVERY extension must be refutable: if
         * Kotlin sits in an unvisited directory, "there is no Spring here" is
         * not a claim this scan is entitled to make, even though it did read
         * every .java file it found.
         */
        if (!exts.every((e) => canRefuteExtension(coverage, e))) {
          /*
           * RECORD THE DECLINE, do not just fall through.
           *
           * Silence here is indistinguishable from "the check never ran", and
           * that cost two rounds of debugging: `premise` came back null on the
           * Django question and read as a wiring bug, when the truth was that
           * the check ran, found the term, and correctly refused — `.py` sits in
           * `tools/` and `examples/`, which the walk never enters.
           *
           * "I cannot rule this in or out, and here is the region I never read"
           * is a real answer and a useful one. It is the difference between a
           * harness that does not know and a harness that knows it does not
           * know, which is the whole honesty claim.
           */
          if (!declined.has(term)) {
            declined.add(term);
            unverifiable.push({
              term,
              blockedBy: exts.filter((e) => !canRefuteExtension(coverage, e)),
              reasons: coverage.reasons.slice(0, 4),
              quote: sentence,
            });
          }
          continue;
        }
        seen.add(term);
        unsupportedTechnologies.push({ term, found: foundLanguages, quote: sentence });
      }
    }
  }

  unsupportedTechnologies.sort((a, b) => a.term.localeCompare(b.term));
  unverifiable.sort((a, b) => a.term.localeCompare(b.term));
  return {
    unsupportedTechnologies,
    unverifiable,
    /* BOTH COUNT. A decline is something to say — it is the honest answer to a
       question the scan cannot settle, and suppressing it is what made the
       check look like it had never run. */
    hasFindings: unsupportedTechnologies.length > 0 || unverifiable.length > 0,
    datastoreEvidence,
    languageEvidence,
  };
}
