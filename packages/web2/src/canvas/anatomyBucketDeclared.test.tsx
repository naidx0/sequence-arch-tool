import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '../tokens/graphite.css';
import './board.css';

import { anatomyExtraHeight, anatomyPanel, ANATOMY_NOTE_H, isAnatomyBucket } from './anatomy';
import { AnatomyPanel } from './visual/AnatomyPanel';
import type { ArchGraph } from '@sequence/schema';

/**
 * THE ONE CELL THAT IS NOT A THING IN THE REPOSITORY MUST SAY SO.
 *
 * A mixed container's loose files are gathered into a single synthetic bucket
 * cell — `anatomy:files:<id>`, labelled "284 loose files" — because drawing
 * `svc:analyzer`'s 284 direct children as 284 cells produced a wall in which
 * almost none of them could be read. That aggregation is right, and it is the
 * only cell on the map whose subject does not exist in the scan.
 *
 * MEASURED ON THE REAL MONOREPO (docs/research/repo-on-the-board-2026-09-09.md):
 * the bucket cell for `analyzer` is 61.7 x 115.0 and its label needs 96px, so it
 * misses by 34.29px and DOES NOT RENDER. The bucket is also built with
 * `kind: 'file'`. So a reader meets a large unnamed rectangle styled exactly like
 * a single source file, and nothing on screen says it stands for 284 of them.
 *
 * THAT IS THE FAULT THIS FILE IS ABOUT, and it is not the general label rule.
 * The other 48 unlabelled cells are real nodes whose names are one hover away —
 * `<title>` carries them and a screen reader reads them. Withholding a name is a
 * legibility trade. Withholding the fact that a cell is an AGGREGATE is a
 * different claim: the reader is not missing a label, they are being shown a
 * structure the repository does not have. What a view cannot draw it draws as
 * absence, and absence reads as a fact.
 *
 * WHY A NOTE AND NOT A NEW MARK. The panel already answers exactly this for the
 * other synthetic thing on the map: children that roll up to zero lines go to a
 * band, and the band is declared in prose — "The bottom band holds N parts with
 * no files. It is not drawn to scale." Same problem, same mechanism, no new
 * visual language invented and no existing rule weakened. In particular the
 * label predicate is NOT loosened: it exists because a name that overflows lands
 * on its neighbour and reads as the neighbour's.
 *
 * AND THE HEIGHT IS RESERVED, because this repository has already made the
 * opposite mistake once. `cardBox.ts` records it: passing a boolean rather than
 * the panel "under-reserved by 42 units on every container with an empty child".
 * A second note that nothing reserves room for paints over the card's own
 * border, so `anatomyExtraHeight` has to count notes rather than test one flag.
 */

/**
 * THE NOTE APPEARS ONLY WHERE THE NAME DOES NOT, and the first version of this
 * file got that wrong. Its fixture gave the bucket the full 129px width, so
 * "3 loose files" fitted, and the precondition guard failed with "expected 129
 * to be less than 84" — the fixture did not reproduce the reported shape at all.
 * CLAUDE.md says it outright: fixture scale proves logic, only a real repo proves
 * the result.
 *
 * Fixing the fixture also fixed the design. Where the label renders, the cell
 * already says it is an aggregate, and a note repeating it would be the exact
 * thing §3 of `docs/AI-CANVAS-IS-A-DOCUMENT.md` refuses — content that names
 * itself is not labelled again. So there are two fixtures: one whose bucket is
 * too small to carry its name, one whose bucket carries it.
 */

/** Bucket far too small for its name: a big module beside three tiny files. */
const GRAPH: ArchGraph = {
  version: 1,
  mode: 'scan',
  scannedAt: '2026-09-09T00:00:00.000Z',
  repoRoot: '/fixtures/anatomy-bucket',
  repoName: 'anatomy-bucket',
  nodes: [
    { id: 'repo', kind: 'repo', label: 'anatomy-bucket' },
    { id: 'svc:api', kind: 'service', label: 'api', parentId: 'repo', path: 'api' },
    { id: 'mod:api/0', kind: 'module', label: 'server', parentId: 'svc:api', path: 'api/src' },
    {
      id: 'file:api/src/server.ts',
      kind: 'file',
      label: 'server.ts',
      parentId: 'mod:api/0',
      path: 'api/src/server.ts',
      meta: { loc: 4000 },
    },
    /* THREE DIRECT FILE CHILDREN. The bucket forms at two or more; three proves
       the note reports a count rather than the word "some". */
    {
      id: 'file:api/a.test.ts',
      kind: 'file',
      label: 'a.test.ts',
      parentId: 'svc:api',
      path: 'api/a.test.ts',
      meta: { loc: 10 },
    },
    {
      id: 'file:api/b.test.ts',
      kind: 'file',
      label: 'b.test.ts',
      parentId: 'svc:api',
      path: 'api/b.test.ts',
      meta: { loc: 8 },
    },
    {
      id: 'file:api/c.test.ts',
      kind: 'file',
      label: 'c.test.ts',
      parentId: 'svc:api',
      path: 'api/c.test.ts',
      meta: { loc: 6 },
    },
  ],
  edges: [],
  warnings: [],
};

/**
 * A bucket BIG ENOUGH to carry its own name — the §3 case.
 *
 * The loose files dominate here, so the bucket takes a rectangle that fits
 * "3 loose files" and says what it is without help. A note here would restate
 * the cell, which is the duplication the design refuses. Without this fixture the
 * suite could not tell "declare an unnamed aggregate" from "always declare".
 */
const BUCKET_FITS: ArchGraph = {
  ...GRAPH,
  nodes: GRAPH.nodes.map((n) =>
    n.id === 'file:api/src/server.ts'
      ? { ...n, meta: { loc: 20 } }
      : n.id.endsWith('.test.ts')
        ? { ...n, meta: { loc: 400 } }
        : n,
  ),
};

/** A container with ONE loose file — below the bucket threshold. */
const NO_BUCKET: ArchGraph = {
  ...GRAPH,
  nodes: GRAPH.nodes.filter(
    (n) => n.id !== 'file:api/b.test.ts' && n.id !== 'file:api/c.test.ts',
  ),
};

function panelFor(graph: ArchGraph) {
  return anatomyPanel(graph, 'svc:api');
}

describe('the loose-file bucket declares itself', () => {
  it('THE FIXTURE IS THE REPORTED SHAPE: a bucket exists and its label does not fit', () => {
    /*
     * The vacuity guard. Every assertion below is about a bucket, so a fixture
     * that stopped producing one would make them all pass while checking
     * nothing — and the label not fitting is the precondition for the note
     * mattering at all.
     */
    const panel = panelFor(GRAPH);
    const bucket = panel.cells.find((c) => isAnatomyBucket(c.id));
    expect(bucket, 'fixture no longer buckets — the rest of this file is vacuous').toBeDefined();
    expect(bucket!.label).toBe('3 loose files');
    /*
     * BOTH HALVES OF THE PREDICATE, because checking one of them is a different
     * question. The first version asserted only the width and failed with
     * "expected 129 to be less than 84" — true of the width and irrelevant: with
     * two cells the treemap hands the bucket a full-width horizontal SLICE, so
     * it is 129 wide and less than a pixel tall, and the name is withheld on
     * HEIGHT. A guard that tests one of two conditions can be wrong about the
     * one it does not test, which is how this file's own instrument was wrong
     * twice before it was right once.
     */
    const fits = bucket!.rect.h >= 12 && bucket!.rect.w >= bucket!.label.length * 6 + 6;
    expect(
      fits,
      `if the label now fits (${bucket!.rect.w.toFixed(1)}x${bucket!.rect.h.toFixed(1)}), this fault is gone and this file should be revisited`,
    ).toBe(false);
  });

  it('READS THE DOM: a note says the cell is an aggregate, and how many it holds', () => {
    render(<AnatomyPanel panel={panelFor(GRAPH)} kind="service" onClose={() => {}} />);
    const note = document.querySelector('[data-testid="board-node-anatomy-bucket"]');
    expect(note, 'nothing on screen says a cell stands for more than one file').not.toBeNull();
    expect(note!.textContent, 'the count is the honest part').toContain('3');
  });

  it('READS THE DOM: no note when the bucket carries its own name — §3', () => {
    /*
     * THE LIMIT THAT KEEPS THE NOTE A DECLARATION RATHER THAN FURNITURE. Where
     * the cell renders "3 loose files" itself, a sentence underneath repeating it
     * is content labelled twice. This case is what separates "declare an unnamed
     * aggregate" from "always declare", and a mutation proved the suite could not
     * tell those apart until this fixture existed.
     */
    const panel = panelFor(BUCKET_FITS);
    const bucket = panel.cells.find((c) => isAnatomyBucket(c.id));
    expect(bucket, 'fixture must still bucket').toBeDefined();
    const fits = bucket!.rect.h >= 12 && bucket!.rect.w >= bucket!.label.length * 6 + 6;
    expect(fits, 'this fixture exists to make the label FIT').toBe(true);
    expect(panel.bucketUnnamed, 'the cell says it, so the panel owes nothing').toBe(false);
    render(<AnatomyPanel panel={panel} kind="service" onClose={() => {}} />);
    expect(document.querySelector('[data-testid="board-node-anatomy-bucket"]')).toBeNull();
  });

  it('READS THE DOM: no such note when nothing was gathered', () => {
    /*
     * A note that always appears is not a declaration, it is furniture. One
     * loose file is drawn as itself, so there is no aggregate to declare.
     */
    const panel = panelFor(NO_BUCKET);
    expect(panel.cells.some((c) => isAnatomyBucket(c.id))).toBe(false);
    render(<AnatomyPanel panel={panel} kind="service" onClose={() => {}} />);
    expect(document.querySelector('[data-testid="board-node-anatomy-bucket"]')).toBeNull();
  });

  it('RESERVES THE ROOM: the card grows for the bucket note, as it does for the zero note', () => {
    /*
     * THE MISTAKE THIS REPOSITORY ALREADY MADE ONCE, in `cardBox.ts`'s own
     * words: a boolean "under-reserved by 42 units on every container with an
     * empty child". An unreserved note is a paint over the card's border, so the
     * reservation must count the notes that will actually render.
     */
    const withBucket = anatomyExtraHeight(panelFor(GRAPH));
    const without = anatomyExtraHeight(panelFor(NO_BUCKET));
    expect(withBucket - without, 'exactly one note of room').toBe(ANATOMY_NOTE_H);
  });
});
