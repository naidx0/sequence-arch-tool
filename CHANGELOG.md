# Changelog

What changed in each release of Sequence, newest first. The full notes for a release are on its GitHub release page (https://github.com/naidx0/sequence-arch-tool/releases) and in `docs/releases/`.

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
