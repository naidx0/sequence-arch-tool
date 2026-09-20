/**
 * THE web2 TESTID CONTRACT.
 *
 * IDENTITY is a `data-testid` — what a thing IS.
 * STATE is a named `data-*` attribute — what state it is IN.
 *
 * That split is inherited from Wave 0's re-anchoring of the v1 suite, and the
 * reason it exists is worth restating: the v1 scripts asked "is this card
 * selected" with `.arch-rf-card-selected` and "what zoom is the board at" by
 * parsing `.react-flow__viewport`'s computed transform. The first dies with the
 * stylesheet. The second was never this repo's contract to begin with — it
 * belongs to @xyflow. A testid and a `data-mode` survive a rebuild because they
 * are promises the product makes rather than by-products of how it was styled.
 *
 * THIS FILE IS THE INVENTORY, NOT A WISH LIST. Every entry below is emitted by
 * packages/web2/src today. An anchor for a surface that does not exist yet is
 * how a suite ends up green against nothing, so new anchors land WITH the
 * surface, not ahead of it.
 *
 * Wave 3's board and Wave 4's rail add their own groups here when they land.
 */

/** The three-region frame — item 2.3, rearranged by Decision 5
 *  (docs/OWNER-PLAN-2026-08-24c.md): sessions LEFT, chat CENTRE, board pane
 *  RIGHT, settings bottom-left of the sidebar. */
export const SHELL = {
  root: 'shell',
  /** STATE on `root`: 'wide' | 'medium' | 'narrow'. */
  breakpointAttr: 'data-breakpoint',
  /** STATE on `root`: the third region's width in px, as the model computed it
   *  — the board pane's when one is mounted, the workspace's otherwise. */
  canvasWidthAttr: 'data-canvas-w',
  chat: 'shell-chat',
  /** THE SESSIONS SIDEBAR — the left pane. The slice key that drives it is
   *  still 'rail'; this anchor names what the reader is looking at. */
  sessions: 'shell-sessions',
  sessionsClose: 'shell-sessions-close',
  rail: 'shell-rail',
  /** STATE on `chat` / `sessions`: 'column' | 'overlay'. A pane in mode
   *  'hidden' is NOT RENDERED — routes.ts: "Mount it or do not render it;
   *  there is no third option" — so absence is the assertion, never a hidden
   *  box. The BOARD pane carries no mode attribute: it exists exactly while a
   *  repository is attached, which is attachment state, not mode machinery. */
  modeAttr: 'data-mode',
  chatHead: 'shell-chat-head',
  chatClose: 'shell-chat-close',
  railHead: 'shell-rail-head',
  /** The pre-board region: hosts the boot surface until a repository is
   *  attached, then disappears in favour of the board pane. */
  workspace: 'shell-workspace',
  /** Decision 5's persistent settings entry, bottom-left of the sidebar. */
  settingsGear: 'shell-settings-gear',
  /** The frame's top line, spanning all three regions. It no longer shares a
   *  column with the canvas, so it is no longer a handle on any pane's extent —
   *  measure panes by their own testids. */
  appbar: 'shell-appbar',
  chatResizer: 'shell-resizer-chat',
  railResizer: 'shell-resizer-rail',
  /** THE ONE OVERLAY HOST. `ShellSlice.overlay` is a single nullable member
   *  rather than a boolean per surface because "two open at once is not a state
   *  the shell has a layout for" — this anchor is what makes that checkable
   *  from outside: a second host on screen IS the defect. */
  overlay: 'shell-overlay',
};

/**
 * THE C+B WORKSPACE — what the app actually renders.
 *
 * `App.tsx` passes `tabLayout` unconditionally, so every anchor in `SHELL`
 * above that is gated on `!tabLayout` — `shell-chat`, `shell-sessions`,
 * `shell-rail`, both resizers — matches NOTHING in the shipped bundle. That is
 * why the boot suite spent three rounds timing out on `shell-chat` before its
 * first assertion: it was addressing a layout the product does not build. The
 * dead branches are `resp-three-pane-shell-is-dead-code`'s to remove; this
 * group is the inventory of what is on screen instead, and every entry below
 * was read off the running bundle rather than off the source.
 *
 * The pane testids are irregular BY DESIGN (`App.tsx: workspacePaneTestId`) —
 * chat and architecture keep the names other suites already address.
 */
export const WORKSPACE = {
  /** The rail + main split, inside `shell-workspace`. */
  root: 'shell-cb',
  /** The persistent left rail: sessions, search, layout. */
  rail: 'workspace-rail',
  railSessions: 'workspace-rail-sessions',
  /** The pill bar. STATE on each pill: `data-on`, `aria-selected`, and
   *  `aria-disabled` / `data-refused` when the frame cannot seat another. */
  pills: 'workspace-tabs',
  pill: (id) => `workspace-tab-${id}`,
  /** Why a pill press did nothing — `role="status"`, so it is announced. */
  refusal: 'workspace-view-refused',
  /** Present only with two or more visible panes. Its `grid-template-columns`
   *  is written inline in px from the MEASURED body width. */
  split: 'shell-workspace-split',
  /** One visible pill's column. STATE: `data-pane`, `data-focused`. */
  pane: (id) => (id === 'chat' ? 'shell-workspace-chat' : id === 'architecture' ? 'shell-workspace-board' : `shell-workspace-pane-${id}`),
  /** No pill visible at all. */
  empty: 'shell-workspace-empty',
};

/** The chat column and its composer — items 2.5 and 2.7. */
export const CHAT = {
  column: 'chat-column',
  transcript: 'chat-transcript',
  empty: 'chat-empty',
  composer: 'composer',
  field: 'composer-field',
  send: 'composer-send',
  plus: 'composer-plus',
  toolbelt: 'composer-toolbelt',
  model: 'composer-model',
  chips: 'composer-chips',
  permission: 'permission-control',
};

/** The board — Wave 3. Every entry here is emitted by src/canvas today:
 *  `board` and `board-empty` by Board.tsx, `board-node` by NodeCard.tsx (both
 *  the card and the rung-7 mark, because a mark IS the node at that rung and a
 *  second anchor would make "how many nodes are drawn" a question with two
 *  answers), `board-legend*` by KindLegend.tsx. */
export const BOARD = {
  root: 'board',
  node: 'board-node',
  empty: 'board-empty',
  legend: 'board-legend',
  legendKind: 'board-legend-kind',
  /** STATE on `node`: the real `ArchNode.id` the card was projected from. It
   *  is what makes "is this board grounded" a checkable question rather than a
   *  claim — an id here that the scan never produced is a fabricated node. */
  nodeIdAttr: 'data-node-id',
  /** STATE on `node`: the silhouette drawn, and the LOD rung it was drawn at. */
  kindAttr: 'data-kind',
  rungAttr: 'data-rung',
  /* ── Visual mode — MADR §0 A1, "on by default; the toggle turns it OFF" ──
   *  `visualAttr` is STATE on `root`; the toggle is the board furniture's own
   *  control (decision 1: beside the direction toggle, never a composer mode
   *  row); `nodeMeta` is the row Visual adds to a card, and it exists only at
   *  the rung that draws the footer, which is what makes "the strip is absent
   *  at the fit's zoom" a checkable claim rather than an excuse. */
  visualAttr: 'data-visual',
  visualToggle: 'board-visual-toggle',
  nodeMeta: 'board-node-meta',
  selectedAttr: 'data-selected',
  /** The card's title line. Present only at the rungs whose ladder row paints
   *  a title, which is what makes `FIT_MIN_ZOOM` checkable from outside. */
  title: 'board-node-title',
  /** Sheet 08.5's third empty state: nodes are drawn, no connector is. */
  edgeless: 'board-edgeless',
  /** STATE on `root`: 'idle' | 'laying-out' | 'failed' — ELK's own progress. */
  layoutAttr: 'data-layout',
  /** STATE on `root`: how many edges the served graph carried. */
  edgeCountAttr: 'data-edge-count',
  /** STATE on `node`: receded because a flow is playing (sheet 06.6). It is a
   *  separate attribute from `data-selected` because they are separate claims
   *  and the sheet is explicit that dimming is NOT a selection effect. */
  dimmedAttr: 'data-dimmed',

  /* ── item playback — the flow, on the board ─────────────────────────────
   *  STATE on `root`. `data-view` is `CanvasView`'s own five-member state, so
   *  "is a flow playing" is answerable without inferring it from a dim that
   *  path-focus will one day also set. The three `data-flow-*` are the current
   *  hop: which one, of how many, and — in the resolver's four-member
   *  vocabulary — whether the board can show it at all. */
  viewAttr: 'data-view',
  flowHopAttr: 'data-flow-hop',
  flowHopsAttr: 'data-flow-hops',
  flowHowAttr: 'data-flow-how',
  flowShownAttr: 'data-flow-shown',
  /** The board saying what it cannot show of this hop. Absent when it can. */
  flowNote: 'board-flow-note',
};

/** The index rail — Wave 4. Emitted by src/rail today. `rail-row` is ONE
 *  anchor for all three rungs on purpose: a rung is a STATE (`data-rung`) of
 *  the same thing, and a second testid would make "how many rows are drawn" a
 *  question with two answers. */
export const RAIL = {
  root: 'rail',
  filter: 'rail-filter',
  filterClear: 'rail-filter-clear',
  /** STATE: `data-rung` ('card'|'file'|'function'), `data-row-id`,
   *  `data-selected`, `data-open`. `data-row-id` on a card rung is a real
   *  `ArchNode.id` — an id here the scan never produced is a fabricated row. */
  row: 'rail-row',
  /** Item 4.4's coverage line. STATE: `data-path`. */
  badge: 'rail-badge',
  /** STATE on the status strip: `data-status` ('idle'|'reading'|'stale'). */
  status: 'rail-status',
  empty: 'rail-empty',
  matches: 'rail-matches',
  detail: 'rail-detail',
  detailScope: 'rail-detail-scope',
  detailClose: 'rail-detail-close',
  flow: 'rail-flow',
  /** The panel's heading. It is anchored because it is a CLAIM: it read
   *  "Plays on board", was retreated to "Traced path" when the Waves 4/5 gate
   *  found that clicking a hop moved nothing on the canvas, and reads
   *  "Plays on board" again only because `flow-plays.mjs` proves it. */
  flowTitle: 'rail-flow-title',
  /** STATE: `data-playing`, and `data-from` / `data-to` — the hop's own
   *  endpoint ids, which is what lets a spec hold the rail's claim and the
   *  board's answer against each other rather than against a shared label. */
  hop: 'rail-hop',
  strip: 'rail-strip',
  stripPlay: 'rail-strip-play',
  scrub: 'rail-scrub',
  clear: 'rail-clear',
  notTraced: 'rail-nottraced',
};

/** The review surface — Wave 5. The inventory is `src/review/anchors.ts`,
 *  which the pane itself renders from; only what an e2e addresses is mirrored
 *  here, and it is mirrored rather than imported because this file is `.mjs`
 *  and that one is TypeScript inside the bundle. */
export const REVIEW = {
  root: 'review',
  scopeBar: 'review-scope',
  scopeSeg: 'review-scope-seg',
  provenance: 'review-provenance',
  gap: 'review-gap',
  empty: 'review-empty',
  failure: 'review-failure',
  /** STATE: `data-path`, `data-decision`, `data-expanded`. */
  file: 'review-file',
  filePath: 'review-file-path',
  /** STATE: `data-kind` ('add'|'del'|'context'), `data-old`, `data-new`. */
  line: 'review-line',
  impact: 'review-impact',
};

/** The command surface — item 2.6. The shell's own palette, and the only way
 *  into a surface the frame does not draw a button for. */
export const COMMAND = {
  root: 'command-surface',
  field: 'command-field',
  /** STATE: `data-command` (the ShellCommandId), `aria-disabled`. */
  row: 'command-row',
  why: 'command-why',
  empty: 'command-empty',
};

/** The boot surface — item 2.4. */
export const BOOT = {
  root: 'boot-surface',
  /** STATE on `root`: the BootOutcome kind, or 'probing'. */
  stateAttr: 'data-state',
  state: 'boot-state',
  title: 'boot-title',
  message: 'boot-message',
  repoName: 'boot-repo-name',
  summary: 'boot-summary',
  action: 'boot-action',
};

/** The attach dialog — item 2.4. `AttachDialog.tsx` emits `attach` on the
 *  <section> that also carries role="dialog", so one anchor answers both "is it
 *  rendered" and "is it a dialog". */
export const ATTACH = {
  root: 'attach',
};

/**
 * The honest not-yet panel — `app/App.tsx`'s `NotYet`, whose testid is derived
 * from its own title.
 *
 * THE FIRST TWO ARE ABSENCE ANCHORS AND NOTHING EMITS THEM, WHICH IS THE
 * POINT. Wave 2 wrote them for panes it had not built, and the promise attached
 * was that later waves would REPLACE them rather than add beside them: Wave 3
 * took the canvas, Waves 4 and 5 took the rail and review. They stay here
 * because "nothing renders this" is now the assertion — `app-mounted.mjs` reads
 * `rail` to prove the rail is not sitting under a placeholder, and a rail
 * BESIDE a "Built in Wave 4" panel is the same defect wearing a different hat.
 * Delete an entry only when the union member it names is gone from
 * `ShellOverlay`, never because it currently matches nothing.
 *
 * The last two ARE emitted today, and each disappears the wave its surface
 * lands — at which point it joins the two above rather than being deleted.
 */
export const NOT_YET = {
  /** Replaced by the board — Wave 3. */
  canvas: 'notyet-canvas',
  /** Replaced by the index rail — Wave 4. */
  rail: 'notyet-index',
  /** Replaced by the review overlay — Wave 5. The wrapper `OverlayHost` puts
   *  round it is `overlay-review`, and that is the one an e2e reads: it carries
   *  role="dialog" and is what the shell's overlay host actually mounts. */
  review: 'notyet-review',
  settings: 'notyet-settings',
  sessions: 'notyet-sessions',
  /** The `role="dialog"` wrapper, one per unbuilt overlay kind. */
  overlaySettings: 'overlay-settings',
  overlaySessions: 'overlay-sessions',
  overlayReview: 'overlay-review',
};
