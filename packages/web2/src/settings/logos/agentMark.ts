import { AGENT_MARKS } from './agentMarks';
import { LOBE_MARKS } from './lobeMarks';
import { AGENT_MARK_ALIAS } from './markKeys';
import type { Mark } from './mark';

/** An agent's packaged mark by its catalog or memory id, or undefined (the page then draws its initial). */
export function agentMark(id: string): Mark | undefined {
  const key = AGENT_MARK_ALIAS[id] ?? id;
  return AGENT_MARKS[key] ?? LOBE_MARKS[key];
}
