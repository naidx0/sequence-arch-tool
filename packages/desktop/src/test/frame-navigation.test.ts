import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { allowFrameNavigation } from '../frameNavigation';

test('a subframe may only show its own srcdoc; the main frame is untouched', () => {
  assert.equal(allowFrameNavigation(false, 'about:srcdoc'), true);
  assert.equal(allowFrameNavigation(false, 'about:blank'), true);
  for (const url of ['https://evil.test/?secret=1', 'http://127.0.0.1:3000/api/status', 'data:text/html,<p>x</p>', 'javascript:alert(1)', 'blob:null/1', 'file:///etc/passwd']) {
    assert.equal(allowFrameNavigation(false, url), false, url);
  }
  assert.equal(allowFrameNavigation(true, 'https://example.test/'), true);
});

test('main.ts wires will-frame-navigate to it', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main.ts'), 'utf8');
  assert.match(main, /will-frame-navigate/);
  assert.match(main, /allowFrameNavigation\(event\.isMainFrame, event\.url\)/);
});
