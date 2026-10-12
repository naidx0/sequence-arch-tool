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
import { chatPick } from './chatConfig';
import { createFrameQueue, type FrameClock } from '../state/frameQueue';
import { promptWithRefs } from '../askInPlace/untrustedRefs';
import { CHAT_TITLE_EVENT, loadSavedRuns } from './savedRuns';
import { answerApproval, markSending, parseSse, streamRunNode, type ApprovalAnswer, type Fetch, type RunNodeEvent } from './runNodeStream';

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
  /* A Stop that comes after the turn was sent but before the server named it waits for the name (see stopRun). */
  let sent = false;
  /* Anything heard on the stream: the server names the turn first, so a stream that spoke without a name never names it. */
  let heard = false;
  /* The server's id for the turn, as soon as it is heard (the store has it only from the next frame). */
  let named: string | undefined;
  let onTurnId: ((turnId: string) => void) | null = null;
  /* Set once an early Stop has been served: the rest of that chunk must not add to the stopped run. */
  let stoppedEarly = false;
  let giveUp: ReturnType<typeof setTimeout> | undefined;
  stops.set(id, {
    ac,
    onStop: () => w.store.apply(id, { type: 'acp:error', error: 'Stopped.', recovery: { kind: 'retry' } }),
    turnId: () => named ?? w.find(id)?.turnId,
    awaitTurnId: (then) => {
      if (!sent || heard) return false;
      onTurnId = then;
      /* A server that never names the turn: drop the stream anyway (its grace ends the turn). */
      giveUp = setTimeout(() => ac.abort(), stopWait.ms);
      return true;
    },
  });
  const found = o.agentRef ? { id: o.agentRef, why: null } : await lookupAgent(f, ac.signal);
  const agentRef = found.id;
  /* A Stop during discovery marks the run at once, but its abort arrives through a lazy import that
     can land after the lookup (on Windows it does): the run's own flag is the one that holds. */
  if (ac.signal.aborted || w.find(id)?.stopped) { stops.delete(id); return w.find(id)!; }
  if (!agentRef) {
    /* Never silent: say why the lookup failed when it did, not only that there is none. */
    w.store.apply(id, {
      type: 'acp:error',
      error: found.why ? `Couldn't ask the server which agents are registered: ${found.why}` : NO_AGENT_TEXT,
      recovery: found.why ? { kind: 'retry' } : { kind: 'retry', cause: 'notInstalled' },
    });
    stops.delete(id);
    return w.find(id)!;
  }
  /* The same question, the same agent, the same chat: a Retry resumes the thread. */
  w.update(id, (r) => ({ ...r, agentRef, access: o.access, intent: o.intent ?? 'build', retry: { ...o, agentRef, question: r.prompt, sessionId: r.sessionId } }));
  /* S2b: from now on this chat talks to this agent (its composer sends here). */
  const sid = run.sessionId;
  if (sid && w.store.get().agents?.[sid] !== agentRef) w.store.patch((s) => ({ ...s, agents: { ...s.agents, [sid]: agentRef } }));
  /* This chat's pick, never another chat's; a model the agent stopped offering is not sent. */
  const config = sid ? chatPick(w.store.get(), agentRef, sid) : w.store.get().config?.[agentRef];
  /* Never silent: if this agent's models and commands could not be loaded, the chat says so as it sends. */
  const capsWhy = w.store.get().capsError?.[agentRef];
  /* Once per chat: the first send says it; later sends in the same chat do not repeat it. */
  const capsSaid = (w.store.get().runs ?? []).some((r) => r.sessionId === run.sessionId && r.id !== id && r.items.some((i) => i.kind === 'note' && i.text.startsWith("Couldn't load this agent's models")));
  if (capsWhy && !capsSaid) {
    const text = `Couldn't load this agent's models and commands (${capsWhy}). Sending with its defaults.`;
    w.update(id, (r) => ({ ...r, items: [...r.items, { kind: 'note', id: `note${r.items.length}`, text }] }));
  }
  /* Stop asks the server to stop the turn by its id (stopRun); dropping the stream alone does not (a reload must not stop it). */
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
    sent = true;
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
          if (stoppedEarly) return;
          /* Stop was pressed before the server named the turn: now it has, stop it there, then drop the stream. */
          if (onTurnId) {
            const then = onTurnId;
            onTurnId = null;
            stoppedEarly = true;
            if (e.type === 'acp:turn-id' && typeof e.turnId === 'string' && e.turnId) then(e.turnId);
            /* The server names a turn before anything else; one that spoke first never will: drop the stream. */
            else ac.abort();
            return;
          }
          heard = true;
          if (e.type === 'acp:turn-id' && typeof e.turnId === 'string' && e.turnId) named = e.turnId;
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
    clearTimeout(giveUp);
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

/**
 * The running runs, by id, and how to stop each (`turnId`: the server's id for the turn, once it said).
 * `awaitTurnId`: the turn was sent but not yet named; true when the run will call `then` with the name as it lands.
 */
const stops = new Map<string, { ac: AbortController; onStop: () => void; turnId?: () => string | undefined; awaitTurnId?: (then: (turnId: string) => void) => boolean }>();

/** How long a Stop pressed before the server named the turn keeps the stream open for the name. An object so a test can shorten it. */
/** The failure when no agent is connected yet: plain words, no CLI. The card under the run offers the way out (RecoveryCard, kind setup). */
export const NO_AGENT_TEXT = 'No agent is connected yet. Connect one in Settings > Agents, or set it up in chat.';

export const stopWait = { ms: 10_000 };

export function stopRun(runId: string, f: (u: string, i?: RequestInit) => Promise<Response> = (u, i) => fetch(u, i)): void {
  const stop = stops.get(runId);
  /* A chat turn outlives its stream (a reload must not stop it), so dropping the stream is not a Stop: the server is asked by the turn's id. */
  const turnId = stop ? stop.turnId?.() : runId.replace(/^saved-/, '');
  const ask = (t: string): void => void f('/api/acp/stop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ turnId: t }) }).catch((err) => console.warn('stop failed', err));
  if (stop) {
    stop.onStop();
    /* Sent but not yet named: dropping the stream now would leave the server running the turn for its grace while
       the page says Stopped. Keep listening for the name, ask the server to stop it, then drop the stream. */
    if (!turnId && stop.awaitTurnId?.((t) => {
      ask(t);
      stop.ac.abort();
    })) return;
    stop.ac.abort();
  }
  if (turnId) ask(turnId);
}

/** Turns this page follows (GET /api/acp/attach), so two callers never follow one twice. */
const following = new Set<string>();

/**
 * Follow a chat turn the server is running that this page did not start (it was
 * reloaded mid-turn, or opened another workspace): what the turn streamed so far,
 * then the rest live, folded into `runId` as if this page had started it. A turn
 * that already ended (404) takes its saved record.
 */
export async function followTurn(w: RunWriter, runId: string, turnId: string, f: Fetch): Promise<void> {
  if (following.has(turnId)) return;
  following.add(turnId);
  const ac = new AbortController();
  stops.set(runId, { ac, onStop: () => w.store.apply(runId, { type: 'acp:error', error: 'Stopped.', recovery: { kind: 'retry' } }), turnId: () => turnId });
  const frames = createFrameQueue<RunNodeEvent>((events) => w.store.batch(() => events.forEach((e) => w.store.apply(runId, e))), runFrameClock);
  /* The server no longer had the start of this turn: said on the run, and the saved record replaces the tail at the end. */
  let trimmed = false;
  try {
    const r = await f(`/api/acp/attach?turnId=${encodeURIComponent(turnId)}`, { headers: { accept: 'text/event-stream' }, signal: ac.signal });
    if (r.ok && r.body) {
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const { events, rest } = parseSse(buf);
        buf = rest;
        for (const e of events) {
          if (e.type === 'acp:replay-truncated') {
            trimmed = true;
            w.update(runId, (x) => addNoteOnce(x, 'The start of this turn is not shown while it runs (it was too long to keep). The whole of it is shown when it ends.'));
            continue;
          }
          if (e.type === 'acp:title' && typeof e.title === 'string') {
            const sid = w.find(runId)?.sessionId;
            if (sid) announceChatTitle(sid, e.title);
          }
          frames.push(e, urgentRunEvent(e));
        }
      }
      frames.flush();
    }
    /* Ended before or while we followed without a result on the stream: the saved record has the end. */
    const now = w.find(runId);
    if (now && now.status === 'running' && !ac.signal.aborted) {
      const sid = now.sessionId;
      const saved = sid ? ((await loadSavedRuns(sid, f)) ?? []).find((s) => s.turnId === turnId) : undefined;
      if (saved && saved.status !== 'running') w.update(runId, () => ({ ...saved, id: runId, restored: false }));
      /* Not followable (an older server, or the stream broke): back to the saved record, which the chat's poll watches to its end. */
      else w.update(runId, (x) => ({ ...(saved ?? x), id: runId, restored: true }));
    } else if (trimmed && now && now.status !== 'running' && !ac.signal.aborted) {
      /* Followed to its end with the start missing: the saved record has all of it. */
      const sid = now.sessionId;
      const saved = sid ? ((await loadSavedRuns(sid, f)) ?? []).find((s) => s.turnId === turnId) : undefined;
      if (saved && saved.status !== 'running') w.update(runId, () => ({ ...saved, id: runId, restored: false }));
    }
  } catch (err) {
    frames.flush();
    if (!ac.signal.aborted) console.warn('following the turn failed', err);
  } finally {
    frames.flush();
    frames.dispose();
    stops.delete(runId);
    following.delete(turnId);
  }
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
/**
 * 0.1.5 G1: how long the page waits for an agent to say what it offers. An agent
 * that never answers was a menu reading "Reading its models…" for ever, with no
 * Retry; past this it is a failure like any other, said once, with Retry.
 * An object so a test can shorten it.
 */
export const capsTimeout = { ms: 45_000 };

export async function loadCapabilities(store: AgentRunStore, agentRef: string, f: Fetch, refresh = false): Promise<void> {
  if (!refresh && (asked.has(agentRef) || store.get().caps?.[agentRef] || store.get().capsError?.[agentRef])) return;
  asked.add(agentRef);
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      /* The reason first, and the abort carries it: aborting first let the fetch's own rejection
         ("signal is aborted without reason") win the race and be what the menu said. */
      const why = new Error(`it did not answer within ${Math.round(capsTimeout.ms / 1000)} s`);
      reject(why);
      ctl.abort(why);
    }, capsTimeout.ms);
  });
  late.catch(() => {});
  try {
    const r = await Promise.race([f(`/api/acp/capabilities?agentRef=${encodeURIComponent(agentRef)}${refresh ? '&refresh=1' : ''}`, { signal: ctl.signal }), late]);
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
    clearTimeout(timer);
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
