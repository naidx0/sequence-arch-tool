/**
 * B3.1 — prior chat work/evidence reaches the ask prompt.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseAskHistoryTurns, renderAskHistorySection } from '../explain/explain.js';

describe('parseAskHistoryTurns + renderAskHistorySection (B3.1)', () => {
  it('keeps prose-only turns unchanged', () => {
    const turns = parseAskHistoryTurns([
      { role: 'user', text: 'what does scan.ts do' },
      { role: 'assistant', text: 'It walks the repo.' },
    ]);
    const lines = renderAskHistorySection(turns);
    assert.deepEqual(lines, [
      '--- PRIOR CHAT (same workspace; continue coherently) ---',
      'User: what does scan.ts do',
      'Assistant: It walks the repo.',
    ]);
  });

  it('renders compact work and evidence under assistant turns', () => {
    const turns = parseAskHistoryTurns([
      { role: 'user', text: 'what calls X' },
      {
        role: 'assistant',
        text: 'Gateway → orders.',
        work: ['Read the graph (orders)', 'Explored 3 files'],
        evidence: {
          filesRead: ['gateway/src/routes/orders.ts'],
          tools: ['read_file'],
          proposals: ['p1'],
        },
      },
    ]);
    const lines = renderAskHistorySection(turns);
    assert.ok(lines.includes('Assistant: Gateway → orders.'));
    assert.ok(lines.some((l) => l.includes('[work]') && l.includes('Read the graph')));
    assert.ok(lines.some((l) => l.includes('[files]') && l.includes('orders.ts')));
    assert.ok(lines.some((l) => l.includes('[tools]') && l.includes('read_file')));
    assert.ok(lines.some((l) => l.includes('[proposals]') && l.includes('p1')));
  });

  it('names memory trimmed when earlier turns were omitted', () => {
    const turns = parseAskHistoryTurns([
      { role: 'user', text: 'old' },
      { role: 'assistant', text: 'reply' },
    ]);
    const lines = renderAskHistorySection(turns, 20, { droppedTurns: 12 });
    assert.match(lines[0]!, /12 earlier turns omitted — memory trimmed/);
  });

  it('marks truncated turn bodies as memory trimmed', () => {
    const long = 'x'.repeat(1300);
    const lines = renderAskHistorySection([{ role: 'user', text: long }]);
    assert.ok(lines.some((l) => l.includes('[memory trimmed]')));
  });

  it('drops non-string work/evidence junk from a hostile client', () => {
    const turns = parseAskHistoryTurns([
      {
        role: 'assistant',
        text: 'ok',
        work: ['real', 12, null, ''],
        evidence: { filesRead: ['a.ts', 3], tools: [{ name: 'x' }], proposals: ['p'] },
      },
    ]);
    assert.deepEqual(turns[0]!.work, ['real']);
    assert.deepEqual(turns[0]!.evidence, { filesRead: ['a.ts'], proposals: ['p'] });
  });

  it('ignores history that is not an array', () => {
    assert.deepEqual(parseAskHistoryTurns(null), []);
    assert.deepEqual(parseAskHistoryTurns({ role: 'user' }), []);
  });
});
