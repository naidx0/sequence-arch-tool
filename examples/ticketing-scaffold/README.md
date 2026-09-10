# ticketing-scaffold — the spec-to-system loop, proven

This directory is a **tracked artifact of Sequence's v4 spec-to-system loop**. It
was not written by hand from an idea; it was scaffolded by an agent following a
deterministic build brief that `sequence` rendered from a design-mode
architecture spec — and then scanned back into that same spec with **zero drift**.

The claim being demonstrated end to end:

> intent (a design spec) → a deterministic brief → real scaffolded code →
> `sequence scan` → `sequence diff` shows **zero drift** → break one wire →
> `sequence diff` **catches the drift**.

## The four pieces

| Piece | What it is |
| --- | --- |
| `examples/ticketing.spec.json` | The authored **design spec** (7 nodes, 5 edges): `gateway` (ts/express) →http→ `api` (py/fastapi); `api` →db(`tickets`)→ `postgres`; `api` →publish→ `ticket.created` (on `redis`); `worker` (ts) →consume→ `ticket.created`. |
| the build brief | `sequence scaffold-brief examples/ticketing.spec.json` — a deterministic markdown brief that names every file, env var, port, route, call, topic literal and SQL statement the code must contain. No LLM inside Sequence. |
| this directory | The scaffold an agent produced by following that brief **verbatim** — `docker-compose.yml` plus one dir per service with a `Dockerfile` and a minimal runnable stub. |
| the loop proof | `sequence scan` this dir, then `sequence diff` against the spec. Exit 0, zero drift. |

## Scaffold tree

```
ticketing-scaffold/
  docker-compose.yml        # the single wiring manifest (env vars = the edges)
  gateway/                  # ts / express, port 3000 — calls api
    Dockerfile              #   FROM node:20-slim
    package.json
    index.ts                #   fetch(`${process.env.API_URL}/tickets/...`) GET + POST
  api/                      # py / fastapi, port 8000
    Dockerfile              #   FROM python:3.12-slim
    requirements.txt
    app/main.py             #   @app.get/post routes, redis publish, sqlalchemy INSERT/SELECT tickets
  worker/                   # ts (no framework) — long-running consumer
    Dockerfile              #   FROM node:20-slim
    package.json
    index.ts                #   redis createClient + subscribe('ticket.created', ...)
```

`postgres` and `redis` are stock-image compose entries with no source directory;
the `ticket.created` topic exists in code only as the inline string literal at the
publish and subscribe call sites (the service-level diff joins spec and scan on
these labels).

## Proof 1 — zero drift

```bash
$ sequence scan examples/ticketing-scaffold --out scanned.json
scanned ticketing-scaffold in 0.1s: 3 services, 3 files, 7 interaction edges, 0 import edges

$ sequence diff examples/ticketing.spec.json scanned.json ; echo "exit=$?"
## sequence conformance report
Implementation conforms to spec — no drift.

exit=0
```

The scanned scaffold reproduces the authored spec exactly: every edge the
architect drew is present in the code, and the code adds no edge the architect
did not draw.

## Proof 2 — a deliberately broken wire is caught

Copy the scaffold, delete **only** the worker's `subscribe('ticket.created', ...)`
call, rescan, and diff:

```bash
$ sequence scan ticketing-scaffold-broken --out scanned-broken.json
scanned ticketing-scaffold-broken in 0.1s: 3 services, 3 files, 7 interaction edges, 0 import edges

warnings (1):
  - topic "ticket.created" has publishers but no consumer found

$ sequence diff examples/ticketing.spec.json scanned-broken.json ; echo "exit=$?"
## sequence conformance report
**1 missing from implementation / 1 not in spec** service-level interaction edges (spec → implementation)

### Missing from implementation
- `worker → topic:ticket.created` [queue_consume]
### Not in spec
- `worker → redis` [db_access] — evidence: worker/index.ts:4

exit=3
```

The diff catches the removed wire: `worker → topic:ticket.created [queue_consume]`
is reported **missing from implementation**. (The companion
`worker → redis [db_access]` line is expected: deleting the only queue op on the
worker leaves a bare `createClient` connection, which the scanner reclassifies as
a plain data-store connection rather than a broker consumer. Both lines are
correct scanner behavior; the load-bearing signal is the missing queue_consume
edge.)

## Reproduce in one command

From the repo root, after `pnpm build`:

```bash
node packages/analyzer/dist/cli.js scan examples/ticketing-scaffold --out /tmp/scanned.json \
  && node packages/analyzer/dist/cli.js diff examples/ticketing.spec.json /tmp/scanned.json
```

The whole loop — including the break-detection half — is also locked as a
deterministic, network-free regression test at
`packages/analyzer/src/test/loop.test.ts` (run via
`node --test packages/analyzer/dist/test/loop.test.js`).
