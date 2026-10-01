import { Icon } from './Icon';
import type { IconName } from './Icon';

import './chat.css';

/* ══════════════════════════════════════════════════════════════════════════
   SESSION HOME CONTEXT — repo · branch · model
   packages/web2/src/chat/SessionHomeContext.tsx

   Shown only on an empty thread. Read-only facts naming what this session is
   grounded in — not permission controls, not @ context.

   `strip` (owner pick B): mono row under the composer, outside its border.
   `chips` (retired in product): bordered chips above the composer.
   ══════════════════════════════════════════════════════════════════════════ */

export interface SessionHomeChip {
  id: string;
  label: string;
  icon: IconName;
  /** Absent = neutral chip; present = secondary detail line in title */
  detail?: string;
}

export interface SessionHomeContextProps {
  chips: readonly SessionHomeChip[];
  /** `strip` = under-composer mono row (default). `chips` = legacy chip row. */
  variant?: 'chips' | 'strip';
}

export function SessionHomeContext({ chips, variant = 'strip' }: SessionHomeContextProps) {
  if (chips.length === 0) return null;

  if (variant === 'chips') {
    return (
      <div className="session-home" data-testid="session-home-context">
        {chips.map((chip) => (
          <span
            key={chip.id}
            className="session-home-chip"
            data-testid={`session-home-${chip.id}`}
            title={chip.detail ?? chip.label}
          >
            <Icon name={chip.icon} size={12} />
            <span className="session-home-chip-label">{chip.label}</span>
          </span>
        ))}
      </div>
    );
  }

  return (
    <span className="session-home-strip" data-testid="session-home-context">
      {chips.map((chip, index) => (
        <span key={chip.id} className="session-home-strip-part">
          {index > 0 ? (
            <span className="session-home-strip-sep" aria-hidden="true">
              ·
            </span>
          ) : null}
          <span
            className="session-home-strip-item"
            data-testid={`session-home-${chip.id}`}
            title={chip.detail ?? chip.label}
          >
            <Icon name={chip.icon} size={12} />
            <span>{chip.label}</span>
          </span>
        </span>
      ))}
    </span>
  );
}
