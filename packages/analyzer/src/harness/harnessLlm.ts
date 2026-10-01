/**
 * Harness LLM helpers — optional keyed paths for distill + refine (Wave 3).
 * When no key is configured, callers fall back to template bodies gracefully.
 */

import type { SkillCluster } from './skillDistill.js';
import type { RefineEvidence } from './refineProposal.js';

export type HarnessLlmCaller = (prompt: string) => Promise<string | undefined>;

/** Build a distill prompt grounded to real trajectory evidence only. */
export function buildSkillDistillPrompt(input: {
  cluster: SkillCluster;
  name: string;
  description: string;
}): string {
  const { cluster, name, description } = input;
  const questions = cluster.docs
    .map((d) => (typeof d.question === 'string' ? d.question.trim() : ''))
    .filter((q) => q.length > 0);
  const uniqueQuestions = [...new Set(questions)];
  const lines: string[] = [
    'Write a concise SKILL.md markdown body (no YAML frontmatter) for a repo harness skill.',
    `Skill name: ${name}`,
    `Description: ${description}`,
    '',
    'Evidence run ids (cite only these — do not invent runs):',
    ...cluster.runIds.map((id) => `- ${id}`),
  ];
  if (cluster.filePaths.length > 0) {
    lines.push('', 'Files actually read across these runs:');
    for (const p of cluster.filePaths) lines.push(`- ${p}`);
  }
  if (uniqueQuestions.length > 0) {
    lines.push('', 'Representative questions from the cluster:');
    for (const q of uniqueQuestions.slice(0, 5)) lines.push(`- ${q}`);
  }
  lines.push(
    '',
    'Requirements:',
    '- Summarise the repeatable pattern these asks share.',
    '- List pitfalls or tips grounded in the evidence above.',
    '- Do NOT invent services, files, or run ids not listed.',
    '- Keep under 1200 characters.',
  );
  return lines.join('\n');
}

/** Build a refine enhancer prompt grounded to real failure evidence. */
export function buildRefineEnhancePrompt(input: {
  trigger: string;
  evidence: RefineEvidence;
  before: string;
  templateAfter: string;
  isSkill: boolean;
  skillName?: string;
}): string {
  const lines: string[] = [
    'Improve the following harness refinement draft for a coding repo.',
    `Trigger: ${input.trigger}`,
    '',
    'Failed run ids (only cite these):',
    ...input.evidence.runIds.map((id) => `- ${id}`),
  ];
  if (input.evidence.filePaths.length > 0) {
    lines.push('', 'Files touched in failed runs:');
    for (const p of input.evidence.filePaths) lines.push(`- ${p}`);
  }
  lines.push(
    '',
    input.isSkill
      ? `Target: SKILL.md pitfalls section for "${input.skillName ?? 'skill'}".`
      : 'Target: .sequence/memory/NOTES.md tip line.',
    '',
    'Current target content (before):',
    '---',
    input.before.length > 0 ? input.before.slice(0, 2000) : '(empty — new file)',
    '---',
    '',
    'Template draft to improve (keep structure, add grounded detail):',
    '---',
    input.templateAfter.slice(0, 3000),
    '---',
    '',
    'Return the FULL proposed file content only (no commentary). Do not invent run ids or paths.',
  );
  return lines.join('\n');
}

/** Wrap a metered provider call as a harness LLM caller (undefined on failure). */
export function harnessLlmCaller(
  call: (prompt: string) => Promise<{ text: string }>,
): HarnessLlmCaller {
  return async (prompt: string) => {
    try {
      const { text } = await call(prompt);
      const trimmed = text.trim();
      return trimmed.length > 0 ? trimmed : undefined;
    } catch {
      return undefined;
    }
  };
}
