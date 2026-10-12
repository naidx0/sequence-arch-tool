import { Clip } from '@/components/cx/Clip';
import { FEATURES_014, SAMPLE_NOTE } from '@/data/content';

/**
 * EACH CLIP ONCE, EACH TIED TO ONE CAPTIONED FEATURE.
 *
 * Four large features alternate words and recording; six more sit in a grid.
 * The tour is in the hero. Titles and captions for the grid come from
 * FEATURES_014 so the page and the release copy cannot disagree.
 */
const BIG = [
  {
    id: 'architecture',
    kicker: 'Architecture',
    title: 'A map scanned from your code.',
    body: 'Open a repository and Sequence draws its services and the calls between them. Solid edges were found in code. Dashed edges are only claimed.',
    points: [
      'Map, Grid and Hotspots from one view menu.',
      'Select a card and it becomes a chip in the chat.',
      'Every solid edge opens to a file and a line.',
    ],
    window: 'Architecture · shopfront',
  },
  {
    id: 'whiteboard-draw',
    kicker: 'Whiteboard',
    title: 'Ask for a diagram. It lays itself out.',
    body: 'Describe a system in chat. The boxes place themselves and animate in. Select and drag is the default tool.',
    points: ['Draw beside the map, in the same window.', 'A drawn edge stays a claim until the scanner finds it.'],
    window: 'Whiteboard',
  },
  {
    id: 'ask-in-place',
    kicker: 'Ask in place',
    title: 'Point at a box, then ask.',
    body: 'Hover a box on the whiteboard or the map, right-click or press Ctrl+Enter. The chat gets a chip naming it and a cropped snapshot.',
    points: ['Works on whiteboard boxes and architecture cards.', 'The question is about exactly that item.'],
    window: 'Ask about this',
  },
  {
    id: 'agents-workflows',
    kicker: 'Agents',
    title: 'Agents, with honest numbers.',
    body: 'Context and Output are shown as the agent reports them. Workflows and runs stay collapsed until you open them. Territories list the git worktrees in play.',
    points: [
      'Several agents at once, each in its own worktree.',
      'The run history and token figures in this clip are illustrative.',
    ],
    window: 'Agents · Workflows',
  },
] as const;

const SMALL_IDS = ['workspaces', 'files', 'chat-drawings', 'rewind'] as const;
const SMALL = SMALL_IDS.map((id) => FEATURES_014.find((f) => f.id === id)!);
const WINDOW: Record<(typeof SMALL_IDS)[number], string> = {
  workspaces: 'Workspaces',
  files: 'Files · docs/guide.md',
  'chat-drawings': 'Chat',
  rewind: 'Edit from here',
};

export function Features() {
  return (
    <section id="features" className="cx-section" aria-labelledby="features-title">
      <div className="cx-wrap-wide">
        <div className="max-w-[44rem]">
          <p className="cx-kicker">The product</p>
          <h2 id="features-title" className="cx-h2">
            One window: the map, a whiteboard, files, a terminal and your agents.
          </h2>
          <p className="cx-lede mt-4">Every clip on this page is the built app, recorded.</p>
        </div>

        <div className="mt-[clamp(3rem,6vw,5rem)] grid gap-[clamp(4rem,9vw,7.5rem)]">
          {BIG.map((f, i) => (
            <article key={f.id} className={`cx-feature ${i % 2 === 1 ? 'is-flipped' : ''}`} aria-labelledby={`f-${f.id}`}>
              <div className="cx-feature-text">
                <p className="cx-kicker">{f.kicker}</p>
                <h3 id={`f-${f.id}`} className="cx-h3">
                  {f.title}
                </h3>
                <p className="cx-body mt-4">{f.body}</p>
                <ul className="cx-points">
                  {f.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
              <div className="cx-stage">
                <Clip id={f.id} title={f.window} alt={`${f.title} Recorded in the app.`} />
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function MoreFeatures() {
  return (
    <section id="more" className="cx-section cx-rule" aria-labelledby="more-title">
      <div className="cx-wrap-wide">
        <div className="max-w-[44rem]">
          <p className="cx-kicker">Also in the window</p>
          <h2 id="more-title" className="cx-h2">
            The rest of the workbench.
          </h2>
        </div>
        <ul className="cx-grid mt-12 list-none p-0">
          {SMALL.map((f) => (
            <li key={f.id} className="cx-card">
              <Clip id={f.id} title={WINDOW[f.id as (typeof SMALL_IDS)[number]]} alt={`${f.title} Recorded in the app.`} />
              <h3 className="mt-5 px-2 text-[17px] font-semibold tracking-tight">{f.title}</h3>
              <p className="cx-body mt-1.5 px-2 !text-[14px]">{f.body}</p>
            </li>
          ))}
        </ul>
        <p className="cx-note mt-6">{SAMPLE_NOTE}</p>
      </div>
    </section>
  );
}
