# Sequence 0.1.4 demo media: what is real and what is replayed

Recorded with `node tools/demo/record-014.mjs --all` (see the header of that file for per-clip flags).
Everything here was recorded against the real built 0.1.4 app (`packages/analyzer/dist/cli.js app`) in headless Chrome,
dark theme, 1920x1080 for video and 1440x900 (some 1024x700, some light) for stills.

## How the video is made (v3, 2026-10-10)

- The window is 1920x1080 CSS px rendered at 2x: a browser-wide `--force-device-scale-factor=2` with no per-context
  viewport override is the one setting under which the CDP screencast hands over 3840x2160 frames (a context
  `deviceScaleFactor: 2` still screencasts at CSS size; measured). The recorder checks the window is exactly 1920x1080 at 2x.
- Captured with CDP `Page.startScreencast` (every painted frame, with its timestamp), not Playwright's `recordVideo`
  (a fixed ~25 fps that dropped frames: the old choppiness). At 4K a new frame arrives about every 27 to 38 ms (median per clip).
- Faster: the rig performs each scenario about 1.4x slower than the old pacing and the frames are played back 2x faster
  (`--speed 2`, `--net 1.45`), so the clips run about 1.45x faster than before while each second of output motion still
  carries roughly 50 to 70 captured frames, resampled to a constant 60 fps on their real timeline. Waits on a replayed answer
  play a further 4x faster.
- Zoomed in on the action: each scenario marks what to frame (`rig.focus(...)`: the map, an Orders card, a menu, the
  files tree, the chat answer). A virtual camera eases between framings (smoothstep, 0.55 s) with zoom up to 2x, done by one
  ffmpeg `perspective` warp per frame over the 2x frames (sub-pixel sampling, so a slow zoom does not step), then scaled
  to 1920x1080. At 2x zoom the output is 1:1 with the capture, so zoomed text stays sharp.
- Dead time cut: `freezedetect` (-86 dB on a 1920-wide copy) finds every stretch where nothing moves; each keeps 0.6 s
  (`--hold`), the rest is cut; the last frame holds 1 s.
- No hover in transit: while the cursor glides nothing under it takes hover (a `pointer-events: none` rule on only during
  the glide, never while a button is held), so a row the pointer crosses cannot light up for one frame.
- Posters: every `<clip>.jpg` is that clip's first frame.
- Encode: H.264 high, yuv420p (TV range), CRF 21 for clips, 25 for both tours, maxrate 6 Mb/s, `+faststart`, no audio.
- Gate: `tools/demo/flicker-check.py` ends every recording run (alone: `--gate`). It fails the run on any one-frame flicker
  (a frame that differs from both neighbours while they match) and on a poster that is not the first frame. Frames inside a
  camera move are skipped (counted as camera_frames): a pan legitimately makes thin lines jump away and back across three
  frames (a plain whole-pixel crop pan of a still frame is flagged on 118 of 120 frames), so the recorder writes each clip's
  and tour's exact move intervals for the gate. Positive control: the earlier reasoning.mp4 is still caught (2 flicker
  frames, 1.85 s and 7.43 s). Known limit: a blink during a camera move is not checked.

## The common ground (true for every clip)

Real:
- The app, its UI code, and its server. Nothing is a mock-up or a re-drawn recreation.
- The repository: a neutral copy of the `shopfront` fixture (`packages/analyzer/test/fixtures/shopfront`: gateway TS,
  orders Py, payments JS, shipping Go, invoices Java, inventory Py, notifications Py, edge nginx; Postgres, Redis, one topic),
  initialised as a git repo with two real extra git worktrees (`feature/request-ids`, `fix/payment-retry`),
  one modified file (`gateway/src/index.ts`), one modified doc, one untracked file (`gateway/src/routes/health.ts`) and a
  `docs/guide.md` with a Mermaid diagram. Two small fixtures (`plainapp` as `notes-app`, `spa-dashboard` as `dashboard`) are the other workspaces.
- The architecture map is a real scan of that repository, the Files tree, git status colours, diffs, markdown preview and
  Mermaid rendering are live, the terminal is a real shell in the repo, and the whiteboard and board interactions are live.

Replayed (no model was called anywhere; no money spent):
- Any answer from a model or an agent. It is a scripted transcript fed into the page through Playwright route mocks
  (`/api/ask/stream`, `/api/acp/run-node`, plus capabilities, agent list and run history). The page renders those events with
  the same code it uses for live ones. The answer text was written by hand for the demo (and checked against the real code, see per clip);
  it is NOT model output. Model and agent names on screen ("Sonnet 5", "GPT-5", "Claude Code") come from the mocked capabilities list.
- Chat titles in the Workspaces tree (other than "New chat") are pre-seeded empty chats, written into the repo's `.sequence/sessions`.

Neutral by construction: home folder `C:/seqdemo/home`, `SEQUENCE_USER_DIR` empty, no real chat history, account, key or path.
Clip start/end are trimmed so the first frame is the app already loaded. A synthetic cursor and click ring are drawn in the video pass (the browser records none).

## Clips (`site/public/demo/v014/<name>.mp4` + `<name>.jpg` poster)

All 1920x1080, 60 fps. terminal and reasoning are no longer in the set (owner, 2026-10-10); their files and stills from the
previous round were deleted from site/public once the site stopped using them (2026-10-10).

| Clip | Length | Real | Replayed or mocked |
|---|---|---|---|
| workspaces | 5.6 s | Workspaces tree with three real projects, fold/unfold, switching project reloads that project's real board | Chat titles under each workspace are seeded empty chats |
| connect-agent | 17.5 s | The model menu with three groups (Local, Claude, OpenAI) and the effort slider; one chat each on Claude Code (Sonnet 5), Codex (GPT-5) and a local model (Qwen3 8B), started one after the other with New chat, each answer still arriving while the next chat starts; the sidebar's per-chat agent marks | The agent list, both agents' model lists and the saved local model are mocked; all three answers are replayed. Only the open chat shows a Working badge in the sidebar (the app does not badge background chats) |
| architecture | 8.8 s | Real scan, zoom onto Orders, the view menu (Map, Grid, Hotspots from the demo repo's thin git history), card selection and its chat chip | none |
| ask-in-place | 5.9 s | Hover handle and right-click menu on a whiteboard box, the ask popover, the reference chip in the chat | The answer |
| ask-chat | 5.8 s | The same on an Architecture card (the whiteboard ask is already in the chat, done off camera) | The answer, hand-written from the real scan |
| whiteboard-draw | 6.7 s | Whiteboard tab, composer, the diagram laid out and fitted, a box dragged with the default tool. While the diagram arrives the board zooms onto its first box; the camera stays on the chat for that moment | The draw request answered by the draw tool's recorded `board:item` stream (`tools/demo/fixtures-014/wb-agentic-loop.json`); the reply text is hand-written |
| research-whiteboard | 7.7 s | Not a codebase: a research loop (question, literature search, hypothesis, experiment, analysis, write-up) drawn on the whiteboard; one box moved by hand | The drawing is a hand-authored `board:item` stream in the draw tool's event format (`record-014-v3-scenarios.mjs`), not model output; the reply text is hand-written |
| files | 7.2 s | Files tree with real git status colours, the one-line breadcrumb over code, Markdown preview with its Mermaid diagram and table | none |
| agentic-workflow | 11.9 s | Ask in chat for a workflow, then the Agents tab: the workflow, its run, the graph with each node's state as the run moves: plan done, edit, tests fail, the loop goes round, tests pass, the graph check, done | The agent turn that creates and starts the workflow is replayed; the workflow, the run and every node state are mocked on a clock (`STEPS` in `record-014-v3-scenarios.mjs`), polled by the real Agents surface |
| agents-workflows | 8.5 s | Agents tab Tree/Workflows layout, Context and Output, the workflow graph with its loop back-edge, Territories listing the two real git worktrees | Run history and token figures are mocked (illustrative, not measured) |
| chat-drawings | 9.7 s | Inline sequence diagram, donut and bar cards drawn by the real visual kit from the transcript's specs | The agent turn (specs grounded in the real code and scan) |
| rewind | 6.8 s | Edit from here: hover control, confirm row, Undo note, the message back in the composer, the rewritten message as a new branch | Both answers and the server-side rewind call |
| files-look | 5.6 s | A cut of `files` for the site's closer-look card, nothing new recorded: 4.2 s held on the clip's frame at 5.85 s (Files tree with git status colours, guide.md rendered with its Mermaid diagram and table) with an eased 1.3x camera move onto the diagram (zoompan over a 2x lanczos upscale), a 0.3 s cross-fade, then `files` from 4.15 s to 5.85 s (index.ts code view to the rendered guide), so the loop joins on the same frame. Same encode as the clips; poster is its first frame | none |

## Tour

Two cuts, both 1920x1080 at 60 fps, joined with 0.3 s cross-fades, no fade at either end (the poster is the first frame).

- Hero cut: `report/media/sequence-0.1.4-tour.mp4` (+ `.jpg`), 15.0 s, 2.4 MB. Six short windows, opening on the map
  zoomed onto Orders: architecture, connect-agent (the model menu), research-whiteboard, agentic-workflow (the run going
  green), ask-in-place, files (the Markdown preview). Windows are `TOUR_HIGHLIGHT` in record-014.mjs.
- Full: `report/media/sequence-0.1.4-tour-full.mp4` (+ `.jpg`), 98.7 s, 11.5 MB. The twelve clips above in full, in that order.

Copies for the site: `site/public/demo/v014/tour.mp4` / `tour.jpg` (hero cut) and `tour-full.mp4` / `tour-full.jpg`.

## Stills (`site/public/demo/v014/stills/`)

Naming: `<name>.png` is 1440x900 dark; `<name>-1024.png` is 1024x700 dark; `<name>-light.png` is 1440x900 light.
Stills come from a separate fast pass of the same scenario, so a replayed answer is shown complete.

| Still | Caption |
|---|---|
| workspaces-tree | The Workspaces tree: three projects, each with its chats (also -1024) |
| workspaces-folded | A workspace folded away in the tree |
| workspaces-switched | Switching to another project loads that project's own architecture (also -1024) |
| architecture-map | The architecture map of the shopfront repo, scanned from its code (also -1024, -light) |
| architecture-card-selected | A card selected; it also becomes a reference chip in the composer (also -1024) |
| architecture-view-menu | The single view dropdown: Map, Grid, Diff, Hotspots (also -1024, -light) |
| architecture-grid-view | Grid view: who calls whom, with counts |
| architecture-hotspots-view | Hotspots view, ranked from git history and centrality |
| architecture-board-controls | The board controls panel: path, neighbours, layout, groups, keys (also -1024) |
| architecture-neighbours-only | Only the neighbours of the selected card, with edge labels (also -1024) |
| architecture-groups-expanded | Groups expanded with "Collapse all" offered (folding) |
| whiteboard-empty-toolbar | The empty whiteboard with its floating toolbar, select as the default tool (also -1024, -light) |
| whiteboard-agentic-loop-drawn | The agentic loop, drawn and laid out from the request (also -1024, -light) |
| whiteboard-select-drag | A box picked up and dragged with the default select tool |
| ask-in-place-hover-handle | Hovering a whiteboard box shows its Ask handle (also -1024) |
| ask-in-place-context-menu | Right-click a box: Ask about this (also -1024) |
| ask-in-place-popover-chip | The ask popover with the item's reference chip (also -1024) |
| ask-in-place-chat-reference-chip | The question lands in the chat with the reference chip (also -1024) |
| ask-in-place-architecture-menu | The same on an Architecture card: Ask about this, Focus, Show inside, Ask an agent |
| ask-in-place-architecture-answer | An architecture question answered in the chat with its chip |
| connect-agent-menu | The model menu: Local, Claude and OpenAI groups, effort slider |
| connect-agent-sidebar | Three chats on three agents, a local model answering in the open one |
| agentic-workflow-asked | The agent created and started the workflow from one request |
| agentic-workflow-green | The workflow run done: every node green after one failed test round |
| research-whiteboard-drawn | A research loop drawn on the whiteboard |
| zoom-map | 3840x2160 (1920x1080 at deviceScaleFactor 2, page.screenshot), also .webp q85: the whole architecture map beside the chat column, settled |
| zoom-node | Same size: the Orders card selected, its Ask chip showing |
| zoom-answer | Same size: the chat answer about what depends on Orders (replayed answer), settled |
| files-tree-status-colours | Files tree with status colours from git (modified amber, new green) (also -1024, -light) |
| files-code-header-breadcrumb | One-line breadcrumb header over the code view (also -1024, -light) |
| files-markdown-preview-diagram | Markdown preview with a rendered Mermaid diagram and a table (also -light) |
| files-new-file | An untracked file, marked as such |
| terminal-prompt-toolbar | The terminal: one-line prompt and toolbar (also -1024) |
| terminal-after-commands | Real commands run in the terminal (also -1024) |
| agents-tree-context-output | The Agents tab: Context and Output figures over the run tree (also -1024, -light) |
| agents-tree-run-detail | A run opened in the tree |
| agents-several-at-once | Runs from Claude and Codex overlapping in time, subagents nested |
| workflows-list-collapsed-runs | Workflows list with collapsed runs and Territories (also -1024, -light) |
| workflows-graph-loop | A workflow's graph with its loop back-edge (also -1024, -light) |
| workflows-territories | Territories: the main checkout and two real parallel worktrees |
| reasoning-slider-open | The reasoning slider, Faster to Smarter, at Medium (also -1024, -light) |
| reasoning-slider-faster | The slider at its lowest notch (also -1024) |
| reasoning-slider-smarter | The slider at its highest notch with the blue fill full (also -1024, -light) |
| reasoning-working-ascii-radar | The ASCII radar loader while the agent works (also -1024) |
| reasoning-answer | The finished turn: thought, tool row, answer |
| chat-drawing-streaming | A drawing being worked on in chat (also -1024) |
| chat-inline-sequence-diagram | An inline sequence diagram in chat, read from the code (also -light) |
| chat-kit-donut-card | A chart-kit donut card: connections by kind (also -light) |
| chat-kit-bar-chart | A chart-kit bar card: source files per service (also -1024) |
| rewind-conversation | A conversation before rewinding (also -1024, -light) |
| rewind-edit-from-here-hover | The Edit from here control appears on hover (also -1024) |
| rewind-confirm-row | The confirm row: this message and everything after it leave the chat (also -1024, -light) |
| rewind-draft-back-in-composer | The message is back in the composer; "Went back to before that message. Undo" (also -1024) |
| rewind-new-branch | The rewritten message going on as a new branch (also -1024) |

Known app behaviours visible in a few stills (not edited out): the "Jump to latest" pill floats over a scrolled chat; in `-1024` the Files and Agents panes are
narrow and clip long lines (three 1024 stills where that read as broken were dropped).

## Not done

- A light-theme video (light is covered by stills only).
- Import of old Claude Code/Codex chats, restart/continue and the settings theme switch have no clip (see above).
- No clip uses a live model: Ollama was not answering on 127.0.0.1:11434 and paid calls were out of bounds.
