/**
 * goal: how a coding agent ticks the plan of a goal run. Present ONLY in a session a goal run started
 * (SEQUENCE_GOAL_URL, SEQUENCE_GOAL_KEY and SEQUENCE_GOAL_CHAT in its environment), so no ordinary session pays for the listing.
 * The tick goes back to the Sequence app (POST /api/goal-tick), which holds the plan and is its only writer, and which
 * applies the built-in model's own checks (analyzer goalAgentTools.ts). A failed call says so; it never reports a tick.
 */
import http from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

/**
 * POST JSON over node:http, NOT fetch: Node's fetch refuses the Fetch spec's blocked ports (4190, 6000, 6665-6669,
 * 10080 ...), so with the app on one of them every tick failed with 'fetch failed' while the agent worked on.
 */
function postJson(url: string, body: unknown, timeoutMs: number): Promise<{ ok: boolean; status: number; json: () => unknown }> {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    const req = http.request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(payload.length) }, timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        resolve({ ok: status >= 200 && status < 300, status, json: () => JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end(payload);
  });
}

export const GOAL_DESCRIPTION = 'Goal plan. mark_step_done {step: words of the step done}; write_plan {steps}.';

/* Kept bare on purpose; the handler checks the values. */
export const goalShape = {
  op: z.enum(['mark_step_done', 'write_plan']),
  step: z.string().optional(),
  steps: z.array(z.string()).optional(),
};

export function registerGoalTool(server: McpServer, goal: { url: string; key: string; chat: string }): void {
  server.registerTool(
    'goal',
    {
      description: GOAL_DESCRIPTION,
      inputSchema: goalShape,
      _meta: { 'anthropic/maxResultSizeChars': 4000 },
    },
    async (args: { op: 'mark_step_done' | 'write_plan'; step?: string; steps?: string[] }) => {
      const fail = (t: string) => ({ content: [{ type: 'text' as const, text: t }], isError: true });
      try {
        const res = await postJson(`${goal.url}/api/goal-tick`, { key: goal.key, chat: goal.chat, op: args.op, step: args.step, steps: args.steps }, 10_000);
        if (!res.ok) return fail(`goal: Sequence refused the tick (${res.status}); the goal run may have ended. Nothing was ticked.`);
        const r = res.json() as { text?: string; isError?: boolean };
        return { content: [{ type: 'text' as const, text: r.text ?? '' }], ...(r.isError ? { isError: true } : {}) };
      } catch (e) {
        return fail(`goal: could not reach Sequence (${(e as Error).message}). Nothing was ticked.`);
      }
    },
  );
}
