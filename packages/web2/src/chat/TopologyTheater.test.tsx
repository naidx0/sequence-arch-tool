import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import '../tokens/graphite.css';
import './chat.css';

import { TopologyTheater } from './TopologyTheater';
import { TOPOLOGY_STEP_LABELS } from './topologyTheaterModel';

describe('TopologyTheater', () => {
  it('renders Drawing on Architecture with ordered steps and statuses', () => {
    render(
      <TopologyTheater
        live
        steps={[
          { id: 'called', label: TOPOLOGY_STEP_LABELS.called, status: 'done' },
          { id: 'nodes', label: TOPOLOGY_STEP_LABELS.nodes, status: 'running' },
          { id: 'edges', label: TOPOLOGY_STEP_LABELS.edges, status: 'pending' },
          { id: 'checking', label: TOPOLOGY_STEP_LABELS.checking, status: 'pending' },
        ]}
      />,
    );

    const theater = screen.getByTestId('chat-topology-theater');
    expect(theater.getAttribute('data-tool')).toBe('propose_topology');
    expect(theater.getAttribute('data-live')).toBe('true');
    expect(theater.textContent).toMatch(/Drawing on Architecture/);
    expect(theater.textContent).toMatch(/propose_topology/);

    const steps = theater.querySelectorAll('.topology-theater-step');
    expect(steps).toHaveLength(4);
    expect(steps[0]?.getAttribute('data-status')).toBe('done');
    expect(steps[1]?.getAttribute('data-status')).toBe('running');
    expect(steps[2]?.getAttribute('data-status')).toBe('pending');
    expect(theater.textContent).toMatch(/1\./);
    expect(theater.textContent).toMatch(/Topology tool called/);
    expect(theater.textContent).toMatch(/Building nodes/);
    expect(theater.textContent).not.toMatch(/strikethrough|<del>/i);
  });
});
