import type { SeqDiagramNode, SeqDiagramV1 } from '@sequence/schema';

export interface AgentInspectorProps {
  doc: SeqDiagramV1;
  nodeId: string;
  readOnly?: boolean;
  onChange: (nodeId: string, patch: Partial<SeqDiagramNode>) => void;
}

export function AgentInspector({ doc, nodeId, readOnly = false, onChange }: AgentInspectorProps) {
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node || node.kind !== 'agent') return null;

  const agent = node.agent ?? { prompt: '' };
  const scopeText = (agent.scopeFiles ?? []).join('\n');

  return (
    <aside
      className="board-scope agent-inspector"
      data-testid="agent-inspector"
      aria-label={`Agent ${node.label}`}
    >
      <div className="agent-inspector-head">
        <span className="agent-inspector-title">{node.label}</span>
        <span className="agent-inspector-kind">agent</span>
      </div>
      <label className="agent-inspector-field">
        <span>Prompt pack</span>
        <textarea
          data-testid="agent-inspector-prompt"
          value={agent.prompt}
          readOnly={readOnly}
          rows={6}
          onChange={(e) =>
            onChange(nodeId, {
              agent: { ...agent, prompt: e.target.value },
            })
          }
        />
      </label>
      <label className="agent-inspector-field">
        <span>Scope files (one per line)</span>
        <textarea
          data-testid="agent-inspector-scope"
          value={scopeText}
          readOnly={readOnly}
          rows={4}
          onChange={(e) => {
            const scopeFiles = e.target.value
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean);
            onChange(nodeId, { agent: { ...agent, scopeFiles } });
          }}
        />
      </label>
      <label className="agent-inspector-field">
        <span>Runtime</span>
        <select
          data-testid="agent-inspector-runtime"
          value={agent.runtime ?? 'gateway'}
          disabled={readOnly}
          onChange={(e) =>
            onChange(nodeId, {
              agent: { ...agent, runtime: e.target.value as 'gateway' | 'acp' },
            })
          }
        >
          <option value="gateway">Gateway (read/plan)</option>
          <option value="acp">ACP (builder)</option>
        </select>
      </label>
      <label className="agent-inspector-field">
        <span>ACP agent ref</span>
        <input
          data-testid="agent-inspector-agent-ref"
          type="text"
          value={agent.agentRef ?? ''}
          readOnly={readOnly}
          placeholder="default"
          onChange={(e) =>
            onChange(nodeId, {
              agent: { ...agent, agentRef: e.target.value || undefined },
            })
          }
        />
      </label>
    </aside>
  );
}
