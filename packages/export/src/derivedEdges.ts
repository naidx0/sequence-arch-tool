/* ══════════════════════════════════════════════════════════════════════════
   DERIVED CONNECTORS — the weaker claim, and it says so
   packages/export/src/derivedEdges.ts

   Owner walk 2026-08-22: "Between the services, they might not be directly
   connected, but there could be some type of dotted lines or maybe a dot
   connector that shows how the analyzer or whatever it outputs can interact
   with the next board."

   ── WHAT THIS IS NOT ──────────────────────────────────────────────────────

   `project.ts:124` drops `kind === 'import'` before the diagram is built, and
   THAT SKIP STAYS. Its three reasons are recorded in ConnectedBoard and the
   first one binds absolutely: an import says one FILE names another. Drawing
   it between two SERVICES asserts at the system level something that was only
   ever measured at the file level, and CANON's first non-negotiable is that a
   tool asserting a false edge with a citation is worse than no tool.

   So this module does not lift imports into service calls. It produces a
   different KIND of thing, and everything about it is built to stay different:

     · it reports a COUNT of imports and never a call,
     · it is flagged `derived`, so a renderer cannot mistake it for a scan edge,
     · it never carries the traced proof vocabulary — `proofOf` marks `import`
       traced, and spending the strongest proof word on the weakest claim is
       the third reason those edges were skipped in the first place,
     · it is THRESHOLDED, because sheet 08's "a graph's overflow is a hairball"
       is not a metaphor here: the real repository is 1,348 imports across ten
       services, very nearly every ordered pair, and an edge present between
       almost every two nodes carries no information at all,
     · and it keeps its evidence, so the count can be checked. A number nobody
       can open is what CANON law 4 forbids.

   PURE, and it shares `buildLift` with the real projector rather than walking
   parents itself — two different answers to "which service is this file in"
   would be a defect nobody could see.
   ══════════════════════════════════════════════════════════════════════════ */

import type { ArchGraph, Evidence } from '@sequence/schema';

import { buildLift } from './project.js';

/** One aggregated import relationship between two lifted containers. */
export interface DerivedEdge {
  /**
   * Graph id of the importing container — the STABLE join key.
   *
   * A saved board document carries display labels ("Acp service") where the graph
   * carries ids ("svc:acp"), so joining a board to these edges on `src`/`dst` matched
   * nothing and left the Imports toggle disabled on every such board. Join on the ids.
   */
  srcId: string;
  /** Graph id of the imported container — the stable join key. */
  dstId: string;
  /** Lifted label of the importing side. */
  src: string;
  /** Lifted label of the imported side. */
  dst: string;
  /** How many file-level imports cross this boundary. The whole content. */
  imports: number;
  /** What a reader should see. Counts imports; never says "calls". */
  label: string;
  /** Always true. A renderer keys its dotted, arrowless style off this. */
  derived: true;
  /** The member imports, so the count can be opened and checked. */
  evidence: Evidence[];
}

export interface DerivedOptions {
  /**
   * The floor. Below it a pair is not drawn.
   *
   * This exists because the honest aggregate is unreadable: on Sequence's own
   * repository the import graph over ten services is nearly complete, and a
   * complete graph is a grey disc.
   */
  minImports: number;
  /** Cap on retained evidence per edge, so a 300-import pair stays openable. */
  maxEvidence?: number;
}

export const DERIVED_DEFAULTS: DerivedOptions = {
  /*
   * NOT 1, DELIBERATELY. A floor of one draws every pair sharing a single
   * import, which is the hairball arriving by default rather than by choice.
   * Three is the smallest floor that means "these two are actually entangled"
   * rather than "someone imported a type once".
   */
  minImports: 3,
  maxEvidence: 12,
};

/**
 * Aggregate a graph's file-level imports into container-level derived edges.
 *
 * Self-pairs are dropped: a service importing its own files is every service,
 * and a self-loop saying so is ink that carries no claim. Direction is kept —
 * an undirected edge would invent a dependency in the direction the scan did
 * not find one.
 */
export function deriveImportEdges(
  graph: ArchGraph,
  opts: Partial<DerivedOptions> = {},
): DerivedEdge[] {
  const { minImports, maxEvidence } = { ...DERIVED_DEFAULTS, ...opts };
  const lift = buildLift(graph);

  const acc = new Map<
    string,
    { srcId: string; dstId: string; src: string; dst: string; imports: number; evidence: Evidence[] }
  >();

  for (const e of graph.edges) {
    if (e.kind !== 'import') continue;

    const src = lift(e.srcId);
    const dst = lift(e.dstId);
    /* A file outside every service lifts to nothing. It is not an error and it
       is not drawn — there is no container to attach the claim to. */
    if (!src || !dst) continue;
    /* Compared by ID, not label: a board document may carry a display label where the
       graph carries a bare id, and two containers could share a label. */
    if (src.id === dst.id) continue;

    const key = `${src.id} -> ${dst.id}`;
    let row = acc.get(key);
    if (!row) {
      row = { srcId: src.id, dstId: dst.id, src: src.label, dst: dst.label, imports: 0, evidence: [] };
      acc.set(key, row);
    }
    row.imports += 1;
    if (row.evidence.length < (maxEvidence ?? DERIVED_DEFAULTS.maxEvidence!)) {
      for (const ev of e.evidence ?? []) row.evidence.push(ev);
    }
  }

  return [...acc.values()]
    .filter((row) => row.imports >= minImports)
    /* Sorted by key, not by count: a board two people are reading must not
       reshuffle because one import moved. */
    .sort((a, b) => `${a.srcId} -> ${a.dstId}`.localeCompare(`${b.srcId} -> ${b.dstId}`))
    .map((row) => ({
      srcId: row.srcId,
      dstId: row.dstId,
      src: row.src,
      dst: row.dst,
      imports: row.imports,
      /* The label IS the claim, and the claim is arithmetic. "imports" is a
         fact about files; every stronger word here would be a fact about
         behaviour that nothing measured. */
      label: `${row.imports} import${row.imports === 1 ? '' : 's'}`,
      derived: true as const,
      /* Sorted, so the array does not depend on the order the scan happened to
         emit its edges in. Without this, two runs over the same repository
         produce equal edges carrying unequal evidence — a difference nothing
         on screen would show and every snapshot would catch. */
      evidence: [...row.evidence].sort(
        (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
      ),
    }));
}
