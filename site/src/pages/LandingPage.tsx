import '@/styles/lt.css';
import { Footer, Nav } from '@/components/lt/Chrome';
import { Hero } from '@/components/lt/Hero';
import { Board, Choose, Draw, Look, LongTasks, Savings, SmallModels, Surfaces } from '@/components/lt/Story';
import { Get } from '@/components/lt/Get';

/**
 * The landing, light only, short (owner, 2026-10-10: simplify). The story is
 * "All your favorite harness pieces in one app", in plain words: choose the
 * model and the agent, draw, point and ask, long tasks, small helper models,
 * fewer round trips, then the download. Each recording is used once; the
 * longer sections of the earlier page (breakdown, compare, what's new, the
 * layers) are cut, their components left in place.
 */
export function LandingPage() {
  return (
    <div className="lt-page">
      <Nav />
      <main>
        <Hero />
        <Choose />
        <Draw />
        <Board />
        <Surfaces />
        <LongTasks />
        <SmallModels />
        <Savings />
        <Look />
        <Get />
      </main>
      <Footer />
    </div>
  );
}
