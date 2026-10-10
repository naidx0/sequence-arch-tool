import '@/styles/lt.css';
import '@/components/bench/bench.css';
import { BenchFooter, BenchNav, SubNav } from '@/components/bench/Parts';
import {
  AccuracySection,
  ContextSection,
  FilesSection,
  HowWeMeasure,
  MappingSection,
  SpeedSection,
  Summary,
} from '@/components/bench/Sections';

/**
 * BENCHMARKS, light. A quantitative page in the landing's language: five
 * groups (context and tokens, finding files, accuracy, speed, mapping), each
 * with headline multiples and percentages, linear charts with labelled axes,
 * one illustration, and a collapsible Method that holds the sources.
 * Every number comes from site/src/data/bench.ts, which
 * tools/ci/site-bench.test.mjs checks against its measurement.
 */
export function BenchmarksPage() {
  return (
    <div className="lt-page bn-page">
      <BenchNav />
      <main>
        <section className="bn-hero" aria-labelledby="bench-title">
          <div className="lt-wrap">
            <p className="lt-kicker">Benchmarks</p>
            <h1 id="bench-title" className="lt-h1 bn-h1">
              Measured, not claimed.
            </h1>
            <p className="lt-lede bn-hero-lede">
              Every number here was measured on internal tests: sealed question sets, paired runs, a small local model on one consumer
              graphics card. Where plain search still wins, we say so.
            </p>
            <Summary />
          </div>
        </section>
        <SubNav />
        <ContextSection />
        <FilesSection />
        <AccuracySection />
        <SpeedSection />
        <MappingSection />
        <HowWeMeasure />
      </main>
      <BenchFooter />
    </div>
  );
}
