import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { groundedRepoRoot, useAppState } from '../../state/connect';
import type { RepoPath } from '../../files/filesModel';
import { previewKind } from '../../files/previewKind';
import type { BoardsIndex } from './boardsModel';

const FilePreview = lazy(() => import('../../files/FilePreview'));
type Delivery = { id: string; chat: string; path: string };

/** Explicit HTML/image delivery uses the existing Files preview, never the object canvas. */
export function ArtifactDelivery({ index, delivered = false }: { index: BoardsIndex | null; delivered?: boolean }) {
  const state = useAppState();
  const project = groundedRepoRoot(state) ?? 'workspace';
  const chat = state.session.activeId;
  const scope = `${project}\u0000${chat ?? ''}`;
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const seen = useRef<{ scope: string; id: string | null } | null>(null);
  const sequence = useRef(0);
  const [opened, setOpened] = useState<{ scope: string; delivery: Delivery; text: string | null } | null>(null);
  const delivery = index?.artifactDelivery ?? null;
  const ready = index !== null;
  useEffect(() => {
    if (!chat || !ready) return;
    const mine = ++sequence.current;
    void (async () => {
      const previous = seen.current;
      seen.current = { scope, id: delivery?.id ?? null };
       if ((!delivered && (!previous || previous.scope !== scope)) || !delivery || delivery.chat !== chat || delivery.id === previous?.id) return;
      const kind = previewKind(delivery.path as RepoPath);
      if (!kind) return;
      const source = kind === 'image' ? null : await fetch(`/api/file?path=${encodeURIComponent(delivery.path)}&chat=${encodeURIComponent(chat)}`).then((r) => r.ok ? r.text() : null);
      if (currentScope.current === scope && mine === sequence.current && (kind === 'image' || source !== null)) setOpened({ scope, delivery, text: source });
    })().catch(() => undefined);
    return () => { sequence.current += 1; };
  }, [chat, scope, ready, delivery?.id, delivery?.chat, delivery?.path]);
  useEffect(() => {
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpened(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);
  if (!opened || opened.scope !== scope) return null;
  const kind = previewKind(opened.delivery.path as RepoPath);
  if (!kind) return null;
  return createPortal(
    <div className="s2 s2-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpened(null); }}>
      <div className="s2-dlg dgm-open-card" role="dialog" aria-modal="true" aria-label="Artifact preview" data-testid="space-artifact-preview">
        <div className="dgm-open-bar"><span className="dgm-label">{opened.delivery.path}</span><button type="button" className="s2-btn s2-btn-sm" onClick={() => setOpened(null)}>Close</button></div>
        <div className="files-scope dgm-open-pane"><Suspense fallback={null}><FilePreview kind={kind} path={opened.delivery.path as RepoPath} text={opened.text} /></Suspense></div>
      </div>
    </div>, document.body,
  );
}
