/**
 * PROSE-DIFF SALVAGE — accept the edit syntax models already speak.
 *
 * Measured on SWE-bench (minimax-m3, run v5): the loop ran its full 32-round
 * budget, countdown nudges firing, engineer identity in place — and the model
 * spent every round writing the COMPLETE new file into a markdown fence,
 * ending "(End of HEALTHCHECK.md)", without once calling edit_file. It reads
 * via native tool calls; it edits in prose. That is not one model's quirk —
 * it is the diff-literate default an entire generation of models trained on
 * (and the gap Aider's whole design answers).
 *
 * So under auto-writes, a turn's final text is scanned for ```diff fences
 * carrying unified diffs, and matching hunks are applied THROUGH THE SAME
 * JAIL as propose_files. Strictness is the honesty rule here:
 *
 *   - a hunk applies only where its context lines match exactly (with one
 *     honest concession: trailing whitespace, which models shed when retyping
 *     lines, is ignored on the SECOND pass), searched near the header's line number and then repo-wide in
 *     the file — never fuzzily;
 *   - one failed hunk refuses that whole file (a half-applied diff is worse
 *     than none), with the reason named;
 *   - new files (`--- /dev/null`) must consist only of additions.
 *
 * Nothing here executes; the caller routes results through applyProposedFiles,
 * which owns the write path, the jail and the events.
 */

export interface ProseDiffHunk {
  /** 1-based old-file start line from the @@ header (best effort — a hint). */
  oldStart: number;
  /** Lines as (kind, text) — ' ' context, '-' removal, '+' addition. */
  lines: { kind: ' ' | '-' | '+'; text: string }[];
}

export interface ProseDiffFile {
  path: string;
  /** True when the diff declares the file new (`--- /dev/null`). */
  isNew: boolean;
  hunks: ProseDiffHunk[];
}

/** Strip a/ b/ prefixes and quotes from a diff header path. */
function cleanDiffPath(raw: string): string {
  let p = raw.trim();
  if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
  if (p.startsWith('a/') || p.startsWith('b/')) p = p.slice(2);
  return p;
}

/**
 * Parse every ```diff fence in `text` into per-file hunk lists.
 *
 * Only fences explicitly tagged `diff` are read — a stray patch-shaped block
 * in ordinary prose (a quoted example, a doc snippet) must not become a write.
 */
export function parseProseDiffs(rawText: string): ProseDiffFile[] {
  // Diffs pasted through CRLF pipelines carry \r on every line; strip it so
  // context matching compares text, not transport.
  const text = rawText.replace(/\r\n/g, '\n');
  const out: ProseDiffFile[] = [];
  const fence = /```diff[^\n]*\n([\s\S]*?)```/g;
  for (let m = fence.exec(text); m !== null; m = fence.exec(text)) {
    parseDiffBody(m[1] ?? '', out);
  }
  return out;
}

function parseDiffBody(body: string, out: ProseDiffFile[]): void {
  const lines = body.split('\n');
  let current: ProseDiffFile | null = null;
  let hunk: ProseDiffHunk | null = null;
  let oldPath: string | null = null;
  const synthetic = new Set<number>();

  for (const line of lines) {
    if (line.startsWith('--- ')) {
      oldPath = line.slice(4).trim();
      trimSyntheticTail(hunk, synthetic);
      hunk = null;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const newPath = cleanDiffPath(line.slice(4));
      const isNew = oldPath !== null && /^\/dev\/null$/.test(oldPath.trim());
      current = { path: newPath, isNew, hunks: [] };
      out.push(current);
      trimSyntheticTail(hunk, synthetic);
      hunk = null;
      continue;
    }
    const at = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(line);
    if (at) {
      if (!current) continue; // hunk with no file header — unusable
      trimSyntheticTail(hunk, synthetic);
      hunk = { oldStart: Number.parseInt(at[1]!, 10), lines: [] };
      current.hunks.push(hunk);
      continue;
    }
    if (hunk && (line.startsWith(' ') || line.startsWith('-') || line.startsWith('+'))) {
      hunk.lines.push({ kind: line[0] as ' ' | '-' | '+', text: line.slice(1) });
      continue;
    }
    if (hunk && line === '') {
      // Blank line inside a hunk body — a context line whose leading space was
      // trimmed by the model. Treat as empty context rather than ending the hunk,
      // but remember it is synthetic: if it turns out to be TRAILING padding
      // before the fence or the next header, it must not poison the match.
      hunk.lines.push({ kind: ' ', text: '' });
      synthetic.add(hunk.lines.length - 1);
    }
  }
  trimSyntheticTail(hunk, synthetic);
}

/**
 * Drop synthetic blank-context lines from a hunk's tail. A blank line the
 * model wrote WITH its leading space is real context; one we inferred from an
 * empty line is padding whenever nothing follows it.
 */
function trimSyntheticTail(hunk: ProseDiffHunk | null, synthetic: Set<number>): void {
  if (!hunk) return;
  while (hunk.lines.length > 0 && synthetic.has(hunk.lines.length - 1)) {
    hunk.lines.pop();
  }
  synthetic.clear();
}

export interface ProseDiffApplied {
  path: string;
  content: string;
}

export interface ProseDiffRefused {
  path: string;
  reason: string;
}

/**
 * Apply one file's hunks to its current content. Exact-context only; the
 * header line number is a search HINT, not a trusted address — models copy
 * diffs against files they have partially read, and a hunk whose context
 * genuinely matches somewhere unique is still that edit.
 */
export function applyProseDiffFile(
  file: ProseDiffFile,
  currentContent: string | null,
): ProseDiffApplied | ProseDiffRefused {
  if (file.isNew) {
    if (currentContent !== null && currentContent.length > 0) {
      return { path: file.path, reason: 'diff says new file, but the file already exists' };
    }
    const adds: string[] = [];
    for (const h of file.hunks) {
      for (const l of h.lines) {
        if (l.kind === '-') return { path: file.path, reason: 'a new-file diff cannot remove lines' };
        if (l.kind === '+') adds.push(l.text);
      }
    }
    if (adds.length === 0) return { path: file.path, reason: 'new-file diff adds nothing' };
    return { path: file.path, content: `${adds.join('\n')}\n` };
  }

  if (currentContent === null) {
    return { path: file.path, reason: 'file not found in the repository' };
  }

  /*
   * Match on \n regardless of the file's own line endings (a Windows checkout
   * is still the same code), then write the file back in the endings it had —
   * an edit must never rewrite every line of a CRLF file.
   */
  const usesCrlf = currentContent.includes('\r\n');
  let workLines = (usesCrlf ? currentContent.replace(/\r\n/g, '\n') : currentContent).split('\n');
  /*
   * The @@ header line number is a position in the ORIGINAL file, but each
   * applied hunk shifts every later line by (added - removed). Without rebasing
   * the hint, a later hunk whose context repeats could be disambiguated to the
   * WRONG occurrence. Carry the cumulative delta and correct the hint.
   */
  let lineDelta = 0;
  for (const [i, h] of file.hunks.entries()) {
    const oldSeq = h.lines.filter((l) => l.kind !== '+').map((l) => l.text);
    if (oldSeq.length === 0) {
      return { path: file.path, reason: `hunk ${i + 1} carries no context — nowhere to anchor it` };
    }
    /*
     * Exact first; trailing-whitespace-blind second. Models retype context
     * lines and shed trailing spaces (measured: 3 of 5 salvage refusals on
     * the mini-50 were exactly this). The relaxed pass still demands a UNIQUE
     * match, and wherever a context line is kept it is the FILE's own line
     * that survives — never the diff's retyped version of it.
     */
    const hint = h.oldStart - 1 + lineDelta;
    let at = findUnique(workLines, oldSeq, hint, exactEq);
    if (at === -1) at = findUnique(workLines, oldSeq, hint, trailBlindEq);
    /*
     * EDGE-CONTEXT FUZZ — what `patch --fuzz=2` has done for forty years, and
     * the case the removal-anchored fallback below structurally cannot reach.
     *
     * MEASURED, mini-50 v17 (deepseek-v4-flash): 25 of 50 instances shipped no
     * patch, and 3 of those had a complete, plausible unified diff sitting in
     * the answer that this function refused — "hunk 1: its context does not
     * match the file". sphinx-7748's hunk 1 is ADDITION-ONLY (it adds two class
     * attributes under a docstring), so it has no removal to anchor on and the
     * fallback below refuses it by construction. Its context was right in the
     * middle and off by a line at the edges, which is precisely the shape fuzz
     * exists for.
     *
     * Safe because the core still has to be UNIQUE and still has to be real
     * evidence: only CONTEXT lines are dropped, never a removal; at most two
     * from each end; and what is left must be at least three lines. Where a
     * dropped edge line turns out not to match the file, no damage is done —
     * the splice below re-emits the FILE's own line for every context slot, so
     * a mis-remembered edge line is carried through unchanged rather than
     * overwritten.
     */
    if (at === -1) {
      const fuzzed = findByEdgeFuzz(workLines, h.lines, hint);
      if (fuzzed !== null) at = fuzzed;
    }
    if (at !== -1 && at !== -2) {
      const replacement: string[] = [];
      let offset = 0;
      for (const l of h.lines) {
        if (l.kind === ' ') {
          replacement.push(workLines[at + offset]!);
          offset += 1;
        } else if (l.kind === '-') {
          offset += 1;
        } else {
          replacement.push(l.text);
        }
      }
      lineDelta += replacement.length - oldSeq.length;
      workLines = [...workLines.slice(0, at), ...replacement, ...workLines.slice(at + oldSeq.length)];
      continue;
    }
    if (at === -2) {
      return { path: file.path, reason: `hunk ${i + 1}: its context matches more than one place` };
    }
    /*
     * REMOVAL-ANCHORED FALLBACK. Measured on mini-50 v10 (django-12262,
     * django-12325): last-chance diffs arrived with real removal lines wrapped
     * in half-remembered context, and the whole file was refused for the part
     * the model invented rather than the part it got right. The '-' lines are
     * the strongest evidence in a diff — they claim "these exact lines exist" —
     * so when full-context matching fails, the CONTIGUOUS removal block is
     * matched alone, exactly and uniquely, and replaced with the '+' lines.
     * Fabricated context is discarded instead of poisoning a correct edit;
     * an addition-only hunk (no removals) still refuses — there is nothing
     * real to anchor it.
     */
    const removalRuns: { start: number; lines: string[] }[] = [];
    let run: string[] | null = null;
    for (const l of h.lines) {
      if (l.kind === '-') {
        if (!run) {
          run = [];
          removalRuns.push({ start: removalRuns.length, lines: run });
        }
        run.push(l.text);
      } else if (l.kind === ' ') {
        run = null;
      }
    }
    if (removalRuns.length !== 1) {
      return { path: file.path, reason: `hunk ${i + 1}: its context does not match the file` };
    }
    const removals = removalRuns[0]!.lines;
    let ranchor = findUnique(workLines, removals, hint, exactEq);
    if (ranchor === -1) ranchor = findUnique(workLines, removals, hint, trailBlindEq);
    if (ranchor === -1) {
      return { path: file.path, reason: `hunk ${i + 1}: its context does not match the file` };
    }
    if (ranchor === -2) {
      return {
        path: file.path,
        reason: `hunk ${i + 1}: its removed lines match more than one place`,
      };
    }
    const adds = h.lines.filter((l) => l.kind === '+').map((l) => l.text);
    lineDelta += adds.length - removals.length;
    workLines = [
      ...workLines.slice(0, ranchor),
      ...adds,
      ...workLines.slice(ranchor + removals.length),
    ];
  }
  const joined = workLines.join('\n');
  return { path: file.path, content: usesCrlf ? joined.replace(/\n/g, '\r\n') : joined };
}

/**
 * Find `needle` inside `hay` exactly once. Prefers a match at/near `hint`
 * (the @@ line number) when several exist. Returns index, -1 (none), or
 * -2 (ambiguous with no hint match).
 */
const exactEq = (a: string, b: string): boolean => a === b;
const trailBlindEq = (a: string, b: string): boolean => a.replace(/\s+$/, '') === b.replace(/\s+$/, '');

/** Context lines droppable from EACH end. GNU patch's default fuzz is 2. */
const MAX_CONTEXT_FUZZ = 2;
/**
 * Below this, a core is not evidence. Two identical lines occur everywhere in
 * real source (`    return value`, a lone brace), and placing an edit on one
 * is how a fuzzy patcher lands a hunk in the wrong function.
 */
const MIN_FUZZ_CORE_LINES = 3;

/**
 * The index of the ONLY window matching `needle`, or -1 for none-or-several.
 * Deliberately hint-free — see the call site in `findByEdgeFuzz`.
 */
function findOnly(
  hay: string[],
  needle: string[],
  eq: (a: string, b: string) => boolean,
): number {
  let found = -1;
  outer: for (let i = 0; i + needle.length <= hay.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (!eq(hay[i + j]!, needle[j]!)) continue outer;
    }
    if (found !== -1) return -1;
    found = i;
  }
  return found;
}

/**
 * Place a hunk whose full context does not match, by dropping up to
 * `MAX_CONTEXT_FUZZ` CONTEXT lines from each end and re-matching the core.
 *
 * Returns the implied start of the FULL old sequence (not of the core), or
 * null when no trimming yields a unique, long-enough match. Removal lines are
 * never trimmed: they are the diff's strongest claim about the file and
 * dropping one would let a hunk anchor on text it never asserted.
 */
function findByEdgeFuzz(
  workLines: string[],
  hunkLines: readonly { kind: ' ' | '-' | '+'; text: string }[],
  hint: number,
): number | null {
  const old = hunkLines.filter((l) => l.kind !== '+');
  let leadCtx = 0;
  while (leadCtx < old.length && old[leadCtx]!.kind === ' ') leadCtx += 1;
  let tailCtx = 0;
  while (tailCtx < old.length - leadCtx && old[old.length - 1 - tailCtx]!.kind === ' ') tailCtx += 1;

  const maxLead = Math.min(MAX_CONTEXT_FUZZ, leadCtx);
  const maxTail = Math.min(MAX_CONTEXT_FUZZ, tailCtx);
  /* Fewest lines dropped first: the closest match to what the model actually
     claimed wins over a looser one that also happens to be unique. */
  for (let total = 1; total <= maxLead + maxTail; total += 1) {
    for (let dropLead = 0; dropLead <= Math.min(total, maxLead); dropLead += 1) {
      const dropTail = total - dropLead;
      if (dropTail > maxTail) continue;
      const core = old.slice(dropLead, old.length - dropTail).map((l) => l.text);
      if (core.length < MIN_FUZZ_CORE_LINES) continue;
      /*
       * STRICTLY ONE MATCH — no hint tie-break, unlike the full-context passes.
       *
       * `findUnique` lets the @@ line number choose between several matches,
       * which is right when the whole context matched: the diff pinned the
       * place and the number only breaks a tie. Here it would be a guess on top
       * of a guess — fuzz has ALREADY discarded the lines that distinguish two
       * similar blocks, and the line number of a hunk a model retyped from
       * memory is the least trustworthy field in it. Caught by the test named
       * "fuzz still demands a UNIQUE core": two identical function bodies, the
       * only distinguishing line dropped, and the hint happily picked the first.
       */
      let p = findOnly(workLines, core, exactEq);
      if (p === -1) p = findOnly(workLines, core, trailBlindEq);
      if (p < 0) continue;
      const start = p - dropLead;
      /* The full window must still fit — a core matched near a boundary can
         imply a start before the file begins or an end past its last line. */
      if (start < 0 || start + old.length > workLines.length) continue;
      return start;
    }
  }
  return null;
}

function findUnique(
  hay: string[],
  needle: string[],
  hint: number,
  eq: (a: string, b: string) => boolean = exactEq,
): number {
  const matches: number[] = [];
  outer: for (let i = 0; i + needle.length <= hay.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (!eq(hay[i + j]!, needle[j]!)) continue outer;
    }
    matches.push(i);
    // Scan a generous bound. If even this many identical windows exist, the
    // context is too weak to place safely — refuse (ambiguous) rather than
    // hint-guess at a location the diff never pinned. (Was: stop at 9 and
    // guess via the hint, which could land on the wrong one of 10+.)
    if (matches.length > 64) return -2;
  }
  if (matches.length === 0) return -1;
  if (matches.length === 1) return matches[0]!;
  /* Several matches: the hint disambiguates when one is clearly nearest. */
  let best = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  let tie = false;
  for (const m of matches) {
    const d = Math.abs(m - hint);
    if (d < bestDist) {
      best = m;
      bestDist = d;
      tie = false;
    } else if (d === bestDist) {
      tie = true;
    }
  }
  return tie ? -2 : best;
}
