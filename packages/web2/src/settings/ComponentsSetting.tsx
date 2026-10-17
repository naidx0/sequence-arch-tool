/* ══════════════════════════════════════════════════════════════════════════
   SETTINGS > SKILLS > COMPONENTS
   packages/web2/src/settings/ComponentsSetting.tsx

   Contract: docs/requests/components-ui-contract.md.
     GET /api/components            { enabled, mode, groups: [{ id, name, blurb, components: [...] }] }
     PUT /api/components/settings   { enabled?, mode? }

   Jaden: components can be turned off; on, the model either runs one on its
   own, asks with an approval card first, or only offers it from the + next to
   the chat box and never suggests it. A server without the route answers 404:
   the section draws nothing rather than an error.
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';

import { FailureNote } from '../components/FailureNote';

export type ComponentMode = 'auto' | 'approve' | 'manual';

export interface ComponentsView {
  enabled: boolean;
  mode: ComponentMode;
  groups: { id: string; name: string; blurb?: string; components: { id: string; name: string; blurb?: string }[] }[];
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export const MODE_CHOICES: { id: ComponentMode; label: string; says: string }[] = [
  { id: 'auto', label: 'Run on their own', says: 'The model picks a component when it fits and uses it. A row in the chat shows which one.' },
  { id: 'approve', label: 'Ask me first', says: 'It offers a component in an approval card. Use it, or keep the regular workflow.' },
  { id: 'manual', label: 'Only from +', says: 'Never suggested. A component runs only when you pick it from the + next to the chat box.' },
];

export function ComponentsSetting({ fetchImpl = fetch }: { fetchImpl?: Fetch }): JSX.Element | null {
  const [view, setView] = useState<ComponentsView | null>(null);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<{ say: string; detail: string } | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    fetchImpl('/api/components', { headers: { accept: 'application/json' } })
      .then(async (r) => {
        if (r.status === 404) {
          if (live.current) setGone(true);
          return;
        }
        if (!r.ok) throw new Error(`the server answered ${r.status}`);
        const v = (await r.json()) as ComponentsView;
        if (live.current) setView({ ...v, groups: Array.isArray(v.groups) ? v.groups : [] });
      })
      .catch((e: Error) => live.current && setError({ say: 'Could not read the components.', detail: e.message }));
    return () => {
      live.current = false;
    };
  }, [fetchImpl]);

  const save = async (patch: { enabled?: boolean; mode?: ComponentMode }): Promise<void> => {
    setError(null);
    const before = view;
    if (view) setView({ ...view, ...patch });
    try {
      const r = await fetchImpl('/api/components/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!r.ok) throw new Error(`the server answered ${r.status}`);
    } catch (e) {
      if (!live.current) return;
      setView(before);
      setError({ say: 'Could not save this setting.', detail: (e as Error).message });
    }
  };

  if (gone) return null;
  const enabled = view?.enabled ?? true;
  const mode = view?.mode ?? 'approve';
  const says = MODE_CHOICES.find((c) => c.id === mode)?.says ?? '';
  const keys = MODE_CHOICES.map((c) => c.id);
  return (
    <section className="sb-group" data-testid="settings-components">
      <h3 className="sb-lab">Components</h3>
      <div className="sb-card">
        <label className="sb-row sb-row-switch">
          <input
            type="checkbox"
            role="switch"
            className="sb-switch"
            data-testid="settings-components-toggle"
            checked={enabled}
            disabled={view === null}
            onChange={(e) => void save({ enabled: e.currentTarget.checked })}
          />
          <span className="sb-row-txt">
            <span>Use components</span>
            <span className="sb-row-sub" role="status">
              {error ? (
                <FailureNote message={error.say} detail={error.detail} testid="settings-components-error" />
              ) : enabled ? (
                'Ready-made instruction packs for jobs like design review. Off: none are used, even from +.'
              ) : (
                'Off: no component is used, suggested or listed in the chat.'
              )}
            </span>
          </span>
        </label>
        {enabled ? (
          <div className="sb-row sb-theme" data-testid="settings-components-mode-row">
            <span className="sb-row-txt">
              <span className="sb-row-t">When a component fits</span>
              <span className="sb-row-sub" data-testid="settings-components-mode-says">{says}</span>
            </span>
            <div
              className="sb-seg"
              role="radiogroup"
              aria-label="When a component fits"
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                e.preventDefault();
                const at = keys.indexOf(mode);
                const next = keys[(at + (e.key === 'ArrowRight' ? 1 : -1) + keys.length) % keys.length]!;
                void save({ mode: next });
                e.currentTarget.querySelector<HTMLButtonElement>(`[data-components-mode="${next}"]`)?.focus();
              }}
            >
              {MODE_CHOICES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={mode === c.id}
                  tabIndex={mode === c.id ? 0 : -1}
                  data-components-mode={c.id}
                  className={mode === c.id ? 'is-on' : undefined}
                  disabled={view === null}
                  onClick={() => void save({ mode: c.id })}
                >
                  <span>{c.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {(view?.groups ?? []).map((g) => (
          <div key={g.id} className="sb-comp-group" data-testid="settings-components-group" data-group={g.id}>
            <span className="sb-row-t">{g.name}</span>
            {g.blurb ? <span className="sb-row-sub">{g.blurb}</span> : null}
            <ul className="sb-list sb-comp-list">
              {g.components.map((c) => (
                <li key={c.id} className="sb-row sb-comp" data-testid="settings-components-item">
                  <span className="sb-row-txt">
                    <span className="sb-row-t">{c.name}</span>
                    {c.blurb ? (
                      <span className="sb-row-sub sb-comp-sub" tabIndex={0} title={c.blurb} data-testid="settings-components-item-sub">
                        {c.blurb}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

export default ComponentsSetting;
