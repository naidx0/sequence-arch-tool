import { Clip, Window } from '@/components/lt/Window';
import { Reveal } from '@/components/lt/hooks';

/**
 * ONE PRODUCT CHAPTER, MACBOOK-STYLE: a full viewport of white space, one
 * short headline, one line, and the product large under it. The clip's
 * caption sits on the product in a frosted pill (Tesla's glass layer).
 */
export function Chapter({
  id,
  kicker,
  title,
  line,
  clip,
  window,
  caption,
  band = false,
}: {
  id: string;
  kicker: string;
  title: string;
  line: string;
  clip: string;
  window: string;
  caption: string;
  band?: boolean;
}) {
  return (
    <section id={id} className={`lt-chapter ${band ? 'lt-band' : ''}`} aria-labelledby={`${id}-title`}>
      <div className="lt-wrap-wide">
        <Reveal className="mx-auto max-w-[46rem] text-center">
          <p className="lt-kicker">{kicker}</p>
          <h2 id={`${id}-title`} className="lt-display">
            {title}
          </h2>
          <p className="lt-lede mx-auto mt-5 max-w-[36rem]">{line}</p>
        </Reveal>
        <Reveal className="lt-chapter-shot" delay={120}>
          <Window title={window} className="lt-window-big" over={<p className="lt-overlay lt-glass">{caption}</p>}>
            <Clip id={clip} alt={`${title} ${caption}`} />
          </Window>
        </Reveal>
      </div>
    </section>
  );
}
