import { useEffect, useState } from 'react';

/** Timers run only while this document is visible, including after a tab resumes. */
export function useVisibleTick(active: boolean, delay = 500): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    /* The first resume only arms the timer: state is already current, and a set here is an extra commit on every mount. */
    let first = true;
    const resume = () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
      if (!document.hidden) {
        if (!first) setNow(Date.now());
        first = false;
        timer = setInterval(() => setNow(Date.now()), delay);
      }
    };
    resume();
    document.addEventListener('visibilitychange', resume);
    return () => { if (timer !== undefined) clearInterval(timer); document.removeEventListener('visibilitychange', resume); };
  }, [active, delay]);
  return active ? now : Date.now();
}
