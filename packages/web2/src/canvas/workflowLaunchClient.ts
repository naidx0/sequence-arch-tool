/**
 * Board workflow launch — POST /api/program/run from Architecture board.
 */

import type { PostProgramRunResponse } from '@sequence/api-types';
import type { Program } from '@sequence/schema';

export interface WorkflowLaunchPayload {
  program: Program;
  sourceDiagramId?: string;
  sourceDiagramHash?: string;
}

export interface WorkflowLaunchResult {
  ok: true;
  runId: string;
  status: PostProgramRunResponse['status'];
}

export interface WorkflowLaunchError {
  ok: false;
  message: string;
  problems?: string[];
}

export type WorkflowLaunchOutcome = WorkflowLaunchResult | WorkflowLaunchError;

export async function postWorkflowRun(payload: WorkflowLaunchPayload): Promise<WorkflowLaunchOutcome> {
  try {
    const res = await fetch('/api/program/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.status === 400) {
      const body = (await res.json()) as { error?: string; problems?: string[] };
      return {
        ok: false,
        message: body.error ?? 'Program validation failed',
        problems: body.problems,
      };
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, message: body.error ?? `Launch failed (${res.status})` };
    }
    const body = (await res.json()) as PostProgramRunResponse;
    return { ok: true, runId: body.runId, status: body.status };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Network error' };
  }
}
