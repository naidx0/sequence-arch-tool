/**
 * Skill-aware agent nodes.
 *
 * Two optional fields on a program's `agent` node (schema/program.ts) make a skill run as a workflow step:
 *   - `agent.skill`      run that skill (repo or built-in, by slug) over the node's input and keep the fenced
 *                        block of the answer: the "Deepen prompt" block compiles to this.
 *   - `agent.promptFrom` append a state key's text to the node's prompt, so a deepened prompt reaches the next node.
 * The executors themselves know nothing of either: this wraps them, so the app's executors, the CLI's and a test's
 * stub all behave the same.
 */
import { extractFencedPrompt, type NodeExecutor, type ProgramExecutors } from '@sequence/schema';
import { loadSkillBody } from './skillLoader.js';

/** The prompt that runs a skill over some text: the skill's own words, then the text, then how to answer. */
export function buildSkillPrompt(skill: { name: string; body: string }, input: string): string {
  return [
    skill.body.trim(),
    '',
    '---',
    `Run the "${skill.name}" skill above on the task below. Do not do the task itself. End your answer with the rewritten prompt in a single fenced block.`,
    '',
    'Task:',
    input.trim(),
  ].join('\n');
}

/** The text of an executor's value: a plain string (gateway) or `{ text }` (an agent turn). */
export function textOfValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && typeof (value as { text?: unknown }).text === 'string') return (value as { text: string }).text;
  return '';
}

function stateText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === undefined || v === null) return '';
  return JSON.stringify(v);
}

export interface SkillNodeOptions {
  /** The open repository (its own skills win over built-ins), or null. */
  repoRoot: string | null;
  /** Override the built-in skills directory (tests). */
  builtinRoot?: string | null;
}

export function withSkillNodes(executors: ProgramExecutors, opts: SkillNodeOptions): ProgramExecutors {
  const agent: NodeExecutor = async (node, state, ctx) => {
    const a = node.agent;
    if (!a || (a.skill === undefined && a.promptFrom === undefined)) return executors.agent(node, state, ctx);
    let prompt = a.prompt;
    if (a.skill !== undefined) {
      const skill = loadSkillBody(opts.repoRoot, a.skill, opts.builtinRoot);
      if (!skill) return { ok: false, error: `skill '${a.skill}' was not found, so node '${node.id}' has nothing to run.` };
      const input = a.inKey !== undefined ? stateText(state[a.inKey]) : a.prompt;
      if (input.trim() === '') return { ok: false, error: `node '${node.id}' has no text for the ${skill.name} skill to work on.` };
      prompt = buildSkillPrompt(skill, input);
    } else if (a.promptFrom !== undefined) {
      const extra = stateText(state[a.promptFrom]).trim();
      if (extra !== '') prompt = `${a.prompt.trim()}\n\nTask:\n${extra}`;
    }
    const result = await executors.agent({ ...node, agent: { ...a, prompt } }, state, ctx);
    if (!result.ok || a.skill === undefined) return result;
    const fenced = extractFencedPrompt(textOfValue(result.value));
    if (fenced === null) return { ok: false, error: `The ${a.skill} skill answered without a fenced prompt, so there is nothing to pass on.` };
    return { ...result, value: fenced };
  };
  return { ...executors, agent };
}
