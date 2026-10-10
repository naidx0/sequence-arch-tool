import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseAskArgs } from '../askCli.js';

/**
 * MACHINE-READABLE PROGRESS OUT OF `sequence ask`.
 *
 * Rank 39's row read ✅ and was crediting a different command:
 * `sequence program run --json`, which is a different event union on a
 * different code path. `sequence ask` had `--json`, which emits ONE object at
 * the END - no step boundaries, no tool calls, nothing a CI consumer can act
 * on until the turn is already over.
 *
 * The pipeline has taken an `emit` callback the whole time and this caller
 * passed none, so the events existed and left by no door.
 */

describe('--output-format', () => {
  it('defaults to text, so nothing about the existing CLI changes', () => {
    assert.equal(parseAskArgs(['why']).outputFormat, 'text');
  });

  it('accepts the = form', () => {
    assert.equal(parseAskArgs(['why', '--output-format=stream-json']).outputFormat, 'stream-json');
  });

  it('accepts the space form', () => {
    /* A reader who writes the one the CLI does not accept gets silence
       otherwise, which reads as the flag being ignored. */
    assert.equal(parseAskArgs(['why', '--output-format', 'stream-json']).outputFormat, 'stream-json');
  });

  it('an unknown format falls back to text rather than failing the run', () => {
    /* The question is the request; refusing to answer it because a formatting
       argument was misspelled would lose the work to a typo. */
    assert.equal(parseAskArgs(['why', '--output-format=yaml']).outputFormat, 'text');
    assert.equal(parseAskArgs(['why', '--output-format']).outputFormat, 'text');
  });

  it('is INDEPENDENT of --json, which is a different promise', () => {
    /* `--json` = one object at the end. `stream-json` = events as they happen.
       A caller can reasonably want either, or both. */
    const both = parseAskArgs(['why', '--json', '--output-format=stream-json']);
    assert.equal(both.json, true);
    assert.equal(both.outputFormat, 'stream-json');

    const onlyStream = parseAskArgs(['why', '--output-format=stream-json']);
    assert.equal(onlyStream.json, false);
  });

  it('does not swallow the question', () => {
    /* The value after a space-form flag must not be mistaken for the question,
       and the question must survive the flag appearing before it. */
    assert.equal(parseAskArgs(['--output-format', 'stream-json', 'what breaks'].slice(0)).question, 'what breaks');
    assert.equal(parseAskArgs(['what breaks', '--output-format=stream-json']).question, 'what breaks');
  });
});

describe('the usage text tells a reader it exists', () => {
  it('names the flag and the difference from --json', async () => {
    /* A flag nobody can discover is a flag nobody uses - the same
       discoverability rule the owner walk opened on. */
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const path = await import('node:path');
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(here, '..', '..', 'src', 'askCli.ts'), 'utf8');
    const usage = src.slice(src.indexOf('const USAGE'), src.indexOf('const USAGE') + 1600);
    assert.match(usage, /--output-format stream-json/);
    assert.match(usage, /one event per line/);
  });
});
