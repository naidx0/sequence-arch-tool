/**
 * The PR-triage flagship ProgramGraph (v16 Phase 4, additive).
 *
 * An HONEST TEMPLATE of the acpx PR-triage flow, expressed in the pure Programs
 * model. It models the SHAPE of a real triage run:
 *
 *   start
 *     └─ parallel fan-out of three `acp` probe agents (children of `fan`):
 *          • extract intent        → state.intent    ({stopReason,text})
 *          • assess change quality → state.quality   ({stopReason,text})
 *          • check for conflicts   → state.conflicts ({stopReason,text})
 *     └─ JOIN BARRIER: `fan --seq--> summarize` — the summarize agent runs ONCE,
 *        after ALL three probes finish (the parallel node's seq target is the join;
 *        the probes are ONLY parallel children and carry no seq edge, so they never
 *        race summarize).
 *     └─ branch on state.mode (a SUPPLIED, typed input — deterministic control flow
 *        over real state, not a score parsed from agent text)
 *          • branch-true  (mode == 'strict') → end "deep-review"
 *          • branch-false                    → end "standard-review"
 *
 * HONEST BRANCH (v16 adversarial-review fix): agent nodes produce a structured
 * `{stopReason,text}` turn result — NOT a scalar. The model has no built-in way to
 * parse a number out of freeform agent text, so gating on a "qualityScore >= 7"
 * derived from an agent answer would be a permanently DEAD branch. Instead this
 * template gates on a REAL, populated typed-state slot — `mode` — that the runner
 * supplies:  `sequence program run … --input mode=strict`. `mode == 'strict'`
 * (the `==` comparator works on strings) routes to a deeper review; anything else
 * (the default `standard`) routes to a quick review. Both ends are reachable for
 * the two input values — an honest demonstration of branch-over-typed-state. See
 * the `$note` in the shipped JSON: automated gating on agent *content* (parsing a
 * score) needs a future parse/command step; this template does not fake it.
 *
 * HONESTY BOUNDARY: this is the graph, not a capability. The agent nodes carry
 * `runtime:'acp'` with a placeholder `agentRef` and real prompts, but the graph
 * itself calls nothing — it needs the USER's own local coding agent to run (via
 * `sequence program run .sequence/programs/pr-triage.json --agent <id>`), and the
 * real GitHub-facing steps a production triage would perform (reading the diff,
 * posting a review) require the user's GitHub access on their machine. The
 * template does not itself touch GitHub. See the `$note` in the shipped JSON.
 */

import type { Program } from '../program.js';

/** The `mode` input value that routes to the deeper-review end. */
export const STRICT_MODE = 'strict';
/** The default review mode when no `--input mode=…` is supplied. */
export const DEFAULT_MODE = 'standard';

/** A stable placeholder agent ref; the real ref is supplied at run time via --agent. */
const AGENT_REF = 'local-coding-agent';

/**
 * Build the PR-triage {@link Program}. Deterministic and `validateProgram`-clean:
 * one start, kind-constrained edges, a real predicate over declared typed state,
 * a branch with both (reachable) targets, ≥3 parallel `acp` probe nodes, and a
 * genuine join barrier (`fan --seq--> summarize`).
 */
export function buildPrTriageProgram(): Program {
  return {
    id: 'pr-triage',
    name: 'PR Triage',
    description:
      'Template: parallel ACP probes assess an open PR, a join agent summarizes ' +
      'after all probes finish, and a typed branch on the supplied "mode" input ' +
      'routes to "deep-review" (mode=strict) or "standard-review". Honestly a ' +
      'template — running it needs a real local agent (and, for the real GitHub ' +
      'steps, GitHub access); the graph itself calls nothing.',
    // The shared, typed state. The probe/summary slots hold each agent turn's
    // structured result ({stopReason,text}) — declared 'json' to match what an
    // agent node actually writes. `mode` is a supplied string input the branch
    // reads (deterministic control flow over real state).
    state: {
      shape: {
        intent: 'json',
        quality: 'json',
        conflicts: 'json',
        summary: 'json',
        mode: 'string',
      },
      initial: {
        intent: '',
        quality: '',
        conflicts: '',
        summary: '',
        mode: DEFAULT_MODE,
      },
    },
    nodes: [
      { id: 'start', title: 'PR opened', kind: 'start' },
      { id: 'fan', title: 'Probe the PR in parallel', kind: 'parallel' },

      {
        id: 'probe-intent',
        title: 'Extract intent',
        kind: 'agent',
        agent: {
          runtime: 'acp',
          acp: { agentRef: AGENT_REF },
          intent: 'ask',
          outKey: 'intent',
          prompt:
            'Read this pull request (title, description, and diff) and state, in one ' +
            'sentence, what change the author intends to make and why. Do not evaluate ' +
            'quality yet — only capture the intent.',
        },
      },
      {
        id: 'probe-quality',
        title: 'Assess change quality',
        kind: 'agent',
        agent: {
          runtime: 'acp',
          acp: { agentRef: AGENT_REF },
          intent: 'ask',
          outKey: 'quality',
          prompt:
            'Assess the quality of this pull request diff: correctness, test coverage, ' +
            'clarity, and adherence to the surrounding code. Summarize the main quality ' +
            'signals and any blocking concerns in a few sentences.',
        },
      },
      {
        id: 'probe-conflicts',
        title: 'Check for conflicts',
        kind: 'agent',
        agent: {
          runtime: 'acp',
          acp: { agentRef: AGENT_REF },
          intent: 'ask',
          outKey: 'conflicts',
          prompt:
            'Determine whether this pull request likely conflicts with the current ' +
            'state of the target branch (overlapping edits, stale APIs, merge markers). ' +
            'Explain briefly whether a conflict is likely and where.',
        },
      },

      {
        id: 'summarize',
        title: 'Summarize triage',
        kind: 'agent',
        agent: {
          runtime: 'acp',
          acp: { agentRef: AGENT_REF },
          intent: 'ask',
          outKey: 'summary',
          prompt:
            'Given the extracted intent, the quality assessment, and the conflict ' +
            'assessment gathered so far, write a concise triage summary for a ' +
            'maintainer: what the PR does, its main risks, and a recommended next action.',
        },
      },

      {
        id: 'mode-gate',
        title: 'Review-mode gate',
        kind: 'branch',
        branch: {
          // Deterministic control flow over a SUPPLIED typed input — not a score
          // magically parsed from agent text. `==` works on strings.
          condition: { left: 'mode', op: '==', right: STRICT_MODE },
        },
      },

      { id: 'end-deep', title: 'deep-review', kind: 'end' },
      { id: 'end-standard', title: 'standard-review', kind: 'end' },
    ],
    edges: [
      { id: 'e-start-fan', from: 'start', to: 'fan', kind: 'seq' },

      // The three probes are ONLY parallel children of the fan node.
      { id: 'e-fan-intent', from: 'fan', to: 'probe-intent', kind: 'parallel' },
      { id: 'e-fan-quality', from: 'fan', to: 'probe-quality', kind: 'parallel' },
      { id: 'e-fan-conflicts', from: 'fan', to: 'probe-conflicts', kind: 'parallel' },

      // THE JOIN BARRIER: the parallel node's single seq edge. The scheduler runs
      // this once, after ALL parallel children complete. Probes carry NO seq edge,
      // so summarize never runs on whichever probe finishes first.
      { id: 'e-fan-summarize', from: 'fan', to: 'summarize', kind: 'seq' },

      { id: 'e-summarize-gate', from: 'summarize', to: 'mode-gate', kind: 'seq' },

      { id: 'e-gate-deep', from: 'mode-gate', to: 'end-deep', kind: 'branch-true' },
      { id: 'e-gate-standard', from: 'mode-gate', to: 'end-standard', kind: 'branch-false' },
    ],
  };
}
