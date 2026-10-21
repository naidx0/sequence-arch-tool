# Plug-and-play harness: findings and the first slices

**Date:** 2026-10-16 · **Branch:** `feat/plug-and-play` (off local `main` at `f5b32e707`)
**Ask (owner, via the project):** make the harness the simplest and best to use: plug-and-play agents,
providers and tools; agent flavors; cloud ways to run agents; a near-zero-config UI from 0 to ready.

**End state:** a person opens Sequence, sees every coding agent they could use (installed or not),
connects one with a click, signs in through the agent's own flow, and can hand a message to a role
(`@review`) defined in files they already have. No command typed, no code change per new agent.

---

## 1. What the field does (survey, October 2026)

Sources are linked; anything not verified at the source is marked.

| Harness | Idea worth taking | Source |
|---|---|---|
| **ACP Registry** (Zed + JetBrains, live since 2026-01-28) | One JSON entry per agent: `distribution.npx {package,args}`, `uvx`, or per-platform `binary {archive,cmd,args,sha256}`. Clients install any agent with no per-agent code. Agents must support ACP auth (Agent Auth or Terminal Auth). 42 agents on 2026-10-16. | github.com/agentclientprotocol/registry (`FORMAT.md`, `AUTHENTICATION.md`), CDN `registry/v1/latest/registry.json` |
| **OpenCode** | Agents are markdown files with frontmatter (`description`, `mode`, `model`, `permission`, `tools`) in `.opencode/agents/` or `~/.config/opencode/agents/`. Build/Plan primaries switched with Tab; `@`-invoked subagents. 75+ providers through models.dev. | opencode.ai/docs/agents, /providers |
| **Claude Code** | Subagents in `.claude/agents/*.md` (`name`, `description`, `tools`, `model`, `permissionMode`, `memory`, `isolation: worktree`). Plugins bundle agents, skills, hooks and MCP; marketplaces are a JSON catalog. | code.claude.com/docs/en/sub-agents, /plugins |
| **Codex cloud** | Environment set up by inspecting the repo (install, test command), shown for review, reused per task; per-task network allowlist presets; CLI hands a task to the cloud. | learn.chatgpt.com/docs/cloud |
| **Goose** | A *recipe* (YAML): instructions, prompt, typed parameters rendered as a form, an extension allowlist, sub-recipes. | goose-docs.ai recipe reference (secondary summary) |
| **OpenHands** | A runtime interface: Docker locally, Remote, Modal, Daytona, E2B, Runloop behind it. | docs.openhands.dev runtimes (v0) |
| **Roo / Cline** | Shareable mode bundles (prompt + rules + tool limits in one file); a markdown "memory bank" in the repo. | docs.roocode.com custom modes |
| **Vibe Kanban, Conductor, Crystal, Sculptor** | One task = one worktree (or container) = one card; the diff is the review screen. *Secondary sources only; unverified.* | agentsroom.dev roundup |
| **models.dev** | Open catalog of providers and models with capability flags (tool call, reasoning, limits, prices). The JSON endpoint was not confirmed at the source. | models.dev |

**The one finding that changed the plan:** the ACP registry exists and Sequence already speaks ACP.
`@sequence/acp`'s `AcpClient` drives any ACP agent (`agentKindOf` → `other`); the only thing missing
was the launch line. So "plug-and-play agents" is a catalog, not an adapter per vendor.

## 2. Where Sequence stood (read from the code, 2026-10-16)

- **Agents:** two, hand-wired: `PROVIDER_SPECS` in `packages/analyzer/src/server/providerProbe.ts`
  (Claude Code over its ACP bridge, Codex over `codex app-server`). `~/.sequence/agents.json` could
  hold any `{id, command, args}`, but only the CLI (`sequence agent add`) could write one.
- **Onboarding:** strong for those two (detect, sign in in an embedded terminal, bridge install, one
  click to connect), four big options (Claude Code, Codex, local model, API key). Nothing for anyone
  whose agent is Gemini, Copilot, Cursor, OpenCode or Hermes.
- **Providers:** Anthropic and OpenAI-compatible (`provider.ts`), Ollama/LM Studio detection, an
  OpenRouter-backed gateway. Adequate; a models.dev catalog is the next step (section 5).
- **Tools:** MCP client (`mcpClient.ts`), read-only plugin manifest v0 (`pluginManifest.ts`, one
  built-in `ping`), skills in `.sequence/skills` on the `/` palette.
- **Modes:** three by owner ruling (Plan, Smart, Full auto; `chat/composerModelModes.ts`). Any
  "flavor" must not become a fourth mode.
- **Memory:** `.sequence/memory/NOTES.md`, AGENTS.md editor, per-chat memory.
- **Cloud/remote:** a hosted gateway and a Render blueprint for the app; no remote agent runtime.

## 3. What was built on this branch

Each slice is committed with its tests; every claim below was run.

### 3.1 Agent catalog (server) · `9baf4fba5`
`packages/analyzer/src/server/agentCatalog.ts`, `agentCatalogRoutes.ts`

- Reads the **ACP registry format** from three sources merged by id: a shipped snapshot (13 agents,
  offline), the live registry fetched only on a click (cached in the user store), and the person's own
  `~/.sequence/agent-catalog.json` (same format: a custom agent plugs in with no code change).
- Launch resolution, in order: the person's own CLI on PATH (`gemini --acp`), then **`npx -y <pkg>`
  with nothing to install**, then `uvx`, else an honest "install" state with how to get it.
- `GET /api/acp/catalog`, `POST /api/acp/catalog/refresh`, `POST /api/acp/catalog/connect {id}`. The
  browser names an id; the command line comes from the catalog (the rule the existing connect keeps).
- **One-click sign-in for any agent:** `AcpClient` now keeps initialize's `authMethods` and can call
  ACP `authenticate`. `POST /api/acp/catalog/sign-in/methods` reads the agent's own methods (one
  process per agent at a time); `POST /api/acp/catalog/sign-in` runs an "agent" method as a background
  job; `GET` only reads the job and never starts anything.

Measured on this machine (Windows 11): Cursor and Hermes found installed; Gemini, Copilot, Cline,
Auggie, Factory Droid, Kilo and Qwen runnable through npx. Two real-input bugs found and fixed: Node's
own `npx.cmd` under `C:\Program Files` is not an npm shim (every npx agent read "install" until
`npx-cli.js` was run directly), and `cursor-agent.cmd` needs `cmd.exe /d /c`. Live ACP checks:
Hermes initialized, opened a session and answered a prompt over ACP (its own model backend was down,
which it reported); Cursor initialized and asked for sign-in (`cursor_login`); Gemini over npx
initialized in 26 s and offered four sign-in methods.

### 3.2 Settings › More agents · `bc9ac790c`, `291bf3cc8`
`packages/web2/src/settings/AgentCatalogSection.tsx` under the Coding agents section: each agent's
state in words (Installed / No install needed / Not installed), Connect, Sign in (the agent's own
methods as buttons), Get it, and "Check for new agents" (registry refresh, offline-safe).

### 3.3 First run · `be8b26a37`, `291bf3cc8`
Under the four big options, **More agents** lists what can start now. It opens by itself when neither
Claude Code nor Codex is ready; a connect leaves for setup exactly as a ready Codex does. Looking at
it in the browser found that Connect waited ~45 s for Hermes to list its models before moving on;
fixed and locked by a test.

### 3.4 Agent profiles ("flavors") · `2c9feb47e`, `d9c36f18d`
`packages/analyzer/src/server/agentProfiles.ts`, `packages/web2/src/chat/agentProfiles.ts`

- Read from the files people already have: `.claude/agents` (Claude Code), `.opencode/agent[s]` and
  `~/.config/opencode/agent[s]` (OpenCode), `.sequence/agents`, plus built-ins `review`, `explain`,
  `test`. Nearest definition wins. On the real Sequence repo it lists the six `.claude/agents` roles.
- `@review find what breaks`: the agent gets the role's instructions; the chat keeps and shows only
  what was typed, with a note "As @review, read-only."
- **Read-only is enforced, not requested:** derived from each file's own terms (a `Bash` tool counts
  as a writer), and a read-only role sends that one message in Plan, where the agent's own
  permission mode refuses writes.
- On the `/` palette as its own shelf, "Agent profiles". Not a fourth mode; the mode chip is untouched.

### Gates run (all exit 0 unless noted)

- analyzer: `agent-catalog` and `agent-profiles` with `agents-connect`, `acp-endpoints` and
  `onboarding-routes`, 29 of 29 under the no-real-binaries guard (after the review fixes).
- acp: full suite, 183 pass.
- web2 vitest after the review fixes: `src/chat src/onboarding` 1391 of 1392 and `src/agents src/v3
  src/settings src/shell2` 1626 of 1627. The one failure in each batch passes alone: a `FirstRun` test
  whose exact request list now starts with the catalog read (updated, 35 of 35), and a `shell2` sidebar
  test this branch does not touch, which times out only under full parallel load.
- `tsc` clean in analyzer, acp and web2; `pnpm --filter @sequence/web2 build` and the analyzer build
  succeed. Screens checked in the built app at 1024×768 (shots in the project library).

Not run: the e2e suites and the legibility gate.

### 3.5 Independent review · `3fb48d7b1`

A fresh Opus reviewer read the branch against its base. Eight findings were fixed, each with a test:
a cross-site `GET` could start agents (now only a JSON POST does, deduped per agent); terminal and
env-var sign-in methods were offered as buttons that cannot work; a fetched registry's `bins` could name
any local program, and a registry `cmd` of `./cmd` would match `cmd.exe`; a non-npm `.cmd` under a folder
with a space read "Not installed"; a project file named `review.md` silently dropped the built-in's
read-only; the sign-in poll could run forever and "Signed in." showed for agents with no sign-in step;
profiles were cached across project switches; first run's More agents could open to nothing.

Left open, named: a CLI on PATH that shares an agent's name but is another program (pressly's `goose`,
antirez's `kilo`) reads Installed; and on Windows a `dispose` kills the direct child, so an agent run
through `npx` or `cmd.exe` relies on exiting when its stdin closes.

## 3.6 Round two (branch `feat/plug-and-play-2`, on top of round one)

### What the deeper research changed

A second survey covered sandboxes and 20 more harnesses. Main sources: docs.e2b.dev, daytona.io/docs,
modal.com/docs/guide/sandboxes, vercel.com/docs/vercel-sandbox, docs.docker.com/ai/sandboxes,
github.com/dagger/container-use, code.claude.com/docs/en/claude-code-on-the-web, docs.imbue.com (Sculptor),
ampcode.com/manual, docs.warp.dev, kiro.dev/docs/specs, jules.google/docs.
The pattern every hosted harness converges on is **branch in, branch out**: seed a sandbox from a git
ref, run the agent, return a branch or a patch (Claude Code `--cloud`/`--teleport`, Codex cloud,
Cursor cloud agents, Copilot's coding agent, Sculptor's container per agent, Dagger container-use).
The environment is a checked-in file (`devcontainer.json`, Copilot's `copilot-setup-steps.yml`,
Devin's `environment.yaml`). For a local-first app the first runtime is **local Docker** (no account,
offline); the first remote one is **E2B** (`Sandbox.create`, `commands.run`, pause and resume, an
open-source stack), with Daytona a close second. Cloudflare Sandbox needs a Worker deployed per user,
which is a poor fit for a one-click button.

Ideas from the wider field, ranked for Sequence: a run-location chooser in the new-task dialog
(Factory's Computer tab), a parallel-agents board with a "needs you" state (Nimbalyst, Vibe Kanban,
Warp's agent panel), a plan-approval gate before edits (Jules, Kiro specs), an ACP message log for
debugging (Zed), push notification when a thread needs input (Amp, Claude Code), and a deny-by-default
network allow-list per environment (Copilot, Codex, Claude Code).

### What was built

- **One-click install for agents that ship as an archive** · `1c5c8cb72`. OpenCode, goose, Kimi and
  Mistral Vibe had only "Get it". Install downloads the registry's archive for this machine (https,
  400 MB cap), refuses it unless its sha256 matches the registry's, unpacks it with the system `tar`
  (Windows' own bsdtar reads zip, tar.gz and tar.bz2) into `<store>/agents-bin/<id>/<version>`, and the
  catalog starts the agent from there. An entry with no checksum is refused, so Cursor keeps "Get it".
  Checked on this machine with a zip and a tar.gz built by the same tar; no real agent was downloaded.
- **Stopping an agent on Windows ends its whole process tree** · `51bbd8d9e`. Measured first: every
  earlier test run had left `cursor-agent`'s node process running after dispose (six orphans, now
  cleaned up). A first fix that ran `taskkill /T` alongside the direct kill still left one, because the
  tree was gone before taskkill walked it. Stop now runs `taskkill /T /F` first, then the direct kill.
  Measured after: 0 left.
- **Run in a sandbox** · `eb0374ebf`. A launch whose args carry `{cwd}` is sandboxed: the token becomes
  the project folder at spawn, the agent is told `/workspace/<sub>` instead of a host path, and
  Sequence's host-side MCP servers are not offered inside. Settings › More agents offers "Run in a
  sandbox" for npm agents: `docker run -i --rm --init -v {cwd}:/workspace … node:22-bookworm-slim npx -y
  <pkg>`, with API keys passed by name only. It registers `<id>-sandbox` beside the plain agent and is
  refused, with what to do, while Docker is not running. **Not run live:** Docker Desktop is installed
  here, but its engine did not come up in 25 minutes (it appeared to wait on its own window), so I
  stopped it again. The contract is tested with a mock ACP agent; the Docker path is tested with a fake
  `docker`.

### Round-two review · `d418991ab`, `e6f7dd9b4`

A fresh Opus reviewer found and I fixed: a registry arg carrying `{cwd}` could move an ordinary agent's
session to `/workspace` (sandboxing now needs the docker command too, and catalog args may not carry
launch tokens); the sandbox passed every provider's key and a GitHub token to any agent (now only that
agent's own keys, by name, with `no-new-privileges`, no raw sockets, the person's own user on Linux, and
a per-run container name that Stop removes); the Docker Desktop CLI path was mangled by string escapes
(now found: `C:\Program Files\Docker\Docker\resources\bin\docker.exe`); a registry version of `..`
would have emptied `agents-bin`; a link as the agent's executable; an old-version cleanup that could undo
a fresh install; and three user-seat issues (failure wording, an install followed after a reload, who
installed it). Looking at the built app found two more: four filled Install buttons, and the same
checksum sentence on every row.

Gates at `e6f7dd9b4`: acp 188 of 188; analyzer catalog, install, profiles, connect and ACP endpoint tests
33 of 33 under the no-real-binaries guard; web2 `src/settings src/onboarding src/agents` 791 of 791.
Still not run live: the Docker sandbox (the engine never came up here) and a real archive download.

## 3.7 Round three (branch `feat/plug-and-play-3`): plug-and-play model providers

**Built** · `f43e030f9`, `ee9ab07b5`, `2a5188940`. Settings › Models now carries the models.dev catalog
(189 providers on the Anthropic or OpenAI-compatible wire, each with up to six current tool-calling
models, context window and price). **Any provider**: search, then Set up fills the form (wire, address, a
sensible starting model). **Found on this machine**: a provider whose key is already in the environment is
offered by its variable; Use saves a model with `apiKeyEnv`, which reads the key on every load and never
writes it. Checked live: this machine has `NEBIUS_API_KEY`; Use saved a model and `ai.json` holds
`"apiKeyEnv": "NEBIUS_API_KEY"` and no key (no request was sent to Nebius).

**Review** (fresh Opus, all fixed with tests): a role binding at another address could inherit the env
key (now it needs its own key); hosted mode would have let a user read the server's own keys (refused on
PUT, ignored on load); editing an env-key model wrote the loaded value to disk (the merge now keeps the
name); an unset variable failed the whole config file and the next save would have dropped every other
model (now that one model loads keyless and the row names the variable); the env key's last four
characters reached the page (no mask now); two providers at one address; a GitHub token offered as a
model key; poor starting models; id collisions. The hosted-mode refusal is covered by a unit test of
`usesEnvKey`, not by a hosted-server route test.

**Gates at `2a5188940`:** full analyzer suite earlier in the round 4373 of 4376 (the one failure is this
machine's corepack/pnpm walking the home folder, unrelated); provider, config and settings analyzer tests
242 of 243 after the fixes (1 skipped); `src/settings` web tests 416 of 416.

## 3.8 Round four (branch `feat/plug-and-play-4`): one memory for all your agents

**Research.** Each agent's user-level instruction file, from its own docs: Claude Code
`~/.claude/CLAUDE.md`, Codex `~/.codex/AGENTS.md` (`CODEX_HOME`; 32 KiB load limit), Gemini CLI
`~/.gemini/GEMINI.md`, Qwen Code `~/.qwen/QWEN.md`, OpenCode `~/.config/opencode/AGENTS.md`, Copilot CLI
`~/.copilot/copilot-instructions.md` (`COPILOT_HOME`), Amp `~/.config/amp/AGENTS.md`, and rule folders for
Auggie (`~/.augment/rules`) and Cline (`~/.cline/rules`). Kimi and Cursor have no on-disk global file;
Hermes keeps small agent-written memory files of its own. Windows paths are not documented by most and
are assumed to be the same folders under the user profile. The memory patterns worth taking next:
staged approve-or-reject for memory an agent proposes (Hermes), a hard split between rules a person
wrote and memory an agent generated (Codex), and a "what each agent loaded" view (Amp, Gemini).

**Built** · `955074f1e`, `448621e8d`. Settings › Agents › One memory for all your agents: write how you
like to work once, or Gather it from what your agents' files already say (each paragraph once), Save,
and Share it into the agents you tick. It goes in as one marked block; the rest of each file is the
person's. The round-four review found that the first cut was not the exact inverse it claimed (a stray
marker could eat text, UTF-16 files were corrupted, links were written through, a folder at the path
broke the whole sync, the added separator was guessed back). Now: strict reads (refused with what the
file is), the separator recorded and removed exactly, a created file deleted on Remove, the backup the
original bytes, writes through a rename, markers refused in the shared text, and a "removed elsewhere"
state. Locked by a test that shares and removes across ten file shapes (LF, CRLF, mixed, BOM, blank,
trailing spaces) and checks the bytes.

Checked read-only on this machine: Codex and OpenCode each have an 11,199-byte AGENTS.md, which are the
generated copies of `~/AGENTS.md` (Gather proposes them once). A Share into those files would be wiped at
the next regeneration; the row then says "Removed elsewhere". Nothing was written to the real home.

## 3.9 Round five (branch `feat/plug-and-play-5`): ready in one click

**Built** · `7b087dffc`, `63d55ba2c`. The welcome screen reads what is already on the machine and
lists it in words: signed-in agents, installed catalog agents, and (when no model is set up) the first
provider whose key is in the environment, with the model that will answer and its price. Set up
everything connects every ready agent, remembers the signed-in one as the chat's agent, and saves the
model to read its key by name. Agents that need a sign-in or an install are named and left to their own
rows. With two or more things ready it replaces the single "Use ..." button. This is the "detect, don't
ask" and "import what already exists" pattern from the round-four research (Conductor, Zed, OpenCode).

**Checked live** in a fresh store on this machine: it found Codex (signed in), Claude Code (needs sign-in,
left alone), Cursor and Hermes (installed) and `NEBIUS_API_KEY`. One click registered codex, cursor and
hermes in `agents.json` and saved the Nebius model in `ai.json` with `apiKeyEnv` and no key.

**Review** (fresh Opus, fixed with tests): a failed read of the model settings would have offered a model
whose save replaced every saved model; the chat was left with no agent after connecting several; a run
where everything failed moved on and hid the reasons; the model was not named before the click; writes
continued after the card left. Not fixed: the welcome screen reads the agent catalog and the model
settings twice (once for More agents, once here).

## 4. The stated edge (what is out)

- Downloading a registry agent's **binary archive** (OpenCode, Goose, Kimi): offered as "Get it"
  with the vendor link. The registry carries `sha256`; a verified fetch is the next slice.
- **Terminal Auth** methods (an interactive `--setup` run): listed, not yet run in the embedded
  terminal. Agent Auth (the agent opens the browser) works.
- No real browser sign-in was completed in testing: that signs into the owner's accounts.
- Profiles do not switch the model (`model:` in a file is shown, not applied) or the tool list.

## 5. Next slices, ranked by value for effort

1. **Verified binary install from the registry** (sha256-checked archive into the user store), so
   OpenCode, Goose and Kimi connect with one click like the npx agents.
2. **Terminal Auth in the embedded terminal** (`TerminalPane` already runs vendor sign-ins).
3. **Provider catalog from models.dev**, cached offline, filtered to tool-calling models, with env
   keys detected the way `keySource` already does.
4. **Recipes:** a profile plus typed parameters rendered as a form (Goose's model), saved in
   `.sequence/recipes/`, runnable from the palette and from goals.
5. **Remote runtimes:** a runtime interface (local, Docker/devcontainer, then a hosted sandbox such
   as Daytona or E2B), each task on its own branch, returning a diff or PR plus the live event stream
   Sequence already renders. Gate: one agent turn run in a container against the shopfront fixture.
6. **Worktree-per-task board:** the existing chat worktrees as cards with live state and the diff as
   the review screen.
7. **Plugin bundles:** one manifest that adds profiles, skills, MCP servers and a catalog entry,
   with the context cost shown before enabling.
