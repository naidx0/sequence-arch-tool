# Changelog

What changed in each release of Sequence, newest first. The full notes for a release are on its GitHub release page (https://github.com/naidx0/sequence-arch-tool/releases) and in `docs/releases/`.

## 0.1.8.4

Release notes: [docs/releases/v0.1.8.4.md](docs/releases/v0.1.8.4.md). Published 2026-10-21 on the [v0.1.8.4 release](https://github.com/naidx0/sequence-arch-tool/releases/tag/v0.1.8.4).

### Highlights

- A new sidebar: navigation rows for Workflows, Components, Profiles and Skills, each with a hover card that previews an item and launches a workflow. Every chat lives under its workspace folder.
- Spaces are per chat, and a workflow you launch is watched live on the Agents surface.
- The chat overview and file buttons float over the pane; Focused or Detailed tool calls is one control, in Settings > General.
- Coming back to the Architecture tab no longer shows the cards jumping: 12 different arrangements before the final one are now 0, and 446 ms to the final one is now 99 ms (`docs/bench/PERF-0.1.8.4.md`).
- The desktop app starts its engine before it builds the window and no longer waits for the first project read.

### Fixed

- The board's tab strip holds only tabs for screen readers; the open drawer and its scrim stack above the board dock; the status bar is a status region; the narrow Settings navigation fades where more is scrolled away.
- Stop closes the provider connection on Node 20 and 22 as well as 24.
- The scanner no longer draws three empty message-topic nodes for the engine's own network diagnostics.
- Compose and Kubernetes scan evidence uses `/` in paths on every operating system; scans list directories in one order everywhere; `run_command` kills its process group on abort or timeout on POSIX.

### Known limits

- Installers and update checksums are not signed. Windows and Linux packages were built locally; packaged smoke testing is in progress. macOS packaging and real agent sign-in have not been run for these notes.
- Streaming, chat-switch and first-board timings are unchanged within the run-to-run spread; the first-page script grew by 554 bytes over the integration snapshot.

## 0.1.8.2

Release notes: https://github.com/naidx0/sequence-arch-tool/releases/tag/v0.1.8.2

### Highlights

- Plug and play agents: every ACP coding agent listed with its real logo and one Connect, one-click checksum-checked installs, a Docker sandbox for npm agents, 189 model providers with keys read by name from your environment, and one shared memory for all agents.
- Built-in components: `/be-ambitious` (with a composer Rewrite and a Deepen prompt workflow step) and REA, Reverse Engineer Anything, as an optional component with `/reverse-engineer` and a read-only `@reverse`.
- It feels native: buttons press and settle, panels slide in and out, sheets swipe closed on touch and narrow windows, and Settings, the welcome screen, Search, Files and the model menu were reworked against the design system with real vendor logos.
- Opening or rescanning a project no longer freezes the app. While a scan runs, the engine answers the app's status check in 1.8 to 2.8 ms (95th percentile) on all four measured scan paths; before, the same check waited 26 to 36 s (the 0.1.9 program ledger, which stays in the private workshop repository).
- Scans are much faster. The cold scan of Sequence's own monorepo went from 21.4 s to 7.2 s, and re-reading after one edited file from 22.5 s to 0.86 s; the engine settles at 154 MiB after a scan (the 0.1.9 program ledger, kept private, and `tools/ci/timing-ratchet.json`).
- Work survives. A goal or agent run stays bound to its own project when you switch projects and come back, and a second Build goal run gets its own worktree instead of writing over the first.
- The chat remembers. History is rebuilt on the server, older turns are summarized inside the model's real window, and a context ring shows what is in use.
- The board and the file tree open faster and stay smooth (numbers under Faster).

### New

- Files: a function count on each file row, a line saying how many source files outside every service were not read, reveal-in-Files when you click a card on the board, and a group-by-service view that reaches every service.
- Right-click on the board: Find callers, Write a test and Refactor, beside Explain. In the terminal, "Ask about this output" sends the command, the folder and the output to an agent.
- API keys already set in your environment (ANTHROPIC_API_KEY, OPENAI_API_KEY) count as a ready model; the key itself is never shown or stored by Sequence.
- When a project changes on disk, a notice offers Rescan and refreshes by itself; opening or switching a project shows "Reading N of M files…".
- Goal runs: reasons shown, live turns, a plan editor, /goal mid-turn, a status bar that says where a run works and warns when two runs overlap. Stop and restart are safe.
- Agent turns: files appear as they are written, diffs on edits, rewind marks, a steer bubble, one permission bar, and less clutter.
- "Test model" after you save a model; when a CLI or bridge install fails, the "fix it" prompt carries the failure output.
- The user data folder is now named Sequence; your existing settings and sealed keys move over once and keep working.
- Installer file names now carry the full version (Sequence Setup 0.1.8.2.exe).

### Fixed

- Python projects: imports of a package now count the package's own `__init__.py`, and imports across service roots resolve. On a benchmark of held-out repos, "what breaks if I change X" recall rose from 62.4 % to 96.7 % on sqlfluff, 87.6 % to 100 % on flask, and 88.6 % to 97.9 % pooled over five repos (`docs/bench/RESULTS-0.1.9.md`).
- Library-shaped projects are read: the scanner read 12 of sqlfluff's 476 files before; it now reads 460 of them (`docs/bench/RESULTS-0.1.9.md` and the private program ledger).
- Listing git branches on a repository with 338 branches took 45 s; it takes 0.7 s cold and 11 to 16 ms when nothing changed (`docs/bench/PERF-0.1.9.md`).
- A draft chat no longer races the boot reads; the built-in chat choice survives a reload; Revert removes files an agent created; steers persist; the branch chip follows branch changes made outside Sequence.
- 420 px wide chat fills its width; the context ring panel stays on screen; Recent rows are readable; grouped Files labels never read the same.
- The desktop shell stops the whole engine process tree on quit; before, a child could outlive it on macOS and Linux.

### Faster

All from `docs/bench/PERF-0.1.9.md` (seeded project with 203 chats, a 500-turn chat), medians:

- Board drawn on a cold start: 736 / 825 ms to 422 / 447 ms; on a warm reload: 543 / 533 ms to 252 / 264 ms.
- Total blocking time at start: 237 / 310 ms to 3 / 7 ms; longest start-up task 165 / 183 ms to 53 / 55 ms.
- Boot requests: 42 to 34.
- Files, group by service with every group open (1,225 rows): the 6.9 s freeze is now 58 ms, and scrolling went from 25 to 53 fps.
- Opening a 405 KB source file: 632 ms to 150 ms of blocked time.
- Reopening the Architecture view: 205 / 193 ms to 48 / 52 ms. Board zoom with a large board open: 39 fps to 54 fps.

### Measured against grep (indicative, see the limits)

From `docs/bench/RESULTS-0.1.9.md` (six held-out repos; the machine was shared, so times are not quoted):

- Which files does a change touch: 300 questions, Sequence's `find_files` hit the right file in its top five 89.7 % of the time, against 71.3 % for the strongest fair grep baseline (+18.3 points). On excalidraw the gap is +6.0 points and not significant.
- What breaks if I change X: one call, recall 97.9 % at depth 4 against 91.9 % for a grep walk that takes about 108 calls; the recall gap is not significant, the call count is the difference.

### Not in this release

- Update checksums are not signed: there is no signing key yet, so updates are verified against an unsigned `SHASUMS256.txt` only.
- The Linux AppImage static runtime and the .deb sandbox change were built but not run on a real Linux machine.
- The head-to-head with Codex on a frontier model was not run (the harness was blocked); nothing in these notes claims it.
- Auto-drawing the board when a project opens was left out on purpose: it would spend an agent turn on every open.

## 0.1.8.1

Release notes: https://github.com/naidx0/sequence-arch-tool/releases/tag/v0.1.8.1

### Highlights

- Sequence opens at once. A large project no longer holds the window back while it is read; the window shows "Reading N of M files…" and the app never quits because a read is slow.
- Connecting a model never loops. Ready options come first with one button, and "Connect a model" goes to the model setup instead of back to the list.
- A question asked before anything is connected is kept. One "Connect a model to run this" card connects in place, then runs the question in the chat it was asked in, without retyping.
- API keys stay out of your projects. They are stored per user, encrypted with the system's own protection where it is available (DPAPI on Windows, Keychain, libsecret). A key found in a project folder is moved out to a file only your user can read.

### New

- Sign-in for Claude Code and Codex opens in your browser, waits with Cancel and Retry, and moves on by itself. Claude Code's sign-in page still ends with a code; paste it into the one field shown.
- "Resume goal": a /goal run the app's restart stopped continues at its first open step, on the same agent.
- Clone any https or ssh git address into exactly the folder you choose.
- Folders outside your home folder: "Allow this folder" adds one, without opening your whole drive.
- Board: Undo after Clear board (a toast, and Ctrl+Z); one click picks the last shape and the tool returns to Select after one shape (double-click to keep it); right-click menus with Ask agent about this, Explain, Duplicate, Bring to front, Copy as image and Delete, also on an empty board.
- Settings "Read more" opens the release notes; CHANGELOG.md is in the repository.
- `pnpm test:release` drives the installed app through first run, connect, folders, clone, tabs, terminal resize, board undo and /goal, and fails the release on startup time, server size or a key found in a project.

### Fixed

- Tabs switch the pane on a click; a split opens only with Ctrl+click, the Split button or a drag.
- The terminal re-flows cleanly after a resize; a narrow pane scrolls sideways instead of wrapping mid-word.
- Errors from the engine use its own sentence and a next step ("Check the address", "Choose a folder") instead of "The engine answered 400".
- An empty folder says "This folder has no code Sequence can read yet", with Open another and Start from a sketch.
- Maximize hides the sidebar and keeps the tabs; Show inside opens readable (at least 80 %); /goal reads the same in the menu and the chip.
- Colour swatches have names, secondary text meets 4.5:1 contrast, truncated names show in full on hover, and the names are Spaces and Board throughout.
- find_files ranks test files lower unless the question is about tests.
- The site describes what the board's Draw does today (88.1 % right shape on a fresh test set), not the trained model it does not use yet.

### Lighter

- The bundled engine is 49 MB, down from 90 MB.
- At most three agent sessions stay open, closed after three idle minutes, never in the middle of a turn.
- A second question in a row reuses the project digest instead of rebuilding it.

### Not in this release

- Engine work (scans in worker threads, a multi-repo engine, server-side chat history) is planned for 0.1.9.
- The Linux AppImage still needs libfuse2 on systems without it; run it with `--appimage-extract-and-run` there.
- Installer file names keep 0.1.8 because the packager accepts only three-part versions; the app, the tag and these notes say 0.1.8.1.

## 0.1.8

Release notes: https://github.com/naidx0/sequence-arch-tool/releases/tag/v0.1.8

### Highlights

- Components: 38 ready-made skills now ship inside the app. They are not loaded by default; the agent pulls one in at run time as a tool, so your context stays small. Three modes: auto, approval cards, or off. `/components` and the + next to the chat box manage them.
- Spaces replaces the whiteboard. Agents can draw with colours, lines, frames and SVG, and Spaces can hold scenes and video.
- Free web search and fetch for every engine (Claude, Codex and Sequence's own model). No key, no account.
- Mac: updates download only what changed, and Cmd+C and Cmd+V work.

### New

- Components come in five groups (design, visual and video, workflow and eval, ML and research, security). A big component can hold sub-components. Topic words such as "reverse engineer" or "how an application works" make a component an option the model can offer. Reverse engineering always asks first, with Yes or No (regular workflow). Switching components off in Settings or with `/components off` stops all of it. Each ships with its licence; two without a licence are links only.
- Spaces drawing tools for agents: palette colours, stroke width, dashes, arrowheads, paths, frames, sanitized SVG items, scenes and video, composed into diagrams.
- `/goal` works on Claude and Codex chats in an open project.
- A coverage line under agent answers for Claude and Codex runs, listing the files the run read.
- Branch switching from the app. The architecture board rescans after a switch, including a switch made in the terminal. Files show a status mark for the current branch.
- Review separates unstaged changes from staged ones.
- Export from the app: the board menu has export entries for Mermaid, a matrix and an architecture note.
- A switch in Settings stops every automatic update check to GitHub.
- A memory summary in Settings.
- Cursor rules are found alongside skills.
- The settings payload reports real tool counts, and Settings explains the board tools, what a turn costs and what auto-compaction does.
- Handing a chat to Sequence's own model carries the agent's turns with it.
- Chat search looks inside messages, not only titles ("In messages (this project)").
- Switching projects no longer reloads the page; switching back to one of the last three is near instant.
- Settings and layout survive a changed port: they are copied to the app's own store.
- First run offers a local model that already fits this machine.
- The Install button installs Claude Code and Codex with their vendors' own installers and shows a failure word for word.
- Spaces: a drawing shows as a small inline preview drawn from the Space itself, with Open on surface; workflow loops render inline; a service node can generate an admin or customer page flow grounded in the code.
- The app reads the system proxy on Windows and macOS.

### Fixed

- Security: on Windows, a request for `.SEQUENCE/...` (any letter case) could read the project's private settings, including an API key. Reserved folders are now matched case-insensitively.
- The context meter no longer shows a running total as context, the bar and the Agents pane use one function, and the prompt prefix stays stable so the number does not swing on a near-identical prompt.
- Cmd+C and Cmd+V on Mac (the Edit menu was missing).
- The terminal starts in the project path every time: early input is held, the size is clamped and the path is checked, with a retry.
- Deleting a chat asks in the app, works with the mouse alone on Mac and no longer fires twice.

### Updates

- Sequence checks for an update shortly after launch, shows it in the status bar, and Restart to update finishes it. Windows installs silently and reopens; the portable zip and the Linux AppImage update in place; a deb install says which command to run.
- Before any update runs, the app checks the file against the release's published checksums itself.

### Mac

- Partial updates. The update downloads the zip with a blockmap, fetches only the changed parts and swaps the app in place. The first update after a dmg install downloads the full zip once. Builds are still not notarized with Apple.

### Updates and local server

- Versions with four parts, such as 0.1.8.1, are read end to end.
- `serve` listens on loopback only.

### Opt-in

- Putting the architecture map into Claude and Codex context (`mapToAgents`) is off until its A/B measurement is in.
- Components start in approval mode: a matching component is offered as a card and loads only on Yes. Auto and manual are in Settings.
- Asking find_files before the first search (`findFilesFirst`) and drawing short flows top to bottom (`boardFlowsTopDown`) are off until measured.

### Not in this release

- The agent-side token cost is not measured yet, so there is no figure for it.
- The A/B runs for the map in agent context, the find_files hook and the agent changes from the Pi study are built and sealed but not run yet; their settings stay off until they are.
- Update signing needs a key; until then the anchor is the HTTPS checksum file.
