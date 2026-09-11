import { describe, expect, it } from 'vitest';

import type { SeqDiagramNode } from '@sequence/schema';

import { CARD_FLOOR, cardHeight } from './cardBox';
import { boardNodeFrom, projectDocument } from './project';

/**
 * A CARD MUST NEVER PRINT ITS OWN NAME TWICE.
 *
 * The board card has a title (`.nd-t`) and one line of summary (`.nd-s`). The
 * summary is the analyzer's `whatItIs`. On a real repository that field turns
 * out to restate the label almost every time, so the card rendered the same
 * words on two consecutive rows.
 *
 * MEASURED on ml-harness (292 files, 300 nodeDetail entries), through the
 * running app on 2026-08-21:
 *
 *     exact echo of the label ("db.py" -> "db.py")        293
 *     restates it ("tests" -> "Tests")                      7
 *     genuinely informative                                 0
 *
 * Zero. Every card on that board carried its filename twice, and the service
 * card read "Ml Harness service" above "Ml Harness service". That is two
 * sibling rows reading the same on the product's main surface — the exact thing
 * the legibility gate in CLAUDE.md forbids, and it survived because every
 * fixture in the suite had a hand-written summary that happened to be useful.
 *
 * The rule is enforced HERE, in the view model, rather than in the card: the
 * card's job is to render what it is given, and "is this line worth showing"
 * is a question about the data. Nothing is invented to fill the gap — a card
 * with no real summary is simply shorter, which `cardBox.ts` already supports.
 */

function node(over: Partial<SeqDiagramNode> = {}): SeqDiagramNode {
  return {
    id: 'svc:thing',
    kind: 'service',
    label: 'thing',
    ...over,
  } as SeqDiagramNode;
}

describe('boardNodeFrom — the subtitle earns its line or it is not drawn', () => {
  /*
   * THE FIELD ITSELF IS THE LOCK.
   *
   * `whatItIs` is the structural tree TITLE and `whatItDoes` is its SUMMARY —
   * names that read backwards. The card used to take `whatItIs` and so printed
   * the node name twice: measured on ml-harness, 302 of 311 `whatItIs` values
   * were an exact echo of the label while all 311 `whatItDoes` values said
   * something. This asserts the choice so it cannot silently swap back.
   */
  it('reads the SUMMARY, never the title that merely repeats the label', () => {
    const card = boardNodeFrom(
      node({
        kind: 'file',
        label: 'client.ts',
        detail: {
          whatItIs: 'client.ts',
          whatItDoes: 'Loads the engine client used by the checkout flow.',
        },
      } as Partial<SeqDiagramNode>),
    );
    expect(card.subtitle).toBe('Loads the engine client used by the checkout flow.');
  });

  it('drops path and inventory dumps at first glance — detail waits for select', () => {
    const path = boardNodeFrom(
      node({
        kind: 'file',
        label: 'client.ts',
        detail: {
          whatItIs: 'client.ts',
          whatItDoes: 'frontend/src/lib/engine/client.ts (ts, 563 lines)',
        },
      } as Partial<SeqDiagramNode>),
    );
    expect(path.subtitle).toBeNull();

    const inventory = boardNodeFrom(
      node({
        label: 'frontend',
        detail: { whatItDoes: '18 ts files in frontend, defining App.' },
      } as Partial<SeqDiagramNode>),
    );
    expect(inventory.subtitle).toBeNull();
  });

  it('keeps a summary that says something the label does not', () => {
    const card = boardNodeFrom(
      node({ label: 'payments', detail: { whatItDoes: 'Charges an order and records the receipt.' } } as Partial<SeqDiagramNode>),
    );
    expect(card.subtitle).toBe('Charges an order and records the receipt.');
  });

  it('drops a summary that is the label verbatim — the 293-node case', () => {
    // file:app/db.py -> label "db.py", whatItIs "db.py". Measured, not invented.
    const card = boardNodeFrom(node({ kind: 'file', label: 'db.py', detail: { whatItDoes: 'db.py' } } as Partial<SeqDiagramNode>));
    expect(card.subtitle).toBeNull();
  });

  it('drops a summary that only re-cases or re-punctuates the label', () => {
    // "tests" -> "Tests" and "ml-harness" -> "Ml Harness service": both add
    // nothing a reader could not see on the row above.
    expect(boardNodeFrom(node({ label: 'tests', detail: { whatItDoes: 'Tests' } } as Partial<SeqDiagramNode>)).subtitle).toBeNull();
    expect(
      boardNodeFrom(node({ label: 'ml-harness', detail: { whatItDoes: 'Ml Harness service' } } as Partial<SeqDiagramNode>))
        .subtitle,
    ).toBeNull();
  });

  it('drops a summary that is the label with a kind word appended', () => {
    expect(
      boardNodeFrom(node({ label: 'gateway', detail: { whatItDoes: 'Gateway service' } } as Partial<SeqDiagramNode>)).subtitle,
    ).toBeNull();
    expect(
      boardNodeFrom(node({ kind: 'datastore', label: 'orders', detail: { whatItDoes: 'Orders datastore' } } as Partial<SeqDiagramNode>))
        .subtitle,
    ).toBeNull();
  });

  it('is null when there is no summary at all, never an empty string', () => {
    expect(boardNodeFrom(node({ label: 'thing' })).subtitle).toBeNull();
    expect(boardNodeFrom(node({ label: 'thing', detail: { whatItDoes: '   ' } } as Partial<SeqDiagramNode>)).subtitle).toBeNull();
  });

  /*
   * A longer summary that merely OPENS with the label is still a summary — the
   * reader learns something after the first two words. Only a line that adds
   * nothing is dropped, so the rule cannot quietly delete real content.
   */
  it('keeps a summary that starts with the label but goes on to say more', () => {
    const card = boardNodeFrom(
      node({ label: 'orders', detail: { whatItDoes: 'Orders are validated here before they reach billing.' } } as Partial<SeqDiagramNode>),
    );
    expect(card.subtitle).toBe('Orders are validated here before they reach billing.');
  });
});

describe('projectDocument — blank work-description pitch', () => {
  it('does not reserve the old 96px subtitle+footer chassis between stacked cards', () => {
    /* Owner 2026-08-25: blank work descriptions left dead air as if the glance
       line were still there. Seed layout stacks by each card's own height. */
    const doc = {
      version: 1 as const,
      nodes: [
        { id: 'a', kind: 'service', label: 'a' },
        { id: 'b', kind: 'service', label: 'b' },
      ],
      edges: [],
    };
    const { positions, nodes } = projectDocument(doc as never);
    const blank = nodes.find((n) => n.id === 'a')!;
    expect(blank.subtitle).toBeNull();
    expect(positions.b!.y - positions.a!.y).toBe(cardHeight(blank, 1) + 24);
    expect(positions.b!.y - positions.a!.y).toBe(CARD_FLOOR + 24);
    expect(positions.b!.y - positions.a!.y).toBeLessThan(96);
  });

  it('gives a filled work-description more pitch than a blank neighbour', () => {
    const doc = {
      version: 1 as const,
      nodes: [
        {
          id: 'a',
          kind: 'service',
          label: 'payments',
          detail: { whatItDoes: 'Charges an order and records the receipt.' },
        },
        { id: 'b', kind: 'service', label: 'b' },
      ],
      edges: [],
    };
    const { positions, nodes } = projectDocument(doc as never);
    const filled = nodes.find((n) => n.id === 'a')!;
    expect(filled.subtitle).not.toBeNull();
    expect(positions.b!.y - positions.a!.y).toBe(cardHeight(filled, 1) + 24);
    expect(positions.b!.y - positions.a!.y).toBeGreaterThan(CARD_FLOOR + 24);
  });
});

describe('board-draws-no-edge-labels — the verb on the connector survives projection', () => {
  /*
   * WHAT WAS MEASURED. `SeqDiagramEdge` has carried `label?: string` since the
   * schema was written; `renderSeqDiagramSvg.ts` renders `e.label ?? e.family`
   * for the SAME document through the CLI and the MCP tools. This projector
   * built `{id, source, target, proof}` and dropped it, so `sequence diagram
   * --svg` produced a better picture than the product's own canvas — and an
   * AI-proposed topology lost the verb the model wrote ('publishes
   * order.placed') the moment it landed on the board.
   */
  const doc = {
    version: 1 as const,
    nodes: [
      { id: 'a', kind: 'service', label: 'a' },
      { id: 'b', kind: 'service', label: 'b' },
      { id: 'c', kind: 'service', label: 'c' },
    ],
    edges: [
      { id: 'e1', from: 'a', to: 'b', family: 'queue', label: 'publishes order.placed' },
      { id: 'e2', from: 'b', to: 'c', family: 'http' },
    ],
  };

  it('carries the document’s own edge label onto the board edge', () => {
    const { edges } = projectDocument(doc as never);
    expect(edges.find((e) => e.id === 'e1')!.label).toBe('publishes order.placed');
  });

  it('leaves the KEY ABSENT — not undefined — on an edge the scan gave no verb', () => {
    /* An edge with no label draws no tag rather than an empty one, and the
       shape matters as well as the value: `{label: undefined}` is a different
       object from `{}` to the identity checks `promoteOnFlow` and the router
       lean on to avoid re-routing a board nothing changed on. */
    const { edges } = projectDocument(doc as never);
    const plain = edges.find((e) => e.id === 'e2')!;
    expect('label' in plain).toBe(false);
  });
});

describe('honesty — drawn is not found, and the document says so at rest', () => {
  /*
   * `docEdit` gives a created node NO `evidenceRef`, deliberately, and the
   * board's ghost border said so only while the proposal was still a proposal:
   * Accept clears `addedNodeIds`, the dashed border goes, and from then on a
   * model's invention is pixel-identical to a service the scanner proved. The
   * distinction survived only in the footer, which opens on the selected card
   * one at a time — and even there as an ABSENCE rather than a statement.
   */
  const doc = {
    version: 1 as const,
    nodes: [
      { id: 'svc:found', kind: 'service', label: 'found', evidenceRef: 'scan:packages/a:1' },
      { id: 'svc:claimed', kind: 'service', label: 'claimed', evidenceRef: 'scan:compose.yml' },
      { id: 'svc:drawn', kind: 'service', label: 'drawn' },
    ],
    edges: [],
  };

  it('marks a node nothing on disk points at, whatever the reader has selected', () => {
    const { nodes } = projectDocument(doc as never);
    expect(nodes.find((n) => n.id === 'svc:drawn')!.grounded).toBe(false);
  });

  it('counts a manifest claim as grounded — it is weaker proof, not absent proof', () => {
    /* `provenance` is where the STRENGTH of the proof is said: this one is
       'declared', not 'traced'. `grounded` answers the prior question, and
       collapsing the two would make a docker-compose service look invented. */
    const { nodes } = projectDocument(doc as never);
    const claimed = nodes.find((n) => n.id === 'svc:claimed')!;
    expect(claimed.grounded).toBe(true);
    expect(claimed.provenance).toBe('declared');
    expect(nodes.find((n) => n.id === 'svc:found')!.provenance).toBe('traced');
  });
});
