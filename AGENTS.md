# AGENTS.md — Cadence Engineering Guide

This file is the operating manual for AI agents working on Cadence. **Read this first**, update the status/progress sections after every milestone, and keep it concise enough to fit comfortably in context.

## Repository

- GitHub: https://github.com/Arp1tSingh/Cadence
- Branch: `main`
- Local working directory: `C:\Users\Admin\Projects\Cadence`
- Source specification: `cadence_neural_ebook_tts_blueprint.md` — keep it; do not delete.
- Git identity: use the **global** identity only.
  - `Arpit Singh <236452114+Arp1tSingh@users.noreply.github.com>`
  - Never run `git config --local user.name` or `git config --local user.email`.
- Use `npm` (Node 24 / npm 11 are installed). `pnpm` is not installed.

## Product Summary

Cadence is a static, privacy-first web app that turns EPUB and PDF books into audiobooks entirely in the browser. It uses Kokoro-82M through ONNX Runtime Web (WebGPU with WASM fallback), stores model/audio data in OPFS, and presents an Apple Music-style Live Lyrics player with word-level synchronization.

There is no backend, no telemetry, and no user-data upload. The only external request is the one-time Hugging Face model/voice download.

## Non-Negotiables

- **100% client-side.** No server API, analytics, or uploads.
- **No heavy work on the main thread.** Parsing, inference, WSOLA time-stretching, and encoding belong in workers.
- **60fps UI.** High-frequency playback/lyrics updates use refs and CSS variables, not React state. React re-renders happen on sentence/chapter changes only.
- **OPFS for binary data.** IndexedDB stores only metadata, settings, progress, and cache indexes.
- **Static build.** `npm run build` must produce a deployable `dist/` directory.
- **No secrets committed.** Do not commit model weights, audio caches, sample books, or `.env` files.

## Locked Technical Decisions

| Area | Decision |
|---|---|
| Framework | Vite 7 + React 19 + TypeScript 5.9 |
| Styling | Tailwind CSS v4 + Motion (`motion/react`) |
| State | Zustand + Immer; `idb` for IndexedDB |
| Workers | Vite module workers + Comlink |
| EPUB | JSZip + `fast-xml-parser` + `linkedom/worker` |
| PDF | `pdfjs-dist` 4.10.x, local worker/CMaps/fonts |
| TTS | `kokoro-js` for model/tokenizer; custom inference wrapper for style blending and timing |
| Phonemizer | `phonemizer` (bundled espeak-ng) |
| Export | Mediabunny + `@mediabunny/mp3-encoder`; WebCodecs AAC for M4B |
| M4B chapters | Nero `chpl` atom patched into `moov/udta` after muxing |
| Audio cache | 16-bit PCM in OPFS (half the disk of Float32), converted to Float32 on read |
| Speed control | Offline WSOLA in `stretch.worker.ts`; no re-synthesis, no pitch shift |
| Model QA | Kokoro `q8` (~92 MB) via WASM; WebGPU `fp32` is an optional quality mode |
| Test content | Public-domain Gutenberg EPUB + arXiv PDF + synthetic fixtures |

Detailed rationale for these choices is in the conversation/blueprint; the important thing is not to regress them without a strong reason and a note here.

## Commands

```bash
npm install
npm run dev          # Vite dev server with COOP/COEP headers
npm run build        # static production build
npm run preview      # preview production build with COOP/COEP headers
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
npm run test         # Vitest
npm run test:watch
```

Always run `npm run typecheck && npm run lint && npm run test && npm run build` before pushing a milestone.

### Build Notes

- `vite-plugin-static-copy` copies ORT WASM and PDF.js CMaps/standard fonts into `dist/wasm` and `dist/pdfjs` (and serves them in dev). Do not commit generated assets.
- `onnxruntime-web` is pinned to the exact version required by `@huggingface/transformers` 3.8.1.
- `public/` holds only hand-authored files (`favicon.svg`, `_headers`).
- The theme preference currently lives in `localStorage` (`cadence.theme`) for flash-free first paint; migrate it into the settings store when that lands.

## Architecture Map

```text
src/
  app/                 App shell, routing, providers, error boundary
  components/
    bookshelf/         Book cards, dropzone, import sheet, storage UI
    player/            Lyrics canvas, sentence rows, glass dock, mesh background, voice blender
    modals/            Export studio, lexicon, normalization rules, settings
    ui/                Shared buttons, sliders, switches, sheets, progress rings
  core/
    audio/             AudioScheduler, lookahead, word sync, WSOLA, MediaSession, wake lock
    parsing/           EPUB/PDF parsers, normalizer, sentence chunker, cover colors
    storage/           OPFS manager, IndexedDB schema, model cache, audio cache index
    tts/               Kokoro engine, voices, phonemizer, synthesis queue, cache keys
    export/            MP3/M4B jobs, chapter atom patcher, export progress
    workers/           Typed Comlink clients
  workers/
    parser.worker.ts
    tts.worker.ts
    exporter.worker.ts
    stretch.worker.ts
  store/               Zustand stores (library, player, synthesis, settings)
  types/               Shared domain and worker contracts
  styles/              Global CSS, design tokens
public/
  wasm/                ORT WASM assets copied at build/dev time
  pdfjs/               CMaps and standard fonts
scripts/               Asset copy and verification scripts
tests/                 Unit tests and small fixtures
```

### Threading Rules

- **Main thread:** React, DOM, rAF lyrics, Web Audio API graph, MediaSession, Wake Lock.
- **Parser worker:** file hash, EPUB/PDF extraction, cleanup, chapter/sentence building, cover/color extraction.
- **TTS worker:** model loading, voice style loading/blending, phonemization, inference, PCM cache reads/writes.
- **Exporter worker:** reads PCM from OPFS, encodes MP3/M4B, writes output. Never loads a whole book into RAM.
- **Stretch worker:** WSOLA speed changes for playback.

## Data and Storage Layout

```text
OPFS
  /models/cache/<sha256>.<ext>       # transformers.js custom cache
  /models/voices/<voice>.bin         # Kokoro style vectors
  /books/<bookId>.<epub|pdf>         # original import
  /covers/<bookId>.<ext>             # cover image
  /cache/<bookId>/<voiceKey>/<hash>.i16
  /exports/<jobId>.tmp

IndexedDB (via idb)
  books        # BookDocument without runtime audio fields
  progress     # bookId -> chapter/sentence/offset, timestamps
  settings     # theme, voice, rules, lexicon, model config
  audioCache   # cacheKey -> bookId, voiceKey, sentenceId, chapterIndex, duration, timings, size
  exportJobs   # resume metadata for export jobs
```

Cache keys must include: sentence ID, a hash of the TTS text, voice key, and an engine/cache version. Changing pronunciation rules or lexicon must not reuse stale audio.

## Domain Conventions

- Stable IDs: `ch02_p14_s03`, word IDs `w0001`.
- `SentenceNode` carries both display text and TTS text. Lyrics render display text; inference uses TTS text.
- Each display `WordToken` maps to a TTS span so abbreviation/number expansion does not break highlighting.
- Sentences longer than ~400 characters are split into TTS chunks at semicolons/em dashes/conjunctions, but remain one visual sentence.
- Word timing weights: `alpha * phonemeCount + beta * vowelCount + punctuationPause`.
- Cache audio as Int16 in OPFS. Never store audio in IndexedDB.
- Use `crypto.randomUUID()` for IDs and SHA-256 for book fingerprints.
- Prefer pure functions in `core/` and unit-test them.
- Use `type` imports and avoid `any` at worker/module boundaries.

## Browser and Deployment Constraints

- COOP/COEP headers are required for threaded WASM/SharedArrayBuffer. Configure Vite dev/preview and deployment files (Cloudflare Pages/Netlify/Vercel).
- GitHub Pages cannot set headers; document the single-thread fallback.
- WebGPU is optional. Fall back to WASM `q8`.
- WebCodecs AAC is optional. Fall back to MP3.
- `showSaveFilePicker` is optional. Fall back to OPFS temp + blob download.
- Safari/iOS need user-gesture `AudioContext` resume and safe-area handling.
- Scanned image-only PDFs (no OCR) and DRM-protected EPUBs should fail with a clear message.
- M4B `chpl` chapters are widely supported but not guaranteed in Apple Books.

## Current Status

- **Phase 0 — complete.** Vite 7 + React 19 + TypeScript 5.9 + Tailwind v4 scaffold, design tokens, shared UI primitives, theme engine, error boundary, COOP/COEP headers, deploy configs, and asset copying.
- **Phase 1 — complete.** Domain schema, IndexedDB/OPFS storage, text normalization and speech expansion, sentence/word/chunk builder, EPUB parser (nav + NCX + heading-level splitting), PDF layout engine, palette extraction, parser worker/client, bookshelf, import sheet, window dropzones, and progress UI.
- `npm run typecheck && npm run lint && npm run test && npm run build` passes (9 files, 41 tests).
- Next: Phase 2 — Kokoro TTS worker, PCM cache, audio scheduler, playback controls.

## Phase Tracker

| Phase | Status | Notes |
|---|---|---|
| 0. Scaffold + design system | Complete | Vite/React/Tailwind, primitives, theme, isolation headers |
| 1. Ingestion + bookshelf | Complete | EPUB + PDF, OPFS/IDB, import UX, palette covers |
| 2. TTS + playback | In progress | |
| 3. Live Lyrics + voice/speed | Not started | |
| 4. Export + settings + polish | Not started | |

## Progress Log

Add one dated entry per milestone. Keep entries short: what changed, what passed verification, what is next.

### 2026-11-13 — Repository setup
- Created public GitHub repo.
- Added `AGENTS.md`, `README.md`, `.gitignore`.
- Initial commit pushed to `main`.

### 2026-11-13 — Phase 0 scaffold
- Added Vite 7 / React 19 / TypeScript 5.9 / Tailwind v4 app shell and design tokens.
- Added `Button`, `IconButton`, `ProgressRing`, `LogoMark`, theme hook, and error boundary.
- Configured COOP/COEP for dev and preview; added Netlify, Vercel, and Cloudflare Pages headers.
- Added `vite-plugin-static-copy` targets for ORT WASM and PDF.js CMaps/fonts.
- Added ESLint 10 flat config and Vitest. Verified typecheck, lint, tests, production build, preview headers, WASM and CMap serving.

### 2026-11-13 — Phase 1 ingestion + bookshelf
- Added domain schema (`BookDocument`, `ChapterNode`, `SentenceNode`, `WordToken`, `TtsChunk`) and parser worker contracts.
- Built normalization + speech expansion (numbers, abbreviations, symbols) and per-word TTS span mapping so display text stays intact while inference uses expanded text.
- Sentence chunker respects punctuation/conjunction boundaries and caps chunks in spoken characters, not display characters.
- EPUB: JSZip + `fast-xml-parser` + `linkedom/worker`, container/OPF/spine, EPUB3 nav and EPUB2 NCX, DRM detection, cover extraction, and splitting at the most important repeating heading level (Gutenberg packs 3–5 `<h2>` chapters per file).
- PDF: PDF.js with a nested Vite worker, local CMaps/fonts, two-column detection, line/paragraph grouping, header/footer/page-number stripping, rotated-run filtering, body-font sizing, heading/chapter detection, and a word-budget fallback.
- Storage: OPFS manager for sources/covers/cache/exports; IndexedDB schema for books, progress, settings, audio cache, and export jobs.
- Import UX: parser worker with SHA-256 fingerprint and duplicate detection, palette extraction from covers (deterministic fallback palettes), import sheet with progress, window drag-and-drop, book cards, detail sheet, and remove flow.
- Real-book QA: *Pride and Prejudice* → 76 chapters / 6,420 sentences / 130,399 words; arXiv *Attention Is All You Need* → 8 clean sections / 385 sentences / 5,716 words.
- Verified: 9 test files / 41 tests, typecheck, lint, and production build (parser + PDF workers emitted).

## Context-Management Protocol

This project is large; protect context deliberately:

1. Read this file and the **Current Status** before exploring code.
2. Use `grep`/`rg` to find symbols; read only the relevant file ranges.
3. Do not re-read the full blueprint every session. Refer to sections:
   - §4.1 PDF/EPUB ingestion
   - §4.2 TTS + OPFS cache
   - §4.3 Live Lyrics sync
   - §4.4 export pipeline
   - §5 UI specification
6. Record new decisions, API gotchas, and failed approaches in this file immediately.
7. Update **Current Status**, **Phase Tracker**, and **Progress Log** before ending a session.
8. Before claiming completion, run the full verification command set.
9. Commit and push at every coherent milestone. Do not leave the working tree dirty at the end of a session.
10. When unsure about a package API, inspect the installed types under `node_modules` or the package README instead of guessing.

## Commit and Push Protocol

- Use the global Git identity. Do not create repo-local identities.
- Use small, descriptive commits:
  - `chore: scaffold vite react app`
  - `feat(parser): add pdf geometric cleaner`
  - `fix(tts): handle model load fallback`
- Push after each milestone:
  ```bash
  git add -A
  git commit -m "..."
  git push origin main
  ```
- Never commit `node_modules/`, `dist/`, `.vite/`, model weights, generated audio, sample books, or local export files.

## Known Risks / Open Questions

- M4B `chpl` chapter compatibility in Apple Books (accepted; can add a QuickTime chapter track later).
- Full-book PCM cache can reach multiple GB; add a cache cap and clear-after-export option.
- WASM-only devices may synthesize slower than real time; UI must degrade gracefully with buffering states.
- PDF layout extraction is heuristic; test with varied real-world PDFs.
- Large books stress IndexedDB/OPFS; avoid loading entire audio or all sentences into memory at once.
