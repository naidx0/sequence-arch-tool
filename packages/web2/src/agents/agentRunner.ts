/* ══════════════════════════════════════════════════════════════════════════
   RUNNING ONE AGENT RUN — loaded with the first run, not at boot
   packages/web2/src/agents/agentRunner.ts

   agentRuns.ts writes the run's first record and hands it here: find the
   agent, stream run-node, fold every event into the record, close the record
   however the stream ends. And answering an approval. Importing this module
   loads the fold (agentRunFold.ts), which registers itself with the store.
   ══════════════════════════════════════════════════════════════════════════ */

import { followUpPrompt, isAskAgain } from '@sequence/schema';
import { expandDrawingRefs } from '../chat/drawingRefs';
import { withVisualHint } from '../chat/visualHint';
import { acpPermissionModeFor } from '../chat/accessMode';
import { readAskLedgerMode } from '../settings/askLedgerPreference';
import type { SlashCommand } from '../chat/composerModel';
import './agentRunFold';
import type { AgentCaps, AgentRun, AgentRunStore, RunWriter, StartRunOptions } from './agentRuns';
import { askAgainFrom } from './askAgain';
import { createFrameQueue, type FrameClock } from '../state/frameQueue';
import { promptWithRefs } from '../askInPlace/untrustedRefs';
import { CHAT_TITLE_EVENT } from './savedRuns';
import { answerApproval, markSending, streamRunNode, type ApprovalAnswer, type Fetch, type RunNodeEvent } from './runNodeStream';

/** S6: an approval, an error and the turn's end are applied at once; the rest once per frame. */
export function urgentRunEvent(e: RunNodeEvent): boolean {
  return e.type === 'acp:permission' || e.type === 'acp:question' || e.type === 'acp:error' || e.type === 'acp:result' || e.type === 'acp:turn' || e.type === 'acp:status' || e.type === 'acp:waiting' || e.type === 'acp:transcript';
}

/** Test seam: the clock a run's frame queue uses (default: the browser's frames). */
let runFrameClock: FrameClock | undefined;
export function setRunFrameClock(clock: FrameClock | undefined): void {
  runFrameClock = clock;
}

/**
 * The first agent the server has registered. When it cannot say, `why` is the
 * reason (the server's answer or the network's), never a bare "none".
 */
export async function lookupAgent(f: Fetch, signal?: AbortSignal): Promise<{ id: string | null; why: string | null }> {
  try {
    const r = await f('/api/acp/agents', signal ? { signal } : undefined);
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: unknown };
      return { id: null, why: typeof body.error === 'string' && body.error ? body.error : `the server answered ${r.status}` };
    }
    const j = (await r.json()) as { agents?: { id: string }[] };
    return { id: j.agents?.[0]?.id ?? null, why: null };
  } catch (e) {
    return { id: null, why: e instanceof Error ? e.message : String(e) };
  }
}

/** The first agent the server has registered, or null when there is none. */
export async function firstAgent(f: Fetch, signal?: AbortSignal): Promise<string | null> {
  return (await lookupAgent(f, signal)).id;
}

export async function streamRun(w: RunWriter, run: AgentRun, o: StartRunOptions, f: Fetch): Promise<AgentRun> {
  const id = run.id;
  const ac = new AbortController();
  stops.set(id, { ac, onStop: () => w.store.apply(id, { type: 'acp:error', error: 'Stopped.', recovery: { kind: 'retry' } }) });
  const found = o.agentRef ? { id: o.agentRef, why: null } : await lookupAgent(f, ac.signal);
  const agentRef = found.id;
  /* A Stop during discovery marks the run at once, but its abort arrives through a lazy import that
     can land after the lookup (on Windows it does): the run's own flag is the one that holds. */
  if (ac.signal.aborted || w.find(id)?.stopped) { stops.delete(id); return w.find(id)!; }
  if (!agentRef) {
    /* Never silent: say why the lookup failed when it did, not only that there is none. */
    w.store.apply(id, {
      type: 'acp:error',
      error: found.why ? `Couldn't ask the server which agents are registered: ${found.why}` : 'No local agent is registered. Add one with: sequence agent add <id> --command <bin>',
      recovery: { kind: 'retry' },
    });
    stops.delete(id);
    return w.find(id)!;
  }
  /* The same question, the same agent, the same chat: a Retry resumes the thread. */
  w.update(id, (r) => ({ ...r, agentRef, access: o.access, intent: o.intent ?? 'build', retry: { ...o, agentRef, question: r.prompt, sessionId: r.sessionId } }));
  /* S2b: from now on this chat talks to this agent (its composer sends here). */
  const sid = run.sessionId;
  if (sid && w.store.get().agents?.[sid] !== agentRef) w.store.patch((s) => ({ ...s, agents: { ...s.agents, [sid]: agentRef } }));
  const config = w.store.get().config?.[agentRef];
  /* Never silent: if this agent's models and commands could not be loaded, the chat says so as it sends. */
  const capsWhy = w.store.get().capsError?.[agentRef];
  /* Once per chat: the first send says it; later sends in the same chat do not repeat it. */
  const capsSaid = (w.store.get().runs ?? []).some((r) => r.sessionId === run.sessionId && r.id !== id && r.items.some((i) => i.kind === 'note' && i.text.startsWith("Couldn't load this agent's models")));
  if (capsWhy && !capsSaid) {
    const text = `Couldn't load this agent's models and commands (${capsWhy}). Sending with its defaults.`;
    w.update(id, (r) => ({ ...r, items: [...r.items, { kind: 'note', id: `note${r.items.length}`, text }] }));
  }
  /* Stop drops the stream; the server cancels the turn when its client goes. */
  /* S6: a frame's worth of events is folded and told to the page once. */
  /* The ask ledger (t3gap/asks): asked for on this run, so its closing line is read and cut. */
  const ledgerOn = !o.compact && readAskLedgerMode() !== 'off';
  if (ledgerOn) w.update(id, (r) => ({ ...r, askLedgerOn: true }));
  /* Auto: the requests the closing line left open are asked again, once, as
     soon as the run is done with a report. Not at the end of the stream:
     Claude's bridge holds the stream open after answering, and it is only
     closed when the next message arrives. A follow-up is never followed up. */
  let autoAsked = false;
  const autoAskAgain = (): void => {
    if (autoAsked || !ledgerOn) return;
    const r = w.find(id);
    if (!r || r.status !== 'done' || !r.askLedger?.open.length || readAskLedgerMode() !== 'auto' || isAskAgain(r.prompt)) return;
    autoAsked = true;
    queueMicrotask(() => void askAgainFrom(w.store, r, followUpPrompt(r.askLedger!.closures.filter((c) => !c.done)), f));
  };
  const frames = createFrameQueue<RunNodeEvent>((events) => {
    w.store.batch(() => events.forEach((e) => w.store.apply(id, e)));
    autoAskAgain();
  }, runFrameClock);
  try {
    /* The agent's copy may carry private context (the kit's hint, attached drawings); the chat saves only what was typed. */
    const agentPrompt = o.compact ? '' : await withVisualHint(run.prompt, await expandDrawingRefs(run.prompt));
    const out = await streamRunNode(
      {
        agentRef,
        prompt: o.compact ? '' : promptWithRefs(agentPrompt, run.refs ?? []),
        ...(agentPrompt !== run.prompt || run.refs?.length ? { display: run.prompt } : {}),
        ...(o.compact ? { compact: true } : {}),
        ...(o.attachments?.length ? { attachments: o.attachments } : {}),
        ...(config && (config.model || config.effort) ? { config } : {}),
        ...(o.nodeId ? { contextNodeId: o.nodeId } : {}),
        permissionMode: acpPermissionModeFor(o.intent ?? 'build', o.access ?? 'ask'),
        sessionKey: o.nodeId ? `ask-node::${o.nodeId}::${agentRef}` : `chat::${run.sessionId ?? 'none'}::${agentRef}`,
        /* The chat thread: its Always rules (and, S1, its agent's thread) live on it. */
        ...(run.sessionId ? { chatId: run.sessionId } : {}),
        /* The ask ledger: the server adds a short private instruction; the agent names its requests on one closing line. */
        ...(ledgerOn ? { askLedger: true } : {}),
      },
      {
        onEvent: (e) => {
          /* Round 9: the server named the chat from this exchange; the shell's rail and header take it. */
          if (e.type === 'acp:title' && run.sessionId) {
            const noteTitle = (why: string): void => w.update(id, (r) => addNoteOnce(r, `Couldn't name this chat (${why}).`));
            if (typeof e.error === 'string' && e.error) noteTitle(e.error);
            else if (typeof e.title === 'string') announceChatTitle(run.sessionId, e.title, (err) => noteTitle(err instanceof Error ? err.message : String(err)));
          }
          frames.push(e, urgentRunEvent(e));
        },
        signal: ac.signal,
      },
      f,
    );
    frames.flush();
    /* A stream that ends without a result or an error still ends the run. */
    const now = w.find(id);
    if (now && now.status === 'running') {
      w.store.apply(id, out.ok ? { type: 'acp:result', text: out.text } : { type: 'acp:error', error: out.text || 'The agent stream ended without a result.', recovery: { kind: 'retry', cause: 'unknown' } });
    }
    autoAskAgain();
  } catch (err) {
    frames.flush();
    if (ac.signal.aborted) {
      /* An answered run that was only ended to free the chat stays as it was answered. */
      if (!w.find(id)?.answered) w.store.apply(id, { type: 'acp:error', error: 'Stopped.', recovery: { kind: 'retry' } });
    }
    else w.store.apply(id, { type: 'acp:error', error: err instanceof Error ? err.message : String(err), recovery: { kind: 'retry', cause: /fetch|network|load failed/i.test(String(err)) ? 'localServer' : 'unknown' } });
  } finally {
    frames.flush();
    frames.dispose();
    stops.delete(id);
  }
  return w.find(id)!;
}

export function announceChatTitle(sessionId: string, title: string, onError?: (e: unknown) => void): void {
  try {
    window.dispatchEvent(new CustomEvent(CHAT_TITLE_EVENT, { detail: { sessionId, title } }));
  } catch (e) {
    /* no DOM (a test without one): nothing to rename. Say so on the chat, and in the console. */
    console.warn('chat title not announced', e);
    onError?.(e);
  }
}

/** One quiet line in the run, once. */
function addNoteOnce(r: AgentRun, text: string): AgentRun {
  return r.items.some((i) => i.kind === 'note' && i.text === text) ? r : { ...r, items: [...r.items, { kind: 'note', id: `note${r.items.length}`, text }] };
}

/** The running runs, by id, and how to stop each. */
const stops = new Map<string, { ac: AbortController; onStop: () => void }>();

export function stopRun(runId: string, f: (u: string, i?: RequestInit) => Promise<Response> = (u, i) => fetch(u, i)): void {
  const stop = stops.get(runId);
  if (stop) { stop.onStop(); stop.ac.abort(); return; }
  /* A turn this page did not start (the page was reloaded mid-turn): there is no stream to drop, so ask the server. */
  void f('/api/acp/stop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ turnId: runId.replace(/^saved-/, '') }) }).catch((err) => console.warn('stop failed', err));
}

/**
 * The `/` rows for an agent: its own slash commands (`/review`) and codex's
 * skills (`$release-notes`), sent to the agent as typed. Shelved under
 * "Claude / Codex" (composerModel.ts slashGroupOf).
 */
export function agentSlash(caps: Pick<AgentCaps, 'commands' | 'skills'>): SlashCommand[] {
  const row = (prefix: string, name: string, hint: string): SlashCommand => ({ name, label: `${prefix}${name}`, hint, icon: 'agent', source: { kind: 'agent', text: `${prefix}${name}` } });
  return [...caps.commands.map((c) => row('/', c.name, c.description)), ...caps.skills.map((k) => row('$', k.name, k.description))];
}

/** Agents whose capabilities are being asked for right now (one request each at a time). */
const asked = new Set<string>();

/**
 * S2b: what `agentRef` offers the picker and the `/` menu, asked of the
 * server once per agent per page (GET /api/acp/capabilities).
 *
 * Round 7 (A1): a failure is remembered (`capsError`) and NOT asked again by
 * the next mount or menu open, each of which used to start the agent again.
 * The model menu shows the reason with a Retry, which asks with refresh.
 */
export async function loadCapabilities(store: AgentRunStore, agentRef: string, f: Fetch, refresh = false): Promise<void> {
  if (!refresh && (asked.has(agentRef) || store.get().caps?.[agentRef] || store.get().capsError?.[agentRef])) return;
  asked.add(agentRef);
  try {
    const r = await f(`/api/acp/capabilities?agentRef=${encodeURIComponent(agentRef)}${refresh ? '&refresh=1' : ''}`);
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: unknown };
      throw new Error(typeof body.error === 'string' && body.error ? body.error : `the server answered ${r.status}`);
    }
    const j = (await r.json()) as Partial<AgentCaps>;
    const base: AgentCaps = {
      models: Array.isArray(j.models) ? j.models : [],
      efforts: Array.isArray(j.efforts) ? j.efforts : [],
      commands: Array.isArray(j.commands) ? j.commands : [],
      skills: Array.isArray(j.skills) ? j.skills : [],
    };
    const caps: AgentCaps = { ...base, slash: agentSlash(base) };
    store.patch((s) => {
      const capsError = { ...s.capsError };
      delete capsError[agentRef];
      return { ...s, caps: { ...s.caps, [agentRef]: caps }, capsError };
    });
  } catch (e) {
    const why = e instanceof SyntaxError ? 'the server sent an unreadable answer' : e instanceof Error ? e.message : String(e);
    store.patch((s) => ({ ...s, capsError: { ...s.capsError, [agentRef]: why } }));
  } finally {
    asked.delete(agentRef);
  }
}

export async function sendAnswer(w: RunWriter, runId: string, requestId: string, decision: ApprovalAnswer, f: Fetch): Promise<void> {
  /* Shown as being answered at once, on both the card and the toast. */
  w.update(runId, (r) => {
    const approvals = markSending(r.approvals, requestId, decision);
    /* Answering is the person's move, not the agent's silence: the quiet clock restarts. */
    return approvals.some((a, i) => a !== r.approvals[i]) ? { ...r, approvals, lastEventAt: Date.now(), stalled: null, waiting: null } : r;
  });
  const ok = await answerApproval(requestId, decision, f);
  /* Refused (the server no longer holds it): give the buttons back. The
     settling event, when it comes, folds it either way. */
  if (!ok) {
    w.update(runId, (r) => ({
      ...r,
      approvals: r.approvals.map((a) => (a.requestId === requestId && a.decision === null ? { ...a, sending: null } : a)),
    }));
  }
}
