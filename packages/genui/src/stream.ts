/**
 * THE STREAM COMPILER: text in (any chunking), spec out, after every chunk.
 *
 * Each complete line is one op, applied atomically; a line that is not JSON is repaired
 * if it can be (repairJson) and reported if it cannot, and the rest of the stream goes
 * on: one bad line never takes the surface down. The line still arriving is applied
 * speculatively to a copy (preview()), so a long text or a diff renders as it types
 * without ever being committed half-written.
 */
import { parsePartialJson, repairJson } from './partialJson.js';
import { applyOp, normaliseOp } from './ops.js';
import { GENUI_LIMITS } from './limits.js';
import { emptySpec, type Fix, type Issue, type UIOp, type UISpec } from './types.js';

export interface PushResult {
  spec: UISpec;
  applied: UIOp[];
  issues: Issue[];
  fixes: Fix[];
}

const SKIP = /^\s*(```.*|)\s*$/;

export class SpecStream {
  private buf = '';
  private line = 0;
  spec: UISpec;

  constructor(
    initial: UISpec = emptySpec(),
    private maxElements: number = GENUI_LIMITS.elementsPerSurface,
  ) {
    this.spec = initial;
  }

  /**
   * Fold one op in, unless it would take the surface past its element cap. An op that adds nothing new to a full
   * surface (a props update, a removal) still lands, so a full card can still be finished. Returns false when dropped.
   */
  private fold(op: UIOp): boolean {
    const next = applyOp(this.spec, op);
    const was = Object.keys(this.spec.elements).length;
    const now = Object.keys(next.elements).length;
    if (now > this.maxElements && now > was) return false;
    this.spec = next;
    return true;
  }

  private limitIssue(dropped: number): Issue {
    return {
      code: 'LIMIT_EXCEEDED',
      severity: 'error',
      path: '/elements',
      message: `${dropped} ops dropped: a surface holds at most ${this.maxElements} elements`,
      hint: 'summarise instead: group rows into one Text or KeyValue, or finish this card and start a new surface',
    };
  }

  /** Apply ops that did not come through text (an agent's patch reply, a tool call). Returns what the cap dropped. */
  applyOps(ops: UIOp[]): Issue[] {
    let dropped = 0;
    for (const op of ops) if (!this.fold(op)) dropped++;
    return dropped ? [this.limitIssue(dropped)] : [];
  }

  push(chunk: string): PushResult {
    this.buf += chunk;
    const parts = this.buf.split('\n');
    this.buf = parts.pop() ?? '';
    return this.consume(parts);
  }

  /** The stream ended: the last line counts even without a newline. */
  end(): PushResult {
    const rest = this.buf;
    this.buf = '';
    return this.consume(rest.trim() ? [rest] : []);
  }

  /** The committed spec plus the in-flight line, applied to a copy if it parses that far. */
  preview(): UISpec {
    return this.previewInfo().spec;
  }

  /**
   * The preview and the element it touches. Only element ops preview: a half-written
   * "set" of 36 is "3" for a frame (a number that jumps back), and a half-written remove
   * must never run. The caller keeps the committed element when the in-flight one does
   * not validate yet, so an element being updated never flickers to a skeleton.
   */
  previewInfo(): { spec: UISpec; id: string | null } {
    const pending = this.buf.trim();
    const none = { spec: this.spec, id: null };
    if (!pending || SKIP.test(pending)) return none;
    const p = parsePartialJson(pending);
    if (!p || p.value == null || typeof p.value !== 'object') return none;
    const n = normaliseOp(p.value);
    if ('issue' in n || n.op.op !== 'el') return none;
    let op = n.op;
    /* The last id of an unfinished children list may itself be unfinished ("s" of "s2"). */
    if (!p.complete && op.children?.length) op = { ...op, children: op.children.slice(0, -1) };
    try {
      return { spec: applyOp(this.spec, op), id: op.id };
    } catch {
      return none;
    }
  }

  private consume(lines: string[]): PushResult {
    const applied: UIOp[] = [];
    const issues: Issue[] = [];
    const fixes: Fix[] = [];
    let dropped = 0;
    for (const raw of lines) {
      this.line++;
      if (SKIP.test(raw)) continue;
      const parsed = repairJson(raw);
      if (!parsed) {
        issues.push({ code: 'PARSE_ERROR', severity: 'error', path: `line:${this.line}`, message: `line ${this.line} is not JSON: ${raw.slice(0, 80)}`, hint: 'one JSON object per line' });
        continue;
      }
      for (const f of parsed.fixes) fixes.push({ lossy: false, by: 'fixer', message: `line ${this.line}: ${f}`, path: `line:${this.line}` });
      const n = normaliseOp(parsed.value);
      if ('issue' in n) {
        issues.push({ ...n.issue, path: `line:${this.line}` });
        continue;
      }
      fixes.push(...n.fixes);
      try {
        if (this.fold(n.op)) applied.push(n.op);
        else dropped++;
      } catch (e) {
        issues.push({ code: 'BAD_OP', severity: 'error', path: `line:${this.line}`, message: `line ${this.line}: ${(e as Error).message}` });
      }
    }
    if (dropped) issues.push(this.limitIssue(dropped));
    return { spec: this.spec, applied, issues, fixes };
  }
}

/** Whole-spec mode: an agent that writes one big JSON object instead of op lines. */
export function specFromPartialJson(text: string): UISpec | undefined {
  const p = parsePartialJson(text);
  if (!p || p.value == null || typeof p.value !== 'object') return undefined;
  const v = p.value as Partial<UISpec>;
  return { ...emptySpec(), ...v, elements: (v.elements as UISpec['elements']) ?? {}, state: v.state ?? {}, actions: v.actions ?? {}, meta: v.meta ?? {} } as UISpec;
}
