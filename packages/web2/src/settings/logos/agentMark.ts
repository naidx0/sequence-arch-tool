import { AGENT_MARKS } from './agentMarks';
import { LOBE_MARKS } from './lobeMarks';
import type { Mark } from './mark';

/* Ids that name the same agent in another list (Shared memory's short ids; the ACP registry's long ones; the launcher's own name). */
const ALIAS: Readonly<Record<string, string>> = {
  claude: 'claude-acp',
  codex: 'codex-acp',
  qwen: 'qwen-code',
  copilot: 'github-copilot-cli',
  'github-copilot': 'github-copilot-cli',
  amp: 'amp-acp',
  'cursor-agent': 'cursor',
  'gemini-cli': 'gemini',
  'hermes-agent': 'hermes',
  droid: 'factory-droid',
  vibe: 'mistral-vibe',
};

/** An agent's packaged mark by its catalog or memory id, or undefined (the page then draws its initial). */
export function agentMark(id: string): Mark | undefined {
  const key = ALIAS[id] ?? id;
  return AGENT_MARKS[key] ?? LOBE_MARKS[key];
}
