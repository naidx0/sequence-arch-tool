import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Emitter, type GenUIAgent } from './agent';
import { BUTTON_CLASS, GenUISurface } from './GenUISurface';
import { GenUISession } from './session';

/* Decision 51: a generated Button is one of the app's existing buttons. The map is locked here, and the
   classes it names must be ones the button kit (src/buttonKit.test.ts) already knows. */

class Quiet extends Emitter implements GenUIAgent {
  start(): void {}
  sendAction(): void {}
  async repair(): Promise<null> {
    return null;
  }
}

const KIT = new Set(['s2-btn', 's2-btn-sm', 's2-blue', 's2-danger', 's2-chipbtn']);
const VARIANTS = ['primary', 'secondary', 'danger', 'ghost'] as const;

describe('generated buttons use the app theme buttons', () => {
  it('maps each variant to its kit class and to no other class', async () => {
    const agent = new Quiet();
    const session = new GenUISession(agent);
    const ops =
      '{"op":"add","path":"/actions/go","value":{"description":"Go"}}\n' +
      '{"op":"el","id":"a","type":"Actions","children":' + JSON.stringify(VARIANTS.map((v) => `b-${v}`)) + '}\n' +
      VARIANTS.map((v) => `{"op":"el","id":"b-${v}","type":"Button","props":{"label":"L-${v}","action":{"name":"go"},"variant":"${v}"}}\n`).join('');
    agent.emit({ kind: 'ui.text', surfaceId: 's', chunk: ops });
    agent.emit({ kind: 'ui.end', surfaceId: 's' });
    await new Promise((r) => setTimeout(r, 40));
    const view = session.get().surfaces[0]!;
    render(<GenUISurface view={view} busy={false} onClick={() => {}} />);

    for (const v of VARIANTS) {
      const btn = screen.getByText(`L-${v}`).closest('button')!;
      const classes = btn.className.split(/\s+/).filter((c) => c && c !== 'gu-btn');
      expect(classes, v).toEqual(BUTTON_CLASS[v]!.split(' '));
      expect(classes.every((c) => KIT.has(c)), `${v} uses only kit classes`).toBe(true);
    }
    /* Distinct looks: primary solid accent, danger destructive, ghost the quiet chip, secondary the plain glass pill. */
    expect(new Set(VARIANTS.map((v) => BUTTON_CLASS[v])).size).toBe(4);
    expect(BUTTON_CLASS.primary).toContain('s2-blue');
    expect(BUTTON_CLASS.danger).toContain('s2-danger');
    expect(BUTTON_CLASS.ghost).toBe('s2-chipbtn');
  });

  it('an unknown or missing variant falls back to the secondary button', () => {
    expect(BUTTON_CLASS.secondary).toBe('s2-btn s2-btn-sm');
  });
});
