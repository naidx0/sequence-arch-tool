/**
 * Compact term counts for the ask file index.
 *
 * WHY. The index kept one `Map<string, number>` per file for its content
 * tokens and one for its path tokens, plus a `df` Map. On a 20,000-file repo
 * (t3code) those Maps were 79 + 12 + 12 MB of live heap, and building 40,000
 * small Maps was most of the build's garbage: the find_files process stayed at
 * ~665 MB RSS after the build (V8 keeps the high-water mark). Here every term
 * gets one id in a vocabulary shared by the whole index, and a document is a
 * run of (id, count) pairs, sorted by id, in two growable typed arrays (a
 * Uint32 id, a Uint16 count clamped at 65,535): 6 bytes a term and a ~40-byte
 * view object a document.
 *
 * The views are read-only `ReadonlyMap<string, number>`s, so every consumer
 * (`get`, `has`, `keys`, `values`, iteration) reads them as before. Iteration
 * is in vocabulary order, not the file's first-occurrence order; no consumer
 * depends on that order (the BM25 postings list files in index order per word).
 */

/**
 * A copy of `s` that does not keep the string it was cut from alive. V8 makes
 * `slice`, `substring` and regex captures of 13+ characters "sliced strings"
 * that point into their parent: one kept term pinned a whole file's text, and
 * the index build held every file it had read (~330 MB live at 15,000 files of
 * t3code). Concatenation then slice forces a flat copy of just these characters.
 */
export const detachString = (s: string): string => (s.length < 13 ? s : (' ' + s).slice(1));

type Typed = Uint32Array | Uint16Array;
class Grow<T extends Typed> {
  length = 0;
  constructor(public data: T, private readonly make: (n: number) => T) {}
  reserve(n: number): void {
    if (this.length + n <= this.data.length) return;
    let cap = this.data.length * 2;
    while (cap < this.length + n) cap *= 2;
    const next = this.make(cap);
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }
  trim(): void {
    if (this.data.length !== this.length) this.data = this.data.slice(0, this.length) as T;
  }
}

/** The index's vocabulary and every document's (id, count) pairs. */
export class AskTermStore {
  readonly ids = new Map<string, number>();
  readonly terms: string[] = [];
  /** Pair k: term id `tid.data[k]`, count `cnt.data[k]`. */
  readonly tid = new Grow<Uint32Array>(new Uint32Array(1 << 14), (n) => new Uint32Array(n));
  readonly cnt = new Grow<Uint16Array>(new Uint16Array(1 << 14), (n) => new Uint16Array(n));
  /** Documents per term (the index's df), by term id. */
  dfById = new Uint32Array(1 << 12);

  idOf(w: string): number {
    let id = this.ids.get(w);
    if (id === undefined) {
      id = this.terms.length;
      w = detachString(w);
      this.ids.set(w, id);
      this.terms.push(w);
      if (id >= this.dfById.length) {
        const next = new Uint32Array(this.dfById.length * 2);
        next.set(this.dfById);
        this.dfById = next;
      }
    }
    return id;
  }

  /** Store one document's counts (`counts` is consumed in any order). */
  add(counts: ReadonlyMap<string, number>): AskTermCounts {
    const n = counts.size;
    const ids = new Uint32Array(n);
    const byId = new Map<number, number>();
    let i = 0;
    for (const [w, c] of counts) {
      const id = this.idOf(w);
      ids[i++] = id;
      byId.set(id, c);
    }
    ids.sort();
    this.tid.reserve(n);
    this.cnt.reserve(n);
    const start = this.tid.length;
    const T = this.tid.data;
    const C = this.cnt.data;
    for (let k = 0; k < n; k++) {
      T[start + k] = ids[k]!;
      C[start + k] = Math.min(65_535, byId.get(ids[k]!)!);
    }
    this.tid.length += n;
    this.cnt.length += n;
    return new AskTermCounts(this, start, n);
  }

  /** Count a document for each of these term ids (df). */
  countDoc(ids: Iterable<number>): void {
    for (const id of ids) this.dfById[id]!++;
  }

  /** Drop spare capacity once the build is done. */
  trim(): void {
    this.tid.trim();
    this.cnt.trim();
    if (this.dfById.length !== this.terms.length) this.dfById = this.dfById.slice(0, this.terms.length);
  }
}

/** One document's term counts: a read-only Map view over the store. */
export class AskTermCounts implements ReadonlyMap<string, number> {
  constructor(
    private readonly store: AskTermStore,
    /** First pair index. */
    private readonly start: number,
    readonly size: number,
  ) {}

  /** The pair index holding `id`, or -1. */
  private find(id: number): number {
    const d = this.store.tid.data;
    let lo = this.start;
    let hi = this.start + this.size;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const v = d[mid]!;
      if (v === id) return mid;
      if (v < id) lo = mid + 1;
      else hi = mid;
    }
    return -1;
  }

  get(w: string): number | undefined {
    const id = this.store.ids.get(w);
    if (id === undefined) return undefined;
    const k = this.find(id);
    return k < 0 ? undefined : this.store.cnt.data[k];
  }

  has(w: string): boolean {
    return this.get(w) !== undefined;
  }

  /** Whether this document holds term `id` (an id of the same store). */
  hasId(id: number): boolean {
    return this.find(id) >= 0;
  }

  /** The store this view reads (its vocabulary ids are the BM25 posting ids, askLtr.ts). */
  get termStore(): AskTermStore {
    return this.store;
  }

  /** Visit (id, count) pairs in id order without allocating. */
  forEachId(cb: (id: number, count: number) => void): void {
    const T = this.store.tid.data;
    const C = this.store.cnt.data;
    for (let k = this.start; k < this.start + this.size; k++) cb(T[k]!, C[k]!);
  }

  /** Term ids in this document (ascending). */
  *termIds(): Generator<number, undefined, unknown> {
    const T = this.store.tid.data;
    for (let k = this.start; k < this.start + this.size; k++) yield T[k]!;
    return undefined;
  }

  *keys(): MapIterator<string> {
    const T = this.store.tid.data;
    for (let k = this.start; k < this.start + this.size; k++) yield this.store.terms[T[k]!]!;
    return undefined;
  }

  *values(): MapIterator<number> {
    const C = this.store.cnt.data;
    for (let k = this.start; k < this.start + this.size; k++) yield C[k]!;
    return undefined;
  }

  *entries(): MapIterator<[string, number]> {
    const T = this.store.tid.data;
    const C = this.store.cnt.data;
    for (let k = this.start; k < this.start + this.size; k++) yield [this.store.terms[T[k]!]!, C[k]!];
    return undefined;
  }

  [Symbol.iterator](): MapIterator<[string, number]> {
    return this.entries();
  }

  forEach(cb: (value: number, key: string, map: ReadonlyMap<string, number>) => void, thisArg?: unknown): void {
    for (const [k, v] of this.entries()) cb.call(thisArg, v, k, this);
  }

  get [Symbol.toStringTag](): string {
    return 'AskTermCounts';
  }
}

/** The index's df as a read-only Map over the store (documents per term, content or path). */
export class AskDocFreq implements ReadonlyMap<string, number> {
  constructor(private readonly store: AskTermStore) {}
  get size(): number {
    return this.store.terms.length;
  }
  get(w: string): number | undefined {
    const id = this.store.ids.get(w);
    return id === undefined ? undefined : this.store.dfById[id];
  }
  has(w: string): boolean {
    return this.store.ids.has(w);
  }
  *keys(): MapIterator<string> {
    yield* this.store.terms;
    return undefined;
  }
  *values(): MapIterator<number> {
    for (let i = 0; i < this.store.terms.length; i++) yield this.store.dfById[i]!;
    return undefined;
  }
  *entries(): MapIterator<[string, number]> {
    for (let i = 0; i < this.store.terms.length; i++) yield [this.store.terms[i]!, this.store.dfById[i]!];
    return undefined;
  }
  [Symbol.iterator](): MapIterator<[string, number]> {
    return this.entries();
  }
  forEach(cb: (value: number, key: string, map: ReadonlyMap<string, number>) => void, thisArg?: unknown): void {
    for (const [k, v] of this.entries()) cb.call(thisArg, v, k, this);
  }
  get [Symbol.toStringTag](): string {
    return 'AskDocFreq';
  }
}
