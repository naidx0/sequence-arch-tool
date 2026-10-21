/* ══════════════════════════════════════════════════════════════════════════
   ONE MEMORY FOR ALL YOUR AGENTS
   packages/web2/src/settings/SharedMemorySection.tsx

   Settings › Agents. How you like to work, written once and shared into each
   agent's own instruction file (Claude Code's CLAUDE.md, Codex's AGENTS.md,
   Gemini's GEMINI.md, ...), so every agent reads it the way it reads its own
   memory, inside Sequence or not (analyzer agentMemory.ts).

   Start from what you have: "Gather from my agents" proposes the text you
   already wrote in their files, each paragraph once. Save keeps it in Sequence.
   Share writes it into the agents you tick, as one marked block; the rest of
   each file is yours and is never touched. Remove takes the block back out.
   Each agent's row says, in words, whether it has the current text.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';

import { agentMark } from './logos/agentMark';
import { BrandMark } from './logos/BrandMark';

export const SHARED_MEMORY_ROUTE = '/api/memory/shared';

export interface MemoryTargetState {
  id: string;
  agent: string;
  path: string;
  present: boolean;
  exists: boolean;
  bytes: number;
  shared: boolean;
  current: boolean;
  /** Shared before, and the block has since gone: something else rewrote the file. */
  lost?: true;
  /** Why Sequence will not change this file. */
  refused?: string;
  limitBytes?: number;
}

interface SharedView {
  text: string;
  targets: MemoryTargetState[];
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const pageFetch: Fetch = (i, init) => fetch(i, init);
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** One row's state, in words. */
export function targetWord(t: MemoryTargetState): string {
  if (!t.present) return 'Not set up here';
  if (t.refused) return "Can't change";
  if (t.current) return 'Up to date';
  if (t.shared) return 'Older text';
  if (t.lost) return 'Removed elsewhere';
  return 'Not shared';
}

/** `nested`: drawn inside the Agents pane's Instructions group, which carries the heading. */
export function SharedMemorySection({ fetchImpl = pageFetch, nested = false }: { fetchImpl?: Fetch; nested?: boolean }) {
  const [view, setView] = useState<SharedView | null>(null);
  const [draft, setDraft] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<'gather' | 'save' | 'share' | 'remove' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const live = useRef(true);

  const first = useRef(true);
  const adopt = (v: SharedView, keepDraft = false): void => {
    setView(v);
    if (!keepDraft) setDraft(v.text);
    /* On first load every agent that is set up here and can be changed is ticked; after that the
       person's own ticks stand (a Save never re-ticks an agent they unticked; round-four review). */
    if (first.current) {
      first.current = false;
      setPicked(new Set(v.targets.filter((t) => t.present && !t.refused).map((t) => t.id)));
    }
  };

  useEffect(() => {
    live.current = true;
    void fetchImpl(SHARED_MEMORY_ROUTE, { headers: { accept: 'application/json' } })
      .then(async (r) => (r.ok ? ((await r.json()) as SharedView) : null))
      .then((v) => {
        if (live.current && v && Array.isArray(v.targets)) adopt(v);
      })
      .catch(() => {
        /* No route (an older server, hosted mode): the section is not offered. */
      });
    return () => {
      live.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchImpl]);

  /* Nothing to share with until an agent that reads such a file is set up here: the section is not offered. */
  if (view === null || !view.targets.some((t) => t.present)) return null;

  const call = async <T,>(what: typeof busy, url: string, init: RequestInit): Promise<T | null> => {
    setBusy(what);
    setFailure(null);
    setNote(null);
    try {
      const r = await fetchImpl(url, init);
      const body = (await r.json().catch(() => ({}))) as T & { error?: string };
      if (!r.ok) {
        setFailure(body.error ?? `the server answered ${r.status}`);
        return null;
      }
      return body;
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'the server could not be reached');
      return null;
    } finally {
      if (live.current) setBusy(null);
    }
  };

  const gather = async (): Promise<void> => {
    const g = await call<{ text: string; sources: string[] }>('gather', '/api/memory/shared/gather', json('POST', {}));
    if (!g || !live.current) return;
    if (g.text.trim() === '') {
      setNote('None of your agents has its own instructions yet. Write yours here.');
      return;
    }
    setDraft(g.text);
    setNote(`Gathered from ${g.sources.join(', ')}. Read it, trim it, then Save.`);
  };

  const save = async (): Promise<void> => {
    const v = await call<SharedView>('save', SHARED_MEMORY_ROUTE, json('PUT', { text: draft }));
    if (v && live.current) {
      adopt(v);
      setNote('Saved in Sequence. Share it to send it to your agents.');
    }
  };

  const share = async (remove: boolean): Promise<void> => {
    const r = await call<SharedView & { results: { id: string; ok: boolean; note: string }[] }>(remove ? 'remove' : 'share', '/api/memory/shared/sync', json('POST', { ids: [...picked], remove }));
    if (!r || !live.current) return;
    adopt(r, true);
    const bad = r.results.filter((x) => !x.ok);
    setNote(bad.length ? `Done, except: ${bad.map((x) => `${view.targets.find((t) => t.id === x.id)?.agent ?? x.id} (${x.note})`).join('; ')}.` : remove ? 'Removed from the agents you ticked; the rest of each file is as you left it.' : 'Shared. Each agent reads it the next time it starts.');
  };

  const unsaved = draft !== view.text;
  const present = view.targets.filter((t) => t.present);
  /* Every ticked agent already has this exact text: there is nothing left to share. */
  const allCurrent = picked.size > 0 && [...picked].every((id) => view.targets.find((t) => t.id === id)?.current === true);

  return (
    <section className={nested ? undefined : 'sb-group'} data-testid="shared-memory">
      {nested ? null : <h3 className="sb-lab">One memory for all your agents</h3>}
      <div className="sb-card">
        {nested ? <p className="sb-copy-lab">Your rules for every project</p> : null}
        <p className="sb-hint">
          How you like to work, written once. Sequence adds it to each agent's own instruction file as one block, so every agent reads it. Remove takes Sequence's block back out and leaves the rest of the file as you wrote it.
        </p>
        <textarea
          className="sb-input sb-instr-text"
          data-testid="shared-memory-text"
          aria-label="Shared memory"
          spellCheck={false}
          placeholder="Use pnpm, not npm. Prefer small diffs. Ask before deleting files."
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="sb-acts">
          <button type="button" className="sb-pill" data-testid="shared-memory-gather" disabled={busy !== null} onClick={() => void gather()}>
            {busy === 'gather' ? 'Gathering…' : 'Gather from my agents'}
          </button>
          <button type="button" className="sb-pill" data-testid="shared-memory-save" disabled={busy !== null || !unsaved} onClick={() => void save()}>
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
        </div>
        {(
          <ul className="sb-list" data-testid="shared-memory-targets">
            {view.targets
              .filter((t) => t.present)
              .map((t) => (
                <li key={t.id} className="sb-row sb-shared-row" data-testid="shared-memory-target" data-agent={t.id}>
                  <span className="sb-shared-pick">
                    <BrandMark id={t.id} mark={agentMark(t.id)} name={t.agent} />
                    <span className="sb-row-txt">
                      <span className="sb-row-t">{t.agent}</span>
                      <span className="sb-row-sub">{t.refused ? `${t.path}: ${t.refused}` : t.lost ? `${t.path}: the block was taken out by something else (a tool that rewrites this file?). Share again to put it back.` : t.path}</span>
                    </span>
                  </span>
                  <span className="sb-badge" data-state={t.current ? 'connected' : t.shared ? 'limited' : 'ready'} data-testid="shared-memory-state">
                    {targetWord(t)}
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    className="sb-switch"
                    data-testid="shared-memory-pick"
                    aria-label={`Share with ${t.agent}`}
                    checked={picked.has(t.id)}
                    disabled={t.refused !== undefined}
                    onChange={(e) =>
                      setPicked((p) => {
                        const n = new Set(p);
                        if (e.target.checked) n.add(t.id);
                        else n.delete(t.id);
                        return n;
                      })
                    }
                  />
                </li>
              ))}
          </ul>
        )}
        {present.length > 0 ? (
          <div className="sb-acts">
            <button
              type="button"
              className="sb-pill sb-pill-solid"
              data-testid="shared-memory-share"
              disabled={busy !== null || picked.size === 0 || unsaved || view.text.trim() === '' || allCurrent}
              title={unsaved ? 'Save first' : undefined}
              onClick={() => void share(false)}
            >
              {busy === 'share' ? 'Sharing…' : allCurrent ? 'Shared' : `Share with ${picked.size} agent${picked.size === 1 ? '' : 's'}`}
            </button>
            <button type="button" className="sb-pill" data-testid="shared-memory-remove" disabled={busy !== null || picked.size === 0 || !view.targets.some((t) => picked.has(t.id) && t.shared)} onClick={() => void share(true)}>
              {busy === 'remove' ? 'Removing…' : 'Remove'}
            </button>
          </div>
        ) : null}
        {note ? (
          <p className="sb-note" role="status" data-testid="shared-memory-note">
            {note}
          </p>
        ) : null}
        {failure ? (
          <p className="sb-fail" role="alert" data-testid="shared-memory-failure">
            {failure}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export default SharedMemorySection;
