import { useState } from 'react';
import { FONT_CHOICES, readFont, writeFont, type FontId } from './fontPreference';
import { MenuSelect } from './sbParts';

/* Interface font as one row, Theme's format: the label on the left, the choice on the right. Four faces do not
   fit a segmented control at the narrowest Settings width, so the control is the settings dropdown (MenuSelect). */
export function FontSetting() {
  const [font, setFont] = useState(readFont);
  const pick = (next: string) => {
    setFont(next as FontId);
    writeFont(next as FontId);
  };
  return <div className="sb-row sb-theme sb-font" data-testid="settings-font">
    <span className="sb-row-txt"><span className="sb-row-t">Interface font</span><span className="sb-row-sub">Bundled with the app.</span></span>
    <MenuSelect
      testid="settings-font-select"
      ariaLabel="Interface font"
      value={font}
      options={FONT_CHOICES.map((c) => ({ value: c.id, label: c.label }))}
      onChange={pick}
    />
  </div>;
}
