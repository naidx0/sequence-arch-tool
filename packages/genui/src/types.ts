/**
 * The generative UI wire shapes. One place, both directions.
 *
 *   agent -> app   UIOp lines (JSONL), one atomic change each, folded into a UISpec
 *   app -> agent   UIAction (a click on a generated control) and UIDiagnostics
 *                  (what the validator refused, phrased so the agent can patch it)
 *
 * A UISpec is a flat adjacency map (the json-render / A2UI shape): elements by id,
 * children by id. Flat beats nested for streaming: every line can add or change one
 * element without re-sending its parents, and a child can be referenced before it
 * arrives (it renders as a placeholder until it does).
 */

export interface UIElement {
  type: string;
  props: Record<string, unknown>;
  children?: string[];
}

export type SurfaceStatus = 'streaming' | 'working' | 'idle' | 'done' | 'error';

export interface ActionDecl {
  /** What the button does, in the agent's words; shown in the confirm and sent back. */
  description?: string;
  /** Allowed while the agent is mid-turn. Default false: controls are inert while it works. */
  whileBusy?: boolean;
}

export interface UISpec {
  root: string | null;
  elements: Record<string, UIElement>;
  /** The surface's data model. Props bind into it with {"$state": "/json/pointer"}. */
  state: Record<string, unknown>;
  /** The actions this surface accepts back. A Button naming anything else is refused. */
  actions: Record<string, ActionDecl>;
  meta: { title?: string; status?: SurfaceStatus; label?: string };
}

/** One JSONL line. RFC 6902 ops on the spec, plus three shorthands an LLM gets right more often. */
export type UIOp =
  | { op: 'add' | 'replace'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  /** Shallow-merge an object at path (props updates without restating every prop). */
  | { op: 'merge'; path: string; value: Record<string, unknown> }
  /** Push onto the array at path (a new child, a new log line). */
  | { op: 'append'; path: string; value: unknown }
  /** Upsert one element. */
  | { op: 'el'; id: string; type: string; props?: Record<string, unknown>; children?: string[]; parent?: string; root?: boolean }
  /** Write into the data model: path is relative to /state. */
  | { op: 'set'; path: string; value: unknown }
  /** Surface status and the one-line status label ("Running 36 of 42 tests"). */
  | { op: 'status'; status: SurfaceStatus; label?: string };

export type Severity = 'error' | 'warning';

export type IssueCode =
  | 'PARSE_ERROR'
  | 'BAD_OP'
  | 'NO_ROOT'
  | 'UNKNOWN_COMPONENT'
  | 'INVALID_PROPS'
  | 'MISSING_CHILD'
  | 'UNALLOWED_CHILD'
  | 'CYCLE'
  | 'ORPHAN'
  | 'UNDECLARED_ACTION'
  | 'UNBOUND_STATE'
  | 'RENDER_ERROR'
  | 'LIMIT_EXCEEDED';

export interface Issue {
  code: IssueCode;
  severity: Severity;
  message: string;
  /** JSON pointer into the spec (or the line number for PARSE_ERROR / BAD_OP). */
  path: string;
  elementId?: string;
  /** A short, concrete instruction for the agent ("use one of: pending, running, done"). */
  hint?: string;
}

export interface Fix {
  /** lossless fixes move or normalise and never change what renders; lossy ones drop or substitute. */
  lossy: boolean;
  message: string;
  elementId?: string;
  path?: string;
  by: 'fixer' | 'agent';
}

/** A click (or other input) on a generated control, sent back to the agent as an event. */
export interface UIAction {
  kind: 'ui.action';
  surfaceId: string;
  name: string;
  params: Record<string, unknown>;
  elementId: string;
  /** The surface data model at the moment of the click (A2UI's sendDataModel). */
  state: Record<string, unknown>;
  at: number;
}

export interface UIDiagnostics {
  kind: 'ui.diagnostics';
  surfaceId: string;
  issues: Issue[];
  /** The repair request as prose, ready to hand to the agent. */
  prompt: string;
  round: number;
}

export const emptySpec = (): UISpec => ({ root: null, elements: {}, state: {}, actions: {}, meta: {} });
