import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BenchmarksPage } from '@/pages/BenchmarksPage';
import '@/styles/globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BenchmarksPage />
  </StrictMode>,
);
