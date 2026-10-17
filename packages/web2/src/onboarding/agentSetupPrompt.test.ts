import { describe, expect, it } from 'vitest';

import { createStore } from '../state';
import { agentSetupPrompt, draftIntoComposer, type SetupNeed } from './agentSetupPrompt';

const NEEDS: SetupNeed[] = ['install', 'signIn', 'update', 'bridge', 'attention', 'none', 'another', 'localModel'];
const FACTS = { id: 'claude', label: 'Claude Code', version: '1.0.0', minVersion: '2.0.0', installHint: 'npm install -g @anthropic-ai/claude-code', signInCommand: 'claude auth login', adapterInstall: 'npm install -g claude-agent-acp' };

describe('agentSetupPrompt', () => {
  it('every need drafts a plain request that asks the agent to do the steps', () => {
    for (const need of NEEDS) {
      const text = agentSetupPrompt({ need, ...FACTS });
      expect(text.length, need).toBeGreaterThan(80);
      expect(text, need).toMatch(/Do the steps for me/);
    }
  });

  it('puts the command inside the prompt for the need that has one', () => {
    expect(agentSetupPrompt({ need: 'install', ...FACTS })).toContain(FACTS.installHint);
    expect(agentSetupPrompt({ need: 'signIn', ...FACTS })).toContain(FACTS.signInCommand);
    expect(agentSetupPrompt({ need: 'bridge', ...FACTS })).toContain(FACTS.adapterInstall);
    const up = agentSetupPrompt({ need: 'update', ...FACTS });
    expect(up).toContain('1.0.0');
    expect(up).toContain('2.0.0');
  });

  it('a failed install drafts the command that failed and the tail of its output, fenced, and nothing above the tail', () => {
    const output = Array.from({ length: 60 }, (_, i) => `step ${i + 1}: npm output line`);
    const text = agentSetupPrompt({ need: 'install', ...FACTS, failure: { command: FACTS.installHint, output } });
    expect(text).toMatch(/step 60: npm output line/);
    expect(text).toMatch(/step 21: npm output line/);
    expect(text).not.toMatch(/step 20: npm output line/);
    expect(text).toMatch(/```[\s\S]*step 60[\s\S]*```/);
    expect(text).toContain(`The command that failed: ${FACTS.installHint}`);
  });

  it('bounds the drafted output to 4 KB even when the last lines are long', () => {
    const output = Array.from({ length: 40 }, (_, i) => `row ${i + 1} ${'x'.repeat(500)}`);
    const text = agentSetupPrompt({ need: 'bridge', ...FACTS, failure: { command: FACTS.adapterInstall, output } });
    expect(text).toMatch(/row 40 x/);
    expect(text.length).toBeLessThan(4096 + 1500);
  });

  it('does not invent a version it was not given', () => {
    const up = agentSetupPrompt({ need: 'update', id: 'claude', label: 'Claude Code' });
    expect(up).toContain('Installed version: unknown');
  });
});

describe('draftIntoComposer', () => {
  it('fills an empty composer, and goes after what is already typed', () => {
    const app = createStore({});
    draftIntoComposer(app, 'first');
    expect(app.getState().composer.draft).toBe('first');
    draftIntoComposer(app, 'second');
    expect(app.getState().composer.draft).toBe('first' + String.fromCharCode(10, 10) + 'second');
  });
});
