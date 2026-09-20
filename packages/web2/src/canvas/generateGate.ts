/* ══════════════════════════════════════════════════════════════════════════
   THE GENERATE GATE
   packages/web2/src/canvas/generateGate.ts

   The owner's constraint, verbatim, and it is the sharpest one in the editing
   model:

     "you can do agentic coding with drawing, editing the diagram, and proposing
      code as well, BUT NOT AT EVERY JUNCTION… If somebody does something, it
      doesn't automatically have to propose code."

     "Drawing a box must NOT fire a code proposal. Generate is an explicit act
      with a confirmation step. This is the difference between a canvas that
      thinks with you and one that panics at every stroke."

   So the gate is mostly a REFUSAL, and the most important thing in this file is
   the thing it does not do: creating a node fires nothing. No ask, no proposal,
   no spinner. `docEdit` adds a node and the turn does not move.

   WHAT GENERATE IS, WHEN IT IS ASKED FOR: an explicit act on a node the person
   made, which hands the AI the node and the diagram around it and asks what
   goes in it. Step 4 of the owner's model is that it may answer with a
   DESCRIPTION rather than code — "let a strong architect scaffold it
   themselves" — so `intent` is part of the request rather than a mode the user
   discovers afterwards.

   IT ONLY OFFERS ITSELF ON A NODE NOBODY PROVED. A scanned node already has an
   implementation; asking an AI what goes in `svc:orders` when `orders/` is on
   disk is asking it to invent a second answer to a question the repository has
   already settled. The test for "did a person make this" is the absence of
   `evidenceRef`, which is the same signal `docEdit` uses when it refuses to
   give a drawn node one.
   ══════════════════════════════════════════════════════════════════════════ */

import type { SeqDiagramNode, SeqDiagramV1 } from '@sequence/schema';

/** What Generate may be asked to produce. Step 4 of the owner's model. */
export type GenerateIntent =
  /** A note describing what belongs here. The default, and the safer one. */
  | 'describe'
  /** Scaffolding — files. Downstream, deliberate, and still only a PROPOSAL. */
  | 'scaffold';

export interface GenerateRequest {
  nodeId: string;
  label: string;
  intent: GenerateIntent;
  /** The question put to the model, in the user's own framing where they gave one. */
  prompt: string;
}

/**
 * Whether Generate should be offered on this node at all.
 *
 * `evidenceRef` is the whole test. A node the scan proved has an implementation
 * already; offering to generate one would invite a second answer to a question
 * the repository has settled, and the reader would have no way to tell the
 * invented one from the found one afterwards.
 */
export function isGeneratable(node: Pick<SeqDiagramNode, 'evidenceRef'>): boolean {
  return node.evidenceRef === undefined || node.evidenceRef === '';
}

/**
 * The context a Generate request carries.
 *
 * NEIGHBOURS, NOT THE WHOLE DIAGRAM. What the AI needs to answer "what goes in
 * this box" is what the box is connected to — a service between a gateway and a
 * datastore is a different thing from the same box floating alone, and that
 * difference is the whole of the reader's intent. Sending three hundred
 * unrelated nodes would bury it and cost a prompt budget that item 1.1 already
 * measures.
 */
export function generateContext(
  doc: SeqDiagramV1,
  nodeId: string,
): { inbound: string[]; outbound: string[] } {
  const labelOf = new Map(doc.nodes.map((n) => [n.id, n.label]));
  const inbound: string[] = [];
  const outbound: string[] = [];
  for (const e of doc.edges) {
    if (e.to === nodeId) inbound.push(labelOf.get(e.from) ?? e.from);
    if (e.from === nodeId) outbound.push(labelOf.get(e.to) ?? e.to);
  }
  return { inbound: [...new Set(inbound)].sort(), outbound: [...new Set(outbound)].sort() };
}

/**
 * Build the request. Returns null when the node is not generatable, so a caller
 * cannot route around {@link isGeneratable} by constructing one directly.
 */
export function buildGenerateRequest(
  doc: SeqDiagramV1,
  nodeId: string,
  intent: GenerateIntent,
  userNote?: string,
): GenerateRequest | null {
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node || !isGeneratable(node)) return null;

  const { inbound, outbound } = generateContext(doc, nodeId);
  const connections = [
    inbound.length > 0 ? `It is called by ${inbound.join(', ')}.` : '',
    outbound.length > 0 ? `It calls ${outbound.join(', ')}.` : '',
    inbound.length === 0 && outbound.length === 0
      ? 'Nothing is connected to it yet.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  /*
   * THE USER'S OWN WORDS COME FIRST when they gave any. Step 5 of the owner's
   * model is that the AI reads what the human built AND WHY they built it that
   * way; a prompt that paraphrased their note would be answering a question
   * they did not ask.
   */
  const framing = userNote?.trim()
    ? `The person who drew it said: "${userNote.trim()}"`
    : 'They did not say what it is for.';

  const asked =
    intent === 'describe'
      ? `Describe what belongs in it. Do not propose files.`
      : `Propose the files that would implement it. This is a PROPOSAL — nothing is written until a human accepts it.`;

  return {
    nodeId,
    label: node.label,
    intent,
    prompt: [
      `A person added "${node.label}" to this architecture diagram. It is not in the code yet.`,
      connections,
      framing,
      asked,
    ]
      .filter(Boolean)
      .join(' '),
  };
}
