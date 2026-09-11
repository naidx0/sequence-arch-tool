import type { WorkflowLaunchPhase } from './useWorkflowLaunch.js';

export interface WorkflowLaunchBarProps {
  phase: WorkflowLaunchPhase;
  error: string | null;
  previewProgramId: string | null;
  activeRunId: string | null;
  canLaunch: boolean;
  tier?: 'minimal' | 'standard' | 'full';
  suggestFullTier?: boolean;
  onTierChange?: (tier: 'minimal' | 'standard' | 'full') => void;
  onPreview: () => void;
  onLaunch: () => void;
  onReset: () => void;
  onPause?: () => void;
  onResume?: () => void;
}

export function WorkflowLaunchBar({
  phase,
  error,
  previewProgramId,
  activeRunId,
  canLaunch,
  tier = 'standard',
  suggestFullTier = false,
  onTierChange,
  onPreview,
  onLaunch,
  onReset,
  onPause,
  onResume,
}: WorkflowLaunchBarProps) {
  if (!canLaunch) return null;

  return (
    <div
      className="board-scope proposalbar workflow-launch-bar"
      data-testid="board-workflow-launch"
      role="group"
      aria-label="Agent workflow"
    >
      <span className="pb-title">Build this architecture</span>
      {phase === 'preview' && previewProgramId ? (
        <span className="pb-why">Preview: {previewProgramId}</span>
      ) : null}
      {phase === 'running' && activeRunId ? (
        <span className="pb-count" data-testid="workflow-run-chip">
          Run {activeRunId.slice(0, 12)}…
        </span>
      ) : null}
      {suggestFullTier && tier !== 'full' && (phase === 'idle' || phase === 'error' || phase === 'preview') ? (
        <span className="pb-why" data-testid="workflow-tier-hint">
          High blast-radius hub detected — consider{' '}
          <button
            type="button"
            className="pb-btn"
            data-testid="workflow-tier-full"
            onClick={() => onTierChange?.('full')}
          >
            Full council (Tier 3)
          </button>
        </span>
      ) : null}
      {tier === 'full' && phase !== 'running' && phase !== 'launching' ? (
        <span className="pb-count" data-testid="workflow-tier-label">
          Tier 3 — full council
        </span>
      ) : null}
      {error ? (
        <span className="pb-why" data-testid="workflow-launch-error" role="alert">
          {error}
        </span>
      ) : null}
      {phase === 'idle' || phase === 'error' ? (
        <>
          <button type="button" className="pb-btn" data-testid="workflow-preview" onClick={onPreview}>
            Preview workflow
          </button>
          <button type="button" className="pb-btn pb-btn-primary" data-testid="workflow-launch" onClick={onLaunch}>
            Approve &amp; launch
          </button>
        </>
      ) : null}
      {phase === 'preview' ? (
        <>
          <button type="button" className="pb-btn pb-btn-primary" data-testid="workflow-launch" onClick={onLaunch}>
            Approve &amp; launch
          </button>
          <button type="button" className="pb-btn" onClick={onReset}>
            Back
          </button>
        </>
      ) : null}
      {phase === 'running' ? (
        <>
          {onPause ? (
            <button type="button" className="pb-btn" data-testid="workflow-pause" onClick={onPause}>
              Pause
            </button>
          ) : null}
          {onResume ? (
            <button type="button" className="pb-btn" data-testid="workflow-resume" onClick={onResume}>
              Resume
            </button>
          ) : null}
        </>
      ) : null}
      {phase === 'launching' ? <span className="pb-why">Launching…</span> : null}
    </div>
  );
}
