/**
 * The ask index's grep cache: the lowercased text of every indexed file, kept
 * as a RUN index so a query never re-reads or re-lowercases the corpus.
 *
 * Every grep word is `[a-z0-9][a-z0-9_-]{2,}` (find-the-fix picker A), so each
 * of its occurrences in a lowercased text lies inside one maximal
 * `[a-z0-9_-]+` run. The index keeps each distinct run (length >= 3) once, with
 * its (file, count) postings; a word's per-file count is the sum, over the runs
 * that contain it, of (occurrences in the run) x (run count in the file). That
 * equals counting the word in the whole lowercased text (non-overlapping),
 * exactly — it is the search3/ltr `word_counts` fast path, ported.
 *
 * Size: bounded by the index's text cap (ASK_INDEX_MAX_TEXT_BYTES): the run
 * vocabulary is at most the text, the postings one (file, count) pair per
 * distinct run per file.
 */

import { detachString } from './askTermCounts.js';

class GrowInt32 {
  data = new Int32Array(1 << 12);
  length = 0;
  push3(a: number, b: number, c: number): void {
    if (this.length + 3 > this.data.length) {
      const next = new Int32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length++] = a;
    this.data[this.length++] = b;
    this.data[this.length++] = c;
  }
}

const isRunChar = (c: number): boolean => (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 45;

/** Run characters as 0..37 (a-z, 0-9, '_', '-'); -1 for any other code unit below 128. */
const ALPHABET = 38;
const TRIGRAMS = ALPHABET * ALPHABET * ALPHABET;
const CODE = new Int8Array(128).fill(-1);
for (let c = 97; c <= 122; c++) CODE[c] = c - 97;
for (let c = 48; c <= 57; c++) CODE[c] = c - 48 + 26;
CODE[95] = 36;
CODE[45] = 37;

/** Builds the run index one file at a time, in index order. */
export class AskGrepIndexBuilder {
  private readonly runId = new Map<string, number>();
  private readonly runs: string[] = [];
  private readonly triples = new GrowInt32();
  /** Files whose text was read (empty files included): N of the grep idf. */
  readFiles = 0;
  private readonly nonEmpty: boolean[] = [];

  /** `fileIdx` is the file's position in the index; `text` null = not read (path only). */
  add(fileIdx: number, text: string | null): void {
    this.nonEmpty[fileIdx] = Boolean(text);
    if (text === null) return;
    this.readFiles++;
    if (!text) return;
    const lower = text.toLowerCase();
    /* Counter(findall(run)) in first-occurrence order, runs shorter than 3 dropped. */
    const counts = new Map<string, number>();
    const n = lower.length;
    let i = 0;
    while (i < n) {
      if (!isRunChar(lower.charCodeAt(i))) {
        i++;
        continue;
      }
      let j = i + 1;
      while (j < n && isRunChar(lower.charCodeAt(j))) j++;
      const r = lower.slice(i, j);
      counts.set(r, (counts.get(r) ?? 0) + 1);
      i = j;
    }
    for (const [r, c] of counts) {
      if (r.length < 3) continue;
      let id = this.runId.get(r);
      if (id === undefined) {
        id = this.runs.length;
        /* A new run is kept until finish(): copy it, or it pins this file's lowercased text (askTermCounts.ts detachString). */
        const own = detachString(r);
        this.runId.set(own, id);
        this.runs.push(own);
      }
      this.triples.push3(id, fileIdx, c);
    }
  }

  finish(): AskGrepIndex {
    const nRuns = this.runs.length;
    const t = this.triples.data;
    const m = this.triples.length / 3;
    const start = new Int32Array(nRuns + 1);
    for (let k = 0; k < m; k++) start[t[3 * k]! + 1]!++;
    for (let r = 0; r < nRuns; r++) start[r + 1]! += start[r]!;
    const fill = start.slice(0, nRuns);
    const post = new Int32Array(2 * m);
    /* Counting sort by run id; files stay in index order within a run. */
    for (let k = 0; k < m; k++) {
      const r = t[3 * k]!;
      const at = fill[r]!++;
      post[2 * at] = t[3 * k + 1]!;
      post[2 * at + 1] = t[3 * k + 2]!;
    }
    const offsets = new Int32Array(nRuns + 1);
    let o = 0;
    for (let r = 0; r < nRuns; r++) {
      offsets[r] = o;
      o += this.runs[r]!.length + 1;
    }
    offsets[nRuns] = o;
    return new AskGrepIndex(this.runs.join('\n'), offsets, start, post, this.readFiles, Uint8Array.from(this.nonEmpty, (b) => (b ? 1 : 0)));
  }
}

/** {@link AskGrepIndex} as structured-cloneable data. */
export interface AskGrepWire {
  vocab: string;
  offsets: Int32Array;
  start: Int32Array;
  post: Int32Array;
  readFiles: number;
  nonEmpty: Uint8Array;
}

export class AskGrepIndex {
  constructor(
    /** The distinct runs joined by '\n' (no grep word contains '\n'). */
    private readonly vocab: string,
    private readonly offsets: Int32Array,
    private readonly start: Int32Array,
    private readonly post: Int32Array,
    /** Files whose text was read (the grep idf's N). */
    readonly readFiles: number,
    private readonly nonEmpty: Uint8Array,
  ) {}

  /** The index as plain data. Arrays are copies (the builder may keep using this one); trigrams are separate (they arrive later). */
  toWire(): AskGrepWire {
    return { vocab: this.vocab, offsets: this.offsets.slice(), start: this.start.slice(), post: this.post.slice(), readFiles: this.readFiles, nonEmpty: this.nonEmpty.slice() };
  }

  static fromWire(w: AskGrepWire): AskGrepIndex {
    return new AskGrepIndex(w.vocab, w.offsets, w.start, w.post, w.readFiles, w.nonEmpty);
  }

  /** The trigram postings once {@link indexTrigrams} has run, else null. */
  trigramWire(): { triStart: Int32Array; triRuns: Int32Array } | null {
    return this.triStart && this.triRuns ? { triStart: this.triStart, triRuns: this.triRuns } : null;
  }

  setTrigrams(t: { triStart: Int32Array; triRuns: Int32Array }): void {
    this.triStart = t.triStart;
    this.triRuns = t.triRuns;
  }

  /**
   * Trigram postings over the runs: runs triRuns[triStart[t] .. triStart[t + 1])
   * contain trigram t, each run once, in vocabulary order. Null until
   * {@link indexTrigrams} has run; until then a word scans the vocabulary.
   */
  private triStart: Int32Array | null = null;
  private triRuns: Int32Array | null = null;

  /**
   * Builds the trigram postings, yielding every `step` runs (the LTR stage
   * runs it in the background). Two passes over the runs: count, then fill.
   */
  *indexTrigrams(step = 100_000): Generator<void, void, void> {
    const { vocab, offsets } = this;
    const nRuns = offsets.length - 1;
    const triStart = new Int32Array(TRIGRAMS + 1);
    const stamp = new Int32Array(TRIGRAMS).fill(-1);
    const SQ = ALPHABET * ALPHABET;
    for (let pass = 0; pass < 2; pass++) {
      const fill = pass ? triStart.slice(0, TRIGRAMS) : null;
      const runs = pass ? new Int32Array(triStart[TRIGRAMS]!) : null;
      stamp.fill(-1);
      for (let r = 0; r < nRuns; r++) {
        if (r > 0 && r % step === 0) yield;
        const end = offsets[r + 1]! - 1;
        let i = offsets[r]!;
        let t = CODE[vocab.charCodeAt(i)]! * ALPHABET + CODE[vocab.charCodeAt(i + 1)]!;
        for (i += 2; i < end; i++) {
          t = (t % SQ) * ALPHABET + CODE[vocab.charCodeAt(i)]!;
          if (stamp[t] === r) continue;
          stamp[t] = r;
          if (runs) runs[fill![t]!++] = r;
          else triStart[t + 1]!++;
        }
      }
      if (!pass) for (let t = 0; t < TRIGRAMS; t++) triStart[t + 1]! += triStart[t]!;
      else {
        this.triStart = triStart;
        this.triRuns = runs;
      }
      yield;
    }
  }

  /** Approximate retained bytes (UTF-16 vocab + typed arrays). */
  get bytes(): number {
    return this.vocab.length * 2 + this.offsets.byteLength + this.start.byteLength + this.post.byteLength + this.nonEmpty.byteLength + (this.triStart?.byteLength ?? 0) + (this.triRuns?.byteLength ?? 0);
  }

  /** True when the file at `fileIdx` had non-empty text. */
  hasText(fileIdx: number): boolean {
    return this.nonEmpty[fileIdx] === 1;
  }

  private runAt(pos: number): number {
    let lo = 0;
    let hi = this.offsets.length - 2;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.offsets[mid]! <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /**
   * Occurrences of `w` per file index (non-overlapping, in the lowercased
   * text), in the order the reference builds them: runs in vocabulary order,
   * files in index order within a run.
   */
  wordCounts(w: string): Map<number, number> {
    const out = new Map<number, number>();
    const { files, counts } = this.wordCountsDense(w);
    for (const fi of files) out.set(fi, counts[fi]!);
    return out;
  }

  /** Per-file count scratch for {@link wordCountsDense}: one slot per file, zeroed after each call's reader is done. */
  private scratch: Int32Array | null = null;
  private scratchFiles: number[] = [];

  /**
   * {@link wordCounts} without a Map: the files in the same (first-touch)
   * order, and a dense array of their counts by file index. Both are reused by
   * the next call, so read them before calling again.
   */
  wordCountsDense(w: string): { files: readonly number[]; counts: Int32Array } {
    const { vocab, offsets, start, post } = this;
    if (!this.scratch) this.scratch = new Int32Array(this.nonEmpty.length);
    const counts = this.scratch;
    for (const fi of this.scratchFiles) counts[fi] = 0;
    const files: number[] = (this.scratchFiles = []);
    if (!w) return { files, counts };
    const add = (r: number, m: number): void => {
      for (let k = start[r]!; k < start[r + 1]!; k++) {
        const fi = post[2 * k]!;
        if (counts[fi] === 0) files.push(fi);
        counts[fi]! += m * post[2 * k + 1]!;
      }
    };
    /* The word's rarest trigram names the runs worth checking (in vocabulary order). */
    const { triStart, triRuns } = this;
    let best = -1;
    if (triStart && triRuns && w.length >= 3) {
      let t = 0;
      for (let i = 0; i < w.length; i++) {
        const c = w.charCodeAt(i);
        const x = c < 128 ? CODE[c]! : -1;
        if (x < 0) {
          best = -2;
          break;
        }
        t = ((t % (ALPHABET * ALPHABET)) * ALPHABET + x) | 0;
        if (i >= 2 && (best < 0 || triStart[t + 1]! - triStart[t]! < triStart[best + 1]! - triStart[best]!)) best = t;
      }
    }
    if (best >= 0) {
      const wl = w.length;
      for (let k = triStart![best]!; k < triStart![best + 1]!; k++) {
        const r = triRuns![k]!;
        const end = offsets[r + 1]! - 1;
        let m = 0;
        for (let i = offsets[r]!; i + wl <= end; ) {
          if (vocab.startsWith(w, i)) {
            m++;
            i += wl;
          } else i++;
        }
        if (m) add(r, m);
      }
      return { files, counts };
    }
    /* No trigram postings yet, or not a run-alphabet word of 3+ characters: scan the vocabulary. */
    let pos = vocab.indexOf(w);
    while (pos >= 0) {
      const r = this.runAt(pos);
      /* Non-overlapping occurrences in this run; the search that leaves the run lands on the next match. */
      const end = offsets[r + 1]! - 1;
      let m = 0;
      let i = pos;
      while (i >= 0 && i < end) {
        m++;
        i = vocab.indexOf(w, i + w.length);
      }
      add(r, m);
      pos = i;
    }
    return { files, counts };
  }
}
