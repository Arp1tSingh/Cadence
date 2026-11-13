import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

export default defineConfig({
  // GitHub Pages serves project sites from `/<repo>/`. The deploy workflow
  // sets VITE_BASE; local dev and root-hosted deploys keep `/`.
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    react(),
    tailwindcss(),
    viteStaticCopy({
      targets: [
        // ONNX Runtime Web loads these at runtime from a URL, so they must be
        // served as static files rather than bundled.
        {
          src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded*.wasm',
          dest: 'wasm',
          rename: { stripBase: true },
        },
        {
          src: 'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded*.mjs',
          dest: 'wasm',
          rename: { stripBase: true },
        },
        // PDF.js loads CMaps and the standard font data on demand.
        {
          src: 'node_modules/pdfjs-dist/cmaps/*',
          dest: 'pdfjs/cmaps',
          rename: { stripBase: true },
        },
        {
          src: 'node_modules/pdfjs-dist/standard_fonts/*',
          dest: 'pdfjs/standard_fonts',
          rename: { stripBase: true },
        },
        // Curated Kokoro style vectors. Bundling them keeps voice switching
        // offline: roughly 4 MB for the eight curated voices.
        {
          src: [
            'node_modules/kokoro-js/voices/af_heart.bin',
            'node_modules/kokoro-js/voices/af_bella.bin',
            'node_modules/kokoro-js/voices/af_nicole.bin',
            'node_modules/kokoro-js/voices/am_michael.bin',
            'node_modules/kokoro-js/voices/am_fenrir.bin',
            'node_modules/kokoro-js/voices/bf_emma.bin',
            'node_modules/kokoro-js/voices/bm_george.bin',
            'node_modules/kokoro-js/voices/bm_fable.bin',
          ],
          dest: 'voices',
          rename: { stripBase: true },
        },
      ],
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    headers: isolationHeaders,
  },
  preview: {
    headers: isolationHeaders,
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // These packages resolve WASM/worker assets relative to their own modules
    // and must not be pre-bundled by esbuild.
    exclude: ['@huggingface/transformers', 'onnxruntime-web', 'kokoro-js', 'phonemizer'],
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    passWithNoTests: true,
    restoreMocks: true,
  },
});
