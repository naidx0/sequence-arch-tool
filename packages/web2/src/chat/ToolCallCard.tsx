import { Icon } from './Icon';
import type { IconName } from './Icon';
import { toolCardTitle, type StrippedTool } from './stripToolProse';

function glyphForTool(name: string): IconName {
  if (name === 'propose_topology') return 'board';
  if (name.startsWith('canvas.')) return 'spark';
  if (name === 'propose_files') return 'code';
  if (name === 'read_file' || name === 'search_files') return 'file';
  if (name === 'run_command') return 'terminal';
  return 'run';
}

export interface ToolCallCardProps {
  tool: StrippedTool;
  /** Full raw JSON — shown in title; truncated on the card face. */
  detail?: string;
}

/**
 * Compact tool-call card — replaces raw JSON/code dumps in the transcript
 * while Architecture / AI Canvas work rows carry the live trail.
 */
export function ToolCallCard({ tool, detail }: ToolCallCardProps) {
  const title = toolCardTitle(tool.name);
  return (
    <div
      className="tool-call-card"
      data-testid="chat-tool-call-card"
      data-tool={tool.name}
      title={detail?.trim() ? detail : tool.name}
    >
      <Icon name={glyphForTool(tool.name)} size={14} />
      <span className="tool-call-card-title">{title}</span>
      <span className="tool-call-card-name mono">{tool.name}</span>
    </div>
  );
}
