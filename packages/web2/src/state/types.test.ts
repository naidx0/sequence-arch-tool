import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AppState } from './types';

/**
 * ITEM 2.1 — THE LOCK ON `state/types.ts`.
 *
 * The plan makes the state contract its own build item and freezes it before
 * 2.2 starts, because every other Wave 2 lane codes against it and a type
 * changed mid-wave is how four agents end up disagreeing (risk R13: the store
 * is the serialization point, 1,627 + 2,387 lines and 92 actions in v1, with
 * every parallel builder editing it in week one).
 *
 * Three rules, each with the specific drift it prevents:
 *
 *   1. TYPES ONLY. No `export const`, `function`, `class` or `enum`. The item
 *      says "types only, no implementation" because a constant that lands here
 *      is a value 2.2 through 2.9 will import, and the file stops being a
 *      contract the moment it becomes a module with behaviour.
 *
 *   2. NO NAME COLLISION WITH `@sequence/api-types`. That package exists to be
 *      the single definition of a wire shape (engine gap G12: roughly sixty
 *      request/response shapes were re-derived by hand at each end and nothing
 *      tied the two together). A second declaration of a name it already
 *      exports is exactly the drift it was extracted to stop.
 *
 *   3. NO STRUCTURAL RE-DECLARATION. Rule 2 only catches a copy that kept the
 *      name. The expensive failure is the copy that renamed: an interface here
 *      whose property set is identical to a wire shape is the same object with
 *      a fresh label, and it will fall out of step silently. So every exported
 *      interface in `types.ts` is compared against every exported interface in
 *      `api-types` by property-name set, and an exact match on two or more
 *      properties fails.
 *
 * A note on `Coverage`. `AskCoverage` lives at
 * `packages/analyzer/src/explain/explain.ts:1214` and is carried on
 * `AskPipelineResult` and on the `result` SSE event, but it has NOT been
 * mirrored into `@sequence/api-types` yet — item 1.1 landed it in the engine
 * this hour and the wire-type package has not caught up. So `Coverage` is
 * declared here today and rule 3 permits it. When 1.1 reaches `api-types/ask.ts`
 * this test goes RED on the property set, and the fix is to delete the local
 * declaration and import the wire type. That red is the mechanism working, not
 * a defect in it.
 */

const HERE = resolve(process.cwd(), 'src', 'state');
const API_TYPES_SRC = resolve(process.cwd(), '..', 'api-types', 'src');

/** Comments carry prose that legitimately names other declarations. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '\n').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** The body of the `{ … }` that starts at `open`, brace-counted. */
function bodyFrom(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return '';
}

/**
 * Top-level property names of an interface body. Depth is counted on `{`, `(`
 * and `[` only — never on `<`, because `=>` and `Record<string, X>` would both
 * unbalance it and a drift guard that mis-parses is worse than none.
 */
function propertyNames(body: string): string[] {
  const names: string[] = [];
  let depth = 0;
  let segment = '';
  const flush = () => {
    const m = /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*:/.exec(segment);
    if (m) names.push(m[1]);
    segment = '';
  };
  for (const ch of body) {
    if (ch === '{' || ch === '(' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ')' || ch === ']') depth -= 1;
    if (depth === 0 && (ch === ';' || ch === '\n')) {
      flush();
      continue;
    }
    segment += ch;
  }
  flush();
  return names;
}

interface Declared {
  /** Every exported interface / type-alias / const / function / class name. */
  names: string[];
  /** Exported interface name → its top-level property names. */
  interfaces: Map<string, string[]>;
  /** Exported names that are values, not types. */
  values: string[];
}

function declarationsIn(raw: string): Declared {
  const text = stripComments(raw);
  const names: string[] = [];
  const values: string[] = [];
  const interfaces = new Map<string, string[]>();

  for (const m of text.matchAll(/export\s+interface\s+([A-Za-z_$][\w$]*)/g)) {
    names.push(m[1]);
    const open = text.indexOf('{', m.index + m[0].length);
    if (open !== -1) interfaces.set(m[1], propertyNames(bodyFrom(text, open)));
  }
  for (const m of text.matchAll(/export\s+type\s+([A-Za-z_$][\w$]*)/g)) names.push(m[1]);
  for (const m of text.matchAll(
    /export\s+(?:declare\s+)?(?:const|let|var|function|class|enum)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    names.push(m[1]);
    values.push(m[1]);
  }
  return { names, interfaces, values };
}

const STATE_SOURCE = readFileSync(join(HERE, 'types.ts'), 'utf8').replace(/\r\n/g, '\n');
const STATE = declarationsIn(STATE_SOURCE);

const API = (() => {
  const names = new Set<string>();
  const interfaces = new Map<string, string[]>();
  for (const entry of readdirSync(API_TYPES_SRC)) {
    if (!entry.endsWith('.ts')) continue;
    const found = declarationsIn(
      readFileSync(join(API_TYPES_SRC, entry), 'utf8').replace(/\r\n/g, '\n'),
    );
    for (const n of found.names) names.add(n);
    for (const [n, props] of found.interfaces) interfaces.set(`${entry}:${n}`, props);
  }
  return { names, interfaces };
})();

/** Compile-time: the root state must still name all seven slices. */
const REQUIRED_SLICES: (keyof AppState)[] = [
  'shell',
  'repo',
  'canvas',
  'rail',
  'session',
  'composer',
  'net',
];

describe('item 2.1 — the frozen state contract', () => {
  it('parses a non-empty contract and a non-empty wire package', () => {
    /*
     * Every rule below is "for each declaration, assert nothing matches", and
     * all of them pass vacuously against an empty parse. This is the test that
     * says so instead of four green ticks that mean nothing.
     */
    expect(STATE.names.length).toBeGreaterThan(20);
    expect(STATE.interfaces.size).toBeGreaterThan(10);
    expect(API.names.size).toBeGreaterThan(100);
    expect(API.interfaces.size).toBeGreaterThan(50);
  });

  it('names every slice on the root state', () => {
    expect(REQUIRED_SLICES).toHaveLength(7);
    expect(new Set(REQUIRED_SLICES).size).toBe(7);
  });

  it('declares types only — no runtime value escapes the contract', () => {
    expect(STATE.values).toEqual([]);
  });

  it('codes against the wire package rather than around it', () => {
    // Non-vacuity for the two rules below: a contract that imports nothing
    // from api-types cannot collide with it, and would pass both while being
    // the exact failure they exist to catch.
    expect(STATE_SOURCE).toContain("from '@sequence/api-types'");
    expect(STATE_SOURCE).toContain("from '@sequence/schema'");
  });

  it('redeclares no name that @sequence/api-types already exports', () => {
    const collisions = STATE.names.filter((n) => API.names.has(n));
    expect(
      collisions,
      'import these from @sequence/api-types instead of redeclaring them: ' +
        collisions.join(', '),
    ).toEqual([]);
  });

  it('redeclares no SHAPE that @sequence/api-types already exports', () => {
    /*
     * TurnEvidence shares the three wire keys of AskHistoryEvidence
     * (filesRead/tools/proposals) but holds richer session values
     * (ToolResultRecord[], ProposalId[]). Renaming the local fields would
     * break chat memory; the wire shape stays the compact string[] form.
     */
    const ALLOWED_SHAPE_MIRRORS = new Set(['TurnEvidence']);
    const collisions: string[] = [];
    for (const [name, props] of STATE.interfaces) {
      if (props.length < 2) continue;
      if (ALLOWED_SHAPE_MIRRORS.has(name)) continue;
      const mine = [...props].sort().join(',');
      for (const [wire, wireProps] of API.interfaces) {
        if (wireProps.length !== props.length) continue;
        if ([...wireProps].sort().join(',') === mine) {
          collisions.push(`${name} === api-types ${wire} { ${mine} }`);
        }
      }
    }
    expect(
      collisions,
      'these state types are wire types wearing a new name: ' + collisions.join(' | '),
    ).toEqual([]);
  });
});
