/* ══════════════════════════════════════════════════════════════════════════
   "REFRESH THE BOARD AUTOMATICALLY WHEN FILES CHANGE" (019-rescan-ui)
   packages/web2/src/settings/AutoRefreshSetting.tsx

   One switch, on by default (autoRefreshPreference.ts). On, the app rescans on its own a moment after files change.
   Off, a notice says the files changed and offers Rescan.
   ══════════════════════════════════════════════════════════════════════════ */

import { useAutoRefreshEnabled, writeAutoRefreshEnabled } from './autoRefreshPreference';

export function AutoRefreshSetting() {
  const on = useAutoRefreshEnabled();
  return (
    <section className="sb-group" data-testid="settings-auto-refresh">
      <h3 className="sb-lab">Project</h3>
      <div className="sb-card">
        <label className="sb-row sb-row-switch" data-testid="settings-auto-refresh-row">
          <input
            type="checkbox"
            role="switch"
            className="sb-switch"
            data-testid="settings-auto-refresh-switch"
            checked={on}
            onChange={(e) => writeAutoRefreshEnabled(e.currentTarget.checked)}
          />
          <span className="sb-row-txt">
            <span className="sb-row-t">Refresh the board automatically when files change</span>
            <span className="sb-row-sub" data-testid="settings-auto-refresh-sub">
              {on ? 'The board and Files catch up a moment after an edit.' : 'A notice appears instead, with a Rescan button.'}
            </span>
          </span>
        </label>
      </div>
    </section>
  );
}

export default AutoRefreshSetting;
