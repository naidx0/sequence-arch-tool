import assert from 'node:assert';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * 0.1.8 C1 (owner: on Mac the red, yellow and green lights "are kind of blending in with the actual Sequence title ...
 * a little bit of buffer space at the top"). Source-text assertion, as no-menu.test.ts: main.ts needs the Electron runtime.
 * The web side of the same fix (the 78 px clear strip) is asserted in packages/web2/src/shell2/macLights.test.tsx.
 */
const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', 'main.ts'), 'utf8').replace(/\r\n/g, '\n');

test('macOS places the traffic lights itself: inset from the left, with a buffer above', () => {
  const darwin = src.slice(src.indexOf("process.platform === 'darwin'"));
  assert.match(darwin, /titleBarStyle: 'hiddenInset'/);
  const m = /trafficLightPosition: \{ x: (\d+), y: (\d+) \}/.exec(darwin);
  assert.ok(m, 'trafficLightPosition is set on the darwin branch');
  assert.ok(Number(m[1]) >= 12, 'clear of the left edge');
  assert.ok(Number(m[2]) >= 12, 'a buffer of window above the lights');
  /* The lights are about 16 px tall and the sidebar's title row starts 12 (panel padding) + 24 (--mac-lights-row) down. */
  assert.ok(Number(m[2]) + 16 + 4 <= 12 + 24, 'the title row starts clear below the lights');
});

test('the other platforms do not get the macOS option', () => {
  assert.equal((src.match(/trafficLightPosition:/g) ?? []).length, 1);
  assert.ok(src.indexOf('trafficLightPosition:') > src.indexOf("process.platform === 'darwin'"));
});
