/* ══════════════════════════════════════════════════════════════════════════
   RECORD AN AGENT SESSION AS A REPLAY FIXTURE
   packages/acp/src/replay/record.ts

   `recordingSpawn` wraps a real spawn: the agent process runs as usual, and
   every JSON-RPC line on its stdin and stdout is kept with the time it
   crossed. `recordCodexSession` drives one CodexAppServerClient turn through
   it and returns the fixture, with machine-specific strings replaced by
   placeholders (fixture.ts `substitute`) so the file can be committed.

   Used once per scenario, by bin/record-codex.js, against the real codex.
   ══════════════════════════════════════════════════════════════════════════ */

import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

import { CodexAppServerClient } from '../codexAppServer.js';
import type { AgentMode } from '../planMode.js';
import { substitute, substituteDeltas, type Fixture, type FixtureHeader, type Frame, type Json } from './fixture.js';

export interface Recording {
  frames: Frame[];
  stderr: string[];
}

/** A spawn that runs the real process and records its JSON-RPC lines. */
export function recordingSpawn(rec: Recording, realSpawn: typeof childProcess.spawn = childProcess.spawn): typeof childProcess.spawn {
  const t0 = Date.now();
  const take = (dir: Frame['dir'], text: string, buf: { s: string }): void => {
    buf.s += text;
    let cut: number;
    while ((cut = buf.s.indexOf('\n')) !== -1) {
      const line = buf.s.slice(0, cut).trim();
      buf.s = buf.s.slice(cut + 1);
      if (!line) continue;
      try {
        rec.frames.push({ t: Date.now() - t0, dir, msg: JSON.parse(line) as Json });
      } catch {
        rec.stderr.push(`[non-JSON ${dir}] ${line.slice(0, 200)}`);
      }
    }
  };
  return ((command: string, args: readonly string[], options: childProcess.SpawnOptions) => {
    const child = realSpawn(command, args as string[], options);
    const inBuf = { s: '' };
    const outBuf = { s: '' };
    /* Tapped at `_write`, under every way of writing: `write()` and a web
       stream over the Writable (the ACP SDK's `ndJsonStream`) both end there. */
    const stdin = child.stdin! as unknown as {
      _write: (chunk: unknown, enc: BufferEncoding, cb: (e?: Error | null) => void) => void;
      _writev?: unknown;
    };
    const inner = stdin._write.bind(stdin);
    stdin._writev = undefined;
    stdin._write = (chunk, enc, cb) => {
      take('c2s', Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk), inBuf);
      inner(chunk, enc, cb);
    };
    child.stdout?.on('data', (b: Buffer) => take('s2c', String(b), outBuf));
    child.stderr?.on('data', (b: Buffer) => rec.stderr.push(...String(b).split(/\r?\n/).filter(Boolean)));
    return child;
  }) as unknown as typeof childProcess.spawn;
}

export interface Scenario {
  name: string;
  covers: string;
  accessMode: AgentMode;
  prompt: string;
  /** How to answer each approval, in order; past the end, deny. */
  answers: ('allow' | 'deny')[];
  /** Extra `-c key=value` overrides for codex, recorded in the header. */
  codexConfig?: string[];
}

/** The strings a fixture must not carry, and what replaces them. */
export function machinePairs(cwd: string): [string, string][] {
  const home = os.homedir();
  const user = os.userInfo().username;
  const pairs: [string, string][] = [
    [cwd, '<CWD>'],
    [fsReal(cwd), '<CWD>'],
    /* Longest first: the temp dir sits inside the home dir. */
    [os.tmpdir(), '<TMP>'],
    [home, '<HOME>'],
  ];
  if (user && user.length >= 3) pairs.push([user, '<USER>']);
  const host = os.hostname();
  if (host && host.length >= 3) pairs.push([host, '<HOST>']);
  return pairs;
}

function fsReal(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return p;
  }
}

export async function recordCodexSession(opts: {
  scenario: Scenario;
  command: string;
  args?: string[];
  cwd: string;
  source: string;
  timeoutMs?: number;
}): Promise<{ fixture: Fixture; stderr: string[]; text: string; stopReason: string }> {
  const rec: Recording = { frames: [], stderr: [] };
  const answers = [...opts.scenario.answers];
  const client = new CodexAppServerClient({
    command: opts.command,
    args: [...(opts.args ?? []), ...(opts.scenario.codexConfig ?? []).flatMap((c) => ['-c', c])],
    cwd: opts.cwd,
    accessMode: opts.scenario.accessMode,
    spawn: recordingSpawn(rec),
    onPermission: async () => answers.shift() ?? 'deny',
  });
  let text = '';
  let stopReason = 'error';
  try {
    await client.start();
    await client.newSession(opts.cwd);
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), opts.timeoutMs ?? 5 * 60_000);
    try {
      const r = await client.prompt(opts.scenario.prompt, { signal: timeout.signal });
      text = r.text;
      stopReason = r.stopReason;
    } finally {
      clearTimeout(timer);
    }
    /* Late notifications (usage, rate limits) arrive just after the turn. */
    await new Promise((r) => setTimeout(r, 1500));
  } finally {
    await client.dispose();
  }
  const pairs = machinePairs(opts.cwd);
  const header: FixtureHeader = {
    kind: 'header',
    provider: 'codex-app-server',
    scenario: opts.scenario.name,
    covers: opts.scenario.covers,
    live: true,
    source: opts.source,
    recordedAt: new Date().toISOString().slice(0, 10),
    accessMode: opts.scenario.accessMode,
    prompt: opts.scenario.prompt,
    answers: opts.scenario.answers,
    ...(opts.scenario.codexConfig?.length ? { codexConfig: opts.scenario.codexConfig } : {}),
    placeholders: {
      '<CWD>': 'the working directory the session ran in (a temp copy of the shopfront fixture)',
      '<HOME>': "the recording user's home directory",
      '<TMP>': 'the OS temp directory',
      '<USER>': "the recording user's name",
      '<HOST>': "the recording machine's name",
    },
  };
  /* Deltas first: a path the model wrote can be split across them. */
  const frames = redact(substitute(substituteDeltas(rec.frames, pairs), pairs));
  return { fixture: { header, frames }, stderr: substitute(rec.stderr, pairs), text: substitute(text, pairs), stopReason };
}

export const DEFAULT_SOURCE = (version: string) => `codex-cli ${version} (\`codex app-server\`), driven by @sequence/acp CodexAppServerClient`;

/** Keys whose values identify a machine or an account, whatever their text. */
export const REDACTED_KEYS = ['installationId', 'accountId', 'email', 'userId', 'orgId', 'organizationId'];

export function redact<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const o: Json = {};
      for (const [k, x] of Object.entries(v as Json)) o[k] = REDACTED_KEYS.includes(k) && x !== null ? '<REDACTED>' : walk(x);
      return o;
    }
    return v;
  };
  return walk(value) as T;
}
