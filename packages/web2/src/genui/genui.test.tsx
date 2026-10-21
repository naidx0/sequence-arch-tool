import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { validateSpec, type UIDiagnostics } from '@sequence/genui';

import { Emitter, type GenUIAgent } from './agent';
import { GenUISurface } from './GenUISurface';
import { MockAgent } from './mockAgent';
import { GenUISession, type SessionView } from './session';
import { useGenUISession } from './useGenUISession';

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));

class Scripted extends Emitter implements GenUIAgent {
  actions: string[] = [];
  repairs: UIDiagnostics[] = [];
  start(): void {}
  sendAction(a: { name: string }): void {
    this.actions.push(a.name);
  }
  async repair(d: UIDiagnostics): Promise<string> {
    this.repairs.push(d);
    return '{"op":"add","path":"/actions/go","value":{"description":"Go"}}';
  }
  text(s: string): void {
    /* model-like chunking: 5 characters at a time */
    for (let i = 0; i < s.length; i += 5) this.emit({ kind: 'ui.text', surfaceId: 's', chunk: s.slice(i, i + 5) });
  }
}

describe('genui session pipeline', () => {
  it('streams, fixes lossless live, asks the agent for the rest, settles valid', async () => {
    const agent = new Scripted();
    const session = new GenUISession(agent);
    const phases: string[] = [];
    session.subscribe((v: SessionView) => {
      const p = v.surfaces[0]?.phase;
      if (p && phases[phases.length - 1] !== p) phases.push(p);
    });
    agent.text('{"op":"el","id":"c","type":"card","props":{"title":"T"},"children":["b"]}\n');
    await tick(20);
    expect(session.get().surfaces[0]!.spec.elements.c!.type).toBe('Card');
    agent.text('{"op":"el","id":"b","type":"Button","props":{"label":"Go","action":"go"}}\n');
    agent.emit({ kind: 'ui.end', surfaceId: 's' });
    await tick(30);
    const s = session.get().surfaces[0]!;
    expect(phases).toEqual(['streaming', 'repairing', 'settled']);
    expect(agent.repairs[0]!.issues.map((i) => i.code)).toEqual(['UNDECLARED_ACTION']);
    expect(s.fixes.some((f) => f.by === 'fixer' && f.message.includes('-> Card'))).toBe(true);
    expect(s.fixes.some((f) => f.by === 'agent')).toBe(true);
    expect(validateSpec(s.spec).ok).toBe(true);
    session.click('s', 'b');
    expect(agent.actions).toEqual(['go']);
  });

  it('refuses a click while the agent is mid-turn', async () => {
    const agent = new Scripted();
    const session = new GenUISession(agent);
    agent.text('{"op":"el","id":"b","type":"Button","props":{"label":"Go","action":{"name":"go"}}}\n{"op":"add","path":"/actions/go","value":{}}\n');
    agent.emit({ kind: 'ui.end', surfaceId: 's' });
    agent.emit({ kind: 'turn', busy: true });
    await tick(20);
    session.click('s', 'b');
    expect(agent.actions).toEqual([]);
    expect(session.get().surfaces[0]!.refused?.reason).toMatch(/working/);
  });

  it('events that arrive while a pass is being repaired wait, then apply', async () => {
    const agent = new Scripted();
    const session = new GenUISession(agent);
    agent.text('{"op":"el","id":"b","type":"Button","props":{"label":"Go","action":"go"}}\n');
    agent.emit({ kind: 'ui.end', surfaceId: 's' });
    agent.text('{"op":"el","id":"t","type":"Text","props":{"text":"after"},"parent":"b2"}\n');
    await tick(30);
    expect(session.get().surfaces[0]!.spec.elements.t?.props.text).toBe('after');
    expect(session.get().surfaces[0]!.spec.actions.go).toBeTruthy();
  });
});

function Harness({ agent }: { agent: GenUIAgent }): JSX.Element {
  const [view, session] = useGenUISession(agent);
  const s = view.surfaces[0];
  return (
    <div>
      <button type="button" onClick={() => session.start('go')}>
        start
      </button>
      {s ? <GenUISurface view={s} busy={view.busy} onClick={(a, b) => session.click(a, b)} /> : null}
      <span data-testid="busy">{String(view.busy)}</span>
    </div>
  );
}

describe('GenUISurface with the scripted agent', () => {
  it('renders the live surface, shows self-correction, and round-trips a click', async () => {
    const agent = new MockAgent({ speed: 0, chunk: [40, 80] });
    render(<Harness agent={agent} />);
    fireEvent.click(screen.getByText('start'));
    await waitFor(() => expect(screen.getByText('Fix failures')).toBeTruthy(), { timeout: 8000 });
    await waitFor(() => expect(screen.getByTestId('busy').textContent).toBe('false'), { timeout: 8000 });
    expect(screen.getByText('Upgrade auth middleware')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('40 of 42')).toBeTruthy());
    expect(screen.getByText('Self-corrected')).toBeTruthy();
    expect(screen.getByText(/by agent/)).toBeTruthy();
    /* the agent's repair replaced the unknown Sparkline with a Metric */
    expect(screen.getByText('Suite time')).toBeTruthy();
    const fix = screen.getByText('Fix failures').closest('button')!;
    expect(fix.disabled).toBe(false);
    await act(async () => {
      fix.click();
    });
    await waitFor(() => expect(screen.getByText('42 of 42')).toBeTruthy(), { timeout: 8000 });
    await waitFor(() => expect(screen.getByText('Types')).toBeTruthy(), { timeout: 8000 });
    await waitFor(() => expect(screen.getByText('Open pull request')).toBeTruthy(), { timeout: 8000 });
    expect(screen.queryByText('2 tests failed')).toBeNull();
  }, 20000);
});

describe('```genui fence', () => {
  it('draws as the message grows and settles when the fence closes', async () => {
    const { GenUIFence } = await import('./GenUIFence');
    const { StreamingContext } = await import('../chat/DiagramBlock');
    const full =
      '{"op":"el","id":"c","type":"Card","props":{"title":"Build"},"children":["p"]}\n' +
      '{"op":"el","id":"p","type":"ProgressBar","props":{"label":"Tests","value":3,"max":9}}\n';
    const cut = full.indexOf('{"op":"el","id":"p"') + 30;
    const view = (text: string, open: boolean): JSX.Element => (
      <StreamingContext.Provider value={open}>
        <GenUIFence source={text} open={open} />
      </StreamingContext.Provider>
    );
    const r = render(view(full.slice(0, cut), true));
    await waitFor(() => expect(screen.getByText('Build')).toBeTruthy());
    r.rerender(view(full, false));
    await waitFor(() => expect(screen.getByText('3 of 9')).toBeTruthy());
    expect(screen.getByText('Self-corrected')).toBeTruthy();
  });
});
