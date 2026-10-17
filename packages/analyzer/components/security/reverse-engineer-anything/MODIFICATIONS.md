# Modifications

Sequence changed these vendored files after the pinned upstream commit (8cbd57cafaf1cfacbe832bae593589cf211442ef). The upstream
project's MIT license is kept unchanged in LICENSE. Edits are applied by tools/components/vendor.mjs
from tools/components/patches/rea.json; a re-vendor reproduces them. docs/research/rea-security-review.md (seq-018-be, dbe2b2e1), verdict SHIP WITH EDITS.

## 1. SKILL.md (SKILL.md:34-35)

C1: no unpinned npx on the agent own judgement of scope; ask the user to install the pinned package.

Before:

```
Prefer an existing `rea` CLI. When none is installed and REA package acquisition
is within the authorized scope, use `npx -y rea-agents@latest` in its place.
```

After:

```
Prefer an existing `rea` CLI. If none is installed, stop and ask the user to install `rea-agents@6.4.0` themselves.
```

## 2. references/connection-and-recovery.md (connection-and-recovery.md:7-8)

C2: same as C1 for every recovery command.

Before:

```
Commands below use an installed `rea`. If none is available, use the package
invocation in `SKILL.md` when acquiring REA is authorized.
```

After:

```
Commands below use an installed `rea`. If none is available, stop and ask the user to install `rea-agents@6.4.0` themselves.
```

## 3. references/connection-and-recovery.md (connection-and-recovery.md:53-59)

C4: drop the loophole that lets a write run when its scope is not already authorized.

Before:

```
Obtain approval for writes when that concrete scope is not already authorized,
```

After:

```
Obtain the user's yes in chat for this exact write before running it,
```

## 4. references/connection-and-recovery.md (connection-and-recovery.md:76-94)

C6: delete the persistent per-tool auto-approve (approval_mode) preapproval section.

Before:

```
For an operator who explicitly wants to preapprove named operations in a
disposable Codex profile, current Codex supports per-tool configuration. For
example, opening and closing an analysis session can be scoped independently:

```toml
[mcp_servers.rea.tools.open_binary]
approval_mode = "approve"

[mcp_servers.rea.tools.close_binary]
approval_mode = "approve"
```

Use the actual server ID and only the operations whose effects were approved;
this example does not approve inspection, extraction or runtime execution.
Show the proposed config edit and preserve unrelated entries and backups before
writing. Managed policy can constrain client settings. Consult the
[Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
for the installed client's supported settings. This is an optional recovery
choice, not a prerequisite for every REA task.


```

After:

```
(removed)
```

## 5. references/native-and-artifacts.md (native-and-artifacts.md:74-75)

C8: the entitlement line invites re-signing to weaken code signing; the agent must not add it.

Before:

```
`get-task-allow` entitlement.
```

After:

```
`get-task-allow` entitlement. Do not add the entitlement yourself; report it as a blocker.
```
