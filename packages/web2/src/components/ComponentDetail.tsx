/*
 * A component's definition, short: its name, group and source, the one-line blurb, and a capped excerpt of the
 * body in a box that scrolls. "Use" hands the id back (the caller adds the chip); "Back" returns to the list.
 * Props stay {id, onUse, onClose} so the rail builder can reuse it. Drawn with the menu parts the + menu already
 * has (s2-btn); the only new rules are the capped, scrolling body in shell2/modelMenu.css.
 */
import { useEffect, useState } from 'react';

import { fetchComponents, previewComponent, type ComponentGroupView, type ComponentItem } from './componentsClient';

/** The most characters of the body shown; a longer body is cut here and says so. */
export const DETAIL_EXCERPT_CHARS = 1200;

type Loaded = ComponentItem & { body: string | null };

/** The listing's name for the group holding `id` ("ML and research"); the id prefix, capitalised, when the listing has none for it. */
export function groupNameOf(groups: readonly ComponentGroupView[] | null, id: string): string {
  const named = groups?.find((g) => g.components.some((c) => c.id === id))?.name;
  return named ? named : groupOf(id);
}

const groupOf = (id: string): string => {
  const g = id.includes('/') ? id.split('/')[0]! : '';
  return g ? g.charAt(0).toUpperCase() + g.slice(1) : '';
};

export function excerptOf(body: string | null): { text: string; cut: boolean } {
  const t = (body ?? '').trim();
  if (t.length <= DETAIL_EXCERPT_CHARS) return { text: t, cut: false };
  /* Cut at a line end when there is one near the cap, so the excerpt does not stop mid-word. */
  const head = t.slice(0, DETAIL_EXCERPT_CHARS);
  const nl = head.lastIndexOf('\n');
  return { text: (nl > DETAIL_EXCERPT_CHARS * 0.6 ? head.slice(0, nl) : head).trimEnd(), cut: true };
}

/** `backLabel` is the word on the left button: "Back" in a menu or list it returns to, "Close" in the rail's flyout. */
export function ComponentDetail({ id, onUse, onClose, backLabel = 'Back' }: { id: string; onUse: (id: string) => void; onClose: () => void; backLabel?: string }) {
  const [item, setItem] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState(false);
  const [groups, setGroups] = useState<ComponentGroupView[] | null>(null);

  useEffect(() => {
    let live = true;
    setItem(null);
    setFailed(false);
    previewComponent(id).then(
      (r) => live && setItem(r),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [id]);

  /* The group's name is in the listing, not in the item the preview returns. */
  useEffect(() => {
    let live = true;
    fetchComponents().then(
      (r) => live && setGroups(r.groups),
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);

  const ex = item ? excerptOf(item.body) : null;
  return (
    <div className="s2-comp-detail" data-testid="component-detail" data-component={id}>
      {/* The actions come first: in a rail list or a capped menu the foot of a long definition sits below the fold. */}
      <div className="s2-comp-detail-foot">
        <button type="button" className="s2-btn" data-testid="component-detail-back" onClick={onClose}>
          {backLabel}
        </button>
        {item ? (
          <button type="button" className="s2-btn s2-blue" data-testid="component-detail-use" onClick={() => onUse(id)}>
            Use
          </button>
        ) : null}
      </div>
      {failed ? (
        <p className="s2-mi s2-mi-foot" data-testid="component-detail-error">
          This definition could not be read.
        </p>
      ) : !item ? (
        <p className="s2-mi s2-mi-foot" data-testid="component-detail-loading">
          Reading the definition
        </p>
      ) : (
        <>
          <p className="s2-comp-detail-name" data-testid="component-detail-name">
            {item.name}
          </p>
          <p className="s2-comp-detail-meta">{[groupNameOf(groups, id), item.source].filter(Boolean).join(' from ')}</p>
          {item.blurb ? <p className="s2-comp-detail-blurb">{item.blurb}</p> : null}
          {ex && ex.text ? (
            <div className="s2-comp-detail-body" data-testid="component-detail-scroll" tabIndex={0} role="region" aria-label={`${item.name} definition`}>
              <pre className="s2-comp-detail-pre" data-testid="component-detail-excerpt">
                {ex.text}
              </pre>
            </div>
          ) : null}
          {ex?.cut ? <p className="s2-comp-detail-note">Shortened: the first part of the definition.</p> : null}
        </>
      )}
    </div>
  );
}
