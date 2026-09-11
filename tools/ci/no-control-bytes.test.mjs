/**
 * No tracked TEXT file may carry a C0 control byte other than tab, LF or CR.
 *
 * WHY THIS EXISTS — it cost a real investigation. Eight source files were
 * carrying LITERAL NUL bytes (0x00) where the author had written the escape
 * sequence `\u0000` inside a template literal:
 *
 *     const key = `${e.srcId}\u0000${e.dstId}\u0000${family}`;
 *
 * The escape was interpreted during authoring (heredoc / tooling), so the byte
 * landed in the file instead of the six characters that describe it.
 *
 * THIS COMPILES AND PASSES. A NUL is a legal character in a JS string, the key
 * separator still separates, every suite stayed green. That is exactly what
 * makes it dangerous: nothing fails, and the file goes quietly wrong in a
 * different way — `grep` classifies any file containing a NUL as BINARY and
 * stops printing matches from it. `packages/export/src/serviceInterior.ts` did
 * not appear in a content search for its own function name.
 *
 * A file invisible to code search is a file no future agent will find. It will
 * be re-implemented rather than edited, and the duplicate will be the one that
 * gets maintained.
 *
 * SCOPE — tracked text files only. Real binaries (images, fonts, wasm, lock
 * artefacts) are excluded by extension, because a PNG is *supposed* to be full
 * of control bytes. The check reads bytes, never decoded text, because
 * decoding is what hides the problem.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Extensions that are genuinely text and must stay greppable. */
const TEXT_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.md', '.css', '.html', '.yml', '.yaml',
  '.sh', '.txt', '.svg',
]);

/**
 * Tab (0x09), LF (0x0A) and CR (0x0D) are the only control bytes a text file
 * has any business containing. CR is permitted because `core.autocrlf=true`
 * on Windows checks files out with CRLF line endings — flagging it would fail
 * the whole tree on one platform and nothing else.
 */
function isForbidden(byte) {
  if (byte === 0x09 || byte === 0x0a || byte === 0x0d) return false;
  return byte < 0x20 || byte === 0x7f;
}

function trackedTextFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split('\0')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((f) => TEXT_EXT.has(path.extname(f).toLowerCase()));
}

test('no tracked text file carries a C0 control byte (tab/LF/CR excepted)', () => {
  const offenders = [];

  for (const rel of trackedTextFiles()) {
    let buf;
    try {
      buf = fs.readFileSync(path.join(ROOT, rel));
    } catch {
      continue; // a path in the index but not on disk is not this test's business
    }

    const found = [];
    for (let i = 0; i < buf.length; i++) {
      if (isForbidden(buf[i])) {
        found.push({ offset: i, byte: buf[i] });
        if (found.length >= 4) break;
      }
    }

    if (found.length > 0) {
      const where = found
        .map((f) => `offset ${f.offset} = 0x${f.byte.toString(16).padStart(2, '0')}`)
        .join(', ');
      offenders.push(`${rel} — ${where}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    'Tracked text files contain control bytes, which makes them BINARY to grep ' +
      'and therefore invisible to code search. Write the escape sequence ' +
      '(for example backslash-u-0-0-0-0) rather than the byte itself:\n  ' +
      offenders.join('\n  '),
  );
});
