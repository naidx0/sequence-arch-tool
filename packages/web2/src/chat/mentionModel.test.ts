import { describe, expect, it } from 'vitest';

import { MENTION_LIMIT, detectMention, mentionSources, rankMentions } from './mentionModel';
import type { ArchGraph } from '@sequence/schema';

/**
 * `@` RESOLVES AGAINST THE GRAPH, OR IT RESOLVES AGAINST NOTHING.
 *
 * Sheet 12.4, in as many words: "The picker offers only targets that exist in
 * the attached repo — architecture nodes, files and functions… Where nothing
 * matches it says so and offers NO FREE-TEXT FALLBACK, because a reference the
 * engine cannot resolve is the exact thing this product exists to prevent."
 *
 * That ruling is the whole design. A picker that let a user type `@paymnts` and
 * send it anyway would hand the engine an identifier it cannot look up, and the
 * turn that followed would be the model guessing at a name — which is what
 * grounding is for.
 *
 * The chip a mention produces is the SAME OBJECT a card click produces.
 * `ConnectedBoard` says so at its own call site: "the same one the `@` picker
 * uses, so a node chip and a mention chip are the same object". Two shapes for
 * one concept is how the composer ends up with a chip the engine cannot resolve
 * from one path and can from the other.
 */

const GRAPH = {
  version: 1,
  mode: 'scan',
  scannedAt: '',
  repoRoot: '/repo',
  repoName: 'shop',
  nodes: [
    { id: 'svc:payments', label: 'payments', kind: 'service' },
    { id: 'svc:orders', label: 'orders', kind: 'service' },
    { id: 'ds:postgres', label: 'postgres', kind: 'datastore' },
    { id: 'file:src/pay.ts', label: 'pay.ts', kind: 'file', path: 'src/pay.ts' },
    { id: 'file:src/order.ts', label: 'order.ts', kind: 'file', path: 'src/order.ts' },
  ],
  edges: [],
  warnings: [],
} as unknown as ArchGraph;

const FUNCTIONS = {
  nodes: [
    { id: 'fn:src/pay.ts#charge', name: 'charge', file: 'src/pay.ts', line: 12 },
    { id: 'fn:src/order.ts#place', name: 'place', file: 'src/order.ts', line: 4 },
  ],
  edges: [],
} as never;

const SOURCES = mentionSources(GRAPH, FUNCTIONS);

/* ═══ detecting the token ═════════════════════════════════════════════════ */

describe('detectMention', () => {
  it('finds the @token the caret is inside, with its offsets', () => {
    const draft = 'what calls @pay';
    const m = detectMention(draft, draft.length);
    expect(m).toEqual({ query: 'pay', from: 11, to: 15 });
  });

  it('a bare @ opens the picker with an empty query', () => {
    /* The picker must open on the `@` itself — waiting for a character would
       make the affordance invisible to anyone who does not already know it is
       there, and the placeholder promises it. */
    expect(detectMention('ask @', 5)).toEqual({ query: '', from: 4, to: 5 });
  });

  it('is null when the caret has left the token', () => {
    const draft = 'what calls @pay and more';
    expect(detectMention(draft, draft.length)).toBeNull();
  });

  it('a space closes the token — a mention is one word', () => {
    expect(detectMention('@pay ', 5)).toBeNull();
  });

  it('an email is not a mention', () => {
    /* `@` after a word character is an address, a handle or a decorator, not a
       reference. Opening a picker there would fight the user's typing. */
    expect(detectMention('mail me at max@example.com', 25)).toBeNull();
  });

  it('finds the token when the caret is mid-word, not only at the end', () => {
    const draft = '@payments and orders';
    /* Caret after "@pay" — the user is still typing inside the token. */
    expect(detectMention(draft, 4)).toEqual({ query: 'pay', from: 0, to: 4 });
  });

  it('no @ at all is null', () => {
    expect(detectMention('what calls pay', 14)).toBeNull();
  });
});

/* ═══ ranking, over things that actually exist ════════════════════════════ */

describe('rankMentions', () => {
  it('matches nodes, files and functions in one list', () => {
    const kinds = new Set(rankMentions('', SOURCES).map((r) => r.kind));
    expect(kinds).toEqual(new Set(['node', 'file', 'function']));
  });

  it('a prefix match outranks a substring match', () => {
    /* `orders` STARTS with the query; `src/order.ts` only contains it in its
       path. A reader who typed the characters meant the thing that begins with
       them. (An earlier version of this test used `pay`, where `pay.ts` is
       ALSO a prefix match — it was testing the tiebreak, not the rule.) */
    const results = rankMentions('order', SOURCES);
    expect(results[0]!.label).toBe('orders');
  });

  it('at equal rank a node outranks a file — coarsest first', () => {
    /*
     * `@pay` matches the payments SERVICE and `pay.ts` as prefixes both. In an
     * architecture tool the service is what a person reasons about; the file is
     * where it lives. Without this rule the shorter label won, which is a
     * coincidence rather than a reason.
     */
    const results = rankMentions('pay', SOURCES);
    expect(results[0]!.kind).toBe('node');
    expect(results[0]!.label).toBe('payments');
  });

  it('matching is case-insensitive', () => {
    expect(rankMentions('PAY', SOURCES).some((r) => r.label === 'payments')).toBe(true);
  });

  it('a file matches on its PATH, not only its basename', () => {
    /* Two files called `index.ts` are told apart by their path, and that is
       what a user types to disambiguate. */
    expect(rankMentions('src/order', SOURCES).some((r) => r.ref === 'src/order.ts')).toBe(true);
  });

  it('nothing that matches nothing is returned — no free-text fallback', () => {
    /*
     * Sheet 12.4's ruling. An unresolvable reference is the exact thing this
     * product exists to prevent, so the empty list is the answer and the
     * surface renders "No grounded matches" rather than offering the raw text.
     */
    expect(rankMentions('paymnts-typo', SOURCES)).toEqual([]);
  });

  it('an empty graph offers nothing at all', () => {
    const empty = mentionSources(
      { ...GRAPH, nodes: [] } as unknown as ArchGraph,
      null,
    );
    expect(rankMentions('pay', empty)).toEqual([]);
  });

  it('the list is capped, so the picker never becomes a file tree', () => {
    const many = mentionSources(
      {
        ...GRAPH,
        nodes: Array.from({ length: 200 }, (_v, i) => ({
          id: `svc:s${i}`,
          label: `service-${i}`,
          kind: 'service',
        })),
      } as unknown as ArchGraph,
      null,
    );
    expect(rankMentions('service', many)).toHaveLength(MENTION_LIMIT);
  });

  it('results are deterministic — two runs agree', () => {
    expect(rankMentions('or', SOURCES)).toEqual(rankMentions('or', SOURCES));
  });

  it('a node result carries its real id, and a file result its real path', () => {
    /*
     * THE GROUNDING. `ref` is what the turn hands the engine, so it has to be
     * the identifier the engine can resolve — an `ArchNode.id` for a node and a
     * repo-relative path for a file, never a display label.
     */
    const node = rankMentions('payments', SOURCES).find((r) => r.kind === 'node');
    expect(node?.ref).toBe('svc:payments');
    const file = rankMentions('pay.ts', SOURCES).find((r) => r.kind === 'file');
    expect(file?.ref).toBe('src/pay.ts');
  });

  it('a function result names where it is, because a bare name is ambiguous', () => {
    const fn = rankMentions('charge', SOURCES).find((r) => r.kind === 'function');
    expect(fn?.detail).toMatch(/src\/pay\.ts/);
  });
});
