/**
 * `.env.example` as a declaration source.
 *
 * Built because the card's left-hand column came only from container manifests,
 * and exactly one repository on this machine had one with app-service env — so
 * "declared, never read" was `0 of 0` on every real repo. A denominator of zero
 * everywhere is not a measurement.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { declaredFromDotenvExample } from './declaredInputs.js';

const withRepo = (files: Record<string, string>, fn: (dir: string) => void): void => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seq-declared-'));
  try {
    for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), body);
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

test('names are read; comments, blanks and values are not', () => {
  withRepo(
    {
      '.env.example': [
        '# Prisma Config',
        'DATABASE_URL=postgresql://postgres:testpass@db:5432/app',
        '',
        '  export TRUST_PROXY=false',
        '#COMMENTED_OUT=1',
        'PROXY_APP_URL="https://proxy.example.com"',
      ].join('\n'),
    },
    (dir) => {
      assert.deepEqual(
        declaredFromDotenvExample(dir).map((d) => d.name),
        ['DATABASE_URL', 'TRUST_PROXY', 'PROXY_APP_URL'],
      );
    },
  );
});

test('a real .env is NEVER read', () => {
  /*
   * It is gitignored, machine-specific and routinely holds secrets. Reading it
   * would make the card's answer depend on who ran it, and would put
   * credentials into a structure that gets rendered.
   */
  withRepo({ '.env': 'SECRET_TOKEN=hunter2\n' }, (dir) => {
    assert.deepEqual(declaredFromDotenvExample(dir), []);
  });
});

test('a repository with no example file declares nothing, and says so by being empty', () => {
  withRepo({ 'README.md': '# hi' }, (dir) => {
    assert.deepEqual(declaredFromDotenvExample(dir), []);
  });
});

test('the source file is recorded, and the first spelling wins for a repeated name', () => {
  withRepo({ '.env.example': 'A=1\nA=2\nB=3\n' }, (dir) => {
    const got = declaredFromDotenvExample(dir);
    assert.deepEqual(got, [
      { name: 'A', source: '.env.example' },
      { name: 'B', source: '.env.example' },
    ]);
  });
});
