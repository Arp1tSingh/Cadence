import '@/lib/immerSetup';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import '@/styles/globals.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Cadence could not find its root element.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.DEV) {
  // Dev-only diagnostics: `await window.__cadenceThreadBenchmark()` in the
  // browser console. It replaces the TTS worker between thread counts, so do
  // not run it while narrating. The production build drops this branch.
  void import('@/core/tts/threadBenchmark')
    .then(({ runThreadBenchmark }) => {
      (window as unknown as {
        __cadenceThreadBenchmark?: typeof runThreadBenchmark;
      }).__cadenceThreadBenchmark = runThreadBenchmark;
    })
    .catch((error: unknown) => {
      console.warn('[cadence] thread benchmark unavailable', error);
    });

  // Dev-only Flash/Piper spike used to pick the voice and verify the real-time
  // gate before the engine is wired into playback.
  void import('@/core/tts/flashSpike')
    .then(({ runFlashSpike, downloadFlashSamples }) => {
      const target = window as unknown as {
        __cadenceFlashSpike?: typeof runFlashSpike;
        __cadenceFlashSamples?: typeof downloadFlashSamples;
      };
      target.__cadenceFlashSpike = runFlashSpike;
      target.__cadenceFlashSamples = downloadFlashSamples;
    })
    .catch((error: unknown) => {
      console.warn('[cadence] Flash spike unavailable', error);
    });
}
