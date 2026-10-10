import type { CanvasDocBlock } from '../state/types';
import type { ContextChip } from '../state/types';
import { canvasBlockHeading } from './aiCanvasBlockMeta';
import type { AiCanvasBlockType } from './aiCanvasBlockMeta';

/** Grounded composer chip for point-to-ask on an AI Canvas block. */
export function canvasBlockChip(block: Pick<CanvasDocBlock, 'id' | 'type' | 'title'>): ContextChip {
  const label = canvasBlockHeading(block.type as AiCanvasBlockType, block.title);
  return {
    id: `canvas-block:${block.id}`,
    kind: 'canvas-block',
    ref: block.id,
    label,
    nodeKind: null,
  };
}
