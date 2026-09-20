import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  PROGRAM_RUN_LOG_HEADER,
  appendProgramRunLogRow,
  formatProgramRunLogRow,
  isProgramRunLogRow,
  parseProgramRunLog,
} from './programRunLog.js';

describe('programRunLog', () => {
  it('formats and parses a row round-trip', () => {
    const row = {
      runId: 'a1b2c3d',
      programId: 'dogfood-loop',
      metric: 'checker:yes',
      status: 'keep' as const,
      description: 'baseline scout→gate→review',
    };
    const line = formatProgramRunLogRow(row);
    assert.strictEqual(
      line,
      'a1b2c3d\tdogfood-loop\tchecker:yes\tkeep\tbaseline scout→gate→review',
    );
    const parsed = parseProgramRunLog(`${PROGRAM_RUN_LOG_HEADER}\n${line}`);
    assert.deepStrictEqual(parsed, [row]);
  });

  it('appendProgramRunLogRow creates header on first write', () => {
    const next = appendProgramRunLogRow(undefined, {
      runId: 'x',
      programId: 'p',
      metric: 'steps:3',
      status: 'discard',
      description: 'budget stop',
    });
    assert.match(next, new RegExp(`^${PROGRAM_RUN_LOG_HEADER}`));
    assert.ok(next.includes('x\tp\tsteps:3\tdiscard'));
  });

  it('sanitizes tabs/newlines in free-text fields', () => {
    const line = formatProgramRunLogRow({
      runId: 'r1',
      programId: 'p1',
      metric: 'm',
      status: 'crash',
      description: 'line1\nline2\ttab',
    });
    assert.strictEqual(line.split('\t').length, 5);
    assert.ok(!line.includes('\n'));
    assert.ok(line.endsWith('line1 line2 tab'));
  });

  it('isProgramRunLogRow rejects bad status', () => {
    assert.strictEqual(
      isProgramRunLogRow({ runId: 'a', programId: 'b', metric: 'm', status: 'win', description: '' }),
      false,
    );
  });
});
