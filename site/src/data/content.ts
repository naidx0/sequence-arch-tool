/**
 * Marketing copy — feature breadth over the Teach/Plan/Build loop.
 * Help hrefs stay on the public mirror (CI site-links).
 */

export const PUBLIC_MIRROR = 'https://github.com/naidx0/sequence-arch-tool';

/** Bumped whenever site/public/demo/*.png are retaken, so a browser that
 *  cached the previous captures fetches the new ones. */
export const DEMO_V = '20260918d';

/**
 * 0.1.4 CLIPS. Recorded from the built app into site/public/demo/v014/ with
 * these exact names: <id>.mp4 and a same-name <id>.jpg poster. `tour` is the
 * full walk-through (a copy of report/media/sequence-0.1.4-tour.mp4 + poster).
 */
export const v014Video = (id: string) => `/demo/v014/${id}.mp4`;
export const v014Poster = (id: string) => `/demo/v014/${id}.jpg`;

/** Shown beside the 0.1.4 clips: the repo is a sample and the model answers are scripted. */
export const SAMPLE_NOTE =
  'Clips use a sample shop repository; the app and scan are real, model answers are sample replies.';

export const NAV_LINKS = [
  { href: '#overview', label: 'Overview' },
  { href: '#whats-new', label: "What's new" },
  { href: '#workflows', label: 'Workflows' },
  { href: '#difference', label: 'Difference' },
  { href: '#surfaces', label: 'Surfaces' },
  { href: '#help', label: 'Support' },
  { href: '#download', label: 'Download' },
] as const;

/** One card per thing a person sees in 0.1.4 that has a clip. */
export const FEATURES_014 = [
  {
    id: 'workspaces',
    title: 'Workspaces, with their chats.',
    body: 'Each workspace is a folder with its chats under it. New chat starts in the one you have open.',
  },
  {
    id: 'whiteboard-draw',
    title: 'Ask for a diagram. It lays itself out.',
    body: 'Describe a system in chat. The boxes place themselves and animate in. Select and drag is the default tool.',
  },
  {
    id: 'ask-in-place',
    title: 'Point at a box, then ask.',
    body: 'Hover a box on the whiteboard or the map, right-click or press Ctrl+Enter. The chat gets a chip naming it and a cropped snapshot.',
  },
  {
    id: 'architecture',
    title: 'One view menu on the map.',
    body: 'Pick a view from a single dropdown. In a narrow pane the tags fold inside it instead of overlapping.',
  },
  {
    id: 'files',
    title: 'Files that read well.',
    body: 'A one-line breadcrumb, VS Code status colours, and rendered Markdown with its diagrams. Preview, Edit or Diff.',
  },
  {
    id: 'agents-workflows',
    title: 'Agents, with honest numbers.',
    body: 'Context and Output are shown as the agent reports them. The run history and token figures in this clip are illustrative. Workflows and runs stay collapsed until you open them.',
  },
  {
    id: 'chat-drawings',
    title: 'Drawings and charts, in the chat.',
    body: 'An svg or html block the agent writes is drawn inline, in the app theme. Twelve built-in chart and diagram types draw from a spec.',
  },
  {
    id: 'rewind',
    title: 'Edit from here.',
    body: 'Take a message and everything after it out of the chat, and the agent forgets them too. Undo until your next send.',
  },
] as const;

/** Things that ship in 0.1.4 and are better said than shown. */
export const ALSO_014 = [
  {
    title: 'Claude sets itself up',
    body: 'No 307 MB global bridge to install. The app fetches a pinned 8.2 MB bridge the first time it needs it and shows its progress. Already signed in: no setup clicks.',
  },
  {
    title: 'Restart, then continue',
    body: 'A turn cut off by quitting says so and offers Continue. Queued prompts come back held, with Resume.',
  },
  {
    title: 'Bring old chats in',
    body: 'Import a Claude Code or Codex session from the Workspaces header. Your next message continues it. The CLI folders are not changed.',
  },
  {
    title: 'Several agents at once',
    body: 'Tick two or more agents in the + menu and send. Each gets its own chat and worktree. Compare, merge one, discard the rest.',
  },
  {
    title: 'Open a pull request',
    body: 'From a worktree chat: a drafted title and body, then one press commits, pushes and opens the PR with gh. Files that look like secrets are held back and listed.',
  },
  {
    title: 'A radar while it works',
    body: 'A small ASCII radar in the chat header and status bar shows when the agent is busy.',
  },
] as const;

export const WORKFLOWS = [
  {
    id: 'architecture',
    clip: 'architecture' as string | null,
    title: 'Ask about the architecture',
    lede: 'Understand a repository you did not write.',
    steps: [
      'Open Architecture beside the chat.',
      'Ask what calls a function, or what breaks if a file changes.',
      'The answer cites the files and lines it read, and every tool call is a card.',
      'Click a node on the map. It becomes a chip in the composer, so your next question is about it.',
    ],
  },
  {
    id: 'plan',
    clip: 'ask-in-place' as string | null,
    title: 'Plan on the whiteboard, ask in place',
    lede: 'Think in boxes, and keep the chat pointed at the right one.',
    steps: [
      'Ask the chat to draw the system. It lays itself out and animates in.',
      'Rearrange it with select and drag.',
      'Hover the box you are unsure about, right-click or press Ctrl+Enter, and ask.',
      'The chat receives that exact reference with a snapshot of it.',
    ],
  },
  {
    id: 'agents',
    clip: null as string | null,
    title: 'Run agents and compare',
    lede: 'Try the same task two ways and keep the better one.',
    steps: [
      'In the + menu, tick two or more agents and press Send.',
      'Each agent works in its own chat and its own worktree.',
      'A compare block shows the results, with a merge dry run.',
      'Press Merge this one. Discard the others; it asks twice if their work is unmerged.',
      'Open a pull request from the merged worktree chat.',
    ],
  },
] as const;

export const SURFACES = [
  { id: 'chat', name: 'Chat', body: 'Always on the left. Chats live under their workspace. Drawings and charts appear inline.' },
  { id: 'files', name: 'Files', body: 'Tree, status colours, rendered Markdown and diagrams.' },
  {
    id: 'architecture',
    name: 'Architecture',
    body: 'Solid edges were found in code. Dashed edges are only claimed.',
  },
  { id: 'whiteboard', name: 'Whiteboard', body: 'Draw beside the map, or ask for a diagram and watch it lay out.' },
  { id: 'ai-canvas', name: 'AI Canvas', body: 'Where the agent draws charts and plans.' },
  { id: 'agents', name: 'Agents', body: 'Context and Output as reported. Workflows and runs open on demand.' },
  { id: 'terminal', name: 'Terminal', body: 'A shell with a one-line prompt and a toolbar.' },
  { id: 'browser', name: 'Browser', body: 'Check what you just changed.' },
] as const;

export const DIFFERENCE = [
  {
    id: 'vs-guess',
    title: 'Grounded, not guessed',
    yours: 'Chat invents a diagram that feels right.',
    ours: 'Every solid edge traces to a file and a line.',
  },
  {
    id: 'vs-tabs',
    title: 'One harness',
    yours: 'Draw here. Graph elsewhere. Browser elsewhere.',
    ours: 'Chat, files, graph, whiteboard, canvas, terminal and browser in one window.',
  },
  {
    id: 'vs-keys',
    title: 'Local-first',
    yours: 'Nothing useful until a key and a login.',
    ours: 'Core value with no network and no account.',
  },
] as const;

export const STATS = [
  { id: 'surfaces', value: '8', label: 'Surfaces in one harness' },
  { id: 'radius', value: '113', label: 'Files at depth 4, one call' },
  { id: 'truth', value: '2', label: 'Edge kinds: solid and dashed' },
  { id: 'keys', value: '0', label: 'Keys required to start' },
] as const;

/** Human goals for what the agent can draw — not jargon chart-family names. */
export const CHART_FAMILIES = [
  { id: 'topology', label: 'Topology map', body: 'Services and edges from the scan, each one traceable to a line' },
  { id: 'flow', label: 'Request path', body: 'Follow a real call from gateway to datastore' },
  { id: 'impact', label: 'Blast radius', body: 'See what breaks when one service changes' },
  { id: 'hierarchy', label: 'Package tree', body: 'What lives under a folder, grounded in the scan' },
  { id: 'timeline', label: 'Ordered work', body: 'Steps the agent plans, tied to real files' },
  { id: 'counts', label: 'Scan counts', body: 'Services, edges, and claims from the repo' },
  { id: 'compare', label: 'Side-by-side', body: 'Tradeoffs with numbers you can check' },
  { id: 'cards', label: 'Step cards', body: 'A path broken into grounded cards' },
  { id: 'annotated', label: 'Annotated frame', body: 'Callouts on a map that already exists' },
] as const;

export const HELP_LINKS = [
  {
    title: 'It will not open',
    body: 'Launcher, ports, and the browser that does not open.',
    href: `${PUBLIC_MIRROR}/blob/main/HOW_TO_RUN.md`,
  },
  {
    title: 'It drew something wrong',
    body: 'How an arrow is found, and how to check any claim.',
    href: `${PUBLIC_MIRROR}/blob/main/docs/how-to-verify.md`,
  },
  {
    title: 'Grounded drawing',
    body: 'Sketch beside the graph. Solid edges stay proven.',
    href: `${PUBLIC_MIRROR}/blob/main/docs/TEACH-MODE-GOAL.md`,
  },
  {
    title: 'Build from source',
    body: 'Node, pnpm, and the workspace build.',
    href: `${PUBLIC_MIRROR}/blob/main/docs/build-guide.md`,
  },
  {
    title: 'What changed',
    body: 'Every release.',
    href: `${PUBLIC_MIRROR}/blob/main/CHANGELOG.md`,
  },
  {
    title: 'Talk to support',
    body: 'A bug, a bad read, or a claim it could not back.',
    href: 'https://github.com/naidx0/sequence-arch-tool/issues',
  },
] as const;
