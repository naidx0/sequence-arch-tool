import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_PROGRAMS } from '@sequence/schema';

import { ActivityPane } from './ActivityPane';
import { ACTIVITY } from './anchors';
import { RUN_STEP_BUDGETS, RUN_TIME_BUDGETS } from './activityModel';
import { acpReadinessNote } from './acpReadiness';

afterEach(cleanup);

/* Words a first-time user does not know. Derived once, used against every string the form shows. */
const JARGON = /\b(engine|ACP|SPOF|blastBand|graph ids?|Tier \d|grounded|scaffold)\b/i;

function form(extra: Record<string, unknown> = {}) {
  return render(
    <ActivityPane
      runs={[]}
      now={0}
      filter="all"
      onFilter={() => undefined}
      onOpen={() => undefined}
      onCloseRun={() => undefined}
      authoring
      onStart={() => undefined}
      onAuthorCancel={() => undefined}
      {...extra}
    />,
  );
}
const start = () => screen.getByTestId(ACTIVITY.authorStart) as HTMLButtonElement;

describe('Start a workflow: plain words', () => {
  it('the jargon check has teeth: it catches planted examples and passes a plain sentence', () => {
    for (const bad of ['ACP agent', 'Parallel SPOF critics', 'Branch on blastBand', 'Propose graph ids', 'Tier 2 build', 'grounded checker', 'scaffold']) {
      expect(JARGON.test(bad), bad).toBe(true);
    }
    expect(JARGON.test('Agents look for single points of failure, then agree on the risks.')).toBe(false);
  });

  it('every catalogue entry (derived, not listed) reads in plain words, as one short sentence', () => {
    expect(BUILTIN_PROGRAMS.length).toBeGreaterThan(0);
    for (const e of BUILTIN_PROGRAMS) {
      expect(JARGON.test(e.title), e.id + ' title').toBe(false);
      expect(JARGON.test(e.blurb), e.id).toBe(false);
      expect(e.blurb, e.id).not.toMatch(/→|·|->/);
      expect(e.blurb, e.id).toMatch(/\.$/);
      expect((e.blurb.match(/\./g) ?? []).length, e.id + ' is one sentence').toBe(1);
      expect(e.blurb.length, e.id).toBeLessThan(130);
    }
  });

  it('the rendered form, with every workflow picked in turn, carries no jargon and no middle dot', () => {
    form();
    const ids = screen.getAllByTestId(ACTIVITY.authorBuiltin).map((b) => (b as HTMLElement).dataset.builtinId!);
    expect(ids).toEqual(BUILTIN_PROGRAMS.map((e) => e.id));
    for (const id of [null, ...ids]) {
      if (id === null) {
        const custom = screen.queryByTestId(ACTIVITY.authorCustom);
        if (custom) fireEvent.click(custom);
      } else {
        fireEvent.click(screen.getAllByTestId(ACTIVITY.authorBuiltin).find((b) => (b as HTMLElement).dataset.builtinId === id)!);
      }
      const text = screen.getByTestId(ACTIVITY.author).textContent ?? '';
      expect(JARGON.test(text), `${id}: ${text}`).toBe(false);
      expect(text).not.toContain('·');
    }
  });

  it('the budget copy is plain', () => {
    expect(RUN_TIME_BUDGETS[0].label).toBe('10 minutes (default)');
    expect(RUN_STEP_BUDGETS[0].label).toBe('200 steps (default)');
    form();
    const text = screen.getByTestId(ACTIVITY.author).textContent ?? '';
    expect(text).toContain('A run stops when it reaches either limit.');
    expect(text).toContain('Runs with your connected agent on this computer.');
    expect(text).not.toMatch(/clamps|engine default|attached repository/);
  });

  it('the no-agent note is plain too', () => {
    expect(JARGON.test(acpReadinessNote({ kind: 'no-agents' }) ?? '')).toBe(false);
  });
});

describe('Start run waits until there is something to run', () => {
  it('custom run: disabled while the instruction is empty or blank, with a plain reason; enabled once written', () => {
    form();
    expect(start().disabled).toBe(true);
    expect(start().title).toMatch(/pick a workflow|write an instruction/i);
    expect(JARGON.test(start().title)).toBe(false);
    fireEvent.change(screen.getByTestId(ACTIVITY.authorInstruction), { target: { value: '   ' } });
    expect(start().disabled).toBe(true);
    fireEvent.change(screen.getByTestId(ACTIVITY.authorInstruction), { target: { value: 'tidy the docs' } });
    expect(start().disabled).toBe(false);
    expect(start().getAttribute('title')).toBeNull();
  });

  it('a picked workflow enables it with no instruction; going back to custom disables it again', () => {
    form();
    fireEvent.click(screen.getAllByTestId(ACTIVITY.authorBuiltin)[0]!);
    expect(start().disabled).toBe(false);
    fireEvent.click(screen.getByTestId(ACTIVITY.authorCustom));
    expect(start().disabled).toBe(true);
  });

  it('no connected agent keeps it disabled whatever else is filled, and that reason is the one shown', () => {
    form({ startBlockedReason: 'Connect an agent first' });
    fireEvent.click(screen.getAllByTestId(ACTIVITY.authorBuiltin)[0]!);
    expect(start().disabled).toBe(true);
    expect(start().title).toBe('Connect an agent first');
  });
});

describe('Start form fields use the shared radius, not a pill', () => {
  const css = readFileSync(resolve(__dirname, 'activity.css'), 'utf8');
  const rule = (selector: string) => {
    const at = css.lastIndexOf(selector + ' {');
    expect(at, selector).toBeGreaterThan(-1);
    return css.slice(at, css.indexOf('}', at));
  };

  it('the field and wrapper rules out-rank the shell skin and use --r-8, never --r-full', () => {
    const input = rule('.s2 .ac-scope .ac-author .ac-input');
    expect(input).toContain('border-radius: var(--r-8)');
    expect(input).not.toContain('--r-full');
    expect(rule('.s2 .ac-scope .ac-author .ac-field')).toContain('border-radius: 0');
  });

  it('negative control: the shell skin rule that made the pills is exactly what this one beats', () => {
    const skin = readFileSync(resolve(__dirname, '../shell2/pages.css'), 'utf8');
    expect(skin).toMatch(/\.s2 \.ac-scope \.ac-input,[\s\S]*?border-radius: var\(--r-full\)/);
    /* 3 classes (skin) < 4 classes (ours) */
    expect('.s2 .ac-scope .ac-author .ac-input'.split('.').length - 1).toBeGreaterThan('.s2 .ac-scope .ac-input'.split('.').length - 1);
  });

  it('the name, instruction and both budget controls all carry the ac-input class', () => {
    form();
    for (const id of [ACTIVITY.authorName, ACTIVITY.authorInstruction, ACTIVITY.authorTimeBudget, ACTIVITY.authorStepBudget]) {
      expect(screen.getByTestId(id).className, id).toContain('ac-input');
    }
  });
});
