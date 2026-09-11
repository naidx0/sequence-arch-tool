import { describe, expect, it } from 'vitest';

import type { WorkRow } from '../state/types';
import { formatElapsed, glyphFor, liveLabelFor, livePhaseFor } from './workRowModel';

function row(
  over: Partial<WorkRow>,
): Pick<WorkRow, 'from' | 'verb' | 'identifier' | 'status'> {
  return { from: 'tool:start', verb: 'Called a tool', identifier: null, status: 'running', ...over };
}

describe('livePhaseFor — Cursor-mobile phases', () => {
  it('maps exploration reads and search to Exploring', () => {
    expect(livePhaseFor(row({ from: 'file:read' }))).toBe('exploring');
    expect(livePhaseFor(row({ verb: 'Called search_files' }))).toBe('exploring');
  });

  it('maps topology to Planning and provider to Thinking', () => {
    expect(livePhaseFor(row({ from: 'topology:proposal', verb: 'Proposed' }))).toBe('planning');
    expect(livePhaseFor(row({ verb: 'Called propose_topology' }))).toBe('planning');
    expect(livePhaseFor(row({ from: 'provider:start', verb: 'Reasoned' }))).toBe('thinking');
  });
});

describe('liveLabelFor — Cursor-mobile labels', () => {
  it('uses Exploring / Planning / Thinking / Working vocabulary', () => {
    expect(liveLabelFor(row({ from: 'file:read', identifier: 'session.ts' }))).toBe(
      'Exploring session.ts…',
    );
    expect(liveLabelFor(row({ verb: 'Called search_files', identifier: '*auth*' }))).toBe(
      'Exploring *auth*…',
    );
    expect(liveLabelFor(row({ verb: 'Called propose_topology' }))).toBe(
      'Drawing on Architecture…',
    );
    expect(liveLabelFor(row({ from: 'provider:start' }), 'ox-alpha')).toBe(
      'Reasoning with ox-alpha…',
    );
    expect(liveLabelFor(row({ verb: 'Called run_command' }))).toBe('Working…');
  });

  it('does not leak pipeline step ids as "Thinking provider…"', () => {
    expect(liveLabelFor(row({ from: 'step:start', identifier: 'provider' }))).toBe('Reasoning…');
    expect(liveLabelFor(row({ from: 'step:start', identifier: 'intents' }))).toBe('Planning…');
    expect(liveLabelFor(row({ from: 'step:start', identifier: 'file-research' }))).toBe(
      'Exploring…',
    );
  });
});

describe('glyphFor — the row names the event that produced it', () => {
  it('takes the glyph from the stream event, not from a verb string', () => {
    expect(glyphFor({ from: 'file:read', group: 'read' })).toBe('file');
    expect(glyphFor({ from: 'command:log', group: 'run' })).toBe('terminal');
    expect(glyphFor({ from: 'topology:proposal', group: 'change' })).toBe('board');
  });
});

describe('formatElapsed — a measured number, formatted, never invented', () => {
  it('reads minutes and seconds past a minute', () => {
    expect(formatElapsed(64000)).toBe('1m 04s');
  });
});
