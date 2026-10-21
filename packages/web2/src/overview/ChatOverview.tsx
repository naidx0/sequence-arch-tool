/* ══════════════════════════════════════════════════════════════════════════
   THE CHAT OVERVIEW
   packages/web2/src/overview/ChatOverview.tsx

   A small glass panel floating over the background at the right of the chat: what this chat is doing and holds.
   Progress (the plan, the step now, a live loop), Context (where, who, how full), Files, Artifacts and Quick open.
   Each section says one line about itself ("3 files, 2 edited", "1 card") and unfolds in place. Progress shows only
   while there is work to show; a list that is empty is not drawn (an empty chat gets one quiet line); Context and
   Quick open always stay.

   It reserves no room: it floats, sized by its content with an inner scroll, and overviewPlace.ts keeps it clear of
   the chat card. Beside a card too close, it folds to a pill; with a surface open the pill sits in the chat header. Only
   the room folds it (a chat that is alone has no collapse control). A pill the panel cannot fit beside opens it as a popover the reader asked for, closed by
   Escape, a click elsewhere or a choice made in it.

   It reads the store and draws overviewModel's answer; it owns no state of the chat. A file opens in Files, an
   artifact scrolls the transcript to its turn, a surface name opens that surface through the shell's own opener.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import { CHROME_TAB_DEFS, SHIPPED_SURFACES, type ChromeTabId } from '../app/chromeTabModel';
import { agentRuns } from '../agents/agentRuns';
import { chatContext } from '../agents/contextMeter';
import { ContextRing, contextPercent, formatContextWindowTokens, resolveContextRingUsed } from '../chat/ContextRing';
import { modelLabel } from '../chat/modelSelection';
import { listChatSurfaces, type SavedSurface } from '../genui/surfaceStore';
import { brandOf, ProviderIcon } from '../shell2/brandIcons';
import { S2Icon, type S2IconName } from '../shell2/icons';
import { composerPropsFrom } from '../state/connect';
import { groundedRepoName, useAppState, useStore } from '../state/connect';
import type { TodoItem } from '../state/types';
import { fleetSummary } from './overviewFleet';
import { buildOverview, type ArtifactKind, type FileState, type OverviewArtifact, type OverviewFile } from './overviewModel';
import { placeOverview, samePlacement, toBox, type OverviewPlacement } from './overviewPlace';
import { artifactsSummary, emptyLine, filesSummary, keyCount, listOpenByDefault, progressOpenByDefault, progressSummary, windowLine } from './overviewSummary';
import { scrollToTurn } from './scrollToTurn';
import { useChatAgentModel, useChatEffort } from './useChatEffort';
import { useLiveLoop } from './useLiveLoop';
import './overview.css';

const MARK: Record<TodoItem['status'] | 'failed', string> = { pending: '○', active: '◆', done: '✓', blocked: '!', failed: '✕' };
const STATE_WORD: Record<FileState, string> = { edited: 'Edited', proposed: 'Proposed', read: 'Read', mentioned: 'Mentioned', attached: 'Attached' };
const KIND_WORD: Record<ArtifactKind, string> = { chart: 'Chart', diagram: 'Diagram', board: 'Board', workflow: 'Loop', visual: 'Visual', genui: 'UI' };

/** The folder a file sits in, with its slash: "gateway/src/". Empty for a file at the root. */
function dirOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : path.slice(0, at + 1);
}

/** The surfaces the quick-open row names, in reading order. */
const QUICK: readonly { id: ChromeTabId; icon: S2IconName }[] = [
  { id: 'architecture', icon: 'board' },
  { id: 'files', icon: 'file' },
  { id: 'whiteboard', icon: 'pen' },
  { id: 'terminal', icon: 'term' },
  { id: 'agents', icon: 'cpu' },
];

function Section({ id, title, summary, defaultOpen, children }: { id: string; title: string; summary?: string; defaultOpen: boolean; children: ReactNode }) {
  /* The reader's own fold wins; until they press, the section opens or folds by its default. */
  const [manual, setManual] = useState<boolean | null>(null);
  const open = manual ?? defaultOpen;
  return (
    <section className="ov-sec" data-testid={`ov-sec-${id}`} data-open={open ? 'true' : 'false'}>
      <button type="button" className="s2-btn ov-sec-h" aria-expanded={open} aria-controls={`ov-body-${id}`} onClick={() => setManual(!open)}>
        <S2Icon name={open ? 'chev' : 'chevr'} small />
        <span className="ov-sec-t">{title}</span>
        {summary ? <span className="ov-sum" data-testid={`ov-sum-${id}`}>{summary}</span> : null}
      </button>
      {open ? (
        <div className="ov-sec-b" id={`ov-body-${id}`}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** What the shell hands the overview so it can place itself: the row it floats in, the chat card it keeps clear of, and the chat header's slot. */
export interface OverviewFloat {
  rowRef: RefObject<HTMLElement | null>;
  /** The main column the chat card is centred in. */
  mainRef: RefObject<HTMLElement | null>;
  chatRef: RefObject<HTMLElement | null>;
  /** No surface is open. */
  centred: boolean;
  /** The chat header's slot for the inline pill (a surface is open, or the margin is too thin). */
  headSlot: HTMLElement | null;
}

export function ChatOverview({ onOpenSurface, float }: { onOpenSurface: (id: ChromeTabId) => void; float?: OverviewFloat }) {
  const state = useAppState();
  const store = useStore();
  const { turns, proposals, inFlight, activeId } = state.session;
  const { chips, attachments } = state.composer;
  /* The generated cards the agent drew and the chat saved. Read again when a turn settles (a card saves as its pass ends). */
  const [saved, setSaved] = useState<SavedSurface[]>([]);
  const settled = inFlight === null ? turns.length : -1;
  useEffect(() => {
    let live = true;
    if (!activeId) {
      setSaved([]);
      return;
    }
    void listChatSurfaces(activeId).then((rows) => {
      if (live) setSaved(rows);
    });
    return () => {
      live = false;
    };
  }, [activeId, settled]);
  const model = useMemo(
    () => buildOverview({ turns, chips, attachments, proposals, inFlight, saved }),
    [turns, chips, attachments, proposals, inFlight, saved],
  );
  const loop = useLiveLoop(activeId);

  /* Placement: measured from the row and the chat card's real bounds, again whenever either resizes. */
  const centred = float?.centred ?? true;
  const [place, setPlace] = useState<OverviewPlacement>(() => placeOverview({ container: null, column: null, chat: null, centred }));
  useLayoutEffect(() => {
    const measure = (): void => {
      const row = float?.rowRef.current ?? null;
      const chat = float?.chatRef.current ?? null;
      const main = float?.mainRef.current ?? null;
      const next = placeOverview({ container: row ? toBox(row.getBoundingClientRect()) : null, column: main ? toBox(main.getBoundingClientRect()) : null, chat: chat ? toBox(chat.getBoundingClientRect()) : null, centred });
      setPlace((prev) => (samePlacement(prev, next) ? prev : next));
    };
    measure();
    if (!float) return;
    window.addEventListener('resize', measure);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro) {
      if (float.rowRef.current) ro.observe(float.rowRef.current);
      if (float.mainRef.current) ro.observe(float.mainRef.current);
      if (float.chatRef.current) ro.observe(float.chatRef.current);
    }
    return () => {
      window.removeEventListener('resize', measure);
      ro?.disconnect();
    };
  }, [float, centred]);

  /* A pill the panel cannot fit beside opens it as a popover on request: Escape, a click elsewhere or a choice closes it. */
  const [peek, setPeek] = useState(false);
  const rootRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!peek) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPeek(false);
    };
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setPeek(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [peek]);
  /* The chat card gives up room for the panel (shifts left, narrows only if it must): set on the card, removed with the panel. */
  const shift = place.mode === 'panel' ? place.chatShift : null;
  useLayoutEffect(() => {
    const chat = float?.chatRef.current;
    if (!chat || !shift) return;
    chat.style.setProperty('--ov-left', `${shift.left}px`);
    chat.style.setProperty('--ov-w', `${shift.width}px`);
    chat.setAttribute('data-ov-shift', 'true');
    return () => {
      chat.style.removeProperty('--ov-left');
      chat.style.removeProperty('--ov-w');
      chat.removeAttribute('data-ov-shift');
    };
  }, [float, shift?.left, shift?.width]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (place.mode === 'panel') setPeek(false);
  }, [place.mode]);

  const { progress, files, artifacts } = model;
  const showProgress = progress.todos.length > 0 || progress.run !== null || loop !== null;

  const project = groundedRepoName(state);
  const branch = state.session.git.branch?.trim() || null;
  /* The row is cut with an ellipsis when the repo and the branch are long, and a cut value
     with no way to read it is a value the reader does not have. The title carries it whole. */
  const projectLabel = project ? (branch ? `${project} / ${branch}` : project) : 'No project';
  const composer = composerPropsFrom(state, store);
  const agents = useSyncExternalStore(agentRuns.subscribe, agentRuns.get, agentRuns.get);
  const agentRef = activeId ? agents.agents?.[activeId] : null;
  /* The model and both context numbers must describe the same chat's current agent.
     API history/breakdown cannot measure an ACP agent, even before its first report. */
  const context = agentRef ? chatContext(agents.runs, activeId, agentRef) : null;
  const used = context ? context.used : resolveContextRingUsed(inFlight?.usage ?? null, composer.contextUsed ?? null);
  const windowTok = context ? context.size : composer.contextWindow ?? null;
  /* The glance across chats: runs from the run store (this workspace's), chats from the session index. Apart from the selected chat's context above. */
  const { sessions, indexReady } = state.session;
  const fleet = fleetSummary(agents.runs, indexReady ? sessions.map((s) => s.id) : null, agents.agentLabels);
  const chatsText = fleet.chats === null ? 'Unknown' : `${fleet.chats} ${fleet.chats === 1 ? 'chat' : 'chats'}${fleet.runningChats > 0 ? `, ${fleet.runningChats} running` : ''}`;
  const breakdown = context ? null : composer.contextBreakdown ?? null;
  /* The row says what was measured and what is known of the window, and never calls a measured turn unmeasured. */
  const windowText = windowLine(used === null ? null : formatContextWindowTokens(used), windowTok ? formatContextWindowTokens(windowTok) : null);
  const modelName = useChatAgentModel(activeId ?? null) ?? modelLabel(state.composer.model);
  const effort = useChatEffort(activeId ?? null);

  const openFile = (f: OverviewFile): void => {
    if (!f.openable) return;
    store.dispatch({ type: 'files/open', path: f.path, ...(f.line ? { line: f.line } : {}) });
  };
  const openArtifact = (a: OverviewArtifact): void => {
    scrollToTurn(a.turnId, turns.map((t) => t.id));
  };

  const live = (inFlight !== null && inFlight.phase !== 'done' && inFlight.phase !== 'error') || loop !== null || progress.run !== null;
  const empty = emptyLine(files.length, artifacts.length);

  const sections = (
    <>
      {showProgress ? (
        <Section id="progress" title="Progress" summary={progressSummary(progress.todos, progress.run)} defaultOpen={progressOpenByDefault(live, progress.todos)}>
          {progress.run ? (
            <p className="ov-run" data-testid="ov-run">
              <span className="ov-run-r">Round {progress.run.round} of {progress.run.roundCap}</span>
              {progress.run.step ? <span className="ov-run-s">{progress.run.step}</span> : null}
            </p>
          ) : null}
          {progress.todos.length > 0 ? (
            <ul className="ov-list ov-todos" data-testid="ov-todos" data-live={progress.live ? 'true' : 'false'}>
              {progress.todos.map((t) => (
                <li key={t.id} className="ov-todo" data-status={t.status}>
                  <span className="ov-mark" aria-hidden="true">{MARK[t.status]}</span>
                  <span className="ov-todo-t">{t.title}</span>
                  <span className="ov-sr">{t.status}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {loop ? (
            <div className="ov-loop" data-testid="ov-loop">
              <p className="ov-sub">{loop.name}{loop.round > 0 ? `, pass ${loop.round + 1}` : ''}</p>
              <ul className="ov-list ov-todos" data-live={loop.steps.some((s) => s.state === 'active') ? 'true' : 'false'}>
                {loop.steps.map((s) => (
                  <li key={s.id} className="ov-todo" data-status={s.state}>
                    <span className="ov-mark" aria-hidden="true">{MARK[s.state]}</span>
                    <span className="ov-todo-t">{s.label}</span>
                    {s.state === 'failed' ? <span className="ov-sr">failed</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Section>
      ) : null}

      <Section id="context" title="Context" defaultOpen>
        <dl className="ov-kv" data-testid="ov-context">
          <div>
            <dt>Project</dt>
            <dd data-testid="ov-project" title={projectLabel}>{projectLabel}</dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd data-testid="ov-model" title={modelName}>{modelName}</dd>
          </div>
          <div>
            <dt>Agents</dt>
            <dd className="ov-fleet" data-testid="ov-agents">
              {fleet.agents.length > 0 ? (
                <span className="ov-marks">
                  {fleet.agents.map((a) => (
                    <span key={a.ref ?? 'unknown'} className="ov-mark-a" role="img" aria-label={`${a.name}, ${a.runs} running`} title={`${a.name}, ${a.runs} running`} data-testid="ov-agent-mark">
                      <ProviderIcon provider={brandOf(a.ref, a.name)} />
                    </span>
                  ))}
                </span>
              ) : null}
              <span>{fleet.running > 0 ? `${fleet.running} running` : 'None running'}</span>
            </dd>
          </div>
          <div>
            <dt>Chats</dt>
            <dd data-testid="ov-chats">{chatsText}</dd>
          </div>
          {effort ? (
            <div>
              <dt>Effort</dt>
              <dd data-testid="ov-effort">{effort}</dd>
            </div>
          ) : null}
          <div>
            <dt>Window</dt>
            <dd className="ov-ring">
              <span className="chat-scope s2-ctx" data-testid="ov-ring">
                <ContextRing used={used ?? null} window={windowTok} breakdown={breakdown} showEmpty />
              </span>
              <span data-testid="ov-window">{windowText}</span>
            </dd>
          </div>
          {used !== null && windowTok ? (
            <div>
              <dt>Used</dt>
              <dd data-testid="ov-used">{contextPercent(used, windowTok)} of context</dd>
            </div>
          ) : null}
        </dl>
        {model.context.chips.length > 0 ? (
          <ul className="ov-chips" data-testid="ov-chips" aria-label="Context for the next message">
            {model.context.chips.map((c) => (
              <li key={c.id} className="ov-chip" title={c.detail ?? c.label}>
                {c.label}
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      {empty ? (
        <p className="ov-sub ov-empty" data-testid="ov-empty">{empty}</p>
      ) : null}

      {files.length > 0 ? (
        <Section id="files" title="Files" summary={filesSummary(files)} defaultOpen={listOpenByDefault(files.length)}>
          <ul className="ov-list" data-testid="ov-files">
            {files.map((f) => (
              <li key={f.key}>
                {f.openable ? (
                  <button
                    type="button"
                    className="s2-btn ov-row"
                    data-testid="ov-file"
                    data-path={f.path}
                    data-state={f.state}
                    title={f.alsoRead && f.state === 'edited' ? `${f.path} (read, then edited)` : f.path}
                    onClick={() => openFile(f)}
                  >
                    <S2Icon name="file" small />
                    <span className="ov-row-t">
                      {dirOf(f.path) ? (
                        <span className="ov-row-dir" data-testid="ov-file-dir">
                          <bdi>{dirOf(f.path)}</bdi>
                        </span>
                      ) : null}
                      <span className="ov-row-n" data-testid="ov-file-name">{f.name}</span>
                    </span>
                    <span className="ov-row-s">{STATE_WORD[f.state]}</span>
                  </button>
                ) : (
                  <span className="ov-row is-static" data-testid="ov-file" data-state={f.state} title={f.path}>
                    <S2Icon name="file" small />
                    <span className="ov-row-t">
                      {dirOf(f.path) ? (
                        <span className="ov-row-dir" data-testid="ov-file-dir">
                          <bdi>{dirOf(f.path)}</bdi>
                        </span>
                      ) : null}
                      <span className="ov-row-n" data-testid="ov-file-name">{f.name}</span>
                    </span>
                    <span className="ov-row-s">{STATE_WORD[f.state]}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {artifacts.length > 0 ? (
        <Section id="artifacts" title="Artifacts" summary={artifactsSummary(artifacts.length)} defaultOpen={listOpenByDefault(artifacts.length)}>
          <ul className="ov-list" data-testid="ov-artifacts">
            {artifacts.map((a) => (
              <li key={a.key}>
                <button type="button" className="s2-btn ov-row" data-testid="ov-artifact" data-kind={a.kind} title={a.title} onClick={() => openArtifact(a)}>
                  <S2Icon name="layers" small />
                  <span className="ov-row-t">{a.title}</span>
                  <span className="ov-row-s">{KIND_WORD[a.kind]}</span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <div className="ov-quick" data-testid="ov-sec-quick" role="group" aria-label="Quick open">
        <span className="ov-quick-in" data-testid="ov-quick">
          {QUICK.filter((q) => SHIPPED_SURFACES.includes(q.id)).map((q) => (
            <button
              key={q.id}
              type="button"
              className="s2-ibtn s2-round"
              aria-label={CHROME_TAB_DEFS[q.id].label}
              title={CHROME_TAB_DEFS[q.id].label}
              data-testid={`ov-open-${q.id}`}
              onClick={() => {
                setPeek(false);
                onOpenSurface(q.id);
              }}
            >
              <S2Icon name={q.icon} />
            </button>
          ))}
        </span>
      </div>
    </>
  );

  const count = keyCount(files, artifacts);
  const pillText = live && progress.todos.length > 0 ? progressSummary(progress.todos, progress.run) : 'Overview';
  const asPill = place.mode !== 'panel';
  const floating = float !== undefined && place.mode !== 'inline';
  const style: CSSProperties | undefined =
    floating && place.mode === 'panel'
      ? { top: place.top, right: place.right, width: place.width, maxHeight: place.maxHeight }
      : floating && place.mode === 'pill'
        ? { top: place.top, right: place.right }
        : undefined;
  const onPill = (): void => {
    setPeek((v) => !v);
  };

  const node = (
    <aside
      ref={rootRef}
      className={`ov ov-${place.mode}${floating ? ' ov-float' : ''}`}
      aria-label="Chat overview"
      data-testid="chat-overview"
      data-kind={place.mode}
      data-live={live ? 'true' : undefined}
      style={style}
    >
      {asPill ? (
        <>
          <button
            type="button"
            className="s2-btn ov-pillbtn"
            data-testid="ov-pill"
            aria-expanded={peek}
            aria-label={count > 0 ? `Overview, ${filesSummary(files)}, ${artifactsSummary(artifacts.length)}` : 'Overview'}
            title="Overview"
            onClick={onPill}
          >
            <S2Icon name="plan" small />
            <span>{pillText}</span>
            {count > 0 ? <span className="ov-pill-n" data-testid="ov-pill-count">{count}</span> : null}
          </button>
          {peek ? (
            <div className="ov-pop" data-testid="ov-pop" role="dialog" aria-label="Chat overview">
              {sections}
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="ov-head">
            <span className="ov-head-t">Overview</span>
          </div>
          {sections}
        </>
      )}
    </aside>
  );
  if (place.mode === 'inline') return float?.headSlot ? createPortal(node, float.headSlot) : null;
  return node;
}

export default ChatOverview;
