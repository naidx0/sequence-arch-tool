import type { ReactNode } from 'react';
import { siOllama } from 'simple-icons';
import { ClaudeMark, CodexMark } from '@/components/HarnessLogos';
import { Reveal } from '@/components/lt/hooks';
import { Clip, Window } from '@/components/lt/Window';
import { DEPTH4, GRADE, RANKER, SHAPE, fmt } from '@/data/advantages';

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
      clip="connect-agent"
      window="Sequence · Agents"
      alt="Three chats on three different agents, started one after another while the last one answers. Recorded in the app on a sample project."
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
      clip="whiteboard-draw"
      window="Sequence · Whiteboard"
      alt="A diagram asked for in chat laying itself out and animating onto the whiteboard. Recorded in the app on a sample project."
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

/** Ask about a box. */
export function Board() {
  return (
    <Block
      id="board"
      kicker="Architecture"
      title="Point at a box. Then ask."
      line="Right-click a box on the whiteboard or the map. The chat gets that exact box and a snapshot of it."
      clip="ask-in-place"
      window="Sequence · Whiteboard"
      alt="Asking a question about one box on the whiteboard. Recorded in the app on a sample project."
    />
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
      line="Type /goal and a task. The agent writes a plan, then works through it one step at a time."
      clip="agents-workflows"
      window="Sequence · Agents"
      alt="The Agents pane with the context an agent used and its output, and workflows and runs listed below. Recorded in the app; the run history and figures are a sample."
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
            body: `Turns a hand-drawn shape into a clean box or arrow. On ${fmt(SHAPE.drawings)} diagrams it had never seen, it picked the right shape ${SHAPE.accuracy}% of the time.`,
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
        <strong>It learns from failures too.</strong> When the same kind of question fails twice, Sequence proposes a short
        note for the repository, with the failed runs as evidence. You accept or deny it. Accepted notes go into later prompts,
        and a note that makes answers worse is left out.
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
