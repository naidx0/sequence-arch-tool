import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import {
  ASK_TURN_KEEP,
  askTurnExists,
  isAskTurnId,
  openAskTurnLog,
  readAskTurnEvents,
} from '../server/askTurnLog.js';

function tmpRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'seq-askturn-'));
}

const RUN = 'run-abc123-0000ffff';

describe('recording a turn as it happens', () => {
  it('numbers events from one, in order', () => {
    const repo = tmpRepo();
    const log = openAskTurnLog(repo, RUN);
    assert.equal(log.append({ type: 'delta', text: 'a' }).seq, 1);
    assert.equal(log.append({ type: 'delta', text: 'b' }).seq, 2);
    assert.equal(log.lastSeq(), 2);
  });

  it('reads back exactly what was streamed', () => {
    const repo = tmpRepo();
    const log = openAskTurnLog(repo, RUN);
    log.append({ type: 'delta', text: 'It walks ' });
    log.append({ type: 'result', text: 'It walks the repository.' });

    const events = readAskTurnEvents(repo, RUN);
    assert.deepEqual(
      events.map((e) => e.event),
      [
        { type: 'delta', text: 'It walks ' },
        { type: 'result', text: 'It walks the repository.' },
      ],
    );
  });

  it('CONTINUES the sequence when the log is reopened', () => {
    /* A turn resumed after a restart must not hand out seq 1 twice, or a
       replaying client silently skips everything in between. */
    const repo = tmpRepo();
    openAskTurnLog(repo, RUN).append({ type: 'delta', text: 'a' });
    const second = openAskTurnLog(repo, RUN);
    assert.equal(second.lastSeq(), 1);
    assert.equal(second.append({ type: 'delta', text: 'b' }).seq, 2);
  });

  it('replays only what a client has not seen', () => {
    const repo = tmpRepo();
    const log = openAskTurnLog(repo, RUN);
    for (const t of ['a', 'b', 'c', 'd']) log.append({ type: 'delta', text: t });

    assert.deepEqual(
      readAskTurnEvents(repo, RUN, 2).map((e) => e.seq),
      [3, 4],
    );
    /* Asking from the end is not an error - it is the ordinary state of a
       client that reconnected having missed nothing. */
    assert.deepEqual(readAskTurnEvents(repo, RUN, 4), []);
  });

  it('answers empty for a turn that never existed', () => {
    const repo = tmpRepo();
    assert.deepEqual(readAskTurnEvents(repo, 'run-zzz999-0000aaaa'), []);
    assert.equal(askTurnExists(repo, 'run-zzz999-0000aaaa'), false);
  });

  it('SURVIVES A TORN FINAL LINE, which is the crash this exists for', () => {
    /* A process killed mid-append leaves half a JSON line. Everything before
       it is still a true record of what the turn emitted, and losing all of it
       to one bad tail would defeat the whole store. */
    const repo = tmpRepo();
    const log = openAskTurnLog(repo, RUN);
    log.append({ type: 'delta', text: 'a' });
    log.append({ type: 'delta', text: 'b' });
    const file = path.join(repo, '.sequence', 'ask-turns', RUN, 'events.ndjson');
    fs.appendFileSync(file, '{"seq":3,"at":1,"even');

    const events = readAskTurnEvents(repo, RUN);
    assert.equal(events.length, 2);
    assert.equal(events[1]?.seq, 2);
  });

  it('skips a line that parses but is not an event', () => {
    const repo = tmpRepo();
    openAskTurnLog(repo, RUN).append({ type: 'delta', text: 'a' });
    const file = path.join(repo, '.sequence', 'ask-turns', RUN, 'events.ndjson');
    fs.appendFileSync(file, `${JSON.stringify({ nonsense: true })}\n`);
    assert.equal(readAskTurnEvents(repo, RUN).length, 1);
  });
});

describe('the turn id is a directory name, so it is the jail', () => {
  it('accepts the shape newRunId produces', () => {
    assert.equal(isAskTurnId('run-abc123-0000ffff'), true);
  });

  it('REFUSES a traversal rather than stripping it', () => {
    for (const hostile of ['../../etc/passwd', 'a/b', 'C:\\Windows', '..', '']) {
      assert.equal(isAskTurnId(hostile), false, hostile);
      assert.deepEqual(readAskTurnEvents(tmpRepo(), hostile), []);
      assert.equal(askTurnExists(tmpRepo(), hostile), false);
    }
  });

  it('throws rather than writing outside the store', () => {
    assert.throws(() => openAskTurnLog(tmpRepo(), '../escape'));
  });
});

describe('the store is bounded', () => {
  it(`keeps ${ASK_TURN_KEEP} turns and sweeps the rest`, () => {
    const repo = tmpRepo();
    for (let i = 0; i < ASK_TURN_KEEP + 5; i++) {
      openAskTurnLog(repo, `run-${String(i).padStart(6, '0')}-0000aaaa`).append({ type: 'delta', text: 'x' });
    }
    const kept = fs.readdirSync(path.join(repo, '.sequence', 'ask-turns'));
    assert.ok(kept.length <= ASK_TURN_KEEP + 1, `kept ${kept.length}`);
  });
});
