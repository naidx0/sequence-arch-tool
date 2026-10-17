---
status: accepted
date: 2026-10-10
deciders: Max, Sequence team
---

# 0007: Use a local queue for agent runs

## Status

Accepted

## Context and Problem Statement

Agent runs must survive a restart. We need a queue that works with no network.

## Decision Drivers

* Local-first
* Honest errors

## Considered Options

| Option | Offline | Cost |
|---|---|---|
| SQLite queue | yes | low |
| Hosted queue | no | high |

## Decision Outcome

Chosen option: "SQLite queue", because it works offline.

### Consequences

* Good, because runs survive restarts
* Bad, because one writer at a time

## Flow

```mermaid
flowchart TD
  A[Prompt] --> B{Queue empty?}
  B -- yes --> C[Run now]
  B -- no --> D[Wait]
  D --> C
```

## Handshake

```mermaid
sequenceDiagram
  participant U as User
  participant S as Server
  U->>S: start run
  S-->>U: run id
  S->>S: write queue row
```

## Code

```ts
const x: number = 1;
```
