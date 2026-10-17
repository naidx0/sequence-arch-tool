/* ══════════════════════════════════════════════════════════════════════════
   "OPEN NEW SURFACES LARGE" (0.1.6, owner)
   packages/web2/src/settings/SurfaceFocusSetting.tsx

   One switch, off by default. On, the surface you opened last takes about 75%
   of the workspace and the others share the rest; opening another makes it
   the large one. Off, surfaces share the workspace evenly as they are added.
   The value lives in shell2/layoutPrefs.ts (the stage reads the same store, so
   it follows the switch at once); this is only its row.
   ══════════════════════════════════════════════════════════════════════════ */

import { setFocusLarge, useFocusLarge } from '../shell2/layoutPrefs';

export function SurfaceFocusSetting() {
  const on = useFocusLarge();
  return (
    <section className="sb-group" data-testid="settings-surface-focus">
      <h3 className="sb-lab">Workspace</h3>
      <div className="sb-card">
        <label className="sb-row sb-row-switch" data-testid="settings-surface-focus-row">
          <input
            type="checkbox"
            role="switch"
            className="sb-switch"
            data-testid="settings-surface-focus-switch"
            checked={on}
            onChange={(e) => setFocusLarge(e.currentTarget.checked)}
          />
          <span className="sb-row-txt">
            <span className="sb-row-t">Open new surfaces large</span>
            <span className="sb-row-sub" data-testid="settings-surface-focus-sub">
              {on
                ? 'The surface you opened last takes about 75%.'
                : 'Surfaces share the workspace evenly.'}
            </span>
          </span>
        </label>
      </div>
    </section>
  );
}

export default SurfaceFocusSetting;
