/**
 * `@sequence/api-types` — the shared HTTP wire contract for the Sequence platform
 * server (`packages/analyzer/src/server/repoServer.ts`).
 *
 * **Types only.** No runtime code, no dependency beyond `@sequence/schema`. The
 * built `dist/*.js` files are empty modules; every consumer imports from here with
 * `import type`, so nothing from this package survives into a bundle.
 *
 * WHY IT EXISTS. The server is one raw `node:http` handler, 4,452 lines: no
 * Express, no router, no OpenAPI, no generated client. Requests are `JSON.parse`
 * plus hand-written narrowing, responses go out through one `sendJson`. Before
 * this package, roughly sixty request/response shapes were re-derived by hand at
 * each end and nothing tied the two together. That is engine gap G12; this closes
 * it.
 *
 * WHAT IT IS NOT. It is a description of the server as it is TODAY, not a wish
 * list. Where a response omits something the UI needs (no coverage on an ask
 * result), or where a capability is conditional (terminal resize is live on PTY
 * and a no-op on pipe — see `terminal.ts`), that is written into the type's
 * comment rather than typed as if it always worked. Wave 1 items 1.1, 1.2, 1.5
 * and 1.8 all ADD optional fields here; none of them changes an existing shape.
 *
 * (This paragraph used to lead with "there is no `POST /api/program/run`" as its
 * example of a missing route. P8 built it, and the example was corrected rather
 * than left standing — a contract file describing a route as absent while the
 * server serves it is the same defect as a route typed as if it worked while it
 * does not. `programs.ts` keeps the history in prose, where it belongs.)
 *
 * ONE FILE PER ROUTE GROUP, matching `docs/research/v2-architecture-and-gaps.md`
 * §3.2:
 *
 * | file | routes |
 * | --- | --- |
 * | `common.ts` | the error envelope, `Unvalidated<T>`, `{ok,path}` |
 * | `auth.ts` | `/api/me`, `/auth/login/:provider`, `/auth/callback/:provider`, `/auth/logout` |
 * | `attach.ts` | `/api/status`, `/api/browse`, `/api/attach`, `/api/detach`, `/api/recent`, `/api/policies`, `/api/repo-trust` |
 * | `graph.ts` | `/archgraph.json`, `/api/scan`, `/api/tree`, `/api/functions`, `/api/explain`, `/api/annotate`, `/api/ddl` |
 * | `files.ts` | `/api/file`, `/api/git/status`, `/api/git/diff`, `/api/git/commit` |
 * | `ask.ts` | `/api/ask`, `/api/ask/stream` and the 16-variant SSE union |
 * | `sessions.ts` | `/api/sessions*`, `/api/chat-memory`, `/api/board`, `/api/trajectory*` |
 * | `provider.ts` | `/api/ai-config`, `/api/usage`, `/api/generate`, `/api/prompt-file`, `/api/design-suggest`, `/api/research` |
 * | `integrations.ts` | `/api/acp/*`, `/api/mcp/*`, `/api/github*` |
 * | `harness.ts` | `/api/harness/*` |
 * | `permissions.ts` | `/api/permissions`, `/api/auto-approve` |
 * | `programs.ts` | `/api/program/*` |
 * | `terminal.ts` | the `/api/terminal` WebSocket protocol |
 *
 * NAMING. `<Method><Route>Request` / `<Method><Route>Response`, e.g.
 * `PostAttachRequest` / `PostAttachResponse`. A route with no payload types its
 * request as `void`. Error bodies that carry more than `{ error }` get their own
 * named type next to the route they belong to.
 *
 * LINE REFERENCES. `repoServer.ts:NNNN` citations were measured against the file
 * AS OF THIS COMMIT (post-W0.5), not against the numbers printed in the plan's
 * §3.2 — W0.5's own import block shifted every one of them. When a citation goes
 * stale, the route path in the same comment is the durable anchor: grep
 * `pathname === '/api/…'`.
 */

export type * from './common.js';
export type * from './auth.js';
export type * from './attach.js';
export type * from './graph.js';
export type * from './files.js';
export type * from './ask.js';
export type * from './sessions.js';
export type * from './provider.js';
export type * from './integrations.js';
export type * from './harness.js';
export type * from './permissions.js';
export type * from './programs.js';
export type * from './terminal.js';
