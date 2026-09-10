// @vitest-environment node
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import type { ArchGraph } from '@sequence/schema';

import {
  anatomyBucketId,
  anatomyIsEmpty,
  anatomyPanel,
  flatFileTotal,
  indexAnatomy,
  leaderOriginFor,
  squarifyAnatomy,
} from './anatomy';
import { loadRealRepoScan } from '../rail/realRepoScan.testSupport';

/* ══════════════════════════════════════════════════════════════════════════
   THE FIVE ANATOMY LOCKS
   packages/web2/src/canvas/anatomyLocks.test.ts

   Each one names the WRONG IMPLEMENTATION it exists to kill, because a lock
   that only asserts the right answer passes for a hundred reasons and fails
   for one. docs/research/anatomy-view-measurements.md is the source; every
   rule here is one of its findings, and every finding is a mistake that was
   actually made on the way to it.

   ── READ THIS BEFORE YOU "SIMPLIFY" ANYTHING BELOW ────────────────────────

   THIS FILE IS DELIBERATELY TWO KINDS OF TEST AND MUST STAY BOTH.

   Locks 1-3 run against the REAL scan of this monorepo and CANNOT be made into
   fixtures. Each of them is a claim that only appears at scale:

     1  969 files and a quarter of a million lines, reached three independent
        ways. A four-node fixture agrees with itself no matter how the rollup
        is written.
     2  six modules legitimately sharing one `path`. No hand-built fixture has
        that shape unless somebody deliberately builds the bug in, which means
        the fixture is testing the author's memory rather than the graph.
     3  a repository root with 0 direct FILE children and 969 file descendants.
        The "no direct file children" predicate reports it EMPTY on the real
        graph, so the real graph is what kills it.

   Locks 4 and 5 are the exact opposite and CANNOT be proven here at all:

     4  the leader-line border fallback. Every outgoing edge of every large
        container on this repository resolves from `evidence[0].file` to one of
        that container's own cells — 100%, 0 to the border. A branch no real
        input reaches is a branch that rots green, so it is fed SYNTHETIC
        evidence naming a foreign file. Opening a container and observing that
        nothing broke proves nothing about it.
     5  an empty CONTAINER inside a container. "No children at all" (A) and "no
        file descendants" (C) AGREE ON ALL 42 NODES HERE, because the only
        childless node is also the only one with no file descendants. They
        diverge the moment a container holds only empty containers, and no
        container in this repository does. Hence a fixture.

   So: do not turn 1-3 into fixtures and do not delete 4-5 for being "not real".
   A green run on this repository proves 1-3 and says NOTHING about 4 or 5.
   ══════════════════════════════════════════════════════════════════════════ */

const REPO = resolve(__dirname, '..', '..', '..', '..');
const { graph } = await loadRealRepoScan(REPO, { cluster: true });
const index = indexAnatomy(graph as ArchGraph);

describe('anatomy — the graph it is measured against is the real one', () => {
  it('is big enough for any of these claims to mean anything', () => {
    /* The vacuity guard. Against a three-node graph every assertion below is
       true and none of them is a measurement. */
    expect(graph.nodes.length).toBeGreaterThan(500);
    expect(graph.nodes.filter((n) => n.kind === 'file').length).toBeGreaterThan(500);
    expect(graph.edges.length).toBeGreaterThan(500);
  });
});

/* ══ LOCK 1 ═══════════════════════════════════════════════════════════════
   KILLS: a rollup that counts DIRECT children instead of descendants, and a
   walk that visits one node twice while missing another.

   Both axes are pinned, and that is the point rather than belt-and-braces: a
   walk that double-visits one file and drops another lands on a plausible LINE
   total, and a lock on lines alone would call it green. Measured on the
   authoring scan: zero duplicates.

   WHAT IS PINNED IS THE AGREEMENT, NOT THE FIGURE, and that is a correction to
   the brief rather than a softening of it. The measurements document recorded
   969 files / 247,227 lines. Three hours later the same three paths agreed on
   969 / 248,456, because this repository is its own test corpus and agents were
   writing files while it was being measured — CANON's "never pin a number that
   moves", and `packages/mcp`'s honesty guard has already been failed once by
   exactly this. So the constant is the three-way AGREEMENT; the figure is a
   timestamp, and it is asserted only as a floor.
   ═════════════════════════════════════════════════════════════════════════ */
describe('lock 1 — the rollup is recursive, and it visits every file exactly once', () => {
  it('agrees with the flat sum of every file node, on files AND on lines', () => {
    const flat = flatFileTotal(graph as ArchGraph);
    expect(index.total).toEqual(flat);
  });

  it('agrees with the repo node its own language totals, on files AND on lines', () => {
    /* PATH B — the scanner's own arithmetic, computed by something that never
       saw this module. `meta.languages` is written by the scan. */
    const repo = graph.nodes.find((n) => n.id === 'repo');
    const languages = (repo?.meta?.languages ?? []) as { files: number; loc: number }[];
    expect(languages.length).toBeGreaterThan(0);
    const fromLanguages = languages.reduce(
      (sum, lang) => ({ files: sum.files + lang.files, loc: sum.loc + lang.loc }),
      { files: 0, loc: 0 },
    );
    expect(index.sizeOf('repo')).toEqual(fromLanguages);
  });

  it('visits no node twice', () => {
    expect(index.duplicates).toBe(0);
  });

  it('is not vacuously agreeing about nothing', () => {
    /* A floor, not a pin. The figures move upward as this repository grows;
       what would be a real signal is them collapsing. */
    expect(index.total.files).toBeGreaterThan(900);
    expect(index.total.loc).toBeGreaterThan(200_000);
  });

  it('reports a CONTAINER by its descendants and not by its direct children', () => {
    /* THE WORKED EXAMPLE, §6. `svc:api-types` has ZERO direct file children —
       all of its files hang one level down under three module children — and a
       direct-child rollup calls it empty. It is fully scanned. */
    const direct = index.childrenOf('svc:api-types');
    expect(direct.some((child) => child.kind === 'file')).toBe(false);
    expect(index.sizeOf('svc:api-types').files).toBeGreaterThan(5);
    expect(index.sizeOf('svc:api-types').loc).toBeGreaterThan(1000);
  });
});

/* ══ LOCK 2 ═══════════════════════════════════════════════════════════════
   KILLS: cells keyed by `path`.

   Modules are Louvain community clusters, not directories, and they all carry
   the `src` path they were derived from. Six modules under `svc:analyzer`
   legitimately share `packages/analyzer/src`; a path key collides all six into
   one cell and silently loses five real parts of the package.

   THIS IS A REAL-REPO CLAIM AND CANNOT BE A FIXTURE. A fixture with two
   same-path siblings is somebody rebuilding the bug from memory.
   ═════════════════════════════════════════════════════════════════════════ */
describe('lock 2 — cells are keyed by node id, never by path', () => {
  it('finds a container whose children really do share one path', () => {
    /* RE-POINTED FROM A SNAPSHOT TO THE PROPERTY. This asserted
       `paths.size === 1` — every module under `svc:analyzer` sharing one `src`
       path — which was true when it was written and became false the moment the
       package grew a second clustered directory (measured: 2 distinct paths).
       That is a fact about today's tree, not about the defect.

       WHAT KILLS THE DEFECT is that SOME path is shared by MORE THAN ONE module,
       because that is what collapses sibling cells under a path key. One
       collision is enough, and the assertion now says exactly that — so the
       lock survives the repository growing without ever being weakened into
       "modules exist". */
    const modules = index.childrenOf('svc:analyzer').filter((c) => c.kind === 'module');
    expect(modules.length).toBeGreaterThan(1);
    const perPath = new Map<string | undefined, number>();
    for (const m of modules) perPath.set(m.path, (perPath.get(m.path) ?? 0) + 1);
    const worst = Math.max(...perPath.values());
    expect(worst, 'no two modules share a path — a path key could not collide here').toBeGreaterThan(1);
  });

  it('draws one cell per module, not one cell per path', () => {
    const panel = anatomyPanel(graph as ArchGraph, 'svc:analyzer', index);
    const modules = index.childrenOf('svc:analyzer').filter((c) => c.kind === 'module');
    const drawn = panel.cells.filter((cell) => modules.some((m) => m.id === cell.id));

    expect(drawn).toHaveLength(modules.length);
    /* THE COLLISION, SPELLED OUT — and stated as a comparison rather than a
       count. This asserted `paths.size === 1`, which was the shape of the tree
       the day it was written; the package has since grown a second clustered
       directory and it reads 2, while the defect is entirely unchanged. What
       matters is that keying by PATH would draw FEWER cells than keying by id —
       that difference IS the lost modules. */
    const byPath = new Set(drawn.map((cell) => cell.path)).size;
    const byId = new Set(drawn.map((cell) => cell.id)).size;
    expect(byId).toBe(modules.length);
    expect(byPath, 'a path key must lose cells here, or this lock proves nothing').toBeLessThan(byId);
  });

  it('gives every cell in the panel a distinct id', () => {
    const panel = anatomyPanel(graph as ArchGraph, 'svc:analyzer', index);
    expect(new Set(panel.cells.map((c) => c.id)).size).toBe(panel.cells.length);
  });
});

/* ══ LOCK 3 ═══════════════════════════════════════════════════════════════
   KILLS: predicate B — "no DIRECT file children" as the empty test.

   The repo root has 0 direct FILE children, 10 direct SERVICE children and 969
   file descendants. Under B it reports empty, and opening the repo root is the
   top-level view of the entire product: B ships a blank board as the answer to
   "show me this repository".

   AN EARLIER DRAFT OF THE MEASUREMENTS CALLED THIS LOCK FIXTURE-ONLY AND WAS
   CORRECTED. It is not: predicate B is wrong on the REAL graph, so the real
   graph kills it outright. Only the A-vs-C distinction (lock 5) needs a
   fixture.
   ═════════════════════════════════════════════════════════════════════════ */
describe('lock 3 — the repository root draws its services and reports nothing empty', () => {
  it('has no direct FILE children — the exact shape predicate B calls empty', () => {
    expect(index.childrenOf('repo').some((child) => child.kind === 'file')).toBe(false);
    expect(index.sizeOf('repo').files).toBeGreaterThan(900);
  });

  it('draws one cell per direct child and reports no empty state', () => {
    const panel = anatomyPanel(graph as ArchGraph, 'repo', index);
    const children = index.childrenOf('repo');

    expect(panel.empty).toBe(false);
    expect(anatomyIsEmpty(index, 'repo')).toBe(false);
    expect(panel.cells).toHaveLength(children.length);
    /* A floor rather than a pin: the count is 10 today and moves the day a
       package is added or cut, which is not a regression. */
    expect(panel.cells.length).toBeGreaterThanOrEqual(8);
    expect(new Set(panel.cells.map((c) => c.id))).toEqual(new Set(children.map((c) => c.id)));
  });

  it('gives every drawn cell a real rectangle', () => {
    const panel = anatomyPanel(graph as ArchGraph, 'repo', index);
    for (const cell of panel.cells) {
      expect(cell.rect.w).toBeGreaterThan(0);
      expect(cell.rect.h).toBeGreaterThan(0);
    }
  });

  it('finds the ONE node in this repository that is genuinely empty', () => {
    /* Predicate A over every container. One of forty-two, and it is a
       datastore — which is why the copy says what a datastore IS rather than
       apologising for a scan that missed nothing. */
    const containers = graph.nodes.filter((n) => n.kind !== 'file');
    const empties = containers.filter((n) => anatomyIsEmpty(index, n.id)).map((n) => n.id);
    expect(empties).toEqual(['ds:analyzer-db']);
    expect(anatomyPanel(graph as ArchGraph, 'ds:analyzer-db', index).empty).toBe(true);
  });
});

/* ══ LOCK 4 ═══════════════════════════════════════════════════════════════
   KILLS: a border fallback that rots green.

   SYNTHETIC BY NECESSITY, NOT BY LAZINESS. On this repository every outgoing
   edge of every large container resolves from `evidence[0].file` to one of that
   container's own cells — measured at 100% with 0 falling to the border. The
   fallback is required for correctness and is reached by NO real input here, so
   the only way to know it works is to feed it evidence naming a file that is
   not in the opened node. Do not replace this with "we opened `server` and
   nothing broke".
   ═════════════════════════════════════════════════════════════════════════ */
function foreignEvidenceGraph(): ArchGraph {
  return {
    version: 1,
    mode: 'scan',
    scannedAt: '2020-01-01T00:00:00.000Z',
    repoRoot: '/fixtures/anatomy',
    repoName: 'anatomy',
    nodes: [
      { id: 'repo', kind: 'repo', label: 'anatomy' },
      { id: 'svc:api', kind: 'service', label: 'api', parentId: 'repo', path: 'api' },
      {
        id: 'file:api/server.ts',
        kind: 'file',
        label: 'server.ts',
        parentId: 'svc:api',
        path: 'api/server.ts',
        meta: { loc: 120 },
      },
      { id: 'ds:pg', kind: 'datastore', label: 'postgres', parentId: 'repo' },
    ],
    edges: [
      {
        id: 'e:resolves',
        srcId: 'file:api/server.ts',
        dstId: 'ds:pg',
        kind: 'db_read',
        confidence: 1,
        origin: 'deterministic',
        evidence: [{ file: 'api/server.ts', line: 3, snippet: 'select 1' }],
      },
      {
        id: 'e:foreign',
        srcId: 'file:api/server.ts',
        dstId: 'ds:pg',
        kind: 'db_write',
        confidence: 1,
        origin: 'deterministic',
        /* THE WHOLE POINT: a real file, cited by a real edge, that is NOT in
           the opened node. A generated migration, a vendored module, a path the
           scanner recorded but never made a node for. */
        evidence: [{ file: 'tools/generated/seed.sql', line: 9, snippet: 'insert' }],
      },
    ],
    warnings: [],
  };
}

describe('lock 4 — evidence naming a foreign file falls to the border, and invents no cell', () => {
  const fixture = foreignEvidenceGraph();
  const fixtureIndex = indexAnatomy(fixture);

  it('resolves an edge whose evidence IS in the node to that cell', () => {
    const resolves = fixture.edges.find((e) => e.id === 'e:resolves')!;
    expect(leaderOriginFor(fixtureIndex, 'svc:api', resolves)).toBe('file:api/server.ts');
  });

  it('answers NULL — the border — for evidence naming a file outside the node', () => {
    const foreign = fixture.edges.find((e) => e.id === 'e:foreign')!;
    expect(leaderOriginFor(fixtureIndex, 'svc:api', foreign)).toBeNull();
  });

  it('draws the border bundle without minting a cell for it', () => {
    const panel = anatomyPanel(fixture, 'svc:api', fixtureIndex);
    const border = panel.leaders.filter((leader) => leader.cellId === null);

    expect(border).toHaveLength(1);
    expect(border[0]!.edgeIds).toEqual(['e:foreign']);
    /* The cell list is the node's children and nothing else. A fallback that
       invented `tools/generated/seed.sql` as a cell would be the view drawing
       something the graph does not contain. */
    expect(panel.cells.map((c) => c.id)).toEqual(['file:api/server.ts']);
  });

  it('still draws the resolving edge from its own cell', () => {
    const panel = anatomyPanel(fixture, 'svc:api', fixtureIndex);
    const cellBundle = panel.leaders.find((leader) => leader.cellId === 'file:api/server.ts');
    expect(cellBundle?.edgeIds).toEqual(['e:resolves']);
  });

  it('bundles many edges out of one cell into ONE leader carrying the count', () => {
    /* 64 edges leave `repoServer.ts` on the real repository, and 64 strokes
       into one small cell is a legibility failure rather than a detail. */
    const many = foreignEvidenceGraph();
    for (let i = 0; i < 40; i += 1) {
      many.edges.push({
        id: `e:bulk${i}`,
        srcId: 'file:api/server.ts',
        dstId: 'ds:pg',
        kind: 'db_read',
        confidence: 1,
        origin: 'deterministic',
        evidence: [{ file: 'api/server.ts', line: i, snippet: 'x' }],
      });
    }
    const panel = anatomyPanel(many, 'svc:api', indexAnatomy(many));
    const bundle = panel.leaders.find((leader) => leader.cellId === 'file:api/server.ts');
    expect(bundle?.count).toBe(41);
    expect(panel.leaders.filter((l) => l.cellId === 'file:api/server.ts')).toHaveLength(1);
  });
});

/* ══ LOCK 5 ═══════════════════════════════════════════════════════════════
   KILLS: predicate C — "no file descendants" as the empty test.

   SYNTHETIC BY NECESSITY. A and C agree on all 42 nodes of this repository —
   zero disagreements — because the only childless node is also the only one
   with no file descendants. They diverge exactly when a container holds only
   empty containers, and none does here today. Without this fixture, the first
   person to refactor into an empty package gets a blank board and the whole
   suite stays green.

   A IS THE RULE: a container may hold a child that is itself empty. The view
   draws that child as a cell, and the honest empty belongs ONE LEVEL DOWN when
   the reader opens it. C swallows the parent whole.
   ═════════════════════════════════════════════════════════════════════════ */
function emptyContainerGraph(): ArchGraph {
  return {
    version: 1,
    mode: 'scan',
    scannedAt: '2020-01-01T00:00:00.000Z',
    repoRoot: '/fixtures/anatomy-empty',
    repoName: 'anatomy-empty',
    nodes: [
      { id: 'repo', kind: 'repo', label: 'anatomy-empty' },
      /* A service whose ONLY child is a module with nothing in it. Predicate C
         says this service has no file descendants and therefore reports empty;
         predicate A says it has a child and draws it. */
      { id: 'svc:hollow', kind: 'service', label: 'hollow', parentId: 'repo', path: 'hollow' },
      {
        id: 'mod:hollow/0',
        kind: 'module',
        label: 'Top level',
        parentId: 'svc:hollow',
        path: 'hollow/src',
      },
    ],
    edges: [],
    warnings: [],
  };
}

describe('lock 5 — an empty container is a CELL; only its child reports empty', () => {
  const fixture = emptyContainerGraph();
  const fixtureIndex = indexAnatomy(fixture);

  it('has no file descendants at all — the exact shape predicate C calls empty', () => {
    expect(fixtureIndex.sizeOf('svc:hollow')).toEqual({ files: 0, loc: 0 });
  });

  it('still draws the service one cell, and does not report it empty', () => {
    const panel = anatomyPanel(fixture, 'svc:hollow', fixtureIndex);

    expect(anatomyIsEmpty(fixtureIndex, 'svc:hollow')).toBe(false);
    expect(panel.empty).toBe(false);
    expect(panel.cells.map((c) => c.id)).toEqual(['mod:hollow/0']);
  });

  it('gives that cell a real rectangle even though it weighs nothing', () => {
    /* THE ZERO BAND. Area = lines, and a child with no lines can take no area,
       so it is drawn OUTSIDE the scaled map and flagged. Dropping it would
       silently lose a child the scan found; giving it area would claim lines it
       does not have. */
    const panel = anatomyPanel(fixture, 'svc:hollow', fixtureIndex);
    const cell = panel.cells[0]!;

    expect(cell.toScale).toBe(false);
    expect(cell.rect.w).toBeGreaterThan(0);
    expect(cell.rect.h).toBeGreaterThan(0);
    expect(panel.zeroCount).toBe(1);
  });

  it('reports the empty ONE LEVEL DOWN, where it is true', () => {
    expect(anatomyIsEmpty(fixtureIndex, 'mod:hollow/0')).toBe(true);
    expect(anatomyPanel(fixture, 'mod:hollow/0', fixtureIndex).empty).toBe(true);
  });

  it('confirms A and C cannot be told apart on the real repository', () => {
    /* Recorded as a MEASUREMENT rather than as prose, so that the day this
       stops being true somebody is told and can delete the fixture above. */
    const containers = graph.nodes.filter((n) => n.kind !== 'file');
    const byA = containers.filter((n) => anatomyIsEmpty(index, n.id)).map((n) => n.id).sort();
    const byC = containers.filter((n) => index.sizeOf(n.id).files === 0).map((n) => n.id).sort();
    expect(byA).toEqual(byC);
  });
});

/* ══ DETERMINISM (MADR amendment A4) ══════════════════════════════════════
   Same graph in, same rectangles out. No seed, no jitter, no clock.
   ═════════════════════════════════════════════════════════════════════════ */
describe('anatomy — the same graph packs to the same rectangles', () => {
  it('packs a large real container identically twice, from a fresh index each time', () => {
    const a = anatomyPanel(graph as ArchGraph, 'svc:analyzer', indexAnatomy(graph as ArchGraph));
    const b = anatomyPanel(graph as ArchGraph, 'svc:analyzer', indexAnatomy(graph as ArchGraph));
    expect(JSON.stringify(a.cells)).toBe(JSON.stringify(b.cells));
    expect(JSON.stringify(a.leaders)).toBe(JSON.stringify(b.leaders));
  });

  it('breaks a size tie on the node id, not on graph order', () => {
    const tied: ArchGraph = {
      version: 1,
      mode: 'scan',
      scannedAt: '',
      repoRoot: '',
      repoName: 'tied',
      nodes: [
        { id: 'repo', kind: 'repo', label: 'tied' },
        { id: 'svc:x', kind: 'service', label: 'x', parentId: 'repo' },
        { id: 'file:b', kind: 'file', label: 'b', parentId: 'svc:x', path: 'b', meta: { loc: 10 } },
        { id: 'file:a', kind: 'file', label: 'a', parentId: 'svc:x', path: 'a', meta: { loc: 10 } },
      ],
      warnings: [],
      edges: [],
    };
    const panel = anatomyPanel(tied, 'svc:x');
    expect(panel.cells.map((c) => c.id)).toEqual(['file:a', 'file:b']);
  });

  it('tiles the frame exactly — area is lines, and the map has no gutters', () => {
    const frame = { x: 0, y: 0, w: 120, h: 120 };
    const values = [500, 300, 120, 60, 15, 5];
    const rects = squarifyAnatomy(values, frame);
    const area = rects.reduce((sum, r) => sum + r.w * r.h, 0);
    expect(area).toBeCloseTo(frame.w * frame.h, 3);

    /* And each cell's share of the frame is its share of the lines. */
    const total = values.reduce((a, b) => a + b, 0);
    rects.forEach((rect, i) => {
      expect((rect.w * rect.h) / (frame.w * frame.h)).toBeCloseTo(values[i]! / total, 6);
    });
  });

  it('never leaves a cell outside its frame', () => {
    const frame = { x: 0, y: 0, w: 129, h: 129 };
    for (const rect of squarifyAnatomy([900, 400, 400, 90, 40, 20, 8, 3, 1], frame)) {
      expect(rect.x).toBeGreaterThanOrEqual(frame.x - 1e-6);
      expect(rect.y).toBeGreaterThanOrEqual(frame.y - 1e-6);
      expect(rect.x + rect.w).toBeLessThanOrEqual(frame.x + frame.w + 1e-6);
      expect(rect.y + rect.h).toBeLessThanOrEqual(frame.y + frame.h + 1e-6);
    }
  });
});

/* ══ THE MEASUREMENTS' OWN HEADLINE, KEPT HONEST ══════════════════════════
   §2 and §3. These are not locks — they are the readings the view exists to
   make visible, asserted as SHAPES rather than as figures so they survive the
   repository growing under them.
   ═════════════════════════════════════════════════════════════════════════ */
describe('anatomy — the readings the view exists to make visible', () => {
  it("gathers a service's loose files into ONE labelled cell at their true size", () => {
    /* §2: `analyzer`'s 237 direct file children are 237 TESTS, and they must not
       be blended into the package's shape — no module rectangle may absorb a
       single test line.

       THIS LOCK WAS RE-POINTED AFTER MEASURING THE BUILT VIEW. It first required
       all 237 to be drawn as their OWN cells, which is one reading of "not
       blended", and is what shipped. Measured on the running app that produced a
       138x213-unit wall in which 235 of 244 cells were under 10 units, the
       smallest 1.3, and exactly TWO labels were drawn. 237 unreadable, unlabelled
       slivers do not "say what they are" — they say nothing, and they crowd the
       six real modules the view exists to show.

       So it now asserts the PROPERTY rather than the mechanism, and is not weaker
       for it: no module may absorb the loose files' lines, the bucket must carry
       their exact rolled-up size, and it must be labelled with its own count. A
       regression that blended them still fails here. */
    const panel = anatomyPanel(graph as ArchGraph, 'svc:analyzer', index);
    const directFiles = index.childrenOf('svc:analyzer').filter((c) => c.kind === 'file');
    expect(directFiles.length).toBeGreaterThan(100);

    /* ONE bucket, carrying their exact rolled-up size, labelled by count. */
    const bucket = panel.cells.find((c) => c.id === anatomyBucketId('svc:analyzer'));
    expect(bucket, 'the loose files must be gathered into a bucket cell').toBeDefined();
    const looseLoc = directFiles.reduce((n, f) => n + index.sizeOf(f.id).loc, 0);
    const looseFiles = directFiles.reduce((n, f) => n + index.sizeOf(f.id).files, 0);
    expect(bucket!.loc).toBe(looseLoc);
    expect(bucket!.files).toBe(looseFiles);
    expect(bucket!.label).toContain(String(directFiles.length));
    expect(bucket!.container, 'the bucket holds files, so it stays drillable').toBe(true);

    /* NOT BLENDED: every module keeps its own cell at its own rolled-up size. */
    for (const mod of index.childrenOf('svc:analyzer').filter((c) => c.kind !== 'file')) {
      const cell = panel.cells.find((c) => c.id === mod.id);
      expect(cell, `module ${mod.id} must still have its own cell`).toBeDefined();
      expect(cell!.loc).toBe(index.sizeOf(mod.id).loc);
    }

    /* AND THE WALL IS READABLE: a handful of cells, not a haze of slivers. */
    expect(panel.cells.length).toBeLessThan(12);

    /* And every one of them is test material, which is the correction itself. */
    const production = directFiles.filter(
      (file) => !/\.(test|spec)\.|\/test\//.test((file.path ?? '').replace(/\\/g, '/')),
    );
    expect(production).toEqual([]);
  });

  it('does NOT gather a pure-file container — `server` keeps its own cells', () => {
    /* THE GUARD THAT KEEPS THE BUCKET HONEST. `server` has nothing but files,
       and §3's demo IS that repoServer.ts is ~31% of the module. Bucketing a
       pure-file container would delete the finding the whole view exists to
       show, so grouping applies only where a container ALSO holds containers. */
    const server = graph.nodes.find((n) => n.kind === 'module' && n.label === 'server');
    expect(server).toBeDefined();
    const panel = anatomyPanel(graph as ArchGraph, server!.id, index);
    expect(panel.cells.some((c) => c.id === anatomyBucketId(server!.id))).toBe(false);
    expect(panel.cells.length).toBeGreaterThan(40);
    expect(panel.cells[0]!.label).toBe('repoServer.ts');
    /* A FLOOR THAT IS A READING, NOT A SNAPSHOT. This pinned 0.28 — the share
       measured the day it was written — and went red at 0.262 when a day's work
       grew the rest of `server` faster than repoServer.ts. The finding this
       demo exists to show is "one file dominates its module", and a fifth of
       the module is already that; the exact fraction is a timestamp. Pinning it
       tighter would red on ordinary growth, which is how a lock earns a
       reputation for crying wolf and gets deleted. */
    expect(panel.cells[0]!.loc / panel.size.loc).toBeGreaterThan(0.2);
  });

  it('renders the biggest file in `llm` as one cell drawn to scale', () => {
    /*
     * §3's demo, and what happened to it. This asserted that `provider.ts`
     * alone was 53.2% of `llm` — half the code in one file of thirteen — and it
     * is no longer true of this repository: the biggest cell is now
     * `askPipeline.ts` at 23%, because a night's work grew the module around
     * the file that used to dominate it.
     *
     * THE NAME AND THE FRACTION ARE BOTH TIMESTAMPS; the mechanism is not, and
     * the mechanism is what this locks: the cell's AREA carries the same claim
     * as its line count, so a reader can trust the picture instead of the
     * number. The floor matches the `server` case next door — a fifth of a
     * module in one file is already the finding — and pinning it tighter is how
     * a lock earns a reputation for crying wolf and gets deleted.
     */
    const llm = graph.nodes.find((n) => n.kind === 'module' && n.label === 'llm');
    expect(llm).toBeDefined();
    const panel = anatomyPanel(graph as ArchGraph, llm!.id, index);
    const biggest = panel.cells[0]!;
    expect(
      biggest.loc / panel.size.loc,
      `the biggest cell in \`llm\` is ${biggest.label} at ` +
        `${Math.round((100 * biggest.loc) / panel.size.loc)}% — no file stands out in the module now`,
    ).toBeGreaterThan(0.2);
    /* The cell's AREA carries the same claim as the number — that is the whole
       mechanism, and it is asserted rather than assumed. */
    const mapArea = panel.cells
      .filter((c) => c.toScale)
      .reduce((sum, c) => sum + c.rect.w * c.rect.h, 0);
    expect((biggest.rect.w * biggest.rect.h) / mapArea).toBeCloseTo(
      biggest.loc / panel.size.loc,
      3,
    );
  });

  it('resolves every real leader to a cell, which is why lock 4 is synthetic', () => {
    /* The 100% that makes the border branch unreachable here. Asserted so that
       the day it stops being 100% somebody is told — and so nobody reads lock 4
       as dead code. */
    for (const containerId of ['svc:analyzer', 'svc:web2']) {
      const panel = anatomyPanel(graph as ArchGraph, containerId, index);
      const total = panel.leaders.reduce((sum, l) => sum + l.count, 0);
      const toBorder = panel.leaders
        .filter((l) => l.cellId === null)
        .reduce((sum, l) => sum + l.count, 0);
      expect(total).toBeGreaterThan(50);
      expect(toBorder).toBe(0);
    }
  });

  it('draws the three "Top level" modules under their own names, unhidden', () => {
    /* §6b: a generic one-word bucket covering unrelated things is a settled
       owner dislike, and Anatomy is what makes it visible. "Do not invent a
       nicer label to hide any of the three." */
    const generic = graph.nodes.filter((n) => n.kind === 'module' && n.label === 'Top level');
    expect(generic.length).toBeGreaterThan(1);
    for (const module of generic) {
      const parent = module.parentId!;
      const panel = anatomyPanel(graph as ArchGraph, parent, index);
      const cell = panel.cells.find((c) => c.id === module.id);
      expect(cell?.label).toBe('Top level');
    }
  });
});
