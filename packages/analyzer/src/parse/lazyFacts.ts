/**
 * Facts for an unchanged file without loading the heavy part of them.
 *
 * `FileFacts` is two things: a small part every scan reads (`file`, `language`, `loc`,
 * `imports`, `functions`, `classes`, `parseErrors`) and a large part (`calls`,
 * `assignments`, `envReads`, `annotations`, `varTypes`, `lines`). On the pinned monorepo
 * `calls` alone is 32 of the 36 MB in `facts.v8`.
 *
 * A stub is a `FileFacts` whose small part comes from the scan index and whose large
 * members are lazy accessors. Reading one loads that file's heavy facts, from `facts.v8`
 * when it holds this exact content and by parsing the file otherwise. So a consumer that
 * wants everything (the function graph, a detector that has to run, `onServiceFacts`)
 * gets exactly what a fresh parse returns; a scan that wants only the small part never
 * opens `facts.v8` or the source file at all.
 *
 * `slimOf` is the other half: what the node build derives from the heavy part (import
 * snippets, rationale, the scheduled-job flag) is memoised per file in the index.
 */
import fs from 'node:fs';
import type { FileFacts } from '../types.js';
import { extractRationale, type RationaleNote } from '../rationale.js';
import { fileSuggestsScheduledJob } from '../scheduledDetect.js';
import { extractFacts, withLines } from './facts.js';
import { FactsCache } from './factsCache.js';
import type { IndexRecord, Slim } from './scanIndex.js';

type Heavy = Omit<FileFacts, 'lines'>;

const slims = new WeakMap<object, Slim>();
let heavyLoads = 0;

/** Test seam: how many files' heavy facts have been loaded (from the store or by parsing) since the process began. */
export function heavyLoadCount(): number {
  return heavyLoads;
}

/** What the node build and the memoised passes read from a file's facts. */
export function deriveSlim(f: FileFacts): Slim {
  const importSnippets = f.imports.map((imp) => (f.lines[imp.line - 1] ?? '').trim().slice(0, 200));
  return {
    language: f.language,
    loc: f.loc,
    parseErrors: f.parseErrors,
    imports: f.imports,
    fnNames: f.functions.map((fn) => fn.name),
    classNames: f.classes.map((c) => c.name),
    ...(f.goPackageName !== undefined ? { goPackageName: f.goPackageName } : {}),
    hasAnnotations: 'annotations' in f,
    hasVarTypes: 'varTypes' in f,
    importSnippets,
    // Cloned: the graph keeps these objects, and the index must not see what later passes do to them.
    rationale: structuredClone(extractRationale(f)),
    scheduled: fileSuggestsScheduledJob(f),
  };
}

/** The slim view of `f`: memoised for a stub (from its record) and for fresh facts (derived once). */
export function slimOf(f: FileFacts): Slim {
  let s = StubFacts.ctlOf(f)?.rec.slim ?? slims.get(f);
  if (!s) {
    s = deriveSlim(f);
    slims.set(f, s);
  }
  return s;
}

/** The snippet of `f.imports[i]`, as `(f.lines[line - 1] ?? '').trim().slice(0, 200)` would give it. */
export function importSnippet(f: FileFacts, i: number): string {
  return slimOf(f).importSnippets[i] ?? '';
}

/** The file's rationale notes, a copy the graph may own. */
export function rationaleOf(f: FileFacts): RationaleNote[] {
  const r = slimOf(f).rationale;
  return r.length === 0 ? r : structuredClone(r);
}

export interface HeavySource {
  /** where heavy facts are looked up before the file is parsed again; undefined: always parse */
  store?: FactsCache;
  /** absolute path of a repo-relative file */
  abs: (rel: string) => string;
}

/** One stub's lazily loaded state. */
class StubCtl {
  private heavyFacts: Heavy | undefined;
  private lineList: string[] | undefined;
  private source: string | undefined;

  constructor(
    readonly rel: string,
    readonly rec: IndexRecord,
    private readonly from: HeavySource,
  ) {}

  private readSource(): string {
    return (this.source ??= fs.readFileSync(this.from.abs(this.rel), 'utf8'));
  }

  /**
   * Is the file on disk still the bytes this record describes? A stub stands in for a file the scan trusted by its
   * stat; anything that must READ the file (a detector whose memo missed) first checks, and keeps the bytes it
   * read, so the heavy facts and the lines it then uses come from the very text it verified.
   *   'same'     the bytes hash to `rec.sha`; `source()` is them
   *   'changed'  they do not (the file changed after the stat): `source()` is the new text
   *   'gone'     the file cannot be read any more
   */
  verify(): 'same' | 'changed' | 'gone' {
    try {
      const src = this.readSource();
      return FactsCache.hash(src) === this.rec.sha ? 'same' : 'changed';
    } catch {
      return 'gone';
    }
  }

  /** The text `verify` read. */
  text(): string {
    return this.readSource();
  }

  heavy(): Heavy {
    if (this.heavyFacts) return this.heavyFacts;
    heavyLoads += 1;
    const peeked = this.from.store?.peek(this.rel, this.rec.sha, this.rec.lang, this.rec.tsx);
    if (peeked) {
      this.heavyFacts = peeked;
    } else {
      // Not in the store (never written, torn, or a different content): parse the file, as a miss would.
      const full = extractFacts(this.readSource(), this.rel, this.rec.lang);
      // Put it back, so the store heals instead of re-parsing this file on every scan from now on. Only when the
      // bytes are the ones the record describes (otherwise this entry would sit under the wrong sha).
      if (FactsCache.hash(this.readSource()) === this.rec.sha) this.from.store?.put(this.rel, this.rec.sha, this.rec.lang, this.rec.tsx, full);
      this.lineList = full.lines;
      const { lines: _l, ...rest } = full;
      void _l;
      this.heavyFacts = rest;
    }
    return this.heavyFacts;
  }

  lines(): string[] {
    return (this.lineList ??= this.readSource().split('\n'));
  }
}

/**
 * A `FileFacts` whose small part is a plain own property and whose large part reads through the
 * prototype's accessors. One class, not an `Object.defineProperty` per member per file: a scan makes
 * thousands of these and the defineProperty form cost more than the rest of the stub loop.
 * (`annotations` and `varTypes` exist only on files whose full facts carry them, so those two are defined
 * per instance when present: `'annotations' in facts` keeps meaning what it meant.)
 */
class StubFacts {
  readonly file: string;
  readonly language: Slim['language'];
  readonly loc: number;
  readonly imports: Slim['imports'];
  readonly parseErrors: number;
  goPackageName?: string;
  readonly #ctl: StubCtl;

  constructor(ctl: StubCtl) {
    const s = ctl.rec.slim;
    this.file = ctl.rel;
    this.language = s.language;
    this.loc = s.loc;
    this.imports = s.imports;
    this.parseErrors = s.parseErrors;
    if (s.goPackageName !== undefined) this.goPackageName = s.goPackageName;
    this.#ctl = ctl;
    if (s.hasAnnotations) Object.defineProperty(this, 'annotations', { get: () => ctl.heavy().annotations, enumerable: true, configurable: true });
    if (s.hasVarTypes) Object.defineProperty(this, 'varTypes', { get: () => ctl.heavy().varTypes, enumerable: true, configurable: true });
  }

  get functions(): Heavy['functions'] {
    return this.#ctl.heavy().functions;
  }
  get classes(): Heavy['classes'] {
    return this.#ctl.heavy().classes;
  }
  get calls(): Heavy['calls'] {
    return this.#ctl.heavy().calls;
  }
  get assignments(): Heavy['assignments'] {
    return this.#ctl.heavy().assignments;
  }
  get envReads(): Heavy['envReads'] {
    return this.#ctl.heavy().envReads;
  }
  get lines(): string[] {
    return this.#ctl.lines();
  }

  static ctlOf(f: object): StubCtl | undefined {
    return #ctl in f ? (f as StubFacts).#ctl : undefined;
  }
}

/** For a stub: whether its file is still the bytes it was described from (see StubCtl.verify). Not a stub: 'same'. */
export function verifyStub(f: object): 'same' | 'changed' | 'gone' {
  return StubFacts.ctlOf(f)?.verify() ?? 'same';
}

/** The text a `verifyStub` read (only after it said 'changed'). */
export function stubText(f: object): string | undefined {
  return StubFacts.ctlOf(f)?.text();
}

export function isStub(f: object): boolean {
  return StubFacts.ctlOf(f) !== undefined;
}

/** A `FileFacts` for the unchanged file described by `rec`; its heavy members load on first read. */
export function stubFacts(rel: string, rec: IndexRecord, from: HeavySource): FileFacts {
  return new StubFacts(new StubCtl(rel, rec, from)) as unknown as FileFacts;
}

/**
 * The plain `FileFacts` a fresh parse would have returned, key order included
 * (`withLines` is the one place that order is defined). For a caller that hands the facts
 * outside the scan (`onServiceFacts`) and must not hand out accessors.
 */
export function materialize(f: FileFacts): FileFacts {
  const c = StubFacts.ctlOf(f);
  if (!c) return f;
  const full = withLines(c.heavy(), c.lines());
  slims.set(full, c.rec.slim);
  return full;
}

/**
 * `describeCluster`'s view of a file: its language and the NAMES of what it defines. For a stub that is the
 * index's, with no heavy facts loaded; for fresh facts it is the facts themselves.
 */
export function clusterViewOf(f: FileFacts): {
  file: string;
  language: FileFacts['language'];
  loc: number;
  classes: Array<{ name: string }>;
  functions: Array<{ name: string }>;
} {
  if (!isStub(f)) return f;
  const s = slimOf(f);
  return {
    file: f.file,
    language: s.language,
    loc: s.loc,
    classes: s.classNames.map((name) => ({ name })),
    functions: s.fnNames.map((name) => ({ name })),
  };
}

/** For a consumer that copies only some members (the shared-facts capture): is `f` a stub, and does it carry `varTypes`? */
export function stubControl(f: object): { hasVarTypes: boolean } | undefined {
  const c = StubFacts.ctlOf(f);
  return c ? { hasVarTypes: c.rec.slim.hasVarTypes } : undefined;
}
