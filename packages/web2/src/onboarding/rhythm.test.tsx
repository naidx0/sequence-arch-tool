/* S4 review item 8: onboarding takes the Bastion rhythm — a display heading at
   350 with -0.03em tracking, 24px heading to agents, 40px to the list, a
   560-640px column, 13-14px rows — and the board and rails stay dense. */
import { afterEach, describe, expect, it } from 'vitest';

import { resolvedStyle } from '../../test/support/css';
import '../tokens/graphite.css';
import '../styles/base.css';
import './onboarding.css';

afterEach(() => {
  document.body.innerHTML = '';
});

function mount(): Record<string, HTMLElement> {
  document.body.innerHTML = `
    <div class="fr-root"><div class="fr-col">
      <div class="fr-brand"></div>
      <header class="fr-head"><h1 class="fr-title">Add an agent</h1></header>
      <section class="fr-section" data-k="agents"><h2 class="fr-h">Agents</h2></section>
      <section class="fr-section" data-k="agents2"><ul class="fr-agents"><li class="fr-agent"><span class="fr-agent-name">a</span></li></ul></section>
    </div></div>`;
  const q = (s: string) => document.querySelector(s) as HTMLElement;
  return { col: q('.fr-col'), title: q('.fr-title'), agents: q('[data-k="agents"]'), agents2: q('[data-k="agents2"]'), repo: q('.fr-agent') };
}

describe('onboarding rhythm', () => {
  it('sets the heading on a display rung at the heading weight (Decision 49), tracked -0.03em', () => {
    const { title } = mount();
    expect(parseFloat(resolvedStyle(title, 'font-size'))).toBeGreaterThanOrEqual(24);
    expect(resolvedStyle(title, 'font-weight')).toBe('600');
    expect(resolvedStyle(title, 'letter-spacing')).toBe('-0.03em');
  });

  it('steps 24px from the heading to the agents and 40px between sections, in a 560-640px column', () => {
    const { col, agents, agents2 } = mount();
    expect(resolvedStyle(agents, 'margin-top')).toBe('24px');
    expect(resolvedStyle(agents2, 'margin-top')).toBe('40px');
    const max = parseFloat(resolvedStyle(col, 'max-width'));
    expect(max).toBeGreaterThanOrEqual(560);
    expect(max).toBeLessThanOrEqual(640);
  });

  it('sets rows at 13-14px', () => {
    const { repo } = mount();
    const px = parseFloat(resolvedStyle(repo, 'font-size'));
    expect(px).toBeGreaterThanOrEqual(13);
    expect(px).toBeLessThanOrEqual(14);
  });
});
