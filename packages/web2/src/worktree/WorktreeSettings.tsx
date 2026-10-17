/* ══════════════════════════════════════════════════════════════════════════
   S7 — CHAT WORKTREE SETTINGS (Settings > Workspace)
   packages/web2/src/worktree/WorktreeSettings.tsx

   How many chats may have their own worktree (1 to 64), and the setup
   command a new worktree shows (the lockfile's suggestion as the
   placeholder). Sequence shows that command; it never runs it.
   GET/PUT /api/worktree-settings (worktreeModel.worktreeApi).
   ══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';

import { worktreeApi, type WorktreeSettings as Settings } from './worktreeModel';

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export default function WorktreeSettings({ fetchImpl }: { fetchImpl?: Fetch }) {
  const f: Fetch = fetchImpl ?? ((i, init) => fetch(i, init));
  const [settings, setSettings] = useState<Settings | null>(null);
  const [cap, setCap] = useState('');
  const [setup, setSetup] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    void worktreeApi
      .settings(f)
      .then((r) => {
        if (!live.current) return;
        if (!r.ok) {
          setNote(r.body.error ?? `Could not read the settings (${r.status}).`);
          return;
        }
        setSettings(r.body);
        setCap(String(r.body.cap));
        setSetup(r.body.setupCommand ?? '');
      })
      .catch((e: unknown) => live.current && setNote(`Could not read the settings: ${e instanceof Error ? e.message : String(e)}`));
    return () => {
      live.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (patch: Partial<Pick<Settings, 'cap' | 'setupCommand'>>): Promise<void> => {
    const r = await worktreeApi.saveSettings(patch, f).catch((e: unknown) => ({ ok: false, status: 0, body: { error: `Could not save: ${e instanceof Error ? e.message : String(e)}` } }) as Awaited<ReturnType<typeof worktreeApi.saveSettings>>);
    if (!live.current) return;
    if (!r.ok) {
      setNote(r.body.error ?? `Could not save (${r.status}).`);
      return;
    }
    setSettings(r.body);
    setNote(null);
  };

  return (
    <section className="sb-group" data-testid="settings-worktrees">
      <h3 className="sb-lab">Chat worktrees</h3>
      <div className="sb-card">
        {/* Decision 49: Settings' grouped card, B's rows and fields. */}
        <label className="sb-row sb-row-act">
          <span className="sb-row-t">Chat worktrees (limit)</span>
          <input
            type="number"
            className="sb-input sb-input-num"
            min={1}
            max={64}
            data-testid="settings-worktree-cap"
            value={cap}
            disabled={settings === null}
            onChange={(e) => setCap(e.currentTarget.value)}
            onBlur={() => {
              const n = Number(cap);
              if (Number.isInteger(n) && n >= 1 && n <= 64) void save({ cap: n });
              else {
                setNote('The limit is a whole number from 1 to 64.');
                setCap(String(settings?.cap ?? ''));
              }
            }}
          />
        </label>
        <label className="sb-field">
          <span className="sb-field-lab">Setup command</span>
          <input
            type="text"
            className="sb-input mono"
            data-testid="settings-worktree-setup"
            placeholder={settings?.suggestion ?? ''}
            value={setup}
            disabled={settings === null}
            onChange={(e) => setSetup(e.currentTarget.value)}
            onBlur={() => void save({ setupCommand: setup.trim() === '' ? null : setup.trim() })}
          />
        </label>
        <p className="sb-hint" role="status" data-testid="settings-worktree-note">
          {note ?? 'Sequence shows this command; it never runs it.'}
        </p>
      </div>
    </section>
  );
}
