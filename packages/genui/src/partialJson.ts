/**
 * JSON as it streams, and JSON as models actually write it.
 *
 * parsePartialJson: the longest valid prefix of an unfinished value, closed. A Text whose
 * "text" is still arriving renders the words so far; a Diff renders the lines so far.
 * (Vercel's AI SDK does this for tool-call arguments with parsePartialJson; Cursor
 * coalesces the partial tool call per frame.)
 *
 * repairJson: the mistakes that cost a whole line otherwise: a ``` fence, a trailing
 * comma, single quotes, an unquoted key, Python's True/None, a // comment. Each repair is
 * reported, so the surface can show that it happened.
 */

interface Scan {
  stack: string[];
  inString: boolean;
  cuts: number[];
}

function scan(s: string): Scan {
  const stack: string[] = [];
  const cuts: number[] = [];
  let inString = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (inString) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{' || c === '[') {
      stack.push(c === '{' ? '}' : ']');
      cuts.push(i + 1);
    } else if (c === '}' || c === ']') stack.pop();
    else if (c === ',') cuts.push(i);
  }
  return { stack, inString, cuts };
}

function close(s: string): string {
  const { inString } = scan(s);
  let out = s;
  if (inString) {
    out = out.replace(/\\u[0-9a-fA-F]{0,3}$/, '').replace(/\\$/, '');
    out += '"';
  }
  out = out.replace(/[\s,]+$/, '');
  /* Half a literal: tru, fals, nul, a bare minus or a trailing decimal point. */
  out = out.replace(/(:|\[|,)\s*(t|tr|tru|f|fa|fal|fals|n|nu|nul|-)$/, '$1').replace(/(\d)\.$/, '$1');
  /* A dangling `"key":` or `"key"` inside an object cannot be closed into anything valid: drop it. */
  /* Only in an object: in an array a string after a comma is a value, not a key. */
  const inner = scan(out).stack;
  if (inner[inner.length - 1] === '}') out = out.replace(/(,|\{)\s*"(?:[^"\\]|\\.)*"\s*:?\s*$/, '$1');
  out = out.replace(/,\s*$/, '');
  return out + scan(out).stack.reverse().join('');
}

export interface PartialResult {
  value: unknown;
  complete: boolean;
}

export function parsePartialJson(text: string): PartialResult | undefined {
  const s = text.trim();
  if (!s) return undefined;
  try {
    return { value: JSON.parse(s), complete: true };
  } catch {
    /* fall through */
  }
  const { cuts } = scan(s);
  const candidates = [s.length, ...cuts.slice().reverse()];
  for (const end of candidates.slice(0, 64)) {
    try {
      return { value: JSON.parse(close(s.slice(0, end))), complete: false };
    } catch {
      /* try a shorter prefix */
    }
  }
  return undefined;
}

export interface RepairResult {
  value: unknown;
  fixes: string[];
}

/** Repairs a complete line. Returns undefined when it is not JSON by any reasonable reading. */
export function repairJson(text: string): RepairResult | undefined {
  const fixes: string[] = [];
  let s = text.trim();
  try {
    return { value: JSON.parse(s), fixes };
  } catch {
    /* repair below */
  }
  const step = (re: RegExp, to: string, why: string): void => {
    const next = s.replace(re, to);
    if (next !== s) {
      s = next;
      fixes.push(why);
    }
  };
  step(/^```[a-z]*\s*|\s*```$/g, '', 'removed a code fence');
  step(/^\s*\/\/.*$/gm, '', 'removed a comment');
  step(/,\s*([}\]])/g, '$1', 'removed a trailing comma');
  /* Only a line written entirely in single quotes: an apostrophe inside a "string" is text. */
  if (!s.includes('"')) step(/'((?:[^'\\]|\\.)*)'/g, '"$1"', 'replaced single quotes');
  step(/([{,]\s*)([A-Za-z_$][\w$-]*)\s*:(?=\s*["'{[\d\-tfn])/g, '$1"$2":', 'quoted a bare key');
  step(/\bTrue\b/g, 'true', 'True -> true');
  step(/\bFalse\b/g, 'false', 'False -> false');
  step(/\bNone\b/g, 'null', 'None -> null');
  try {
    return { value: JSON.parse(s), fixes };
  } catch {
    /* an unbalanced line: close it like a partial one */
  }
  const p = parsePartialJson(s);
  if (p && p.value != null && typeof p.value === 'object') {
    fixes.push('closed unbalanced brackets');
    return { value: p.value, fixes };
  }
  return undefined;
}
