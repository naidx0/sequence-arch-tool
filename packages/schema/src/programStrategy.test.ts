import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  parseProgramEditAllowlist,
  pathMatchesProgramEditAllowlist,
  pathMatchesRepoGlob,
} from './programStrategy.js';

describe('programStrategy', () => {
  it('parses ## Agent may edit section — one glob per line', () => {
    const md = `# Experiment

## Agent may edit

services/payments/**
services/catalog/cache.ts

## Loop
- run tests
`;
    assert.deepStrictEqual(parseProgramEditAllowlist(md), [
      'services/payments/**',
      'services/catalog/cache.ts',
    ]);
  });

  it('parses bullet lines and backticks in the section', () => {
    const md = `## Agent may edit\n\n- ` + '`src/a.ts`' + '\n- `src/b/**`\n';
    assert.deepStrictEqual(parseProgramEditAllowlist(md), ['src/a.ts', 'src/b/**']);
  });

  it('parses inline Setup-style "Agent may edit only …" when section absent', () => {
    const md = `## Setup\n1. Branch from main.\n2. Agent may edit only ` + '`pay/**`' + ' and `catalog/cache.ts`.\n';
    assert.deepStrictEqual(parseProgramEditAllowlist(md), ['pay/**', 'catalog/cache.ts']);
  });

  it('returns undefined when no allowlist is declared', () => {
    assert.strictEqual(parseProgramEditAllowlist('# Loop\nRun forever.\n'), undefined);
  });

  it('pathMatchesRepoGlob supports ** and exact paths', () => {
    assert.strictEqual(pathMatchesRepoGlob('services/payments/foo.ts', 'services/payments/**'), true);
    assert.strictEqual(pathMatchesRepoGlob('services/catalog/cache.ts', 'services/catalog/cache.ts'), true);
    assert.strictEqual(pathMatchesRepoGlob('services/catalog/other.ts', 'services/catalog/cache.ts'), false);
    assert.strictEqual(pathMatchesRepoGlob('other/foo.ts', 'services/payments/**'), false);
  });

  it('pathMatchesProgramEditAllowlist rejects outside any glob', () => {
    const list = ['services/payments/**', 'services/catalog/cache.ts'];
    assert.strictEqual(pathMatchesProgramEditAllowlist('services/payments/x.ts', list), true);
    assert.strictEqual(pathMatchesProgramEditAllowlist('services/other/x.ts', list), false);
    assert.strictEqual(pathMatchesProgramEditAllowlist('anything.ts', undefined), true);
    assert.strictEqual(pathMatchesProgramEditAllowlist('anything.ts', []), true);
  });
});
