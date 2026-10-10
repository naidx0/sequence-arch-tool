import '@/styles/lt.css';
import { Footer, Nav } from '@/components/lt/Chrome';
import { Hero, StackRow } from '@/components/lt/Hero';
import { Chapter } from '@/components/lt/Chapter';
import { Layers } from '@/components/lt/Layers';
import { Closer } from '@/components/lt/Closer';
import { AdvIndex } from '@/components/lt/AdvIndex';
import { AdvSystem } from '@/components/lt/AdvSystem';
import { AdvTokens } from '@/components/lt/AdvTokens';
import { AdvSpeed } from '@/components/lt/AdvSpeed';
import { AdvAccuracy } from '@/components/lt/AdvAccuracy';
import { AdvModels } from '@/components/lt/AdvModels';
import { ScrollArt } from '@/components/lt/ScrollArt';
import { AccuracyArt, SpeedArt, SystemDesignArt, TokensArt } from '@/components/lt/art';
import { DEPTH4 } from '@/data/advantages';
import { Steps } from '@/components/lt/Steps';
import { Gallery } from '@/components/lt/Gallery';
import { Agents } from '@/components/lt/Agents';
import { Anything } from '@/components/lt/Anything';
import { WhatsNew } from '@/components/lt/WhatsNew';
import { Compare } from '@/components/lt/Compare';
import { Get } from '@/components/lt/Get';

/**
 * The landing, light only (owner, 2026-10-10: "default to light mode, no dark
 * mode"). A product page in the MacBook format with Tesla's glass and space:
 * the product leads every chapter and the words follow it.
 *
 * Owner's walkthrough, 2026-10-10 15:51: short and structured, big numbers,
 * no status lines or repository paths, connect any agent, map any project,
 * agentic workflows, our models, what's new, and an easy download.
 *
 * Hero (the 15 s tour cut, the full tour on request), the map read from code,
 * the three layers exploded,
 * the pinned zoom from the map to one answer, ask in place, the breakdown
 * (five advantages, each measured), connect any agent, map any project,
 * day to day (its last step is the agentic workflow run), a closer look,
 * compare, what's new, the download. Each clip once. One line in the footer
 * says what the recordings are.
 *
 * Second tour, 17:56: no "close the loop" chapter (its clip is the day to day's
 * fifth step), a bigger day to day, an editable map, a router you can click.
 */
export function LandingPage() {
  return (
    <div className="lt-page">
      <Nav />
      <main>
        <Hero />
        <StackRow />
        <Chapter
          id="grounded"
          kicker="Architecture"
          title="A map read from your code."
          line="Open a repository and Sequence draws its services and the calls between them. Solid edges were found in code."
          clip="architecture"
          window="Sequence · Architecture"
        />
        <Layers />
        <Closer />
        <Chapter
          id="ask"
          kicker="Ask in place"
          title="Point at a box. Then ask."
          line="Right-click a box on the whiteboard or the map, or press Ctrl+Enter. The chat gets a chip naming it and a cropped snapshot."
          clip="ask-in-place"
          window="Sequence · Whiteboard"
          band
        />
        <AdvIndex />
        {/* Each chapter's drawing, scrubbed by scroll; the numbers on it come from DEPTH_MEASURED. */}
        <AdvSystem art={<ScrollArt label="system" render={(p) => <SystemDesignArt progress={p} />} />} />
        <AdvTokens
          art={
            <ScrollArt
              label="tokens"
              render={(p) => <TokensArt progress={p} readTokens={DEPTH4.readTokens} answerTokens={DEPTH4.answerTokens} filesRead={DEPTH4.files} />}
            />
          }
        />
        <AdvSpeed art={<ScrollArt label="speed" finish={0.72} render={(p) => <SpeedArt progress={p} lookups={DEPTH4.grepLookups} calls={DEPTH4.sequenceCalls} />} />} />
        <AdvAccuracy art={<ScrollArt label="accuracy" render={(p) => <AccuracyArt progress={p} />} />} />
        <AdvModels />
        <Agents />
        <Anything />
        <Steps />
        <Gallery />
        <Compare />
        <WhatsNew />
        <Get />
      </main>
      <Footer />
    </div>
  );
}
