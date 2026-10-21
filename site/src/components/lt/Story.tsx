import type { ReactNode } from 'react';
import { siOllama } from 'simple-icons';
import { ClaudeMark, CodexMark } from '@/components/HarnessLogos';
import { Reveal } from '@/components/lt/hooks';
import { Clip, Window } from '@/components/lt/Window';
import { DEPTH4, GRADE, RANKER, SHAPE } from '@/data/advantages';

/**
 * THE SHORT STORY (owner, 2026-10-10: simplify). "All your favorite harness
 * pieces in one app", told in plain words: pick the model and the agent, draw,
 * see the architecture, run long tasks, small models that do one job each,
 * and fewer round trips on deep questions. Each block is a headline, one line,
 * a clip that already exists and up to three cards. Every number says what it
 * measures in the same sentence. Facts come from README.md; the token claim is
 * round trips on deep questions, never tokens on a one-hop lookup.
 */

type Card = { title: string; body: ReactNode; mark?: ReactNode };

function Cards({ items }: { items: readonly Card[] }) {
  return (
    <ul className="lt-cards">
      {items.map((c) => (
        <li key={c.title} className="lt-glass">
          <p className="lt-card-title">
            {c.mark}
            {c.title}
          </p>
          <p className="lt-card-body">{c.body}</p>
        </li>
      ))}
    </ul>
  );
}

function Block({
  id,
  kicker,
  title,
  line,
  clip,
  still,
  window,
  alt,
  band = false,
  children,
}: {
  id: string;
  kicker: string;
  title: string;
  line: string;
  clip?: string;
  /** A still from /demo/v0184/stills (no extension) for a section that has no recording. */
  still?: string;
  window?: string;
  alt?: string;
  band?: boolean;
  children?: ReactNode;
}) {
  return (
    <section id={id} className={`lt-chapter lt-tight ${band ? 'lt-band' : ''}`} aria-labelledby={`${id}-title`}>
      <div className="lt-wrap-wide">
        <Reveal className="mx-auto max-w-[46rem] text-center">
          <p className="lt-kicker">{kicker}</p>
          <h2 id={`${id}-title`} className="lt-display">
            {title}
          </h2>
          <p className="lt-lede mx-auto mt-5 max-w-[36rem]">{line}</p>
        </Reveal>
        {clip ? (
          <Reveal className="lt-chapter-shot" delay={120}>
            <Window title={window ?? 'Sequence'} className="lt-window-big">
              <Clip id={clip} alt={alt ?? `${title} Recorded in the app on a sample project.`} />
            </Window>
          </Reveal>
        ) : null}
        {still ? (
          <Reveal className="lt-chapter-shot" delay={120}>
            <Window title={window ?? 'Sequence'} className="lt-window-big" ratio="16 / 10">
              <img
                src={`/demo/v0184/stills/${still}.webp`}
                alt={alt}
                width={2880}
                height={1800}
                loading="lazy"
                decoding="async"
                style={{ display: 'block', width: '100%', height: 'auto' }}
              />
            </Window>
          </Reveal>
        ) : null}
        {children ? <Reveal delay={80}>{children}</Reveal> : null}
      </div>
    </section>
  );
}

const OllamaMark = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={siOllama.path} fill="currentColor" />
  </svg>
);

/** Pick the model and the agent. */
export function Choose() {
  return (
    <Block
      id="choose"
      kicker="Your model, your agent"
      title="Use any model. Use any agent."
      line="Run Claude Code, Codex or a model on your own computer, in the same app. Start a task on several at once and compare."
      still="settings-light"
      window="Sequence · Settings"
      alt="Settings, Models: the model in use, a search across 189 providers, and Local model and API key sections. A screenshot of the app."
    >
      <Cards
        items={[
          { title: 'Claude Code', mark: <ClaudeMark className="" />, body: 'Sets itself up the first time you use it. Sign in once.' },
          { title: 'Codex', mark: <CodexMark className="" />, body: 'Its approvals and diffs show up in the chat.' },
          { title: 'Local models', mark: <OllamaMark />, body: 'Ollama, LM Studio or any server on your machine that speaks the OpenAI API format. No key, works offline.' },
        ]}
      />
    </Block>
  );
}

/** Draw: whiteboard, inline drawings, the architecture board. */
export function Draw() {
  return (
    <Block
      id="draw"
      kicker="Draw"
      band
      title="Sketch it. Or ask for it."
      line="Draw on a whiteboard next to your code, or describe a system in chat and watch it lay itself out."
      still="surface-whiteboard-light"
      window="Sequence · Spaces"
      alt="The Spaces surface next to the chat: an empty board with drawing tools and an Ask button. A screenshot of the app."
    >
      <Cards
        items={[
          { title: 'Whiteboard', body: 'A rough box or line you draw is turned into a clean one that the agent can read.' },
          { title: 'Drawings in chat', body: 'Diagrams and charts appear right in the conversation, not in a separate file.' },
          { title: 'Architecture board', body: 'Sequence reads your repository and draws its services and the calls between them. Every solid line points to a line of code.' },
        ]}
      />
    </Block>
  );
}

/** Ask, and the answer comes from the scanned map. */
export function Board() {
  return (
    <Block
      id="board"
      kicker="Architecture"
      title="Ask. It answers from the map."
      line="The chat answers from the architecture Sequence read out of your code, and names the file and line it came from."
      clip="ask-live"
      window="Sequence · Chat and map"
      alt="Asking what the main services are and how they talk. The answer streams in beside the architecture map and ends with the files it came from. Recorded in the app on a sample project with a stand-in model."
    />
  );
}

/** The window's surfaces and the sidebar. */
export function Surfaces() {
  return (
    <Block
      id="surfaces"
      kicker="Inside"
      title="One window. Every surface."
      line="Files, Agents, Spaces, the terminal and the map sit one tab apart, and the sidebar opens Workflows, Components, Profiles and Skills."
      clip="surfaces"
      window="Sequence · Surfaces"
      alt="Switching between Files, Whiteboard, Agents, Terminal and Architecture in one window. Recorded in the app on a sample project."
      band
    />
  );
}

/** A still, light and dark. */
export function Look() {
  return (
    <section id="look" className="lt-chapter lt-tight" aria-labelledby="look-title">
      <div className="lt-wrap-wide">
        <Reveal className="mx-auto max-w-[46rem] text-center">
          <p className="lt-kicker">Look</p>
          <h2 id="look-title" className="lt-display">
            Quiet, so the code can talk.
          </h2>
          <p className="lt-lede mx-auto mt-5 max-w-[36rem]">
            Graphite and one accent, light or dark. The window is a real screenshot; the grain around it is a character mosaic.
          </p>
        </Reveal>
        <Reveal className="lt-chapter-shot" delay={120}>
          <picture>
            <source media="(prefers-color-scheme: dark)" srcSet="/demo/v0184/hero-dark.webp" />
            <img
              src="/demo/v0184/hero-light.webp"
              alt="The Sequence window on a sample project, the chat answering beside the architecture map, set on a field of ASCII characters."
              width={3840}
              height={2160}
              loading="lazy"
              decoding="async"
              style={{ width: '100%', height: 'auto', borderRadius: 14 }}
            />
          </picture>
        </Reveal>
      </div>
    </section>
  );
}

/** Workflows and long-running tasks. */
export function LongTasks() {
  return (
    <Block
      id="long-tasks"
      kicker="Long tasks"
      band
      title="Hand it a goal. Come back later."
      line="Type /goal and a task. It writes a plan, then works through it one step at a time, on Sequence's own model or on your Claude Code or Codex chat."
      still="rail-workflows-light"
      window="Sequence · Workflows"
      alt="The sidebar's Workflows view listing ready-made workflows such as PR Triage and Review loop, beside the chat and the board. A screenshot of the app."
    />
  );
}

/** Small models that each do one job, and learn. */
export function SmallModels() {
  return (
    <Block
      id="small-models"
      kicker="Small helpers"
      title="Small models that do one job well."
      line="Reading code, recognising a drawing and finding files do not need a big model. These are small, fast and run on your computer."
    >
      <Cards
        items={[
          {
            title: 'Reads your code',
            body: `Plain code analysis, no guessing. On a hand-checked sample shop it found ${GRADE.edgesFound} of ${GRADE.edgesTruth} real connections between services and invented none.`,
          },
          {
            title: 'Recognises your drawing',
            body: `On the architecture board, Draw a box to add a service or a line to connect two boxes. On a fresh test set it picked the right shape ${SHAPE.accuracy}% of the time, and it snapped ${SHAPE.recall}% of the shapes it should have. One stroke per shape: a box drawn in four strokes is not recognised yet.`,
          },
          {
            title: 'Finds the right files',
            body: `Picks which files to open for a task. On ${RANKER.sealedRepos} repositories it had never seen, a file the real fix changed was in its top five picks ${RANKER.hitAt5[2]!.value}% of the time. Plain grep (a text search over the files) managed ${RANKER.hitAt5[0]!.value}%.`,
          },
        ]}
      />
      <p className="lt-note mx-auto mt-6 max-w-[40rem] text-center">
        <strong>It learns from what the agent changes.</strong> In each repository the file finder checks which files the agent
        actually edited, and retrains on that. It switches to the new version only if it tests no worse than the old one. All of
        it stays on your computer.
      </p>
      <p className="lt-note mx-auto mt-4 max-w-[40rem] text-center">
        <strong>It learns from failures too.</strong> When a request keeps going wrong (asked twice, stopped, rewritten, or
        reported not done), Sequence proposes a short note for the repository, quoting those turns. You accept or dismiss it.
        Accepted notes go into later prompts; a note after which those failures come back more often is flagged for you and
        left out of later prompts.
      </p>
    </Block>
  );
}

/** Fewer round trips on deep questions. Not claimed: fewer tokens on a one-hop lookup. */
export function Savings() {
  const grep = DEPTH4.grepLookups;
  return (
    <Block
      id="savings"
      kicker="Save effort"
      title="Fewer round trips on hard questions."
      line="Asking what depends on a core file, four levels deep, usually means searching again and again. Sequence answers from its map in one call."
    >
      <div className="lt-versus lt-glass">
        <div className="lt-versus-row">
          <p className="lt-versus-label">
            <strong>Searching with grep:</strong> {grep} separate lookups to list the {DEPTH4.files} files that depend on one core file
          </p>
          <div className="lt-versus-bar" style={{ width: '100%' }} />
        </div>
        <div className="lt-versus-row">
          <p className="lt-versus-label">
            <strong>Sequence:</strong> {DEPTH4.sequenceCalls} call for the same list
          </p>
          <div className="lt-versus-bar is-seq" style={{ width: `${(DEPTH4.sequenceCalls / grep) * 100}%` }} />
        </div>
      </div>
      <p className="lt-note mx-auto mt-5 max-w-[38rem] text-center">
        On a simple one-step lookup grep is just as cheap, so we do not claim a saving there. Measured on Sequence’s own code.{' '}
        <a href="benchmarks.html" className="lt-link">
          See every measurement, in plain words
        </a>
        .
      </p>
    </Block>
  );
}
