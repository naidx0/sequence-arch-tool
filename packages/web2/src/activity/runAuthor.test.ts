import { describe, expect, it } from 'vitest';

import { validateProgram } from '@sequence/schema';

import { authorProblems, programFrom, RUN_AUTHOR_LIMITS } from './runAuthor';

/**
 * ══════════════════════════════════════════════════════════════════════════
 * STARTING A RUN — the half of the harness that was never built
 *
 * `programRunner` survives the client being SIGKILLed and resumes off a durable
 * log at exactly `lastSeq+1`. `web2` reads `GET /api/program/runs` and posts to
 * NOTHING — so the Activity pane is a viewer for runs only the CLI can create,
 * and the moat point "agent workflows on the graph" is a library rather than a
 * workflow.
 *
 * This module is the smallest thing that closes that: a name and an
 * instruction become a valid three-node program. It is PURE so the shape can be
 * asserted against the real validator without a DOM, a server or a fetch —
 * which matters because the shape is the part a form cannot check for itself.
 * ══════════════════════════════════════════════════════════════════════════
 */

const NAME = 'harden the login route';
const WORK = 'add rate limiting to POST /login and a test that proves it';

describe('the program a form produces', () => {
  it('SURVIVES THE REAL VALIDATOR — the same one the CLI and the route run', () => {
    /*
     * The single most important assertion here. `POST /api/program/run` runs
     * `validateProgram` and 400s on failure, with the comment saying why: "a
     * program that would not survive `sequence program run` must not survive
     * this route either, or the two entry points disagree about what a valid
     * program is." A form that composes an invalid program fails at the door
     * with a list of problems no reader can act on.
     */
    const result = validateProgram(programFrom(NAME, WORK, 'p1'));
    expect(result.ok, result.ok ? '' : result.errors.join(' · ')).toBe(true);
  });

  it('is start -> agent -> end, and nothing else', () => {
    /* Not a program editor. Branches, loops, parallel nodes, state and checkers
       are all real and none of them is needed to start one run. */
    const p = programFrom(NAME, WORK, 'p1');
    expect(p.nodes.map((n) => n.kind)).toEqual(['start', 'agent', 'end']);
    expect(p.edges).toHaveLength(2);
    expect(p.edges.every((e) => e.kind === 'seq')).toBe(true);
  });

  it('carries the instruction VERBATIM as the agent prompt', () => {
    /* Rewording what a person typed answers a question they did not ask - the
       same rule the board's Generate gate follows with its note. */
    const agent = programFrom(NAME, WORK, 'p1').nodes.find((n) => n.kind === 'agent');
    expect(agent?.agent?.prompt).toBe(WORK);
  });

  it('names the run what the person named it', () => {
    expect(programFrom(NAME, WORK, 'p1').name).toBe(NAME);
  });

  it('RUNS ON THE LOCAL AGENT, and says so in the program', () => {
    /*
     * `runtime: 'acp'` is a real local coding-agent turn — a subprocess with
     * real repo writes — and it is what makes this local-first rather than a
     * metered gateway call. The route gates on exactly this field
     * (`wantsAcp` -> `acpGate()`), so getting it wrong means the run silently
     * becomes something else rather than being refused.
     */
    const agent = programFrom(NAME, WORK, 'p1').nodes.find((n) => n.kind === 'agent');
    expect(agent?.agent?.runtime).toBe('acp');
    expect(agent?.agent?.intent).toBe('edit');
  });

  it('gives one run one id, and two runs two', () => {
    /* The caller supplies the id, so the module stays pure and a test can
       assert an exact program. Two programs sharing an id is two runs the
       store cannot tell apart. */
    expect(programFrom(NAME, WORK, 'p1').id).toBe('p1');
    expect(programFrom(NAME, WORK, 'p2').id).toBe('p2');
  });

  it('declares NO model, tools, skills or review gate', () => {
    /*
     * REDIRECTED, AND THE REDIRECTION IS THE POINT. This used to read
     * `expect(agent.model).toBeUndefined()`. Those four fields have since been
     * DELETED from `ProgramNode.agent`, so the old assertion no longer compiles
     * — which is a stronger guarantee than it was making, but only if something
     * still checks the shape that goes on the wire.
     *
     * Each was declared with a docblock describing behaviour no code performed:
     * `tools` advertised "a tool not listed is refused by the executor" with no
     * executor consulting it, and `requiresReview` promised "the executor awaits
     * UI approval" with nothing awaiting anything. Deleting them also removed
     * 22 lines from the five built-in programs, every one of which had been
     * declaring a cost-routing model — `gateway-cheap`, `gateway-smart` — that
     * the runner ignored.
     *
     * Asserted over the serialised keys, because that is what the engine reads.
     */
    const agent = programFrom(NAME, WORK, 'p1').nodes.find((n) => n.kind === 'agent');
    const keys = Object.keys(JSON.parse(JSON.stringify(agent?.agent ?? {})));
    expect(keys.sort()).toEqual(['intent', 'prompt', 'runtime']);
  });
});

describe('what the form refuses to send', () => {
  it('accepts a filled-in form', () => {
    expect(authorProblems(NAME, WORK)).toEqual([]);
  });

  it('refuses an empty name, and says which field', () => {
    /* "Invalid input" is a refusal nobody can act on. */
    const problems = authorProblems('   ', WORK);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/name/i);
  });

  it('refuses an empty instruction', () => {
    const problems = authorProblems(NAME, '  \n ');
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/instruction/i);
  });

  it('reports BOTH empty fields rather than one at a time', () => {
    /* A form that reveals its second complaint only after you fix the first is
       a form people fill in twice. */
    expect(authorProblems('', '')).toHaveLength(2);
  });

  it('refuses an instruction longer than the engine will carry', () => {
    /*
     * The route caps the body. An instruction that is refused at the door
     * AFTER the reader has written it is worse than one refused as they write
     * it, because the draft is gone by then.
     */
    const tooLong = 'x'.repeat(RUN_AUTHOR_LIMITS.instruction + 1);
    expect(authorProblems(NAME, tooLong)).toHaveLength(1);
    expect(authorProblems(NAME, 'x'.repeat(RUN_AUTHOR_LIMITS.instruction))).toEqual([]);
  });

  it('refuses a name longer than a row can show', () => {
    const tooLong = 'x'.repeat(RUN_AUTHOR_LIMITS.name + 1);
    expect(authorProblems(tooLong, WORK)).toHaveLength(1);
  });

  it('TRIMS before it builds, so a trailing newline is not the run name', () => {
    const p = programFrom(`  ${NAME}\n`, `  ${WORK}  `, 'p1');
    expect(p.name).toBe(NAME);
    expect(p.nodes.find((n) => n.kind === 'agent')?.agent?.prompt).toBe(WORK);
  });
});
