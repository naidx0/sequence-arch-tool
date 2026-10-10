#!/usr/bin/env node
/* Writes the fixtures that were NOT recorded live (claudeFixtures.ts,
   codexPlanFixture.ts) into src/test/fixtures/replay/. A test checks the
   checked-in files equal what this writes. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { claudeFixtures } from '../claudeFixtures.js';
import { codexPlanFixture } from '../codexPlanFixture.js';
import { codexAlwaysFixture, codexHungFixture, codexResumeFixture, codexSignedOutFixture } from '../codexS1Fixtures.js';
import { codexCapabilitiesFixture, codexCompactFixture, codexModelEffortFixture } from '../codexS2bFixtures.js';
import { formatFixture, type Fixture } from '../fixture.js';
import { s2aFixtures } from '../s2aFixtures.js';
import { codexQuestionFixtures } from '../codexQuestionFixtures.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURE_ROOT = path.resolve(here, '..', '..', '..', 'src', 'test', 'fixtures', 'replay');

export function syntheticFiles(): { file: string; fixture: Fixture }[] {
  return [
    ...claudeFixtures().map((f) => ({ file: path.join(FIXTURE_ROOT, 'claude', `${f.header.scenario}.jsonl`), fixture: f })),
    { file: path.join(FIXTURE_ROOT, 'codex', 'todo-plan-synthetic.jsonl'), fixture: codexPlanFixture() },
    /* Not under codex/: those all open with thread/start, and the run-node
       replay test plays every one of them as a first turn. */
    ...[codexResumeFixture(), codexHungFixture(), codexAlwaysFixture(), codexSignedOutFixture()].map((f) => ({ file: path.join(FIXTURE_ROOT, 'codex-s1', `${f.header.scenario}.jsonl`), fixture: f })),
    ...[codexCapabilitiesFixture(), codexModelEffortFixture(), codexCompactFixture()].map((f) => ({ file: path.join(FIXTURE_ROOT, 'codex-s2b', `${f.header.scenario}.jsonl`), fixture: f })),
    /* S2a: the board's MCP server, plan mode, images (not run live). */
    ...s2aFixtures().map(({ dir, fixture }) => ({ file: path.join(FIXTURE_ROOT, dir, `${fixture.header.scenario}.jsonl`), fixture })),
    /* Codex asks the person (item/tool/requestUserInput): built around one live-recorded frame. */
    ...codexQuestionFixtures().map((f) => ({ file: path.join(FIXTURE_ROOT, 'codex-question', `${f.header.scenario}.jsonl`), fixture: f })),
  ];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const { file, fixture } of syntheticFiles()) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, formatFixture(fixture));
    console.log(`wrote ${path.relative(process.cwd(), file)}`);
  }
}
