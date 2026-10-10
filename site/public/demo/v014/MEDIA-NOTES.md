# Sequence 0.1.4 demo media: what is real and what is replayed

Recorded with `node tools/demo/record-014.mjs --all` (see the header of that file for per-clip flags).
Everything here was recorded against the real built 0.1.4 app (`packages/analyzer/dist/cli.js app`) in headless Chrome,
dark theme, 1920x1080 for video and 1440x900 (some 1024x700, some light) for stills.

## How the video is made (since 2026-10-10)

- Zoomed out: the browser viewport is 1920x1080 CSS px, so the whole app is on screen (the sidebar and chat column are
  no longer folded away for the video pass; stills keep their old framing).
- Captured with CDP `Page.startScreencast`, not Playwright's `recordVideo`. `recordVideo` writes a fixed ~25 fps webm and
  drops the frames in between, which is what made the old clips choppy. The screencast hands over every frame the page paints
  (measured: one frame per 60 fps cursor step, motion cadence p50 10.5 to 13.7 ms per clip) with its wall-clock timestamp.
- Smooth 60 fps: the frames are laid on their real timeline with ffmpeg's concat demuxer and resampled to a constant
  60 fps, so motion keeps its true timing. The cursor glides with a time-based cubic ease, one step per ~16 ms.
- Crisp: capture is 1:1 at 1920x1080, no scaling. `deviceScaleFactor: 2` was tried and gave byte-identical 1920x1080
  screencast frames (headless Chrome screencasts at CSS-pixel size), so there is no 2x source to downscale and no 4K master:
  an upscaled master would add bytes, not detail.
- Dead time cut: `freezedetect` (-86 dB, which ignores a blinking caret but sees a moving cursor) finds every stretch where
  nothing moves; each keeps 0.6 s (`--hold`) and the rest is cut; the last frame holds 1 s.
- Waits on a replayed answer (the spinner turning in ask-in-place and ask-chat) play 4x fast; the answer itself plays at normal speed.
- No hover in transit: while the cursor glides, nothing under it takes hover (a `pointer-events: none` rule that is
  on only during the glide, and never while a button is held, so drags still work). A row the pointer crosses on its way
  can no longer light up for one frame; the target takes its hover on arrival.
- Posters: every `<clip>.jpg` is that clip's first frame, so the site's swap from poster to playing video does not jump.
- Encode: H.264 high, yuv420p (TV range), CRF 21 (hero tour CRF 24, full tour CRF 23), maxrate 6 Mb/s, `+faststart`, no audio.
- Gate: `tools/demo/flicker-check.py` runs at the end of every recording run (and alone with `--gate`). It fails the run on
  any one-frame flicker (a frame that differs from both neighbours while they match each other) and on any poster whose
  mean difference from the first frame is 3 or more (0 to 255 gray, 480x270). Its positive control: the previous
  reasoning.mp4 is caught with 2 flicker frames (1.85 s, 7.43 s).

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

| Clip | Length | Real | Replayed |
|---|---|---|---|
| workspaces | 8.7 s | Workspaces tree with three real projects (opened through the app's own path picker), fold/unfold, switching project reloads the real board of that project | The chat titles under each workspace are seeded empty chats |
| whiteboard-draw | 12.3 s | Whiteboard tab, the floating toolbar, select/drag as default (the Model box is picked up and moved by real mouse input), the layout and the animate-in of the diagram | The "draw the agentic loop" request is answered by a replayed `board:item` event stream (`tools/demo/fixtures-014/wb-agentic-loop.json`, the draw tool's recorded output, captured by the whiteboard lane) delivered 140 to 520 ms apart; the one-line reply text is hand-written |
| ask-in-place | 7.7 s | Hover handle and right-click menu on a whiteboard box, the ask popover, the reference chip with its snapshot in the chat bubble | The answer |
| ask-chat | 7.7 s | The same on an Architecture card: right-click menu, the ask popover with the card's chip, the question in the chat (the whiteboard ask is already in the chat, done off camera first) | The answer, hand-written from the real scan (gateway to orders over HTTP; orders to payments, inventory, postgres, publishes order.created; shipping and notifications consume it) |
| architecture | 12.7 s | The whole clip: real scan, one view dropdown (Map, Grid, Hotspots; Hotspots reads the demo repo's real git history, which is a single commit plus the working-tree edits, so its ranking is thin), card selection and the chat reference chip it adds, fit | none |
| files | 9.8 s | The whole clip: one-line breadcrumb header, status colours from real `git status` (M amber, ? green), code view, markdown preview with a rendered Mermaid diagram and table | none |
| terminal | 7.6 s | The whole clip: the terminal pane, one-line prompt, toolbar, real `git status -s`, `git --no-pager log --oneline`, `ls gateway/src` | none |
| agents-workflows | 10.1 s | The Agents tab and its Tree/Workflows layout, Context and Output figures, the workflow list with collapsed runs, the workflow graph with its loop back-edge, and Territories, which list the two real git worktrees | The run history (four runs across Claude and Codex, their token figures and the "Fix until green" and "Docs pass" workflow runs) is mocked data: the numbers are illustrative, not measured. Subagent labels are mocked |
| reasoning | 13.8 s | The Faster to Smarter slider with its blue fill (real component, real notches taken from the capabilities list), the ASCII radar loader while "working", the Thought and tool rows | The model list and the agent turn (hand-written text, scripted thought and a "Read gateway/src/lib/http.ts" tool row; the file exists and the claim in the answer is true of it) |
| chat-drawings | 13.1 s | Rendering of inline drawings and chart-kit cards: the sequence diagram, donut and bar chart are drawn by the real visual kit (`@sequence/schema` visual) from the specs in the transcript | The agent turn. The specs are grounded: the sequence is read off `gateway/src/routes/orders.ts` and `orders/app/routes.py`; the donut counts the 15 edges of the real scan by kind (HTTP 7, database 4, queue 3, gRPC 1); the bar chart counts source files per service from the repo at record time |
| rewind | 9.9 s | Edit from here: the hover control, the confirm row, "Went back to before that message. Undo", the message returning to the composer, the rewritten message going on as a new branch | Both agent answers and the server-side rewind call (`/api/sessions/:id/rewind` is answered by a mock; the page-side removal of the later messages is the app's real logic) |

Not recorded as separate clips (they appear inside the clips above): theme switch, Settings scrolling, "several agents at once" (visible as overlapping runs in the Agents tree, agents-workflows),
import of old Claude Code and Codex chats, restart/continue. Importing needs a real chat history on the machine and would show it, so it was skipped on purpose
(privacy), and restart/continue needs a live agent process; neither can be shown faithfully with replayed data. Light theme exists as stills (below), not as video.

## Tour

Two cuts, both 1920x1080 at 60 fps, joined with 0.3 s cross-fades, no fade at either end (the poster is the first frame).

- Hero cut: `report/media/sequence-0.1.4-tour.mp4` (+ `.jpg`), 34.3 s, 2.8 MB. The best 3.5 to 4.2 s of ten clips, opening on
  the architecture map beside the chat (the poster): architecture, workspaces, ask-in-place, chat-drawings, whiteboard-draw,
  files, terminal, agents-workflows, reasoning, rewind. Windows are the `TOUR_HIGHLIGHT` table in record-014.mjs.
- Full: `report/media/sequence-0.1.4-tour-full.mp4` (+ `.jpg`), 110.1 s, 6.0 MB. All eleven clips in full, in walkthrough order.

Copies for the site: `site/public/demo/v014/tour.mp4` / `tour.jpg` (hero cut) and `tour-full.mp4` / `tour-full.jpg`.
Same real/replayed split as the clips they are cut from.

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
