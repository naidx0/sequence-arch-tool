import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import { LandingPage } from '@/pages/LandingPage';
import '@/styles/globals.css';
import '@/styles/native.css';

/* The two earlier looks stay reachable for comparison: `?accent=ink` and
   `?accent=gold`, remembered for the tab. Default is Apple blue on ink; nothing
   is written unless a switch is used. */
try {
  const params = new URLSearchParams(window.location.search);
  const wanted = params.get('accent') ?? window.sessionStorage.getItem('sequence.site.accent');
  if (wanted === 'blue' || wanted === 'ink' || wanted === 'gold') {
    window.sessionStorage.setItem('sequence.site.accent', wanted);
    if (wanted !== 'blue') document.documentElement.dataset.accent = wanted;
  }
} catch {
  /* storage blocked: the page renders the default */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LandingPage />
    <Analytics />
  </StrictMode>,
);
