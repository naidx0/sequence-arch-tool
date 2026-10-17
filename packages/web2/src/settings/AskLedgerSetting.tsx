/* ══════════════════════════════════════════════════════════════════════════
   "MAKE SURE EVERY ASK GETS AN ANSWER" (t3gap/asks)
   packages/web2/src/settings/AskLedgerSetting.tsx

   One select in the Agents pane: off, show the asks a reply left open, or
   ask the agent again by itself. askLedgerPreference.ts says what each does.
   ══════════════════════════════════════════════════════════════════════════ */

import { useState } from 'react';
import { MenuSelect, type MenuOption } from './sbParts';
import { readAskLedgerMode, writeAskLedgerMode, type AskLedgerMode } from './askLedgerPreference';

const MODES: readonly MenuOption[] = [
  { value: 'off', label: 'Off' },
  { value: 'chip', label: 'Show what is not done', desc: 'Show what the agent reports not done' },
  { value: 'auto', label: 'Ask again, once', desc: 'Ask the agent again, once, automatically' },
];

export function AskLedgerSetting() {
  const [mode, setMode] = useState(readAskLedgerMode);
  return (
    <section className="sb-group" data-testid="settings-ask-ledger">
      <h3 className="sb-lab">Messages with several asks</h3>
      <div className="sb-card">
        <div className="sb-row sb-theme">
          <span className="sb-row-txt">
            <span className="sb-row-t">Ask the agent to list what it didn’t do</span>
            <span className="sb-row-sub" data-testid="settings-ask-ledger-sub" title="When a message holds several requests, the agent ends its reply with a short list of them, done or not. Anything it marks not done is shown under the reply. This relies on the agent’s own report. Saved on this device.">
              Claude and Codex chats only; it relies on the agent’s own report. Saved here.
            </span>
          </span>
          <MenuSelect
            testid="settings-ask-ledger-select"
            ariaLabel="Ask the agent to list what it didn’t do"
            value={mode}
            options={MODES}
            onChange={(v) => {
              const next = v as AskLedgerMode;
              setMode(next);
              writeAskLedgerMode(next);
            }}
          />
        </div>
      </div>
    </section>
  );
}
