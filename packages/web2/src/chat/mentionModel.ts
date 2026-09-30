/* ══════════════════════════════════════════════════════════════════════════
   THE `@` PICKER, RESOLVED AGAINST THE GRAPH
   packages/web2/src/chat/mentionModel.ts

   Sheet 12.4, and this is the whole design in the book's own words:

     "@ resolves against the graph, or it resolves against nothing. The picker
      offers only targets that exist in the attached repo — architecture nodes,
      files and functions, each with the glyph its kind owns on the board. Where
      nothing matches it says so and offers NO FREE-TEXT FALLBACK, because a
      reference the engine cannot resolve is the exact thing this product exists
      to prevent."

   A picker that let someone type `@paymnts` and send it anyway would hand the
   engine an identifier it cannot look up, and the turn that followed would be
   the model guessing at a name. Guessing at names is what grounding is for.

   THE CHIP IS THE SAME OBJECT A CARD CLICK PRODUCES. `ConnectedBoard` already
   says so at its own call site — "the same one the `@` picker uses, so a node
   chip and a mention chip are the same object". Two shapes for one concept is
   how a composer ends up with a chip the engine can resolve from one path and
   cannot from the other.

   PURE AND REACT-FREE, like `flowFocus` and `railModel` beside it: the picker's
   arithmetic is answerable without a DOM, so a test can ask it a question
   directly rather than by typing into a textarea.
   ══════════════════════════════════════════════════════════════════════════ */

import type { ArchGraph, ArchNode, FunctionGraph } from '@sequence/schema';

import type { ContextChip, MentionResult } from '../state/types';

/** `NodeKind` is not exported from state/types — it is `ArchNode['kind']` there
 *  too, so this is the same type rather than a second name for it. */
type NodeKind = ArchNode['kind'];

/**
 * How many rows the picker may offer.
 *
 * Sheet 12.4 draws a short list under a composer, not a file tree. A picker
 * that returned three hundred rows would be a worse way to find a file than the
 * rail the reader already has, and the answer to "I cannot see it" is to type
 * another character.
 */
export const MENTION_LIMIT = 8;

/** The `@…` token the caret is inside, with the offsets that replace it. */
export interface MentionToken {
  query: string;
  from: number;
  to: number;
}

/**
 * Find the `@token` the caret sits inside.
 *
 * The `@` must start a word: `max@example.com` is an address and
 * `@decorator` after an identifier is not a reference, so opening a picker
 * there would fight the user's typing rather than help it.
 *
 * A bare `@` opens the picker with an empty query, because the placeholder
 * promises the affordance and one that only appeared after a character would be
 * invisible to anyone who did not already know it was there.
 */
export function detectMention(draft: string, caret: number): MentionToken | null {
  const upto = draft.slice(0, Math.max(0, Math.min(caret, draft.length)));
  const at = upto.lastIndexOf('@');
  if (at < 0) return null;

  /* Word character before the `@` ⇒ not a mention. */
  if (at > 0 && /[\w.]/.test(draft[at - 1] ?? '')) return null;

  const query = upto.slice(at + 1);
  /* A mention is ONE word. Whitespace ends the token, and the caret being past
     it means the user has moved on. */
  if (/\s/.test(query)) return null;

  return { query, from: at, to: at + 1 + query.length };
}

/** Everything the picker may offer, flattened once so ranking stays cheap. */
export interface MentionSources {
  entries: MentionResult[];
}

const SYSTEM_KINDS = new Set(['service', 'datastore', 'topic', 'module']);

/**
 * Flatten a graph (and the function index, when it has been fetched) into the
 * things a mention may name.
 *
 * `ref` is the identifier the ENGINE resolves, never the display label: an
 * `ArchNode.id` for a node, a repo-relative path for a file, a `FunctionId` for
 * a function. That is what makes the chip grounded.
 */
export function mentionSources(
  graph: ArchGraph | null,
  functions: FunctionGraph | null,
): MentionSources {
  const entries: MentionResult[] = [];
  if (!graph) return { entries };

  for (const n of graph.nodes) {
    if (n.kind === 'file' && typeof n.path === 'string') {
      entries.push({
        kind: 'file',
        ref: n.path,
        label: n.label ?? n.path,
        detail: n.path,
        nodeKind: null,
      });
      continue;
    }
    if (!SYSTEM_KINDS.has(n.kind)) continue;
    entries.push({
      kind: 'node',
      ref: n.id,
      label: n.label ?? n.id,
      detail: typeof n.path === 'string' ? n.path : null,
      nodeKind: n.kind as NodeKind,
    });
  }

  for (const f of functions?.nodes ?? []) {
    const fn = f as { id?: string; name?: string; file?: string; line?: number };
    if (!fn.id || !fn.name) continue;
    entries.push({
      kind: 'function',
      ref: fn.id,
      label: fn.name,
      /* A bare function name is ambiguous across a repo — `handle` exists in a
         dozen files — so the row names where it is. */
      detail: fn.file ? `${fn.file}${fn.line ? `:${fn.line}` : ''}` : null,
      nodeKind: null,
    });
  }

  return { entries };
}

/** Prefix beats substring; ties broken by length then alphabetically. */
function score(entry: MentionResult, q: string): number | null {
  if (q === '') return 2;
  const label = entry.label.toLowerCase();
  const detail = (entry.detail ?? '').toLowerCase();
  if (label.startsWith(q)) return 0;
  if (label.includes(q)) return 1;
  /* A file is matched on its PATH as well as its name: two files called
     `index.ts` are told apart by their path, and that is what a reader types to
     disambiguate them. */
  if (detail.includes(q)) return 2;
  return null;
}

export function rankMentions(query: string, sources: MentionSources): MentionResult[] {
  const q = query.trim().toLowerCase();
  const scored: { entry: MentionResult; rank: number }[] = [];
  for (const entry of sources.entries) {
    const rank = score(entry, q);
    if (rank === null) continue; // no match is NO ROW — sheet 12.4's ruling
    scored.push({ entry, rank });
  }
  /*
   * KIND IS A TIEBREAK, AND IT IS COARSEST-FIRST.
   *
   * `@pay` in an architecture tool most likely means the payments SERVICE, not
   * `pay.ts` — both are prefix matches, and without this rule the shorter label
   * won, which is a coincidence rather than a reason. Nodes name the thing a
   * person reasons about; files and functions are where it lives.
   */
  const kindRank: Record<MentionResult['kind'], number> = {
    node: 0,
    file: 1,
    function: 2,
    'canvas-block': 3,
  };
  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      kindRank[a.entry.kind] - kindRank[b.entry.kind] ||
      a.entry.label.length - b.entry.label.length ||
      a.entry.label.localeCompare(b.entry.label) ||
      a.entry.ref.localeCompare(b.entry.ref),
  );
  return scored.slice(0, MENTION_LIMIT).map((s) => s.entry);
}

/**
 * The chip a chosen mention becomes — byte-identical to the one a card click
 * produces, which is the point.
 *
 * `id` is derived from the ref so choosing the same target twice does not stack
 * two identical chips: `composer/chip-add` is a set on id, and a chip list with
 * the same node in it three times is a context the reader did not build.
 */
export function chipFromMention(result: MentionResult): ContextChip {
  return {
    id: `${result.kind}:${result.ref}`,
    kind: result.kind,
    ref: result.ref,
    label: result.label,
    nodeKind: result.nodeKind,
  };
}

/** Replace the `@token` in `draft` with nothing, leaving the caret where it was. */
export function draftWithoutToken(draft: string, token: MentionToken): string {
  return `${draft.slice(0, token.from)}${draft.slice(token.to)}`;
}
