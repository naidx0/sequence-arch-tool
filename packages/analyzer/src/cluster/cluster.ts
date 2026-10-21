import { createRequire } from 'node:module';
import path from 'node:path';
import { nameFileGroup } from '../explain/fileSignals.js';
import { rationaleSentence, type RationaleNote } from '../rationale.js';

// graphology ships CJS with types that fight NodeNext ESM — load via require
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Graph: any = require('graphology');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const louvain: any = require('graphology-communities-louvain');

export interface FileGraphInput {
  /** repo-relative file paths of one service */
  files: string[];
  /** import pairs [from, to] within the service */
  imports: [string, string][];
}

/** Deterministic PRNG so cluster assignment is stable between runs (spec §2.3 mitigation 4). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Simple power-iteration PageRank over the import graph (aider-style ranking). */
export function pageRank(input: FileGraphInput, iterations = 30, damping = 0.85): Map<string, number> {
  const nodes = input.files;
  const n = nodes.length;
  const idx = new Map(nodes.map((f, i) => [f, i]));
  if (n === 0) return new Map();
  const outLinks: number[][] = nodes.map(() => []);
  for (const [from, to] of input.imports) {
    const fi = idx.get(from);
    const ti = idx.get(to);
    // rank flows from importer to imported: heavily-imported files rank higher
    if (fi !== undefined && ti !== undefined) outLinks[fi].push(ti);
  }
  let rank = new Array(n).fill(1 / n);
  for (let it = 0; it < iterations; it++) {
    const next = new Array(n).fill((1 - damping) / n);
    for (let i = 0; i < n; i++) {
      const outs = outLinks[i];
      if (outs.length === 0) {
        for (let j = 0; j < n; j++) next[j] += (damping * rank[i]) / n;
      } else {
        for (const j of outs) next[j] += (damping * rank[i]) / outs.length;
      }
    }
    rank = next;
  }
  return new Map(nodes.map((f, i) => [f, rank[i]]));
}

export interface ClusterResult {
  /** cluster id -> member files (deterministic ordering) */
  clusters: Map<number, string[]>;
}

/**
 * Community detection on the import graph, with a directory-affinity boost so
 * files that share a directory but have few imports still group sensibly.
 * Deterministic: seeded RNG + sorted node insertion.
 */
export function clusterFiles(input: FileGraphInput, serviceDir: string): ClusterResult {
  const g = new Graph({ type: 'undirected', multi: false });
  const files = [...input.files].sort();
  for (const f of files) g.addNode(f);

  const bump = (a: string, b: string, w: number) => {
    if (a === b) return;
    if (g.hasEdge(a, b)) g.setEdgeAttribute(a, b, 'weight', (g.getEdgeAttribute(a, b, 'weight') as number) + w);
    else g.addEdge(a, b, { weight: w });
  };
  for (const [from, to] of input.imports) {
    if (g.hasNode(from) && g.hasNode(to)) bump(from, to, 1);
  }
  // same-directory affinity (weak prior vs. import edges)
  const byDir = new Map<string, string[]>();
  for (const f of files) {
    const d = path.dirname(f);
    const arr = byDir.get(d) ?? [];
    arr.push(f);
    byDir.set(d, arr);
  }
  for (const members of byDir.values()) {
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length && j < i + 8; j++) bump(members[i], members[j], 0.3);
    }
  }

  const communities = louvain(g, {
    rng: mulberry32(42),
    getEdgeWeight: 'weight',
    resolution: 1,
  }) as Record<string, number>;

  const clusters = new Map<number, string[]>();
  for (const f of files) {
    const c = communities[f] ?? 0;
    const arr = clusters.get(c) ?? [];
    arr.push(f);
    clusters.set(c, arr);
  }

  // merge fragments (<3 files) into the cluster sharing the most directories,
  // so the module level stays readable (5-15 children per level, spec §2.5)
  const entries = [...clusters.entries()].sort((a, b) => b[1].length - a[1].length);
  const big = entries.filter(([, m]) => m.length >= 3);
  const small = entries.filter(([, m]) => m.length < 3);
  if (big.length >= 1 && small.length > 0) {
    for (const [id, members] of small) {
      let best: number | undefined;
      let bestScore = -1;
      for (const [bid, bmembers] of big) {
        const bdirs = new Set(bmembers.map((m) => path.dirname(m)));
        const bparents = new Set(bmembers.map((m) => path.dirname(path.dirname(m))));
        const score =
          2 * members.filter((m) => bdirs.has(path.dirname(m))).length +
          members.filter((m) => bparents.has(path.dirname(path.dirname(m)))).length +
          members.filter((m) => bparents.has(path.dirname(m))).length;
        if (score > bestScore) {
          bestScore = score;
          best = bid;
        }
      }
      // last resort: largest cluster, so no 1-2 file modules survive
      clusters.get(best !== undefined && bestScore > 0 ? best : big[0][0])!.push(...members);
      clusters.delete(id);
    }
  }
  return { clusters };
}

/**
 * Path segments that name a CONVENTION, not a part of the product.
 *
 * `src`, `app`, `lib`, `packages` appear in every repo and distinguish nothing;
 * the owner's report — rows reading "Frontend Ace Src", "Src Admin" — is what
 * happens when they survive into a label. They are dropped from RENDERED names
 * only, never from the paths themselves, and only while a distinguishing segment
 * remains: a module that really is just `src/` keeps saying `Src` rather than
 * losing its name.
 */
const CONVENTION_SEGMENTS = new Set([
  'src', 'app', 'lib', 'libs', 'source', 'sources', 'packages', 'package', 'modules', 'code',
]);

/**
 * The subset safe to drop from a DISAMBIGUATING name.
 *
 * Narrower than the set above on purpose. `backend/app/core` vs
 * `backend/services/core` is a real reported collision whose settled fix is "App
 * / Core" and "Services / Core" (module-identity.test.ts) — there `app` is the
 * thing telling them apart, so it earns its place. `src` never is: it is the one
 * segment guaranteed to sit between the service and everything in it, which is
 * why the owner's rows read "Frontend Ace Src" and "Src Admin".
 */
const RENDER_NOISE_SEGMENTS = new Set(['src', 'source', 'sources']);

/**
 * Directory names that are TRUE but say nothing about what the code does.
 *
 * These are the labels the owner was looking at when he asked for a naming
 * system: `models`, `utils`, `core`, `Top level`. Each is an accurate statement
 * about where files sit and a non-statement about what they are. When a cluster
 * lands on one of these AND its filenames carry a real pattern, the pattern is
 * the better name — see the `nameFileGroup` call in {@link labelCluster}. A
 * directory that names a domain (`billing`, `checkout`, `admin`) is NOT here:
 * an explicit name always wins, which is the "if it's not explicitly called
 * [something]" half of the ask.
 */
const UNINFORMATIVE_LABELS = new Set([
  'top level', 'model', 'models', 'schema', 'schemas', 'entity', 'entities',
  'util', 'utils', 'utility', 'utilities', 'helper', 'helpers', 'lib', 'libs',
  'core', 'common', 'shared', 'misc', 'main', 'base', 'internal', 'code',
  'src', 'app', 'source', 'modules', 'files', 'stuff', 'other', 'general',
]);

/**
 * Heuristic module label: common directory prefix of members (relative to the
 * service dir). `anchor` — the member the rest of the service depends on most,
 * by real PageRank — names the case where the files share NO directory below the
 * service root: see the note at the fallback below.
 */
export function labelCluster(
  members: string[],
  serviceDir: string,
  anchor?: string,
  serviceName?: string,
): string {
  const structural = structuralLabel(members, serviceDir, anchor, serviceName);
  // r184 — THE PATTERN NAMER, and only where a name is actually missing.
  //
  // The owner: "can we give it a system to name certain objects if it sees
  // patterns, if it's not explicitly called [something]? ... for a backend
  // purchasing system, can we just call it 'Purchasing workflow'?" So an
  // explicit name always wins: a cluster whose files live in `billing/` stays
  // "Billing". Only when the structure yields a label that says nothing —
  // "Models", "Utils", "Core", "Top level" — do the FILENAMES get to name it,
  // and only when they carry a real, thresholded pattern (`nameFileGroup`
  // requires 3+ files, half the group covered, and no tie). Otherwise the
  // mechanical name stays: it is honest, and a confident wrong name is not.
  if (UNINFORMATIVE_LABELS.has(structural.toLowerCase())) {
    const domain = nameFileGroup(members);
    if (domain) return domain;
  }
  return structural;
}

/**
 * The member the rest of the service depends on MOST — or nothing, when that
 * sentence would not be true.
 *
 * `rankOf` is the PageRank the caller already computed over this service's real
 * import graph. The old inline version sorted by it and took the first, so when
 * NOTHING in a module depends on anything the alphabetical winner was crowned
 * anyway: on `gin` — 22 Go files in one package, and Go files in one package do
 * not import each other — that named the whole core of the library **Auth**,
 * after `auth.go`, ahead of `gin.go`, `context.go` and `tree.go`. The label is a
 * claim about evidence; a tie is the absence of evidence.
 *
 * Returns the top member only when it ranks STRICTLY above the runner-up. Two
 * files that are equally depended on are genuinely ambiguous, and "the honest
 * mechanical name" beats picking one of them (HANDOFF §6).
 */
export function chooseAnchor(
  members: readonly string[],
  rankOf: (file: string) => number,
): string | undefined {
  if (members.length === 0) return undefined;
  const sorted = [...members].sort((a, b) => rankOf(b) - rankOf(a) || a.localeCompare(b));
  if (sorted.length === 1) return sorted[0];
  return rankOf(sorted[0]) > rankOf(sorted[1]) ? sorted[0] : undefined;
}

/** The pre-r184 label: the directory the files share, or the root fallback. */
function structuralLabel(
  members: string[],
  serviceDir: string,
  anchor?: string,
  serviceName?: string,
): string {
  const rels = members.map((m) => {
    let r = serviceDir === '.' ? m : m.startsWith(serviceDir + '/') ? m.slice(serviceDir.length + 1) : m;
    r = r.replace(/^(src|app|lib)\//, ''); // generic top dirs carry no meaning
    return r;
  });
  const dirs = rels.map((r) => path.dirname(r));
  let prefix = dirs[0];
  for (const d of dirs.slice(1)) {
    while (prefix !== '.' && prefix !== '' && !(d === prefix || d.startsWith(prefix + '/'))) {
      prefix = path.dirname(prefix);
    }
  }
  if (prefix && prefix !== '.' && prefix !== '') {
    const segs = prefix.split('/');
    const meaningful = segs.filter((s) => !CONVENTION_SEGMENTS.has(s.toLowerCase()));
    return (meaningful.length > 0 ? meaningful : segs).pop()!;
  }
  // fall back to the most common immediate directory name
  const counts = new Map<string, number>();
  for (const d of dirs) {
    // Files sitting directly in the service's own source dir. "(root)" was
    // punctuation pretending to be a name — it reads as a placeholder the scan
    // failed to fill, when it is in fact a true and useful statement.
    //
    // r184 — but it is a statement about the FILING, not about the code, and the
    // owner read a board full of rows like "Top Level" as mechanical rather than
    // English. When the caller can say which member the rest of the service
    // depends on most, that file NAMES the module: `server.ts` → "Server" says
    // what the group is and can be opened and checked, where "Top level" says
    // only where it sits. Same rule `uniqueModuleLabels` already uses to break a
    // "Top level"/"Top level" tie — generalised, not invented. With no anchor
    // (no ranking available) the honest structural statement stays.
    //
    // G8 — ...and an anchor that repeats the SERVICE's own name names nothing.
    // Measured on the real express clone: `lib/express.js` is genuinely the
    // most-depended-on file of its module, so the module read "Express" inside
    // the service "Express" — the settled dislike "a row that just repeats its
    // own name" (HANDOFF §6). The honest statement about those files is where
    // they sit, which is what this branch says without an anchor.
    const fromAnchor = anchorAsName(anchor);
    const usableAnchor =
      fromAnchor && (!serviceName || nameKey(fromAnchor) !== nameKey(serviceName)) ? fromAnchor : undefined;
    const name = d === '.' ? (usableAnchor ?? 'Top level') : d.split('/').pop()!;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

/**
 * The directory all of a cluster's files actually share, repo-relative.
 *
 * {@link labelCluster} throws this away — it returns only the LAST segment, so
 * `backend/app/core` and `backend/services/core` both become "Core" and appear as
 * two identical cards with no way to tell them apart. Reported from real use:
 * "Core" listed twice in one breakout. Returns undefined when the members share
 * no directory below the service root.
 */
export function clusterDir(members: string[]): string | undefined {
  if (members.length === 0) return undefined;
  let prefix = path.dirname(members[0]);
  for (const m of members.slice(1)) {
    const d = path.dirname(m);
    while (prefix !== '.' && prefix !== '' && !(d === prefix || d.startsWith(prefix + '/'))) {
      prefix = path.dirname(prefix);
    }
  }
  return prefix && prefix !== '.' && prefix !== '' ? prefix : undefined;
}

/**
 * Make same-named modules of one service tell themselves apart.
 *
 * Collisions are resolved by walking BACK up each colliding module's own real
 * directory one segment at a time until the names differ — so "Core" and "Core"
 * become "App / Core" and "Services / Core", both of which are paths that exist.
 * Nothing is invented: a module with no distinguishing directory keeps its plain
 * label rather than being given a number, because "Core 2" tells the reader
 * nothing and looks like a real name.
 *
 * Order-independent: input order never changes which module gets which name.
 *
 * `serviceLabel` is the parent service's own name, and it is a VETO, not a
 * decoration (G8). The walk used to accept any set of mutually-distinct
 * strings, so the module whose directory IS the service root rendered as the
 * service: `svc:api` → "Api" and `mod:api/0` → "Api", two rows reading the same
 * in one breakout — the settled dislike "a row that just repeats its own name"
 * (HANDOFF §6) — and `module-desc` has been red on exactly that. A name that
 * only repeats the container tells the reader nothing, so it is rejected and
 * the walk keeps going.
 */
export function uniqueModuleLabels(
  modules: readonly { label: string; dir?: string; anchor?: string }[],
  serviceLabel?: string,
): string[] {
  const out = modules.map((m) => m.label);
  const indicesByLabel = new Map<string, number[]>();
  out.forEach((label, i) => {
    const list = indicesByLabel.get(label);
    if (list) list.push(i);
    else indicesByLabel.set(label, [i]);
  });

  const serviceKey = nameKey(serviceLabel ?? '');
  /**
   * A set of candidate names is usable only when every one of them is a NAME.
   * Mutual distinctness was the only test before, and it let two non-names
   * through:
   *
   *  - the EMPTY string (G12). A module whose files share no directory has no
   *    `dir`, so its segment list is empty and `renderSegments([])` returns
   *    `''` — which is distinct from everything, so it was committed. On the
   *    real flask clone `p:mod:flask/5` (35 py files) came back with an empty
   *    label and the row rendered as nothing at all.
   *  - the parent SERVICE's own name (G8) — see the doc comment above.
   */
  const vetoed = (r: string): boolean =>
    r.trim() === '' || (serviceKey !== '' && nameKey(r) === serviceKey);
  const usable = (rendered: readonly string[]): boolean =>
    rendered.every((r) => !vetoed(r)) && new Set(rendered).size === rendered.length;
  /** The module's most-depended-on file, rendered as a name. */
  /*
   * DISAMBIGUATION USES THE RAW FILENAME, INCLUDING THE POSITION NAMES.
   *
   * `structuralLabel` vetoes `index` / `__init__` / `main` as names because a
   * position is not a thing. Here the goal is different and it wins: this walk
   * exists to stop two rows reading the same, and a weak name beats a DUPLICATE.
   * Measured on the express clone — three modules colliding on "test" with
   * anchors `test/index.js`, `lib/express.js`, `test/utils.js` — applying the
   * veto here collapsed two of them back onto "test" and reintroduced exactly
   * the collision this function is for.
   */
  const anchorName = (i: number): string | undefined => {
    const a = modules[i].anchor;
    return a ? humanizeSegment(basenameNoExt(a)) : undefined;
  };
  /**
   * A vetoed candidate is replaced ONE MODULE AT A TIME, never by throwing the
   * whole set away. Measured on the `twin-core` fixture: `mod:api/0` sits at the
   * service root so its 2-deep render is "Api", the service's own name — and
   * discarding the whole set for it also cost its sibling the perfectly good
   * "Services / Core". The offender falls back to its own anchor file (real,
   * openable), then to its plain label; its siblings keep what they earned.
   */
  const pick = (i: number, rendered: string): string => {
    if (!vetoed(rendered)) return rendered;
    const a = anchorName(i);
    if (a && !vetoed(a)) return a;
    return vetoed(modules[i].label) ? '' : modules[i].label;
  };

  for (const [label, idxs] of indicesByLabel) {
    // A lone module carrying the SERVICE's own name needs resolving too — it
    // collides with its parent rather than with a sibling, and the reader sees
    // the same duplication either way.
    if (idxs.length < 2 && !(serviceKey !== '' && nameKey(label) === serviceKey)) continue;
    // Segment lists, deepest-last, for each colliding module.
    const segs = idxs.map((i) => (modules[i].dir ?? '').split('/').filter((s) => s !== ''));
    const segIndex = new Map(idxs.map((i, k) => [i, k]));
    const maxDepth = Math.max(...segs.map((s) => s.length));
    // U36 — resolve per module, not all-or-nothing. One pair that still collides
    // at depth N (spring-boot: main vs test under .../mongodb/autoconfigure) must
    // not discard the depth-N names every sibling already earned.
    let remaining = [...idxs];
    for (let take = 2; take <= maxDepth && remaining.length >= 2; take++) {
      const candidates = remaining.map((i) => {
        const s = segs[segIndex.get(i)!];
        const rendered = s.length === 0 ? modules[i].label : renderSegments(s.slice(-take));
        return { i, r: pick(i, rendered) };
      });
      const countByKey = new Map<string, number>();
      for (const { r } of candidates) {
        const key = nameKey(r);
        countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
      }
      const resolved: number[] = [];
      for (const { i, r } of candidates) {
        if (countByKey.get(nameKey(r)) === 1 && !vetoed(r)) {
          out[i] = r;
          resolved.push(i);
        }
      }
      remaining = remaining.filter((i) => !resolved.includes(i));
    }

    // ── NO DIRECTORY TO WALK ────────────────────────────────────────────────
    // Modules whose files sit directly in the service root all label "Top
    // level", and `dir` is undefined for every one of them, so the loop above
    // has nothing to climb. Seen on Sequence's own scan: the Schema service
    // card listed "Top Level" three times — three different communities of
    // files, described identically, which is the settled dislike "a row that
    // just repeats its own name" wearing a different hat.
    //
    // Fall back to the module's ANCHOR: its most-depended-on file, chosen by
    // the caller from real PageRank over real imports. That is a derived,
    // checkable name — the file exists and you can open it — where "Top level
    // 2" would be a number pretending to be a name.
    //
    // G8 — an anchor whose name is the SERVICE's own name is vetoed
    // individually, not for the whole group. Measured on the real express
    // clone: three modules collide on "test" and their anchors are
    // `test/index.js`, `lib/express.js` and `test/utils.js`. Rejecting the
    // whole set because of the middle one put all three rows back to reading
    // "Test"; rejecting only that one leaves it on its honest mechanical label
    // while the other two get their real files' names.
    if (remaining.some((i) => !modules[i].anchor)) continue;
    const named = remaining.map((i) => pick(i, anchorName(i) ?? ''));
    if (!usable(named)) continue; // still ambiguous, or not a name — say nothing
    named.forEach((n, k) => {
      out[remaining[k]] = n;
    });
  }
  return out;
}

/**
 * G13 — TWO ROWS THAT NAME THE SAME DIRECTORY AND CANNOT BE TOLD APART ARE ONE
 * MODULE.
 *
 * Reported: `mod:Django/21` and `mod:Django/22` both read "Filepathfield Test
 * Dir" and both sit in `tests/forms_tests/field_tests/filepathfield_test_dir`.
 * Every disambiguator had already run and failed, and it failed for a reason no
 * further naming work can remove:
 *
 *   mod 21  the four files DIRECTLY in filepathfield_test_dir/
 *   mod 22  the five files in its c/, h/ and j/ subdirectories
 *
 * Both clusters therefore share the *identical* `clusterDir`, so the upward
 * directory walk in {@link uniqueModuleLabels} has the same segments to climb
 * on both sides at every depth; and the nine files are empty `__init__.py`
 * stubs that import nothing, so PageRank is flat and neither cluster has an
 * anchor. G8/G11/G12 fixed labels that were overwritten by a worse candidate;
 * this is the different case where there is no candidate at all.
 *
 * The honest reading is not "find a third name". It is that the split was never
 * a finding: Louvain ran over a subgraph whose only edges were the weak
 * same-directory prior (`clusterFiles` adds 0.3 per pair; there is not one
 * import edge among these files), so the community boundary states nothing
 * about the code. Two modules the reader cannot distinguish, over one
 * directory, ARE one module — and saying so once, with all nine files, is
 * strictly more true than saying it twice with four and five.
 *
 * WHY IT RUNS AFTER LABELLING, NOT INSIDE `clusterFiles`. Sharing a directory
 * is not enough — the corpus is full of same-directory cluster pairs that read
 * perfectly differently, because `nameFileGroup` or the anchor fallback DID
 * separate them (spring-boot's `.../boot/jetty` pair reads
 * "ConfigurableJettyWebServerFactory" and "JettyReactiveWebServerFactory").
 * Merging those would destroy a distinction the reader can actually use. The
 * only safe test is the one taken after every naming stage has had its turn:
 * the labels are still equal. Measured over the 27-repo corpus, that is ~15
 * pairs — django's one, sqlfluff's `templaters`/`Tests`, terraform's
 * `command`/`jsonformat`, and a handful in spring-boot.
 *
 * Modules with no `dir` are left alone: "they name the same directory" is the
 * claim being made, and a module whose files share no directory makes no such
 * claim. Those are the root-level collisions the anchor fallback exists for.
 */
export function mergeIndistinguishableModules<T extends { members: string[]; dir?: string }>(
  drafts: readonly T[],
  labels: readonly string[]
): { drafts: T[]; labels: string[] } {
  const firstOf = new Map<string, number>();
  const absorbedInto = new Map<number, number>();
  drafts.forEach((draft, i) => {
    const dir = draft.dir;
    const label = labels[i];
    if (!dir || typeof label !== 'string' || label.trim() === '') return;
    const key = `${nameKey(label)}\u0000${dir}`;
    const first = firstOf.get(key);
    if (first === undefined) firstOf.set(key, i);
    else absorbedInto.set(i, first);
  });
  if (absorbedInto.size === 0) return { drafts: [...drafts], labels: [...labels] };

  const merged = drafts.map((d) => ({ ...d, members: [...d.members] }));
  for (const [from, into] of absorbedInto) {
    merged[into].members.push(...merged[from].members);
  }
  const outDrafts: T[] = [];
  const outLabels: string[] = [];
  merged.forEach((draft, i) => {
    if (absorbedInto.has(i)) return;
    // Members stay in the deterministic order `clusterFiles` produced (sorted),
    // so a merged module's file list is the same list either half would have.
    draft.members.sort();
    outDrafts.push(draft as T);
    outLabels.push(labels[i]);
  });
  return { drafts: outDrafts, labels: outLabels };
}

/**
 * Two names compared the way a READER compares them: `api`, `Api` and `API`
 * are the same word on a card, and `books_worker` reads the same as
 * `Books Worker`. Punctuation and case are rendering, not identity.
 */
function nameKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Filenames that name a POSITION in a package, not a thing in the system.
 *
 * `basenameNoExt('__init__.py')` is `'__init__'` and `humanizeSegment` renders
 * that as **"Init"**, so a Python package marker was naming modules. Measured on
 * ml-harness: the cluster holding the Conductor, the Event Spine and the
 * security middleware came back labelled "Init".
 *
 * Every ecosystem this scanner reads has the same shape — `index.ts`,
 * `main.go`, `__main__.py`, `mod`, `setup.py` — and in each case the filename
 * says where the file sits, not what it does. "Init" is not a worse name than
 * the honest structural fallback; it is a name that LOOKS specific while saying
 * less, which is the more expensive failure.
 */
const NON_NAMING_FILENAMES = new Set(['init', 'main', 'index', 'mod', 'setup', 'app', 'lib']);

/**
 * An anchor file rendered as a module name, or `undefined` when its filename
 * names a position rather than a thing.
 *
 * The anchor is still CHOSEN — it is real signal about which member the rest of
 * the service leans on, and callers use it for more than naming. Only its use as
 * a label is vetoed here.
 */
function anchorAsName(anchor: string | undefined): string | undefined {
  if (!anchor) return undefined;
  const stem = basenameNoExt(anchor);
  if (NON_NAMING_FILENAMES.has(stem.toLowerCase().replace(/[-_]+/g, ''))) return undefined;
  const rendered = humanizeSegment(stem).trim();
  return rendered === '' ? undefined : rendered;
}

/** `src/graph/domain.test.ts` → `domain.test` → `domain`. Deterministic, no guessing. */
function basenameNoExt(file: string): string {
  const base = file.split('/').pop() ?? file;
  const dot = base.indexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/** `books_worker` → `Books Worker`; `api-v2` → `Api V2`. Path segments only. */
function humanizeSegment(seg: string): string {
  return seg
    .replace(/[-_]+/g, ' ')
    .trim()
    .split(' ')
    .map((w) => (w === '' ? w : w[0].toUpperCase() + w.slice(1)))
    .join(' ');
}

/**
 * Render a directory path as a name a person reads, dropping the segments that
 * are filing convention rather than meaning (`CONVENTION_SEGMENTS`). The
 * uniqueness check in `uniqueModuleLabels` runs on the RENDERED strings, so if
 * dropping them would make two modules read alike the caller simply takes one
 * more segment — the collision cannot be hidden by this.
 */
function renderSegments(segs: readonly string[]): string {
  const kept = segs.filter((s) => !RENDER_NOISE_SEGMENTS.has(s.toLowerCase()));
  return (kept.length > 0 ? kept : segs).map(humanizeSegment).join(' / ');
}

/** What a module actually holds — counted, never estimated. */
export interface ClusterFacts {
  file: string;
  language: string;
  functions: readonly { name: string }[];
  classes: readonly { name: string }[];
}

/**
 * A grounded one-line description of a module: where it lives and what it defines.
 *
 * Reported from real use: "function desc too general overall" — every module card
 * in the breakout read `MOD <Name>` and nothing else, so a fifteen-card pop-up
 * said fifteen times over that something exists without ever saying what it is.
 *
 * Every element here is COUNTED from the parse, never guessed: the directory the
 * files share, how many files there are, the language they are written in, and
 * the names of the largest few things defined in them. When the parse produced no
 * symbols the sentence simply stops early — an honest short line beats a padded
 * one. Returns undefined only when there is nothing at all to say.
 *
 * `rationale` (optional) is what the TEAM wrote down — mined deterministically
 * from `// WHY:` / `// HACK:` comments and `ADR-…` references by
 * `extractRationale`. It appends at most ONE sentence pointing at a real
 * `file:line`; the notes themselves hang off the node's `meta.rationale` for a
 * foldable surface. Omitted or empty, this function's output is byte-identical
 * to what it produced before rationale mining existed.
 */
export function describeCluster(
  members: readonly string[],
  factsByFile: ReadonlyMap<string, ClusterFacts>,
  rationale?: readonly RationaleNote[],
): string | undefined {
  if (members.length === 0) return undefined;
  const dir = clusterDir([...members]);
  const langs = new Map<string, number>();
  const symbols: { name: string; weight: number }[] = [];
  for (const m of members) {
    const f = factsByFile.get(m);
    if (!f) continue;
    langs.set(f.language, (langs.get(f.language) ?? 0) + 1);
    // Classes first: a class names a thing, a function names a step.
    for (const c of f.classes) symbols.push({ name: c.name, weight: 2 });
    for (const fn of f.functions) {
      if (!fn.name.startsWith('_')) symbols.push({ name: fn.name, weight: 1 });
    }
  }

  const fileCount = members.length;
  const where = dir ? ` in ${dir}` : '';
  const lang = [...langs.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  const langPart = lang ? `${lang} ` : '';
  let text = `${fileCount} ${langPart}file${fileCount === 1 ? '' : 's'}${where}`;

  // Deduplicate by name, keep the heaviest, then take a deterministic top few.
  const best = new Map<string, number>();
  for (const s of symbols) best.set(s.name, Math.max(best.get(s.name) ?? 0, s.weight));
  const top = [...best.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([name]) => name);
  if (top.length > 0) text += `, defining ${top.join(', ')}`;
  const why = rationale && rationale.length > 0 ? rationaleSentence(rationale) : undefined;
  return why ? `${text}. ${why}` : `${text}.`;
}
