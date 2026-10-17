import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { MainLog, MAX_LINE_CHARS, formatLine, pushTail, redactPaths, redactSecrets } from '../mainLog.js';
import { decideRendererRecovery } from '../rendererRecovery.js';

const T = new Date('2026-10-11T12:00:00.000Z');

test('a line is a timestamped one-liner', () => {
  assert.equal(formatLine(T, 'app-start', 'v=0.1.6'), '2026-10-11T12:00:00.000Z app-start v=0.1.6');
  assert.equal(formatLine(T, 'before-quit'), '2026-10-11T12:00:00.000Z before-quit');
  const multi = formatLine(T, 'x', 'a\nb\r\nc');
  assert.ok(!/[\r\n]/.test(multi));
  assert.ok(formatLine(T, 'x', 'z'.repeat(5000)).length < MAX_LINE_CHARS + 60);
});

test('paths outside userData are redacted; paths under it are kept', () => {
  const ud = 'C:\\Users\\max\\AppData\\Roaming\\Sequence';
  assert.equal(redactPaths('open C:\\Users\\max\\secret\\repo\\a.ts failed', ud), 'open <path> failed');
  assert.equal(redactPaths('x /home/max/repo/file.ts y', ud), 'x <path> y');
  assert.equal(redactPaths('at ' + ud + '\\logs\\main.log ok', ud), 'at ' + ud + '\\logs\\main.log ok');
  assert.equal(redactPaths('code=1 signal=null', ud), 'code=1 signal=null');
  /* over-redacting a URL route is the safe side of the trade */
  assert.equal(redactPaths('GET /api/x 200', ud), 'GET <path> 200');
  assert.equal(redactPaths('exit 1 \\\\server\\share\\f', ud), 'exit 1 <path>');
});

test('rotation keeps one previous file and caps the size', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mainlog-'));
  try {
    const log = new MainLog(dir, { maxBytes: 300, now: () => T });
    for (let i = 0; i < 40; i++) log.write('evt', `n=${i}`);
    const files = fs.readdirSync(dir).sort();
    assert.deepEqual(files, ['main.log', 'main.log.1']);
    assert.ok(fs.statSync(path.join(dir, 'main.log')).size <= 300);
    const all = fs.readFileSync(path.join(dir, 'main.log'), 'utf8');
    assert.ok(all.trimEnd().endsWith('evt n=39'));
    for (let i = 0; i < 400; i++) log.write('evt', `n=${i}`);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['main.log', 'main.log.1']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a log in an unwritable place never throws', () => {
  const log = new MainLog(path.join(os.tmpdir(), 'x\0bad'));
  assert.doesNotThrow(() => log.write('evt'));
});

test('renderer recovery: first death reloads, a second within the window shows the dialog', () => {
  const a = decideRendererRecovery([], 1000, 60_000);
  assert.equal(a.action, 'reload');
  const b = decideRendererRecovery(a.recent, 20_000, 60_000);
  assert.equal(b.action, 'dialog');
  const c = decideRendererRecovery(b.recent, 200_000, 60_000);
  assert.equal(c.action, 'reload', 'old deaths age out');
});

test('secrets are redacted (positive controls) and ordinary text is not (negative controls)', () => {
  const dirty = [
    'key sk-ant-api03-AbCdEf123456-xyz_9',
    'key sk-proj-AbCdEf1234567890',
    'Authorization: Bearer eyJhbGciOi.eyJzdWIiOi.sig-nature',
    'tok ghp_abcdefghij1234567890 gho_abcdefghij1234567890',
    'ANTHROPIC_API_KEY=supersecretvalue',
    'GET http://127.0.0.1:1/x?key=SECRETVAL&b=2',
    'db_password: "hunter two"',
    'auth_token=abc123 client_secret=zzz',
  ];
  for (const d of dirty) {
    const out = redactSecrets(d);
    for (const bad of ['AbCdEf', 'eyJ', 'ghp_', 'gho_', 'supersecretvalue', 'SECRETVAL', 'hunter', 'abc123', 'zzz', 'nature']) {
      assert.ok(!out.includes(bad), `${bad} survived in: ${out}`);
    }
    assert.ok(out.includes('<redacted>'), out);
  }
  for (const clean of ['exited code=1 signal=null', 'keyboard=1 TypeError: x is undefined', 'listening on port 5173', 'stderr-tail=[]']) {
    assert.equal(redactSecrets(clean), clean);
  }
  assert.ok(!formatLine(T, 'x', 'ANTHROPIC_API_KEY=abc').includes('abc'));
});

test('a long detail keeps its END (the crash line)', () => {
  const out = formatLine(T, 'x', 'a'.repeat(2000) + ' FATAL-LAST-LINE');
  assert.ok(out.endsWith('FATAL-LAST-LINE'));
  assert.ok(out.length < MAX_LINE_CHARS + 60);
});

test('pushTail keeps the last N lines, not chunks, with each line capped', () => {
  const tail: string[] = [];
  pushTail(tail, Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n'), 8);
  assert.deepEqual(tail, ['l12', 'l13', 'l14', 'l15', 'l16', 'l17', 'l18', 'l19']);
  pushTail(tail, 'x'.repeat(10000) + 'END', 8, 300);
  assert.ok(tail[tail.length - 1].length <= 301 && tail[tail.length - 1].endsWith('END'));
  assert.equal(tail.length, 8);
});

test('a rotation that cannot rename still holds the cap (truncate fallback)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mainlog-'));
  try {
    fs.mkdirSync(path.join(dir, 'main.log.1')); /* a directory blocks the rename */
    const log = new MainLog(dir, { maxBytes: 300, now: () => T });
    for (let i = 0; i < 200; i++) log.write('evt', `n=${i}`);
    assert.ok(fs.statSync(path.join(dir, 'main.log')).size <= 300);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
