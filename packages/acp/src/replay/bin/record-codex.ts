#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   RECORD THE CODEX REPLAY FIXTURES
   packages/acp/src/replay/bin/record-codex.ts  ->  dist/replay/bin/record-codex.js

     node dist/replay/bin/record-codex.js --out <dir> [--only <name>] [--codex <bin> [--codex-arg <a>]...]

   Runs each scenario ONCE against `codex app-server` in its own temp copy of
   the shopfront fixture, and writes <dir>/<name>.jsonl. These are live model
   calls on the owner's plan: the S0 budget is five sessions in total, so run
   it once and keep what it wrote. With --codex pointing at the fake
   (src/test/fixtures/fake-codex-app-server/codex.mjs) it records the fake,
   which is how the recorder itself is tested.
   ══════════════════════════════════════════════════════════════════════════ */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatFixture } from '../fixture.js';
import { DEFAULT_SOURCE, recordCodexSession, type Scenario } from '../record.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..', '..', '..', '..');
const SHOP = path.join(ROOT, 'packages', 'analyzer', 'test', 'fixtures', 'shopfront');

/*
 * FOUR SESSIONS, EACH ASKING FOR ONE THING THE ADAPTER MUST HANDLE. The
 * prompts name the exact command or file so the model's choice is narrow,
 * and every command is harmless inside a throwaway copy.
 */
export const SCENARIOS: Scenario[] = [
  {
    name: 'edit-with-plan',
    covers: 'a plan with todo steps (turn/plan/updated) kept up to date, file edits applied without asking (Auto-edit), token usage and rate-limit updates',
    accessMode: 'autoEdit',
    prompt:
      'First use your plan tool to write a three-step plan, and update it as you finish each step. ' +
      'Then, in orders/app/main.py, add a function named ping that returns the string "pong", ' +
      'and create a file NOTES.md that says "ping added". Do nothing else.',
    answers: [],
  },
  {
    name: 'command-approval',
    covers: 'a command the read-only sandbox does not allow, put to the client as an approval and allowed, then run',
    accessMode: 'propose',
    prompt:
      'Run exactly this command and tell me what it printed: node -e "require(\'fs\').writeFileSync(\'approved.txt\', \'yes\'); console.log(\'wrote approved.txt\')"',
    answers: ['allow'],
  },
  {
    name: 'file-approval-denied',
    covers: 'a file change the read-only sandbox does not allow, put to the client as an approval and denied, and the turn going on without it',
    accessMode: 'propose',
    prompt: 'Create a file named hello.txt containing the single word hello. Do nothing else.',
    answers: ['deny'],
  },
  {
    name: 'long-silent-tool',
    covers: 'a command that prints nothing for about 20 seconds before finishing (a long silent tool), in Auto-edit',
    accessMode: 'autoEdit',
    prompt:
      'Run exactly this command and wait for it to finish, then tell me what it printed: node -e "setTimeout(() => console.log(\'done waiting\'), 20000)"',
    answers: [],
  },
  {
    /* Recorded after the four above: with goals on (codex-cli 0.153.4's
       default), "use your plan tool" went to the goal tool
       (thread/goal/updated) and no todo list was sent. Goals off leaves the
       update_plan tool, whose list is turn/plan/updated. */
    name: 'todo-plan',
    covers: 'a todo list (turn/plan/updated) created and each step marked done while the agent reads files, in Ask (read-only)',
    accessMode: 'propose',
    prompt:
      'Use your update_plan tool to make a todo list of three steps for reviewing orders/app/main.py, ' +
      'then mark each step completed, one at a time, as you read the file. Do not change any file. ' +
      'End with one sentence on what the file does.',
    answers: [],
    codexConfig: ['features.goals=false'],
  },
];

const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};
const all = (name: string): string[] => argv.flatMap((a, i) => (a === name && argv[i + 1] ? [argv[i + 1]!] : []));

const out = opt('--out');
if (!out) {
  process.stderr.write('usage: record-codex --out <dir> [--only <name>] [--codex <bin> [--codex-arg <a>]...]\n');
  process.exit(2);
}
const only = opt('--only');
const command = opt('--codex') ?? 'codex';
const args = all('--codex-arg');
let version = 'unknown';
try {
  version = execFileSync(command, [...args, '--version'], { encoding: 'utf8', windowsHide: true, shell: process.platform === 'win32' && command === 'codex' }).trim().replace(/^codex-cli\s*/, '');
} catch {
  /* the fake has no --version */
}
fs.mkdirSync(out, { recursive: true });

for (const scenario of SCENARIOS.filter((s) => !only || s.name === only)) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `seq-record-${scenario.name}-`));
  fs.cpSync(SHOP, cwd, { recursive: true, filter: (p) => !/[\\/]\.sequence([\\/]|$)/.test(p) });
  const started = Date.now();
  try {
    const r = await recordCodexSession({ scenario, command, args, cwd, source: DEFAULT_SOURCE(version) });
    const file = path.join(out, `${scenario.name}.jsonl`);
    fs.writeFileSync(file, formatFixture(r.fixture));
    const methods = new Map<string, number>();
    for (const f of r.fixture.frames) {
      const m = String(f.msg.method ?? (f.dir === 'c2s' ? '(answer)' : '(response)'));
      methods.set(`${f.dir} ${m}`, (methods.get(`${f.dir} ${m}`) ?? 0) + 1);
    }
    console.log(JSON.stringify({ scenario: scenario.name, file, ms: Date.now() - started, stopReason: r.stopReason, frames: r.fixture.frames.length, methods: Object.fromEntries(methods), text: r.text.slice(0, 300), stderr: r.stderr.slice(-5) }, null, 2));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}
