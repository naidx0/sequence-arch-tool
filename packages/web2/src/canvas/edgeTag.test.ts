import { describe, expect, it } from 'vitest';

import { EDGE_TAG_MAX, edgeTag } from './edgeTag';
import { projectDocument } from './project';

/* ══════════════════════════════════════════════════════════════════════════
   THE MEASUREMENT, FIRST. With edge labels wired through, this monorepo's one
   scanned connector arrived carrying every member label the projector had
   joined together — "read user_daily_usage, read user_usage, write
   user_daily_usage, write user_usage" — which paints 480px of --t-10 mono
   lying across the board, measured in the shipped bundle at 1:1. An SVG <text>
   has no `text-overflow`, so nothing downstream can clip it: the budget applies
   to the STRING or not at all.
   ══════════════════════════════════════════════════════════════════════════ */

const MEASURED = 'read user_daily_usage, read user_usage, write user_daily_usage, write user_usage';

describe('an edge tag fits on the connector it labels', () => {
  it('keeps a short label exactly as it was, and says nothing was cut', () => {
    expect(edgeTag('POST /charge')).toEqual({ text: 'POST /charge' });
    expect(edgeTag('84 imports')).toEqual({ text: '84 imports' });
  });

  it('answers null for a label there is none of', () => {
    expect(edgeTag(undefined)).toBeNull();
    expect(edgeTag('   ')).toBeNull();
  });

  it('shortens the label measured on this repository, and COUNTS what it dropped', () => {
    const tag = edgeTag(MEASURED)!;
    expect(tag.text.length).toBeLessThanOrEqual(EDGE_TAG_MAX);
    /* Keeping the first member whole says strictly more than cutting mid-word
       through the second: '+3 more' is a measurement, not a hiding. */
    expect(tag.text).toBe('read user_daily_u… +3 more');
    // And the whole thing survives, for the connector to hand over on hover.
    expect(tag.full).toBe(MEASURED);
  });

  it('never exceeds the budget, whatever it is handed', () => {
    const cases = [
      MEASURED,
      'GET /a/very/long/path/that/keeps/going/and/going/for/ages',
      'a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p',
      'onereallylongsinglewordwithnobreaksatallanywhere',
    ];
    for (const label of cases) {
      const tag = edgeTag(label)!;
      expect(tag.text.length, label).toBeLessThanOrEqual(EDGE_TAG_MAX);
      expect(tag.full, label).toBe(label);
    }
  });

  it('does not claim a shortening it did not make', () => {
    /* `full` present means "there is more"; absent means "this is all of it".
       A caller must be able to tell them apart without comparing strings. */
    expect(edgeTag('db read')!.full).toBeUndefined();
  });
});

describe('the projector applies the budget', () => {
  it('cuts the long label and carries the whole one beside it', () => {
    const doc = {
      version: 1 as const,
      nodes: [
        { id: 'a', kind: 'service', label: 'a' },
        { id: 'b', kind: 'datastore', label: 'b' },
      ],
      edges: [{ id: 'e1', from: 'a', to: 'b', family: 'db', label: MEASURED }],
    };
    const [edge] = projectDocument(doc as never).edges;
    expect(edge!.label!.length).toBeLessThanOrEqual(EDGE_TAG_MAX);
    expect(edge!.labelFull).toBe(MEASURED);
  });

  it('leaves `labelFull` off entirely when nothing was cut', () => {
    const doc = {
      version: 1 as const,
      nodes: [
        { id: 'a', kind: 'service', label: 'a' },
        { id: 'b', kind: 'service', label: 'b' },
      ],
      edges: [{ id: 'e1', from: 'a', to: 'b', family: 'http', label: 'POST /charge' }],
    };
    const [edge] = projectDocument(doc as never).edges;
    expect(edge!.label).toBe('POST /charge');
    expect('labelFull' in edge!).toBe(false);
  });
});
