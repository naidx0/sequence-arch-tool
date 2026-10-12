/* ══════════════════════════════════════════════════════════════════════════
   SPEC VALIDATION FOR THE VISUAL KIT
   packages/schema/src/visual/check.ts

   Small combinators; every problem names its path and what was found, so an
   agent can fix the call from the message alone:
     spec.series[1].values[3]: expected a number, got "n/a"
   No dependency (the schema package has none), no throwing inside a check:
   problems are collected and reported together (at most MAX_PROBLEMS).
   ══════════════════════════════════════════════════════════════════════════ */

export const MAX_PROBLEMS = 6;

export class Problems {
  readonly list: string[] = [];
  add(msg: string): void {
    this.list.push(msg);
  }
}
export type Check<T> = (v: unknown, path: string, p: Problems) => T;

export class SpecError extends Error {
  constructor(
    readonly component: string,
    readonly problems: string[],
  ) {
    const shown = problems.slice(0, MAX_PROBLEMS);
    const more = problems.length > shown.length ? ` (+${problems.length - shown.length} more)` : '';
    super(`visual ${component}: ${shown.join('; ')}${more}`);
    this.name = 'SpecError';
  }
}

const show = (v: unknown): string => {
  if (v === undefined) return 'nothing';
  if (v === null) return 'null';
  if (typeof v === 'string') return JSON.stringify(v.length > 24 ? `${v.slice(0, 24)}…` : v);
  if (Array.isArray(v)) return `an array of ${v.length}`;
  if (typeof v === 'object') return 'an object';
  return String(v);
};
const missing = (v: unknown): boolean => v === undefined || v === null;

/** Numbers beyond this overflow the axis arithmetic (ranges, ticks, sums) into Infinity and NaN. */
export const MAX_MAGNITUDE = 1e15;

export function num(o: { min?: number; max?: number; int?: boolean } = {}): Check<number> {
  return (v, path, p) => {
    const x = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof x !== 'number' || !Number.isFinite(x)) {
      p.add(`${path}: expected a number, got ${show(v)}`);
      return 0;
    }
    if (Math.abs(x) > MAX_MAGNITUDE) {
      p.add(`${path}: ${x} is too large to draw (at most ${MAX_MAGNITUDE.toExponential(0)} in size)`);
      return 0;
    }
    if (o.int && !Number.isInteger(x)) p.add(`${path}: expected a whole number, got ${x}`);
    if (o.min !== undefined && x < o.min) p.add(`${path}: must be at least ${o.min}, got ${x}`);
    if (o.max !== undefined && x > o.max) p.add(`${path}: must be at most ${o.max}, got ${x}`);
    return x;
  };
}

export function str(o: { max?: number; allowEmpty?: boolean } = {}): Check<string> {
  return (v, path, p) => {
    const x = typeof v === 'number' && Number.isFinite(v) ? String(v) : v;
    if (typeof x !== 'string') {
      p.add(`${path}: expected text, got ${show(v)}`);
      return '';
    }
    if (!o.allowEmpty && x.trim() === '') p.add(`${path}: must not be empty`);
    if (x.length > (o.max ?? 160)) p.add(`${path}: at most ${o.max ?? 160} characters, got ${x.length}`);
    return x;
  };
}

export function bool(): Check<boolean> {
  return (v, path, p) => {
    if (typeof v !== 'boolean') {
      p.add(`${path}: expected true or false, got ${show(v)}`);
      return false;
    }
    return v;
  };
}

export function oneOf<T extends string>(...values: T[]): Check<T> {
  return (v, path, p) => {
    if (typeof v !== 'string' || !values.includes(v as T)) {
      p.add(`${path}: expected one of ${values.map((x) => `"${x}"`).join(', ')}, got ${show(v)}`);
      return values[0]!;
    }
    return v as T;
  };
}

export function arr<T>(item: Check<T>, o: { min?: number; max?: number } = {}): Check<T[]> {
  return (v, path, p) => {
    if (!Array.isArray(v)) {
      p.add(`${path}: expected an array, got ${show(v)}`);
      return [];
    }
    const min = o.min ?? 0;
    const max = o.max ?? 500;
    if (v.length < min) p.add(`${path}: needs at least ${min} item${min === 1 ? '' : 's'}, got ${v.length}`);
    if (v.length > max) {
      p.add(`${path}: at most ${max} items, got ${v.length}`);
      return [];
    }
    return v.map((x, i) => item(x, `${path}[${i}]`, p));
  };
}

export function opt<T>(c: Check<T>): Check<T | undefined> {
  return (v, path, p) => (missing(v) ? undefined : c(v, path, p));
}

/** Text or number, kept as given (axis labels, timeline dates). */
export function strOrNum(): Check<string | number> {
  return (v, path, p) => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') return v;
    p.add(`${path}: expected text or a number, got ${show(v)}`);
    return '';
  };
}

type Shape = Record<string, Check<unknown>>;
export function obj<S extends Shape>(shape: S): Check<{ [K in keyof S]: ReturnType<S[K]> }> {
  return (v, path, p) => {
    const out: Record<string, unknown> = {};
    if (v === null || typeof v !== 'object' || Array.isArray(v)) {
      p.add(`${path}: expected an object with ${Object.keys(shape).join(', ')}, got ${show(v)}`);
      return out as { [K in keyof S]: ReturnType<S[K]> };
    }
    const rec = v as Record<string, unknown>;
    for (const k of Object.keys(rec)) {
      if (!(k in shape)) p.add(`${path}.${k}: unknown key (allowed: ${Object.keys(shape).join(', ')})`);
    }
    for (const [k, c] of Object.entries(shape)) {
      const sub = path === '' ? k : `${path}.${k}`;
      out[k] = c(rec[k], sub, p);
    }
    return out as { [K in keyof S]: ReturnType<S[K]> };
  };
}

/** Required-key objects report a missing key as "expected X, got nothing" through their checker, which is the clear message wanted. */
export function run<T>(component: string, check: Check<T>, spec: unknown, after?: (value: T, p: Problems) => void): T {
  const p = new Problems();
  const value = check(spec, 'spec', p);
  if (p.list.length === 0 && after) after(value, p);
  if (p.list.length > 0) throw new SpecError(component, p.list);
  return value;
}
