import '@/styles/lt.css';
import { Footer, Nav } from '@/components/lt/Chrome';
import { Hero, StackRow } from '@/components/lt/Hero';
import { Chapter } from '@/components/lt/Chapter';
import { Layers } from '@/components/lt/Layers';
import { Closer } from '@/components/lt/Closer';
import { Tokens } from '@/components/lt/Tokens';
import { Steps } from '@/components/lt/Steps';
import { Gallery } from '@/components/lt/Gallery';
import { Measured } from '@/components/lt/Measured';
import { Compare } from '@/components/lt/Compare';
import { Get } from '@/components/lt/Get';

/**
 * The landing, light only (owner, 2026-10-10: "default to light mode, no dark
 * mode"). A product page in the MacBook format with Tesla's glass and space:
 * the product leads every chapter and the words follow it.
 *
 * Hero (the tour, the full tour on request), the grounded map, the three
 * layers exploded, the pinned zoom from the map to one answer, ask in place,
 * the measured context reduction, the day-to-day walkthrough, a closer look,
 * the measured comparison band, the checklist, the download. Each clip once,
 * each captioned.
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
          line="Open a repository and Sequence draws its services and the calls between them."
          clip="architecture"
          window="Sequence · Architecture"
          caption="Recorded in the app. Solid edges were found in code; dashed edges are only claimed."
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
          caption="Recorded in the app. The answer is a sample reply."
          band
        />
        <Tokens />
        <Steps />
        <Gallery />
        <Measured />
        <Compare />
        <Get />
      </main>
      <Footer />
    </div>
  );
}
