import { describe, expect, it } from 'vitest';

import {
  BOARD_KINDS,
  SILHOUETTES,
  boardKindFor,
  legendGroups,
  presentationFor,
  silhouetteClass,
  legendSwatchClass,
  silhouetteGlyph,
  silhouetteLabel,
  silhouetteOf,
} from './kinds';

/**
 * ITEM 3.7 — KIND WITHOUT HUE, AND ENTRY AS A POSITION.
 *
 * This tier locks the MODEL. The greyscale invariant itself cannot be proved
 * here and is not attempted: it is a claim about RENDERED radii, and jsdom does
 * not compute one. `boardRendered.test.ts` measures it in a real browser, which
 * is where the book's own first draft went wrong — it proved the invariant
 * against DECLARED token values and passed while being wrong.
 */
describe('item 3.7 — the kind vocabulary', () => {
  it('has five buildable kinds, and entry is not one of them', () => {
    // Sheet 03.7: "a legend that lists entry among the kinds teaches the reader
    // that entry is a thing you can build, which it is not."
    expect([...BOARD_KINDS]).toEqual(['service', 'module', 'storage', 'topic', 'agent']);
    expect(BOARD_KINDS).not.toContain('entry');
    expect(SILHOUETTES).toContain('entry');
    expect(SILHOUETTES).toHaveLength(6);
  });

  it('gives every silhouette its own class, glyph and word', () => {
    // Decision 2 ranks the icon the STRONGEST of the four channels, so two
    // kinds sharing a glyph is two kinds sharing their strongest carrier.
    const classes = SILHOUETTES.map(silhouetteClass);
    const glyphs = SILHOUETTES.map(silhouetteGlyph);
    const labels = SILHOUETTES.map(silhouetteLabel);

    expect(new Set(classes).size).toBe(SILHOUETTES.length);
    expect(new Set(glyphs).size).toBe(SILHOUETTES.length);
    expect(new Set(labels).size).toBe(SILHOUETTES.length);
  });

  it('uses the substrate’s own class names, not v1’s', () => {
    // _core.html:1276-1281. `.n-store`, never `.arch-rf-card-storage`. The
    // firewall bans the v1 names outright; this says which names ARE right.
    expect(SILHOUETTES.map(silhouetteClass)).toEqual([
      'n-service',
      'n-module',
      'n-store',
      'n-topic',
      'n-agent',
      'n-entry',
    ]);
  });

  it('says Datastore and never Storage', () => {
    // Sheet 01.5's ruling: the identifier `storage` is a short form of the same
    // word, and the LABEL was the defect. "No sheet may print Storage for a
    // node kind."
    expect(silhouetteLabel('storage')).toBe('Datastore');
    expect(SILHOUETTES.map(silhouetteLabel)).not.toContain('Storage');
  });

  it('presents module and package as Module, and file and function too', () => {
    // Sheet 07. A package is not a deployed thing, so Service is the one answer
    // that is wrong for any of them.
    expect(boardKindFor('module')).toBe('module');
    expect(boardKindFor('package')).toBe('module');
    expect(boardKindFor('file')).toBe('module');
    expect(boardKindFor('function')).toBe('module');
    expect(boardKindFor('service')).toBe('service');
    expect(boardKindFor('datastore')).toBe('storage');
    expect(boardKindFor('topic')).toBe('topic');
    expect(boardKindFor('agent')).toBe('agent');
  });

  it('applies the entry heuristic to services only', () => {
    // A datastore called `api-gateway-cache` is not the way in; it is a cache
    // with an unfortunate name. archKinds.ts's rule verbatim.
    const gatewayService = presentationFor({
      id: 'svc:gateway',
      label: 'gateway',
      kind: 'service',
    });
    const gatewayStore = presentationFor({
      id: 'db:gateway-cache',
      label: 'api-gateway-cache',
      kind: 'datastore',
    });

    expect(gatewayService).toEqual({ kind: 'service', entry: true });
    expect(gatewayStore).toEqual({ kind: 'storage', entry: false });
  });

  it('keeps the kind when the position changes, and only changes the silhouette', () => {
    // Sheet 03.7's whole argument: "A service that nothing upstream calls is an
    // entry; make one call to it from inside the scope and it is a service
    // again, WITHOUT HAVING CHANGED WHAT IT IS."
    const asEntry = { kind: 'service', entry: true } as const;
    const asService = { kind: 'service', entry: false } as const;

    expect(asEntry.kind).toBe(asService.kind);
    expect(silhouetteOf(asEntry)).toBe('entry');
    expect(silhouetteOf(asService)).toBe('service');
  });

  it('draws entry APART from the kinds, in its own group', () => {
    const groups = legendGroups();
    expect(groups.map((group) => group.caption)).toEqual(['Kinds', 'Position']);
    expect(groups[0]!.silhouettes).not.toContain('entry');
    expect(groups[1]!.silhouettes).toEqual(['entry']);
  });

  it('draws no separator when there is no second group to separate', () => {
    // The substrate's own rule: "a legend that shows a subset with no entry in
    // it draws no separator."
    const groups = legendGroups(['service', 'agent']);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.caption).toBe('Kinds');
  });

  it('keeps module adjacent to service in the legend order', () => {
    // Sheet 03.3's order is load-bearing: those are the two the reader has to
    // tell apart, and adjacency is what makes the dashed border and the folder
    // tab read as a difference rather than as noise.
    const kinds = legendGroups()[0]!.silhouettes;
    expect(kinds.indexOf('module')).toBe(kinds.indexOf('service') + 1);
  });

  it('paints the module legend swatch with the service chassis', () => {
    expect(legendSwatchClass('module')).toBe('n-service');
    expect(legendSwatchClass('service')).toBe('n-service');
  });
});
