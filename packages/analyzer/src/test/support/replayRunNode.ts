/* ══════════════════════════════════════════════════════════════════════════
   A RECORDED AGENT SESSION, THROUGH THE REAL SERVER'S run-node STREAM
   packages/analyzer/src/test/support/replayRunNode.ts

   Test support for S0 (the replay harness). Registers the replaying codex
   (@sequence/acp dist/replay/bin/codex.js, a real process playing a fixture)
   as the only agent in a temp user store, starts the real repo server, runs
   one streamed, interactive run-node turn, answers each approval the way the
   recording did, and returns every SSE event the server sent plus the
   replay's own report (divergences, frames played).

   Nothing here is a model: the frames are the recording's. Waits are on the
   stream ending, never on time.
   ══════════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readFixture, substitute, type Fixture } from '@sequence/acp/dist/replay/fixture.js';

import { addAgent } from '../../server/agentsStore.js';
import { createRepoServer } from '../../server/repoServer.js';

type Json = Record<string, unknown>;

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, '..', '..', '..', '..', '..');
export const REPLAY_FIXTURES = path.join(REPO_ROOT, 'packages', 'acp', 'src', 'test', 'fixtures', 'replay');
const REPLAY_CODEX = path.join(REPO_ROOT, 'packages', 'acp', 'dist', 'replay', 'bin', 'codex.js');

/** The access mode a fixture ran in, as run-node's `permissionMode`. */
const WIRE_MODE: Record<string, string> = { propose: 'propose', autoEdit: 'autoEdit', plan: 'plan', full: 'full' };

export interface ReplayedRun {
  fixture: Fixture;
  events: Json[];
  report: { divergences: string[]; cursor: number; total: number; finished: boolean } | null;
  /** The directory the agent ran in (gone by the time this returns). */
  work: string;
  /** The approvals answered, in order, with the server's request ids. */
  answered: { requestId: string; decision: string; status: number }[];
}

async function rmEventually(dir: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'ENOTEMPTY') throw e;
      /* A child still holds the directory: let the event loop run its exit. */
      await new Promise((r) => setImmediate(r));
    }
  }
}

export async function replayRunNode(fixtureFile: string): Promise<ReplayedRun> {
  const fixture = readFixture(fixtureFile);
  const store = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-replay-store-')));
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'seq-replay-work-')));
  const reportFile = path.join(store, 'replay-report.json');
  addAgent(store, { id: 'codex', command: process.execPath, args: [REPLAY_CODEX, '--fixture', fixtureFile, '--report', reportFile], cwd: work });
  const server = await createRepoServer(null, { webDist: undefined, userConfigDir: store });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  const answers = [...(fixture.header.answers ?? [])];
  const answered: ReplayedRun['answered'] = [];
  const events: Json[] = [];
  try {
    const res = await fetch(`${base}/api/acp/run-node?stream=1`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({
        agentRef: 'codex',
        prompt: fixture.header.prompt ?? 'replay',
        permissionMode: WIRE_MODE[fixture.header.accessMode ?? 'propose'] ?? 'propose',
        interactivePermissions: true,
        /* One chat thread per replay, as the page sends it (Always rules are per thread). */
        chatId: 'replay-chat',
      }),
    });
    if (res.status !== 200) throw new Error(`run-node answered ${res.status}: ${await res.text()}`);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let cut: number;
      while ((cut = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, cut);
        buf = buf.slice(cut + 2);
        for (const line of block.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const e = JSON.parse(line.slice(6)) as Json;
          events.push(e);
          if (e.type === 'acp:permission' && e.pending === true) {
            const decision = answers.shift() ?? 'deny';
            const r = await fetch(`${base}/api/acp/permission`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ requestId: e.requestId, decision }),
            });
            answered.push({ requestId: String(e.requestId), decision, status: r.status });
          }
        }
      }
    }
  } finally {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      (server as http.Server & { closeAllConnections?: () => void }).closeAllConnections?.();
    });
  }
  const report = fs.existsSync(reportFile) ? (JSON.parse(fs.readFileSync(reportFile, 'utf8')) as ReplayedRun['report']) : null;
  await rmEventually(store);
  await rmEventually(work);
  return { fixture, events, report, answered, work };
}

/**
 * The events in a form that is the same on every run and every machine: the
 * server's random request ids become <REQ-n>, the working directory <CWD>.
 * This is what web2's replay tests read (fixtures/replay/sse).
 */
export function normalizeEvents(events: Json[], work?: string): Json[] {
  const ids = new Map<string, string>();
  let requestSeq = 0;
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (ids.has(v)) return ids.get(v);
      return v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Json).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  for (const e of events) {
    if (e.type === 'acp:transcript' && typeof e.turnId === 'string') ids.set(e.turnId, '<TRANSCRIPT>');
    /* The server's random id for the turn (what Edit from here cuts by): its presence and place are recorded, its value is not. */
    if (e.type === 'acp:turn-id' && typeof e.turnId === 'string') ids.set(e.turnId, '<TURN>');
    if (typeof e.requestId === 'string' && !ids.has(e.requestId)) ids.set(e.requestId, `<REQ-${++requestSeq}>`);
    const proposal = e.proposal as Json | undefined;
    if (proposal && typeof proposal.proposalId === 'string' && !ids.has(proposal.proposalId)) ids.set(proposal.proposalId, `<REQ-${requestSeq}>`);
  }
  /* Round 9: the live status and the turn log are timing diagnostics (acp:status every few
     seconds, acp:log with durations), and acp:title is the chat index being named; a golden
     keeps what the turn did, not when, nor what the rail calls it. */
  const named = events.filter((e) => e.type !== 'acp:status' && e.type !== 'acp:log' && e.type !== 'acp:title').map((e) => walk(e) as Json);
  /* Every spelling of the work dir (/, \, doubled), as fixture.ts substitute matches them. */
  return work ? substitute(named, [[work, '<CWD>']]) : named;
}
