import { useMemo } from 'react';
import {
  siGo,
  siJavascript,
  siNginx,
  siOpenjdk,
  siPostgresql,
  siPython,
  siRedis,
  siTypescript,
} from 'simple-icons';
import { Clip } from '@/components/cx/Clip';
import { AppleGlyph, WindowsGlyph } from '@/components/OsIcons';
import { SAMPLE_NOTE } from '@/data/content';
import { INSTALLERS, NEXT_VERSION, detectInstallerId } from '@/data/release';

export function Hero() {
  const primary = useMemo(() => {
    const id = detectInstallerId();
    return INSTALLERS.find((i) => i.id === id) ?? INSTALLERS[0]!;
  }, []);
  const Glyph = primary.id === 'windows' ? WindowsGlyph : AppleGlyph;

  return (
    <section id="overview" aria-labelledby="hero-title" className="pt-[clamp(3.5rem,8vw,6.5rem)]">
      <div className="cx-wrap text-center">
        <p className="cx-kicker">Sequence {NEXT_VERSION}</p>
        <h1 id="hero-title" className="cx-h1 mx-auto max-w-[15ch]">
          Architecture you can draw on, and prove.
        </h1>
        <p className="cx-lede mx-auto mt-5 max-w-[36rem]">
          Sequence maps your code, lets you draw beside the map, and answers from both. Every solid edge has a file and
          a line.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a href="#download" className="cx-btn cx-btn-primary">
            <Glyph className="h-4 w-4" />
            Download for {primary.os.split(' · ')[0]}
          </a>
          <a href="#measured" className="cx-btn cx-btn-ghost">
            See the measurements
          </a>
        </div>
      </div>

      <div className="cx-wrap-wide mt-[clamp(2.5rem,5vw,4rem)]">
        <div className="cx-stage cx-stage-hero">
          <Clip
            id="tour"
            eager
            title="Sequence · shopfront"
            alt={`A tour of Sequence ${NEXT_VERSION}: workspaces, the architecture map, the whiteboard, files and agents.`}
          />
        </div>
        <p className="cx-note mt-4 text-center">{SAMPLE_NOTE}</p>
      </div>
    </section>
  );
}

const STACK = [
  { icon: siTypescript, name: 'TypeScript' },
  { icon: siPython, name: 'Python' },
  { icon: siJavascript, name: 'JavaScript' },
  { icon: siGo, name: 'Go' },
  { icon: siOpenjdk, name: 'Java' },
  { icon: siNginx, name: 'nginx' },
  { icon: siPostgresql, name: 'Postgres' },
  { icon: siRedis, name: 'Redis' },
] as const;

/** The trust row, with what the recordings were actually made on. */
export function StackRow() {
  return (
    <section aria-label="The repository in the recordings" className="pt-[clamp(3.5rem,7vw,5.5rem)]">
      <div className="cx-wrap text-center">
        <p className="cx-note">
          Recorded on a sample shop: eight services in six languages, a database, a cache and a topic, mapped from
          source.
        </p>
        <ul className="cx-logos mt-6 list-none p-0">
          {STACK.map(({ icon, name }) => (
            <li key={name}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d={icon.path} fill="currentColor" />
              </svg>
              {name}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
