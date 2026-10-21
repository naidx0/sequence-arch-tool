import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { requestHostCommand } from '../../app/hostCommands';
import { groundedRepoRoot, useAppState } from '../../state/connect';
import { useBoardDelivery } from './useBoardDelivery';
import { onSpaceSnapshot, type SpaceSnapshot } from '../../git/gitEvents';
import type { BoardsIndex } from './boardsModel';

const ArtifactDelivery = lazy(() => import('./ArtifactDelivery').then((m) => ({ default: m.ArtifactDelivery })));

/** Mounted with the host, including while Spaces is closed. */
export function BoardDelivery() {
  const state = useAppState();
  const root = groundedRepoRoot(state);
  const project = root ?? 'workspace';
  const chat = state.session.activeId;
  const scope = `${project}\u0000${chat ?? ''}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [snapshot, setSnapshot] = useState<SpaceSnapshot | null>(null);
  const [updates, setUpdates] = useState(0);
  useEffect(() => root && chat ? onSpaceSnapshot((next) => { setSnapshot(next); setUpdates((n) => n + 1); }) : undefined, [root, chat]);
  const index = snapshot?.project.replace(/\\/g, '/') === project.replace(/\\/g, '/') ? snapshot.index : null;
  const deliver = useCallback((id: string) => {
    void import('./boardsClient').then(({ setActiveWhiteboard }) => {
      if (currentScope.current !== scope) return;
      setActiveWhiteboard(project, id);
      requestHostCommand('canvas.whiteboard');
    });
  }, [project, scope]);
  useBoardDelivery(index, project, chat, deliver);
  const seen = useRef<{ scope: string; id: string | null } | null>(null);
  const [artifact, setArtifact] = useState<{ scope: string; index: BoardsIndex } | null>(null);
  useEffect(() => {
    if (!index) return;
    const delivery = snapshot?.artifacts.find((d) => d.chat === chat) ?? null;
    const previous = seen.current;
    seen.current = { scope, id: delivery?.id ?? null };
    if (previous?.scope === scope && delivery && delivery.id !== previous.id) setArtifact({ scope, index: { ...index, artifactDelivery: delivery } });
  }, [index, snapshot, chat, scope]);
  return <><span hidden data-testid="space-delivery" data-chat={chat ?? ''} data-ready={Boolean(index)} data-update={updates} />{artifact?.scope === scope ? <Suspense fallback={null}><ArtifactDelivery index={artifact.index} delivered /></Suspense> : null}</>;
}
