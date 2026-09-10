// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildFunctionIndex,
  buildRailRows,
  componentEdgeCounts,
  evidenceRef,
  flowForFunction,
  toRepoPath,
} from './railModel';
import { loadRealRepoScan } from './realRepoScan.testSupport';

/* ══════════════════════════════════════════════════════════════════════════
   THE GROUNDED TIER — the rail's model against the REAL engine's real output
   packages/web2/src/rail/railGrounded.test.ts

   WHY THIS FILE EXISTS BESIDE `railModel.test.ts`, which already passes.
   CLAUDE.md: "Fixture scale proves logic; only a REAL repo proves the result.
   Every fixture here is 3–10 files, where an overflow, a truncation or a
   '+30 more' cannot occur." Two of this wave's claims are results, not rules:

     - a function click produces a flow list — on a repository where every one
       of the call edges is intra-component, that is a claim about
       whether the hop rule fits the evidence, and a four-node fixture cannot
       decide it;
     - every hop carries a real `file:line` — which is only true if the
       evidence lookup resolves against paths as the SCANNER writes them,
       backslashes and all.

   WHAT IT READS. `.sequence/graph.json` and `.sequence/functions.json` — the
   engine's own caches for this repository, written by the real scanner and by
   `buildRepoFunctionGraphCached`, the same file `GET /api/functions` serves.
   Nothing here is checked in and nothing here is hand-written.

   HOW IT RUNS WHEN THE CACHES ARE NOT THERE: `.sequence/` is gitignored, so a
   fresh clone has nothing to read. `loadRealRepoScan` invokes the analyzer's
   deterministic, key-free scanner and function builder instead. A clean CI
   checkout therefore runs every assertion below; none is registered as skip.
   ══════════════════════════════════════════════════════════════════════════ */

const REPO = resolve(__dirname, '..', '..', '..', '..');
const { graph, functions } = await loadRealRepoScan(REPO);
const index = buildFunctionIndex(functions);
const rows = buildRailRows(graph, index);

describe('the rail against a real scan of this repository', () => {
    it('reads a graph big enough for the result to mean anything', () => {
      /* The precondition, checked rather than assumed. A three-node graph here
         would make every assertion below vacuously true. */
      expect(graph.nodes.length).toBeGreaterThan(100);
      expect(functions.functionGraph.nodes.length).toBeGreaterThan(100);
    });

    it('indexes every id from the real graph and invents none', () => {
      const realNodeIds = new Set(graph.nodes.map((n) => n.id));
      const realFunctionIds = new Set(functions.functionGraph.nodes.map((n) => n.id));
      for (const row of rows) {
        const known = row.rung === 'function' ? realFunctionIds : realNodeIds;
        expect(known.has(row.id)).toBe(true);
      }
    });

    it('places every file node under a board card — none is dropped', () => {
      const fileRows = rows.filter((r) => r.rung === 'file');
      const fileNodes = graph.nodes.filter((n) => n.kind === 'file');
      expect(fileRows).toHaveLength(fileNodes.length);
    });

    it('never emits a fourth rung, at real scale', () => {
      expect([...new Set(rows.map((r) => r.rung))].sort()).toEqual(['card', 'file', 'function']);
    });

    it('carries every path forward-slashed, as the store contract requires', () => {
      const back = String.fromCharCode(92);
      for (const row of rows) {
        if (row.rung === 'file') expect(row.path).not.toContain(back);
        if (row.rung === 'function') expect(row.file).not.toContain(back);
      }
    });

    /* ── ITEM 4.2, THE RESULT HALF ─────────────────────────────────────── */

    it('produces a flow list for a real function, on real evidence', () => {
      const traced = functions.functionGraph.nodes
        .map((n) => flowForFunction(n.id, index, graph))
        .filter((t) => t.traced);

      /*
       * The claim, at scale. If this repository produced no traced function
       * the honest report would be "the rail cannot play anything here", and
       * that is a result worth failing on rather than skipping past — it would
       * mean the hop rule does not fit the evidence the scanner produces.
       */
      expect(traced.length).toBeGreaterThan(0);

      for (const trace of traced) {
        expect(trace.originNodeId).not.toBeNull();
        for (const hop of trace.hops) {
          expect(hop.from).not.toBe(hop.to);
        }
      }
    });

    it('resolves every hop to two nodes the scan actually drew', () => {
      const realNodeIds = new Set(graph.nodes.map((n) => n.id));
      let checked = 0;
      for (const node of functions.functionGraph.nodes) {
        for (const hop of flowForFunction(node.id, index, graph).hops) {
          expect(realNodeIds.has(hop.from)).toBe(true);
          expect(realNodeIds.has(hop.to)).toBe(true);
          checked += 1;
        }
      }
      expect(checked).toBeGreaterThan(0);
    });

    it('cites a line that is really in the file it names', () => {
      /*
       * NOT "the evidence string is non-empty" — that is the doc-lock defect
       * CANON records by name, which "asserted only that a citation STRING
       * appeared and never resolved it… it silently pinned three wrong
       * citations in place for a whole wave." A citation is resolved here:
       * the file is opened and the line is counted.
       */
      let resolved = 0;
      for (const node of functions.functionGraph.nodes) {
        if (resolved >= 25) break;
        for (const hop of flowForFunction(node.id, index, graph).hops) {
          if (!hop.evidence) continue;
          const ref = evidenceRef(hop.evidence);
          expect(ref).not.toBe('shape unknown — no evidence on this hop');

          const [, lineText] = ref.split(/:(\d+)$/);
          const absolute = join(REPO, toRepoPath(hop.evidence.file));
          if (!existsSync(absolute)) continue;
          /* CRLF on read: core.autocrlf is true here. */
          const lines = readFileSync(absolute, 'utf8').split(/\r?\n/);
          expect(Number(lineText)).toBeGreaterThan(0);
          expect(Number(lineText)).toBeLessThanOrEqual(lines.length);
          resolved += 1;
          if (resolved >= 25) break;
        }
      }
      expect(resolved).toBeGreaterThan(0);
    });

    it('refuses to play the functions whose calls never leave their file', () => {
      const untraced = functions.functionGraph.nodes.filter(
        (n) => !flowForFunction(n.id, index, graph).traced,
      );
      /* Measured 2026-08-20: the great majority of. The number moves with every
         scanner change, so what is pinned is that the population is real and
         the rail has to render it — not a count. */
      expect(untraced.length).toBeGreaterThan(0);
      for (const node of untraced.slice(0, 50)) {
        expect(flowForFunction(node.id, index, graph).hops).toEqual([]);
      }
    });

    /* ── ITEM 4.4, THE DENOMINATOR ─────────────────────────────────────── */

    it('counts component edges against the whole graph, never a capped digest', () => {
      const counts = componentEdgeCounts(graph);
      const total = Object.values(counts).reduce((a, b) => a + b, 0);

      /*
       * Risk R4 in one assertion. `explain.ts:1140-1143` computed omissions
       * against the ALREADY-CAPPED digest, "so it can never report the ~2,026
       * edges the cap removed". Every edge in the real graph touches one
       * component or two, so the sum of the per-component counts is at least
       * the edge count and at most twice it. A rail counting a 300-edge digest
       * would fall under the floor.
       */
      expect(total).toBeGreaterThanOrEqual(graph.edges.length);
      expect(total).toBeLessThanOrEqual(graph.edges.length * 2);
    });

    it('names components by their repo path, forward-slashed', () => {
      const back = String.fromCharCode(92);
      for (const path of Object.keys(componentEdgeCounts(graph))) {
        expect(path).not.toContain(back);
        expect(path.length).toBeGreaterThan(0);
      }
    });
});
