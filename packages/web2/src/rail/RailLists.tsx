/* The three lists the rail browses: Components (by catalog group), Agent profiles and Workflows. Each loads when it
   opens, scrolls inside the rail, filters once it holds more than FILTER_AFTER items, and has honest empty and error
   words. `RailBody` is the one switch the panel and the collapsed rail both render. */

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { BUILTIN_PROGRAMS, type Program } from '@sequence/schema';

import { createActivityClient } from '../activity/activityClient';
import { launchAndWatch } from '../activity/liveRun';
import { WorkflowPreviewHover } from '../activity/WorkflowPreview';
import { createWorkflowApi, type WorkflowView } from '../activity/workflowClient';
import { requestAgentsView } from '../agents/agentsSection';
import { ComponentDetail } from '../components/ComponentDetail';
import { createComponentsClient, type ComponentEntry } from '../components/componentsClient';
import type { SkillsView } from '../settings/settingsClient';
import { S2Icon } from '../shell2/icons';
import { useStore } from '../state/connect';
import { RailFilter } from './RailFilter';
import { RailNote } from './RailSection';
import { RailSkills } from './RailSkills';
import { addComponentChip, pickProfile } from './railActions';
import { RailPopover, usePopoverDismiss, wrapTab } from './railPopover';
import { fetchRailProfiles, matches, useLoad } from './railData';
import type { RailSectionId } from './railSections';

const realFetch: typeof fetch = (i, init) => fetch(i, init);

function Loading({ what }: { what: string }) {
  return <RailNote kind="loading">{`Loading ${what}.`}</RailNote>;
}

function Failed({ what, retry }: { what: string; retry: () => void }) {
  return (
    <div className="rail-failed">
      <RailNote kind="error">{`${what} could not be loaded. The engine did not answer.`}</RailNote>
      <button type="button" className="s2-btn rail-retry" onClick={retry}>
        Try again
      </button>
    </div>
  );
}

/* ── Components ─────────────────────────────────────────────────────────── */

export function RailComponents({ fetchImpl = realFetch, onUsed }: { fetchImpl?: typeof fetch; onUsed?: () => void }) {
  const store = useStore();
  const client = useMemo(() => createComponentsClient(fetchImpl), [fetchImpl]);
  const { state, retry } = useLoad(() => client.list());
  const [query, setQuery] = useState('');
  /* The groups the reader folded; a filter opens whatever it matches without touching this. */
  const [folded, setFolded] = useState<ReadonlySet<string>>(() => new Set());
  const panelBase = useId();
  /* The open component and the row it belongs to: its definition opens in a flyout beside the rail (railPopover), not in the list. */
  const [open, setOpen] = useState<{ id: string; row: HTMLElement } | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const close = (restoreFocus: boolean) => {
    const row = open?.row;
    setOpen(null);
    if (restoreFocus) row?.focus();
  };
  usePopoverDismiss(
    open !== null,
    () => [popRef.current, open?.row],
    (why) => close(why === 'escape'),
  );
  /* Focus moves into the flyout when it opens (it returns to the row on close). */
  useEffect(() => {
    if (open) popRef.current?.focus();
  }, [open?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  /* A filter can take the open row away; its flyout goes with it. */
  useEffect(() => {
    if (open && !open.row.isConnected) setOpen(null);
  });
  if (state.status === 'loading') return <Loading what="components" />;
  if (state.status === 'error') return <Failed what="Components" retry={retry} />;
  const listing = state.data;
  if (!listing.enabled) return <RailNote>Components are off. Turn them on with /components on.</RailNote>;
  const all = listing.groups.flatMap((g) => g.components);
  if (all.length === 0) return <RailNote>No components in this workspace yet.</RailNote>;
  const groups = listing.groups
    .map((g) => ({ ...g, components: g.components.filter((c) => matches(query, c.name, c.id, c.blurb)) }))
    .filter((g) => g.components.length > 0);
  return (
    <>
      <RailFilter label="Filter components" count={all.length} value={query} onChange={setQuery} />
      <div className="rail-list" data-testid="rail-list">
        {groups.length === 0 ? <RailNote>{`No component matches “${query.trim()}”.`}</RailNote> : null}
        {groups.map((g) => {
          const filtering = query.trim() !== '';
          const isOpen = filtering || !folded.has(g.id);
          const panelId = `${panelBase}-${g.id}`;
          return (
            <div key={g.id} className="rail-group" data-group={g.id} role="group" aria-label={g.name}>
              <button
                type="button"
                className="rail-group-head"
                data-testid="rail-group-head"
                aria-expanded={isOpen}
                aria-controls={panelId}
                aria-disabled={filtering || undefined}
                title={filtering ? 'Matches stay open while you filter' : g.blurb || undefined}
                onClick={() => {
                  if (filtering) return;
                  setFolded((prev) => {
                    const next = new Set(prev);
                    if (next.has(g.id)) next.delete(g.id);
                    else next.add(g.id);
                    return next;
                  });
                }}
              >
                <S2Icon name={isOpen ? 'chev' : 'chevr'} small />
                <span className="rail-group-name">{g.name}</span>
                <span className="s2-meta s2-mono">{g.components.length}</span>
              </button>
              <div id={panelId} className="rail-group-body" hidden={!isOpen}>
                {isOpen
                  ? g.components.map((c: ComponentEntry) => (
                      <button
                        key={c.id}
                        type="button"
                        className={`rail-item rail-item-line${open?.id === c.id ? ' is-on' : ''}`}
                        aria-expanded={open?.id === c.id}
                        aria-haspopup="dialog"
                        data-testid="rail-component"
                        data-component={c.id}
                        title={c.blurb || undefined}
                        onClick={(e) => (open?.id === c.id ? close(true) : setOpen({ id: c.id, row: e.currentTarget }))}
                      >
                        <S2Icon name="box" small />
                        <span className="rail-item-t">{c.name}</span>
                        {c.blurb ? (
                          <span className="rail-item-def" data-testid="rail-component-def">
                            {c.blurb}
                          </span>
                        ) : null}
                      </button>
                    ))
                  : null}
              </div>
            </div>
          );
        })}
      </div>
      {open ? (
        <RailPopover
          kind="flyout"
          prefer="right"
          role="dialog"
          label={`${open.id} definition`}
          focusable
          popRef={popRef}
          anchor={() => (open.row.isConnected ? open.row.getBoundingClientRect() : null)}
          onKeyDown={(e) => void wrapTab(e, popRef.current)}
        >
          <ComponentDetail
            id={open.id}
            backLabel="Close"
            onClose={() => close(true)}
            onUse={() => {
              const entry = all.find((x) => x.id === open.id);
              if (entry) addComponentChip(store, entry);
              close(true);
              onUsed?.();
            }}
          />
        </RailPopover>
      ) : null}
    </>
  );
}

/* ── Agent profiles ─────────────────────────────────────────────────────── */

export function RailProfiles({ fetchImpl = realFetch, onPicked }: { fetchImpl?: typeof fetch; onPicked?: () => void }) {
  const store = useStore();
  const { state, retry } = useLoad(() => fetchRailProfiles(fetchImpl));
  const [query, setQuery] = useState('');
  if (state.status === 'loading') return <Loading what="agent profiles" />;
  if (state.status === 'error') return <Failed what="Agent profiles" retry={retry} />;
  const all = state.data;
  if (all.length === 0) return <RailNote>No agent profiles yet. Add one in .sequence/agents.</RailNote>;
  const shown = all.filter((p) => matches(query, p.name, p.description));
  return (
    <>
      <RailFilter label="Filter agent profiles" count={all.length} value={query} onChange={setQuery} />
      <div className="rail-list" data-testid="rail-list">
        {shown.length === 0 ? <RailNote>{`No agent profile matches “${query.trim()}”.`}</RailNote> : null}
        {shown.map((p) => (
          <button
            key={p.name}
            type="button"
            className="rail-item"
            data-testid="rail-profile"
            data-profile={p.name}
            title={p.description || undefined}
            onClick={() => {
              void pickProfile(store, p.name).then(() => onPicked?.());
            }}
          >
            <S2Icon name="agents" small />
            <span className="rail-item-t">{p.name}</span>
            {p.readOnly ? <span className="s2-meta rail-item-meta">Read only</span> : null}
          </button>
        ))}
      </div>
    </>
  );
}

/* ── Workflows ──────────────────────────────────────────────────────────── */

export function RailWorkflows({ fetchImpl = realFetch, onLaunched }: { fetchImpl?: typeof fetch; onLaunched?: () => void }) {
  const api = useMemo(() => createWorkflowApi(fetchImpl), [fetchImpl]);
  const activity = useMemo(() => createActivityClient(fetchImpl), [fetchImpl]);
  /* The premade programs are always there; only the saved ones can fail to load. */
  const { state, retry } = useLoad<WorkflowView[]>(async () => {
    const r = await api.list();
    return r.ok ? r.body : null;
  });
  const [query, setQuery] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const saved = state.status === 'ready' ? state.data : [];
  const launch = async (program: Program) => {
    setFailure(null);
    const r = await launchAndWatch(activity, program);
    if (r.ok) onLaunched?.();
    else setFailure(r.message);
  };
  const open = () => requestAgentsView('workflows');
  const builtin = BUILTIN_PROGRAMS.filter((e) => matches(query, e.title, e.blurb));
  const mine = saved.filter((w) => matches(query, w.name));
  return (
    <>
      <RailFilter label="Filter workflows" count={BUILTIN_PROGRAMS.length + saved.length} value={query} onChange={setQuery} />
      <div className="rail-list" data-testid="rail-list">
        {failure ? <RailNote kind="error">{failure}</RailNote> : null}
        <p className="rail-group-head">
          <span className="rail-group-name">Ready-made</span>
          <span className="s2-meta s2-mono">{builtin.length}</span>
        </p>
        {builtin.map((e) => (
          <WorkflowPreviewHover key={e.id} name={e.title} purpose={e.blurb} program={e.build()} onOpen={open} onLaunch={() => void launch(e.build())}>
            <button type="button" className="rail-item" data-testid="rail-builtin" data-builtin-id={e.id}>
              <S2Icon name="nodes" small />
              <span className="rail-item-t">{e.title}</span>
            </button>
          </WorkflowPreviewHover>
        ))}
        {state.status === 'loading' ? <Loading what="saved workflows" /> : null}
        {state.status === 'error' ? (
          <div className="rail-failed">
            <RailNote kind="error">Saved workflows could not be loaded.</RailNote>
            <button type="button" className="s2-btn rail-retry" onClick={retry}>
              Try again
            </button>
          </div>
        ) : null}
        {state.status === 'ready' ? (
          <>
            <p className="rail-group-head">
              <span className="rail-group-name">Saved</span>
              <span className="s2-meta s2-mono">{mine.length}</span>
            </p>
            {mine.map((w) => (
              <WorkflowPreviewHover key={w.id} name={w.name} blocks={w.blocks} onOpen={open} onLaunch={() => void launch(w.program)}>
                <button type="button" className="rail-item" data-testid="rail-saved" data-workflow-id={w.id}>
                  <S2Icon name="nodes" small />
                  <span className="rail-item-t">{w.name}</span>
                </button>
              </WorkflowPreviewHover>
            ))}
            {saved.length === 0 ? <RailNote>No saved workflows in this project yet.</RailNote> : null}
          </>
        ) : null}
        {builtin.length === 0 && mine.length === 0 ? <RailNote>{`No workflow matches “${query.trim()}”.`}</RailNote> : null}
      </div>
    </>
  );
}

/* ── the switch ─────────────────────────────────────────────────────────── */

export interface RailBodyProps {
  id: RailSectionId;
  fetchImpl?: typeof fetch;
  skills: SkillsView | null;
  repoPath: string | null;
  /** Called after a row did its work (a component added, a profile picked, a workflow launched). */
  onDone?: () => void;
}

export function RailBody({ id, fetchImpl, skills, repoPath, onDone }: RailBodyProps) {
  switch (id) {
    case 'workflows':
      return <RailWorkflows fetchImpl={fetchImpl} onLaunched={onDone} />;
    case 'components':
      return <RailComponents fetchImpl={fetchImpl} onUsed={onDone} />;
    case 'profiles':
      return <RailProfiles fetchImpl={fetchImpl} onPicked={onDone} />;
    case 'skills':
      return <RailSkills skills={skills} repoPath={repoPath} />;
  }
}
