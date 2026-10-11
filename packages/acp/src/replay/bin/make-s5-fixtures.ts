#!/usr/bin/env node
/* Writes the S5 fixtures (codexS5Fixtures.ts, NOT run live) into
   src/test/fixtures/replay/codex-s5/. Not under codex/: the run-node replay
   test plays every file there as a first turn, and these need a client that
   steers or queues. s5-steer.test.ts checks the checked-in files equal what
   this writes. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { s5Fixtures } from '../codexS5Fixtures.js';
import { formatFixture, type Fixture } from '../fixture.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const S5_FIXTURE_DIR = path.resolve(here, '..', '..', '..', 'src', 'test', 'fixtures', 'replay', 'codex-s5');

export function s5Files(): { file: string; fixture: Fixture }[] {
  return s5Fixtures().map((f) => ({ file: path.join(S5_FIXTURE_DIR, `${f.header.scenario}.jsonl`), fixture: f }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const { file, fixture } of s5Files()) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, formatFixture(fixture));
    console.log(`wrote ${path.relative(process.cwd(), file)}`);
  }
}
