/**
 * Shapes every route group shares.
 *
 * `server/repoServer.ts` has exactly two response writers, `sendJson(res, status, body)`
 * and `sendError(res, status, message, extra)`, and
 * `sendError` spreads `extra` over `{ error: message }`. So every non-2xx JSON body
 * on the whole surface is `ApiErrorResponse` plus zero or more named fields, and
 * the route-specific error shapes in the other files all extend this one.
 */

/**
 * The universal error envelope: `sendError` writes `{ error, ...extra }`.
 *
 * `/api/file` GET is the one route whose SUCCESS body is not JSON (it is
 * `text/plain`); its failures still come through here.
 */
export interface ApiErrorResponse {
  error: string;
}

/**
 * A provider-boundary failure (`/api/ask`, `/api/explain`'s provider path,
 * `/api/generate`, `/api/prompt-file`, `/api/research`, `/api/design-suggest`).
 * `providerResponse` is the upstream's OWN response body, attached verbatim by
 * `ProviderError` — it never contains the user's key.
 */
export interface ProviderErrorResponse extends ApiErrorResponse {
  providerResponse?: string;
}

/**
 * The write-acknowledgement shape: `{ ok: true, path }` where `path` is
 * repo-relative. Used by `PUT /api/file`, `PUT /api/board`, `PUT /api/chat-memory`
 * and `POST /api/program/run-log`.
 */
export interface OkPathResponse {
  ok: true;
  path: string;
}

/**
 * The request body AS IT ARRIVES, before validation.
 *
 * `JSON.parse` returns `any`; the server's job is to prove each field. The old
 * hand-written narrowings were literally this mapped type spelled out by hand —
 * `let body: { path?: unknown; content?: unknown }` for a `{ path, content }`
 * request. Writing `Unvalidated<PutFileRequest>` instead means the narrowing and
 * the contract can no longer drift apart: adding a field to the request type
 * makes it visible at the parse site for free, and a field REMOVED from the
 * contract stops being narrowable.
 *
 * Every key is optional and `unknown` on purpose — an untrusted body may be
 * missing any field, or carry the wrong type in it.
 */
export type Unvalidated<T> = { [K in keyof T]?: unknown };

/**
 * A route that answers with a 302 and NO body (`GET /auth/login/:provider`,
 * `GET /auth/callback/:provider`). The response is carried entirely by the
 * `location` and `set-cookie` headers, so there is no success payload to type —
 * only the failure shapes in `auth.ts`.
 */
export type NoBodyRedirect = never;
