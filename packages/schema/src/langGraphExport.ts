/**
 * Read-only LangGraph JSON export for external tooling — not a runtime.
 */

import type { Program, ProgramNode, ProgramEdge } from './program.js';

export interface LangGraphExportNode {
  id: string;
  type: string;
  title: string;
}

export interface LangGraphExportEdge {
  source: string;
  target: string;
  kind: string;
}

export interface LangGraphExport {
  version: 'sequence-langgraph-v0';
  programId: string;
  name: string;
  nodes: LangGraphExportNode[];
  edges: LangGraphExportEdge[];
}

const KIND_MAP: Record<string, string> = {
  start: 'start',
  end: 'end',
  agent: 'llm',
  command: 'tool',
  checker: 'validator',
  parallel: 'parallel',
  branch: 'branch',
  loop: 'loop',
  state: 'state',
};

export function exportProgramToLangGraph(program: Program): LangGraphExport {
  return {
    version: 'sequence-langgraph-v0',
    programId: program.id,
    name: program.name,
    nodes: program.nodes.map((n: ProgramNode) => ({
      id: n.id,
      type: KIND_MAP[n.kind] ?? n.kind,
      title: n.title,
    })),
    edges: program.edges.map((e: ProgramEdge) => ({
      source: e.from,
      target: e.to,
      kind: e.kind,
    })),
  };
}
