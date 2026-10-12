import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { saveDrawing } from '@sequence/analyzer';
import { listDrawingsTool, readDrawingTool } from '../drawingTools.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-drawings-'));
const SVG = '<svg viewBox="0 0 4 4"><title>Request path</title><rect width="2" height="2"/></svg>';

test('list_drawings and read_drawing see what the app saved; an update is a version, not a copy', () => {
  const a = saveDrawing(root, { chat: 'c1', turn: 't1', kind: 'svg', source: SVG });
  assert.equal(a.drawing.id, 'd1');
  assert.equal(a.drawing.title, 'Request path');
  const listed = JSON.parse(listDrawingsTool({ repoPath: root }).content[0]!.text) as { drawings: { id: string; name: string; versions: number }[] };
  assert.deepEqual(listed.drawings.map((d) => [d.id, d.name, d.versions]), [['d1', '1-request-path.svg', 1]]);
  const read = JSON.parse(readDrawingTool({ repoPath: root, id: '@drawing:d1' }).content[0]!.text) as { source: string; version: number };
  assert.equal(read.source, SVG);
  const v2 = saveDrawing(root, { chat: 'c1', turn: 't2', kind: 'svg', source: SVG.replace('width="2"', 'width="3"'), id: 'd1' });
  assert.equal(v2.version, 2);
  assert.equal(listDrawingsTool({ repoPath: root }).content[0]!.text.match(/"id"/g)!.length, 1, 'still one drawing');
  assert.ok(fs.existsSync(path.join(root, '.sequence/drawings/c-c1/1-request-path-v2.svg')));
  assert.match(JSON.parse(readDrawingTool({ repoPath: root, id: 'd1', version: 1 }).content[0]!.text).source, /width="2"/);
  assert.equal(readDrawingTool({ repoPath: root, id: 'd99' }).isError, true);
});

test('the same text in the same chat is the same drawing; a hostile chat or title cannot leave the folder', () => {
  const again = saveDrawing(root, { chat: 'c1', kind: 'svg', source: SVG.replace('width="2"', 'width="3"') });
  assert.equal(again.created, false);
  const evil = saveDrawing(root, { chat: '../../etc', kind: 'html', source: '<p>x</p>', title: '../../x' });
  assert.ok(path.resolve(root, '.sequence/drawings', evil.drawing.versions[0]!.file).startsWith(path.join(root, '.sequence', 'drawings')));
  assert.throws(() => saveDrawing(root, { chat: 'c1', kind: 'html', source: '<p/>', id: 'd1' }), /stay svg/);
  assert.throws(() => saveDrawing(root, { chat: 'c1', kind: 'html', source: '<p/>', id: '../x' }), /not a drawing id/);
});
