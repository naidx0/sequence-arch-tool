/**
 * NO CONTROL CHARACTERS IN SOURCE — found three times on 2026-09-22.
 *
 * A patch script that writes a regex through a Python string turns `\b` into
 * a backspace (0x08). The file still compiles: `/\x08(?:board)\x08/` is a
 * valid regex that matches nothing, so the rule it encoded silently stopped
 * applying — a gate that never fired, a draw-surface guess that always missed.
 * No tracked source file has a reason to carry a C0 control byte other than
 * tab, newline and carriage return.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = /\.(?:ts|tsx|mts|mjs|js|css|json|md)$/;

test('no tracked source file carries a control byte', () => {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT })
    .toString('utf8')
    .split('\0')
    .filter((f) => SOURCE.test(f) && !f.startsWith('tools/release/out/'));
  assert.ok(files.length > 100, `only ${files.length} files listed`);
  const bad = [];
  for (const f of files) {
    let buf;
    try {
      buf = fs.readFileSync(path.join(ROOT, f));
    } catch {
      continue;
    }
    for (let i = 0; i < buf.length; i++) {
      const b = buf[i];
      if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d) {
        const line = buf.subarray(0, i).toString('utf8').split('\n').length;
        bad.push(`${f}:${line} byte 0x${b.toString(16).padStart(2, '0')}`);
        break;
      }
    }
  }
  assert.deepEqual(bad, []);
});
