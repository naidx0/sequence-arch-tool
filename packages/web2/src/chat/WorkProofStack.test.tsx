import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '../tokens/graphite.css';
import './chat.css';

import { workRow } from './fixtures';
import { partitionWorkRows, WorkProofStack } from './WorkProofStack';

describe('partitionWorkRows', () => {
  it('puts reason rows in the Reasoning disclosure and keeps live reads outside', () => {
    const rows = [
      workRow('w1', { group: 'reason', verb: 'Worked a step', identifier: 'intents' }),
      workRow('w2', { group: 'reason', verb: 'Worked a step', identifier: 'file-research' }),
      workRow('w3', {
        group: 'reason',
        verb: 'Reasoned',
        identifier: null,
        status: 'running',
        from: 'provider:start',
      }),
      workRow('w4', {
        group: 'read',
        verb: 'Read',
        identifier: 'CANON.md',
        status: 'running',
        from: 'file:read',
      }),
    ];
    const { live, reason, proof } = partitionWorkRows(rows);
    expect(live.map((r) => r.id)).toEqual(['w4']);
    expect(reason.map((r) => r.id)).toEqual(['w1', 'w2', 'w3']);
    expect(proof).toEqual([]);
  });

  it('folds landed reads into proof, not Reasoning', () => {
    const rows = [
      workRow('w1', { group: 'read', verb: 'Read', identifier: 'a.ts', from: 'file:read' }),
      workRow('w2', { group: 'read', verb: 'Read', identifier: 'b.ts', from: 'file:read' }),
    ];
    const { live, reason, proof } = partitionWorkRows(rows);
    expect(live).toEqual([]);
    expect(reason).toEqual([]);
    expect(proof.map((r) => r.id)).toEqual(['w1', 'w2']);
  });
});

describe('a mode the user did not choose is on screen without a click', () => {
  /*
   * Owner's screen, 2026-09-02: "teach me this: …" typed with the Teach row
   * unselected. The pipeline engages the lesson on the QUESTION — refusing
   * edit_file / propose_files / propose_topology / run_command for the whole
   * turn — and streams step:teach-mode so it is not silent. The store minted
   * that row as a settled `group: 'reason'` row, which every previous test
   * asserted on in STORE STATE — and in the document it was inside a
   * disclosure that starts closed, headed "Reasoning". Both this and the
   * pipeline test stayed green while the announcement was invisible, so the
   * lock has to be a render.
   */
  const teachRow = workRow('w-teach', {
    group: 'reason',
    verb: 'Ran in Teach mode',
    identifier: null,
    from: 'step:start',
    announce: true,
  });

  it('renders the teach announcement unfolded, with the fold still closed', () => {
    render(
      <WorkProofStack
        rows={[
          teachRow,
          workRow('w1', { group: 'reason', verb: 'Reasoned', from: 'provider:start' }),
          workRow('w2', { group: 'reason', verb: 'Worked a step', identifier: 'intents' }),
        ]}
      />,
    );

    expect(screen.getByText('Ran in Teach mode')).toBeTruthy();
    // Still no click: the ordinary reasoning rows are where they were.
    expect(screen.getByTestId('chat-reason-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('chat-reason-body')).toBeNull();
    expect(screen.queryByText(/intents/)).toBeNull();
  });

  it('keeps the announcement out of every fold', () => {
    const { live, reason, proof } = partitionWorkRows([
      teachRow,
      workRow('w1', { group: 'reason', verb: 'Reasoned', from: 'provider:start' }),
      workRow('w2', { group: 'read', verb: 'Read', identifier: 'a.ts', from: 'file:read' }),
    ]);
    expect(live.map((r) => r.id)).toEqual(['w-teach']);
    expect(reason.map((r) => r.id)).toEqual(['w1']);
    expect(proof.map((r) => r.id)).toEqual(['w2']);
  });
});

describe('WorkProofStack — Reasoning disclosure', () => {
  it('collapses reason steps behind Reasoning until the reader expands', () => {
    const rows = [
      workRow('w1', { group: 'reason', verb: 'Worked a step', identifier: 'intents' }),
      workRow('w2', { group: 'reason', verb: 'Worked a step', identifier: 'file-research' }),
      workRow('w3', { group: 'reason', verb: 'Reasoned', identifier: null, from: 'provider:start' }),
    ];
    render(<WorkProofStack rows={rows} />);

    const toggle = screen.getByTestId('chat-reason-toggle');
    expect(toggle.textContent).toMatch(/Reasoning/);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('chat-reason-body')).toBeNull();
    expect(screen.queryByText(/intents/)).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('chat-reason-body').textContent).toContain('intents');
    expect(screen.getByTestId('chat-reason-body').textContent).toContain('file-research');
  });

  it('shows a live reasoning row with braille — no agent run bar', () => {
    render(
      <WorkProofStack
        rows={[
          workRow('w1', {
            group: 'reason',
            verb: 'Reasoned',
            identifier: null,
            status: 'running',
            from: 'provider:start',
          }),
        ]}
        reasoningProvider="ox-alpha"
      />,
    );
    const row = screen.getByTestId('chat-tool-row');
    expect(row.className).toContain('wash');
    expect(row.className).toContain('live');
    expect(row.textContent).toMatch(/Reasoning with ox-alpha/);
    expect(screen.getByTestId('chat-reasoning-glyph').className).toContain('braille');
    expect(screen.queryByTestId('chat-agent-run')).toBeNull();
    expect(screen.queryByTestId('chat-reason-fold')).toBeNull();
  });

  it('live file reads get glimmer without accent wash', () => {
    render(
      <WorkProofStack
        rows={[
          workRow('w1', {
            group: 'read',
            verb: 'Read',
            identifier: 'session.ts',
            status: 'running',
            from: 'file:read',
          }),
        ]}
      />,
    );
    const row = screen.getByTestId('chat-tool-row');
    expect(row.className).toContain('live');
    expect(row.className).not.toContain('wash');
    expect(screen.queryByTestId('chat-reasoning-glyph')).toBeNull();
  });

  it('still collapses two+ landed proof reads behind a files summary', () => {
    const rows = [
      workRow('w1', { group: 'read', verb: 'Read', identifier: 'a.ts', from: 'file:read' }),
      workRow('w2', { group: 'read', verb: 'Read', identifier: 'b.ts', from: 'file:read' }),
    ];
    render(<WorkProofStack rows={rows} />);

    expect(screen.getByTestId('chat-proof-toggle').textContent).toMatch(/2 files researched/);
    expect(screen.queryByTestId('chat-reason-fold')).toBeNull();
    fireEvent.click(screen.getByTestId('chat-proof-toggle'));
    expect(screen.getByTestId('chat-proof-body').textContent).toContain('a.ts');
  });

  it('shows live Round k/n · Xs above the work stack', () => {
    render(
      <WorkProofStack
        rows={[
          workRow('w1', {
            status: 'running',
            from: 'provider:start',
            verb: 'Reasoned',
            group: 'reason',
          }),
        ]}
        roundTimer={{ current: 1, max: 8, elapsedMs: 12_000 }}
      />,
    );

    expect(screen.getByTestId('chat-round-timer').textContent).toBe('Round 1/8 · 12s');
  });

  it('shows a calm provider stall line without blaming the board', () => {
    render(
      <WorkProofStack
        rows={[
          workRow('w1', {
            status: 'running',
            from: 'provider:start',
            verb: 'Reasoned',
            group: 'reason',
          }),
        ]}
        stallNotice="Provider is slow…"
      />,
    );

    expect(screen.getByTestId('chat-provider-stall').textContent).toBe('Provider is slow…');
  });
});
