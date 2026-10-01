# monorepo-apps — the "compose builds from the repo root" shape

Reproduces a real product monorepo reported from use: compose deploys only the API
and a worker, and builds both with `context: .` (so the image can COPY shared
packages) plus `dockerfile: <dir>/Dockerfile`. Several front-ends and shared
libraries live beside them and are deployed elsewhere entirely.

Taken literally, `context: .` made the scanner ingest the WHOLE repo into each of
those two services, so every sibling app became a `module` of both. What this
fixture must produce instead:

- `svc:api` scoped to `backend/`, `svc:arq_worker` scoped to `books_worker/`
- every `frontend-*` / `backend-*` sibling as its OWN service
- `ds:redis` from the compose image
- no service whose path is `.`

Locked by `src/test/monorepo-root-context.test.ts` (which builds its own tmpdir
copies, so this directory is for manual/e2e use — attach it in the app to see the
whole chain: Architecture cards, Whiteboard, index rail).
