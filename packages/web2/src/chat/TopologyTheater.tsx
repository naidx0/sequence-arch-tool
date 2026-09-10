import { Icon } from './Icon';
import {
  TOPOLOGY_THEATER_TITLE,
  type TheaterStep,
  type TheaterStepStatus,
} from './topologyTheaterModel';

export interface TopologyTheaterProps {
  steps: readonly TheaterStep[];
  live?: boolean;
}

function StepMarker({ status }: { status: TheaterStepStatus }) {
  if (status === 'done') {
    return (
      <span className="topology-theater-step-marker">
        <Icon name="check" size={12} className="topology-theater-check" />
      </span>
    );
  }
  if (status === 'running') {
    return (
      <span className="topology-theater-step-marker">
        <span className="topology-theater-pulse" />
      </span>
    );
  }
  return (
    <span className="topology-theater-step-marker">
      <span className="topology-theater-pending" />
    </span>
  );
}

/**
 * Option A tool theater — clean "Drawing on Architecture" + ordered steps.
 * Matches ToolCallCard glyph (board) and work-row vocabulary.
 */
export function TopologyTheater({ steps, live = true }: TopologyTheaterProps) {
  return (
    <div
      className="topology-theater"
      data-testid="chat-topology-theater"
      data-tool="propose_topology"
      data-live={live ? 'true' : 'false'}
    >
      <div className="topology-theater-head">
        <Icon name="board" size={14} />
        <span className="topology-theater-title">{TOPOLOGY_THEATER_TITLE}</span>
        <span className="topology-theater-tool mono">propose_topology</span>
      </div>
      <ol className="topology-theater-steps">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className="topology-theater-step"
            data-step={step.id}
            data-status={step.status}
            data-testid={`chat-topology-step-${step.id}`}
          >
            <span className="topology-theater-step-index">{index + 1}.</span>
            <StepMarker status={step.status} />
            <span
              className={
                step.status === 'running'
                  ? 'topology-theater-step-label live'
                  : 'topology-theater-step-label'
              }
            >
              {step.label}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
