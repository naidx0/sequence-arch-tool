import assert from 'node:assert/strict';
import test from 'node:test';

import { derivePicturePointer, pointsAtPicture, withPicturePointer } from '../server/conceptChart.js';

/* The re-measure r5 chart and r4 answer from the owner's ML Harness run (09-23),
   trimmed: the answer taught and the chart landed, and neither mentioned the other. */
const R5 = {
  version: 1,
  kind: 'system-architecture',
  title: 'ML Harness Architecture Overview',
  items: [
    { id: 'frontend', label: 'frontend' },
    { id: 'engine-client', label: 'engine client' },
    { id: 'main-router', label: 'main.py' },
    { id: 'ml-harness', label: 'ml-harness' },
    { id: 'database', label: 'database' },
    { id: 'hwdetect', label: 'hwdetect' },
  ],
  links: [
    { from: 'frontend', to: 'engine-client', label: 'HTTP client calls' },
    { from: 'engine-client', to: 'main-router', label: 'GET /health' },
    { from: 'main-router', to: 'ml-harness', label: 'Forwarded API traffic' },
    { from: 'ml-harness', to: 'database', label: 'Read/write session state' },
  ],
} as never;

const R4 =
  'The app is a FastAPI service (`app/main.py`) that sits behind a React UI (`frontend`). The service persists state in a SQLite database.\n\n' +
  '**Check-in:** which part do you think ml-harness hands off to next?';

test('a chart with a start walks the learner along the arrows from it', () => {
  assert.equal(
    derivePicturePointer(R5),
    'On the canvas, start at **frontend** and follow the arrows through **engine client** and **main.py** to **ml-harness**.',
  );
});

test('the pointer goes before the closing check-in, so the question stays last', () => {
  const out = withPicturePointer(R4, R5);
  const paras = out.split('\n\n');
  assert.equal(paras.length, 3);
  assert.match(paras[1]!, /^On the canvas, start at \*\*frontend\*\*/);
  assert.match(paras[2]!, /^\*\*Check-in:\*\*/);
});

test('a lesson that already points at its picture is left byte for byte', () => {
  const text = 'Follow the arrows on the canvas from the frontend to the database.';
  assert.equal(withPicturePointer(text, R5), text);
  assert.ok(pointsAtPicture('the highlighted box'));
  assert.ok(!pointsAtPicture('The service persists state in a SQLite database.'));
});

test('a focused chart names the highlighted box instead of walking', () => {
  const focused = { ...(R5 as object), focusItemId: 'main-router' } as never;
  assert.match(derivePicturePointer(focused)!, /\*\*main\.py\*\* is the highlighted box/);
});

test('a loop cannot run forever and a lone box gets no pointer', () => {
  const loop = {
    version: 1,
    kind: 'data-flow',
    title: 'loop',
    items: [
      { id: 'a', label: 'ml-harness' },
      { id: 'b', label: 'ml-harness-app' },
    ],
    links: [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'a' },
    ],
  } as never;
  assert.equal(derivePicturePointer(loop), 'On the canvas, start at **ml-harness** and follow the arrow to **ml-harness-app**.');
  const lone = { version: 1, kind: 'data-flow', title: 'x', items: [{ id: 'a', label: 'a' }] } as never;
  assert.equal(derivePicturePointer(lone), undefined);
  assert.equal(withPicturePointer('Some lesson text here.', lone), 'Some lesson text here.');
});

test('with no closing question the pointer is appended at the end', () => {
  const out = withPicturePointer('The frontend calls the service.', R5);
  assert.match(out, /service\.\n\nOn the canvas/);
});

test('a one-paragraph lesson has its closing question split off, so the question still comes last', () => {
  const one = 'The frontend calls main.py over HTTP. The service stores state in SQLite. What would break if SQLite were read-only?';
  const out = withPicturePointer(one, R5).split('\n\n');
  assert.deepEqual(out.length, 3);
  assert.equal(out[0], 'The frontend calls main.py over HTTP. The service stores state in SQLite.');
  assert.match(out[1]!, /^On the canvas, start at \*\*frontend\*\*/);
  assert.equal(out[2], 'What would break if SQLite were read-only?');
  /* A text that is only a question gets the line in front of it. */
  assert.match(withPicturePointer('Which part hands off next?', R5), /^On the canvas[^\n]*\n\nWhich part hands off next\?$/);
});
