#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   A `codex` THAT REPLAYS A RECORDING
   packages/acp/src/replay/bin/codex.ts   ->  dist/replay/bin/codex.js

   For code that spawns the agent itself (the analyzer's run-node): register
   this file as the agent, `node <dist>/replay/bin/codex.js --fixture <file>`.
   The file is named codex.js so `agentKindOf` treats it as the codex CLI and
   the server drives it through CodexAppServerClient, exactly as the real one.

     --fixture <file>   the recording to play (required)
     --speed <n>        0 (default) plays gaps as zero, 1 at recorded speed
     --report <file>    on exit, write { divergences, cursor, total } here

   <CWD> in the recording becomes this process's working directory, which the
   server sets to the agent's cwd.
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import readline from 'node:readline';

import { CodexReplay } from '../codexReplay.js';
import { readFixture } from '../fixture.js';

const argv = process.argv.slice(2);
const opt = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};

const file = opt('--fixture');
if (!file) {
  process.stderr.write('replay codex: --fixture <file> is required\n');
  process.exit(2);
}
if (!argv.includes('app-server')) {
  /* The recording is an app-server session; anything else is not this. */
  process.stderr.write("error: unrecognized subcommand (this replay only speaks 'app-server')\n");
  process.exit(2);
}

const replay = new CodexReplay(readFixture(file), {
  speed: Number(opt('--speed') ?? '0'),
  values: { '<CWD>': process.cwd() },
});
const report = opt('--report');
const writeReport = (): void => {
  if (!report) return;
  const s = replay.state;
  /* Written whole or not at all: a reader must never see half a report. */
  const tmp = `${report}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ divergences: s.divergences, cursor: s.cursor, total: s.total, finished: s.finished }, null, 2));
  fs.renameSync(tmp, report);
};
/* The report follows every frame: the server stops the agent as soon as the
   turn completes, which can be before the recording's last frames (late usage
   updates) have played, and a killed process on Windows runs no exit handler.
   Written BEFORE the frame goes out: on Windows a kill is immediate, and the
   server kills this process as soon as it reads turn/completed, so a report
   written after the write could lag the frame the server already acted on. */
replay.onSend = (line) => {
  writeReport();
  process.stdout.write(line + '\n');
};
replay.onFinished = writeReport;
readline.createInterface({ input: process.stdin }).on('line', (l) => {
  replay.receive(l);
  if (replay.divergences.length > 0) writeReport();
});
process.stdin.on('end', () => {
  writeReport();
  process.exit(0);
});
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    writeReport();
    process.exit(0);
  });
}
process.on('exit', writeReport);
replay.start();
