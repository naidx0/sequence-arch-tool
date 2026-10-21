import { Reveal } from '@/components/lt/hooks';
import { RELEASE_URL, VERSION } from '@/data/release';

/**
 * WHAT'S NEW IN 0.1.5, BY WHAT IT DOES FOR YOU (owner, 2026-10-10: "the
 * release notes are a big thing… a what's new thing, shows you the benefits").
 * Every card is a line of docs/releases/v0.1.5.md, rewritten as the benefit.
 */
const ITEMS = [
  { title: 'Codex is always in the picker', body: 'Connected agents stay in the model list. If the list cannot be read, you get the default model, the reason and one Retry.' },
  { title: 'Tabs that behave', body: 'Click, drag to reorder and scroll tabs with the wheel. Panes resize smoothly and stop shrinking before they hide your content.' },
  { title: 'Chats keep running', body: 'Reload the page or open another project and your agent keeps going. Rows show a badge while a chat works in the background, and Needs you when it is waiting.' },
  { title: 'Several chats at once', body: 'Run agents in more than one workspace together. Switching between them leaves the others streaming.' },
  { title: 'Cleaner drawings in chat', body: 'Inline drawings fold with one click and fit the chat column, with no scrollbar and no cut-off text.' },
  { title: 'Whiteboard Ask, always on', body: 'Ask opens on any board. Drawings from an agent land readable, with boxes sized to their text and connectors that follow.' },
  { title: 'Answer an agent with a click', body: 'When an agent asks a question or hands over a plan, you get a card. Pick your options, then press Send.' },
  { title: 'Updates from Settings', body: 'See your version, get a daily check for a new release and install it in one click.' },
] as const;

const EARLIER = [
  { title: 'Set up in one go', body: 'Sign in once during setup. Claude installs itself the first time you use it.' },
  { title: 'Several agents at once', body: 'Send one task to two or more agents, each in its own worktree. Compare, merge one, discard the rest.' },
  { title: 'Never lose a turn', body: 'A restart no longer drops your work. An interrupted turn shows Continue.' },
  { title: 'Edit from here', body: 'Rewrite an earlier message and the agent forgets what came after it. Undo until your next send.' },
  { title: 'A pull request in one step', body: 'The app writes the title and body, commits, pushes and opens it. Files that look like secrets are held back.' },
  { title: 'Drawings and charts in the chat', body: 'The agent draws right in the chat, with twelve built-in chart and diagram types.' },
  { title: 'find_files for your agents', body: 'Agents get the files a question is about, ranked, with a reason for each, before they search.' },
  { title: 'Bring your old chats', body: 'Import Claude Code and Codex chats into your workspaces. Importing twice opens the same chat.' },
] as const;

export function WhatsNew() {
  return (
    <section id="whats-new" className="lt-adv" aria-labelledby="whats-new-title">
      <div className="lt-wrap-wide">
        <Reveal className="lt-adv-head">
          <p className="lt-kicker">What’s new in {VERSION}</p>
          <h2 id="whats-new-title" className="lt-h2">
            Chats that keep going. Tools that stay out of the way.
          </h2>
        </Reveal>
        <Reveal className="lt-new" delay={80}>
          {ITEMS.map((it, i) => (
            <article key={it.title} className="lt-new-card">
              <span className="lt-new-n">{String(i + 1).padStart(2, '0')}</span>
              <h3 className="lt-new-title">{it.title}</h3>
              <p className="lt-new-body">{it.body}</p>
            </article>
          ))}
        </Reveal>
        <details className="mt-8">
          <summary className="lt-link cursor-pointer text-center text-[14px]">Earlier: 0.1.4</summary>
          <div className="lt-new mt-6">
            {EARLIER.map((it, i) => (
              <article key={it.title} className="lt-new-card">
                <span className="lt-new-n">{String(i + 1).padStart(2, '0')}</span>
                <h3 className="lt-new-title">{it.title}</h3>
                <p className="lt-new-body">{it.body}</p>
              </article>
            ))}
          </div>
        </details>
        <p className="mt-8 text-center text-[14px]">
          <a href={RELEASE_URL} className="lt-link">
            Full release notes
          </a>
        </p>
      </div>
    </section>
  );
}
