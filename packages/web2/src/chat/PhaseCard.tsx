import { Icon } from './Icon';
import { formatElapsed } from './workRowModel';

export interface PhaseCardProps {
  crumb: string;
  label: string;
  elapsedMs: number;
}

export function PhaseCard({ crumb, label, elapsedMs }: PhaseCardProps) {
  return (
    <div className="phase-card" data-testid="chat-phase-card">
      <div className="phase-card-crumb">
        <Icon name="folder" size={14} className="phase-card-crumb-icon" />
        <span>{crumb}</span>
      </div>
      <div className="phase-card-live">
        <span className="phase-card-dot" aria-hidden="true" />
        <span className="phase-card-label">{label}</span>
        <span className="phase-card-timer">{formatElapsed(elapsedMs)}</span>
      </div>
    </div>
  );
}
