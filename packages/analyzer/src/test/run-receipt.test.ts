import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  RUN_RECEIPT_KEEP,
  buildRunReceipt,
  readRunReceipt,
  routeHost,
  writeRunReceipt,
  type RunReceiptParts,
} from '../server/runReceipt.js';

/**
 * THE CHANGE RECEIPT IS ASSEMBLED, NEVER INVENTED (audit G3).
 *
 * Two properties are locked here, because each is the failure the receipt
 * would otherwise ship with:
 *
 *   1. A field that was not measured is NOT IN THE OBJECT. The assertion is
 *      `'key' in receipt === false`, not `=== undefined` — a key set to
 *      undefined survives `Object.keys` and reads as "measured, empty" to a
 *      reader that checks presence. Same rule as `AskPipelineResult.coverage`.
 *   2. The key never enters, whatever the base URL carries. A receipt is a
 *      file a reader forwards; a base URL can hold a credential as userinfo
 *      or as a query parameter, and `providerRoute.host` must be the host
 *      and nothing else.
 */

const baseParts: RunReceiptParts = {
  runId: 'run-1',
  startedAt: '2026-09-01T10:00:00.000Z',
  finishedAt: '2026-09-01T10:00:05.000Z',
  terminal: 'result',
  events: [],
};

describe('buildRunReceipt', () => {
  it('carries only the identity fields when nothing else was measured', () => {
    const r = buildRunReceipt(baseParts);
    assert.deepEqual(Object.keys(r).sort(), ['finishedAt', 'runId', 'startedAt', 'terminal', 'version'].sort());
    for (const key of [
      'error',
      'instructionHash',
      'model',
      'providerRoute',
      'permission',
      'coverage',
      'tools',
      'commands',
      'metrics',
      'providerRetries',
      'filesWritten',
      'rollbackPoint',
      'verify',
    ]) {
      assert.equal(key in r, false, `${key} must be ABSENT, not present-and-undefined`);
    }
  });

  it('keeps the permission SOURCES when the caller named no mode — a words-only turn still loaded a policy', () => {
    /*
     * REVIEW (honesty): `permission` was emitted only inside the
     * `permissionMode !== undefined` branch, so a turn that loaded and
     * enforced two permission files but asked for no mode reported none of
     * them. The sources are measured whether or not a mode was named.
     */
    const r = buildRunReceipt({
      ...baseParts,
      result: { permissionSources: ['project:.sequence/permissions.json', 'user:permissions.json'] },
    });
    assert.deepEqual(r.permission, { sources: ['project:.sequence/permissions.json', 'user:permissions.json'] });
    assert.equal('mode' in (r.permission ?? {}), false, 'no mode was asked for, so none is claimed');
    const neither = buildRunReceipt({ ...baseParts, result: {} });
    assert.equal('permission' in neither, false, 'nothing measured ⇒ absent');
  });

  it('sources every measured field from the part that measured it', () => {
    const r = buildRunReceipt({
      ...baseParts,
      instructionHash: 'abc123',
      cfg: { provider: 'openai-compatible', model: 'm-1', baseUrl: 'http://127.0.0.1:11434/v1' },
      permissionMode: 'full',
      providerRetries: 2,
      rollbackPoint: 7,
      events: [
        { type: 'tool:start', id: 't1', name: 'read_file' },
        { type: 'tool:done', id: 't1', name: 'read_file' },
        { type: 'tool:done', id: 't2', name: 'read_file' },
        /* A refused request still streams tool:done — it is a call the model made. */
        { type: 'tool:done', id: 't3', name: 'run_command' },
        { type: 'command:log', cmd: 'node ok.mjs', exitCode: 0, output: '', ok: true },
        { type: 'command:log', cmd: 'node fail.mjs', exitCode: 3, output: 'boom', ok: false },
        { type: 'delta', text: 'ignored' },
      ],
      result: {
        coverage: { edgesTotal: 10, edgesSeen: 8, packagesSeen: ['a'], packagesMissed: ['x'] },
        metrics: { rounds: 3, stopReason: 'complete', designMode: false, wallMs: 1234, providerCallMs: [400, 500, 334] },
        usage: { inputTokens: 100, outputTokens: 20, estimated: false },
        verify: { status: 'passed', cmd: 'node ok.mjs', exitCode: 0 },
        filesWritten: ['src/a.ts'],
        permissionSources: ['project'],
      },
    });
    assert.equal(r.instructionHash, 'abc123');
    assert.equal(r.model, 'm-1');
    assert.deepEqual(r.providerRoute, { provider: 'openai-compatible', host: '127.0.0.1:11434' });
    assert.deepEqual(r.permission, { mode: 'full', sources: ['project'] });
    assert.deepEqual(r.tools, { read_file: 2, run_command: 1 });
    assert.deepEqual(r.commands, [
      { cmd: 'node ok.mjs', exitCode: 0, ok: true },
      { cmd: 'node fail.mjs', exitCode: 3, ok: false },
    ]);
    assert.deepEqual(r.metrics, {
      rounds: 3,
      stopReason: 'complete',
      wallMs: 1234,
      tokens: { input: 100, output: 20, estimated: false },
      perCallMs: [400, 500, 334],
    });
    assert.equal(r.providerRetries, 2);
    assert.deepEqual(r.filesWritten, ['src/a.ts']);
    assert.equal(r.rollbackPoint, 7);
    assert.deepEqual(r.verify, { status: 'passed', cmd: 'node ok.mjs', exitCode: 0 });
    assert.deepEqual(r.coverage, { edgesTotal: 10, edgesSeen: 8, packagesSeen: ['a'], packagesMissed: ['x'] });
  });

  it('a zero-write turn says [] — measured — while an error terminal says nothing', () => {
    const ok = buildRunReceipt({
      ...baseParts,
      result: { filesWritten: [], metrics: { rounds: 1, stopReason: 'complete', designMode: false } },
    });
    assert.deepEqual(ok.filesWritten, []);
    assert.equal('tokens' in ok.metrics!, false, 'no usage ⇒ no tokens key');
    assert.equal('perCallMs' in ok.metrics!, false, 'no per-call timings ⇒ no perCallMs key');

    const failed = buildRunReceipt({ ...baseParts, terminal: 'error', error: 'provider request failed: 502' });
    assert.equal(failed.terminal, 'error');
    assert.equal(failed.error, 'provider request failed: 502');
    assert.equal('filesWritten' in failed, false);
    assert.equal('metrics' in failed, false);
  });

  it('permission.sources is absent when the pipeline did not report them, present-and-empty when it did', () => {
    const noReport = buildRunReceipt({ ...baseParts, permissionMode: 'plan' });
    assert.deepEqual(noReport.permission, { mode: 'plan' });
    assert.equal('sources' in noReport.permission!, false);
    const reported = buildRunReceipt({ ...baseParts, permissionMode: 'plan', result: { permissionSources: [] } });
    assert.deepEqual(reported.permission, { mode: 'plan', sources: [] });
  });

  it('never carries the key, wherever the base URL hides one', () => {
    const SECRET = 'sk-SECRET-KEY-9f8e7d';
    const r = buildRunReceipt({
      ...baseParts,
      cfg: {
        provider: 'openai-compatible',
        model: 'm',
        baseUrl: `https://alice:${SECRET}@api.example.com:8443/v1/chat?api_key=${SECRET}#frag`,
        /* A full AiConfig is what callers pass; the builder must not copy it. */
        apiKey: SECRET,
      } as RunReceiptParts['cfg'],
    });
    assert.deepEqual(r.providerRoute, { provider: 'openai-compatible', host: 'api.example.com:8443' });
    const json = JSON.stringify(r);
    assert.equal(json.includes(SECRET), false, 'the key must not appear anywhere in the receipt');
    assert.equal(json.includes('alice'), false, 'userinfo must not appear');
    assert.equal(json.includes('/v1'), false, 'the path must not appear');
    assert.equal(json.includes('api_key'), false, 'the query must not appear');
  });

  it('an unparseable base URL yields no host rather than a substring guess', () => {
    assert.equal(routeHost('not a url'), undefined);
    assert.equal(routeHost(undefined), undefined);
    const r = buildRunReceipt({ ...baseParts, cfg: { provider: 'anthropic', model: 'm', baseUrl: 'not a url' } });
    assert.deepEqual(r.providerRoute, { provider: 'anthropic' });
    assert.equal('host' in r.providerRoute!, false);
  });
});

describe('writeRunReceipt', () => {
  it('lands under .sequence/receipts/<runId>.json and keeps the newest 50', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-receipt-'));
    try {
      const dir = path.join(repo, '.sequence', 'receipts');
      const base = Date.now() - 10 * 60_000;
      for (let i = 0; i < RUN_RECEIPT_KEEP; i++) {
        const runId = `r${String(i).padStart(2, '0')}`;
        writeRunReceipt(repo, buildRunReceipt({ ...baseParts, runId }));
        /* mtimes staggered by hand: a burst of writes on OneDrive or a coarse
           filesystem lands inside one tick, and the sweep orders by mtime. */
        const at = new Date(base + i * 1000);
        fs.utimesSync(path.join(dir, `${runId}.json`), at, at);
      }
      assert.equal(fs.readdirSync(dir).length, RUN_RECEIPT_KEEP);

      writeRunReceipt(repo, buildRunReceipt({ ...baseParts, runId: 'newest' }));
      const names = fs.readdirSync(dir);
      assert.equal(names.length, RUN_RECEIPT_KEEP, 'the sweep holds the directory at the cap');
      assert.ok(names.includes('newest.json'), 'the receipt just written survives its own sweep');
      assert.equal(names.includes('r00.json'), false, 'the oldest is the one swept');
      assert.ok(names.includes('r01.json'));
      assert.equal(readRunReceipt(repo, 'newest')?.runId, 'newest');
      assert.equal(readRunReceipt(repo, 'r00'), undefined);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it('refuses a run id that is not a file name', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-receipt-'));
    try {
      assert.throws(() => writeRunReceipt(repo, buildRunReceipt({ ...baseParts, runId: '../escape' })));
      assert.equal(fs.existsSync(path.join(repo, '.sequence')), false);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
