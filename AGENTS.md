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
  /exports/<jobId>.<mp3|m4b>      # finalized export (moov last, chpl patched in place)

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
- The live deployment is GitHub Pages at `https://arp1tsingh.github.io/Cadence/`, built with `VITE_BASE=/Cadence/` by `.github/workflows/deploy-pages.yml`. Pages cannot set response headers, so it runs without cross-origin isolation and ONNX Runtime Web uses one WASM thread. This fallback has been verified end-to-end; see the deployment entry in the progress log. Local dev/preview and the Netlify/Vercel configs remain cross-origin isolated.
- All runtime asset URLs (`wasm/`, `pdfjs/`, `voices/`, bundled workers) must resolve through `import.meta.env.BASE_URL`; do not hardcode leading-slash paths.
- WebGPU is optional. Fall back to WASM `q8`.
- WebCodecs AAC is optional. Fall back to MP3.
- `showSaveFilePicker` is optional. Fall back to OPFS temp + blob download.
- Safari/iOS need user-gesture `AudioContext` resume and safe-area handling.
- Scanned image-only PDFs (no OCR) and DRM-protected EPUBs should fail with a clear message.
- M4B `chpl` chapters are widely supported but not guaranteed in Apple Books.

## Current Status

- **Phase 0 — complete.** Vite 7 + React 19 + TypeScript 5.9 + Tailwind v4 scaffold, design tokens, shared UI primitives, theme engine, error boundary, COOP/COEP headers, deploy configs, and asset copying.
- **Phase 1 — complete.** Domain schema, IndexedDB/OPFS storage, text normalization and speech expansion, sentence/word/chunk builder, EPUB parser (nav + NCX + heading-level splitting), PDF layout engine, palette extraction, parser worker/client, bookshelf, import sheet, window dropzones, and progress UI.
- **Phase 2 — complete.** Kokoro TTS worker with a foreground/prefetch queue, OPFS Int16 audio cache keyed by engine version + voice + text hash, Web Audio scheduler, player session (lookahead, buffering, seek, chapter/voice restart), MediaSession and Wake Lock, settings/player stores, and the player UI (lyrics stage, glass dock, chapter drawer, voice sheet, model setup, error overlay).
- **Phase 3 — complete.** Offline WSOLA time-stretching in `stretch.worker.ts` with a rate-aware session timeline and speed sheet; Book Page reader with memoized chapter paragraphs, imperative sentence/word sweep, auto-scroll plus resume pill, and tap-to-seek; per-chapter synthesis rings in the drawer; and a barycentric 3-voice style pad that blends two or three 256-float voice rows.
- **Phase 4 — complete.** Export studio with streaming MP3 (LAME WASM) and M4B (AAC at 48 kHz via `AudioSampleSource` resampling) encodes; the exporter worker reads Int16 PCM straight from OPFS, writes through `StreamTarget` into an OPFS file, and patches Nero `chpl` into `moov/udta` after the moov lands at EOF. Cache-only `ensureCached()` synthesizes only on misses and loads the model lazily, so exporting already-listened audio never touches inference. Pause/resume/cancel, persisted job history, and streamed downloads are wired.
- Settings and speech controls: one `SettingsSheet` (Narration / Pronunciation / Storage) reachable from the library and player headers. Narration covers the model tier (`balanced` q8 WASM, `quality` WebGPU fp32, `auto`), default narrator, and speed. Pronunciation applies a case-insensitive, longest-match lexicon (multi-word phrases, possessives, empty replacement = skip) plus abbreviation, citation, and URL normalization rules at synthesis time through pure `respellSentence()`, preserving display text, word ids, spans, and chunks. Storage shows rendered-audio usage and a soft cap (512 MB / 1 GB / 2 GB / 4 GB / Unlimited, oldest-first eviction) with a clear-all action.
- Cache correctness: the key stays `TTS_ENGINE_VERSION + voiceKey + sentence.id + SHA-256(ttsText)`, so changed speech settings are a natural miss. `AudioCacheEntry.speechKey` (FNV-1a of the canonical profile) lets chapter rings ignore entries rendered under other settings; a hit is re-marked with the active key. Export captures voice, speech profile, cap, and tier at start so a mid-export settings change cannot mix renderings. A tier change reloads and disposes the previous ONNX session on the next narration start.
- Real-browser QA (Edge, `playwright-core`): q8 WASM download (88 MB), model init, word-level playback, prefetch cache growth, pause/resume, next sentence, chapter jump, per-voice caching (`af_heart` + `bf_emma`), 1.5× WSOLA duration (52,082 s → 34,721 s), Book Page word sweep and tap seek, 76 chapter rows with cache rings, and a 3-voice blend cached under `af_heart+bf_emma-48+am_michael-47` with all three shares in the dock.
- Export QA uses a synthetic two-chapter book with pre-seeded Int16 cache (45 tones): M4B whole-book → 865,332 B, 77.40 s, boxes `ftyp/mdat/moov`, moov at EOF, `chpl` marks at 0 s and 68.8 s, decodes to 77.42 s; MP3 chapter → 138,932 B, 8.60 s, decodes to 8.64 s; pause held the encoder, resume finished, cancel deleted the partial file, and three history rows persisted. Headless Edge has no AAC encoder; headed Edge encodes AAC at 44.1/48 kHz, not 24 kHz — hence the resample.
- Settings QA (fresh Edge profile, synthetic 1-chapter/3-sentence book): model tier, lexicon entry, and citation/URL rules persisted across reloads. Default-profile audio read `0 of 1 fully cached` under the new speech profile; re-seeding the respelled cache with `speechKey 7d177ad4` read `1 of 1 fully cached`. Playback used the seeded respelled cache and stayed at 6 entries (no new inference). A 512 MB cap reclaimed 7 oldest-first entries and left 2; clear-all left 0; zero console/page errors.
- Measured on the QA laptop (i5-8265U, 15 W, 4 threads): Kokoro q8 WASM runs at roughly **0.2× real time** (3.7 s of audio in ~19–25 s), and fp32 WASM is not faster. Threading scales only ~1.1×. The UI now labels this state instead of showing an indefinite spinner.
- `npm run typecheck && npm run lint && npm run test && npm run build` passes (21 files, 146 tests, zero lint warnings).
- **Deployed.** GitHub Pages workflow `.github/workflows/deploy-pages.yml` lints, tests, and builds with `VITE_BASE=/Cadence/`, then publishes `dist/` to `https://arp1tsingh.github.io/Cadence/`. PDF.js CMap/font URLs now derive from `import.meta.env.BASE_URL`. A local no-isolation smoke test (Edge, `playwright-core`) confirmed `crossOriginIsolated: false`, q8 model load, playback from a seeded OPFS cache, unchanged cache count (no re-synthesis), and zero console errors.
- Next: cross-browser QA sweep (Safari/iOS gesture and safe-area behavior, Firefox WASM fallback), and a large-library storage stress pass.


## Phase Tracker

| Phase | Status | Notes |
|---|---|---|
| 0. Scaffold + design system | Complete | Vite/React/Tailwind, primitives, theme, isolation headers |
| 1. Ingestion + bookshelf | Complete | EPUB + PDF, OPFS/IDB, import UX, palette covers |
| 2. TTS + playback | Complete | Kokoro worker, OPFS PCM cache, scheduler, player UI |
| 3. Live Lyrics + voice/speed | Complete | Book Page, WSOLA speed, 3-voice pad, chapter cache rings |
| 4. Export + settings + polish | Complete | MP3/M4B + chpl, settings sheet, lexicon/rules, tiers, cache caps |

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

### 2026-11-13 — Phase 2 TTS + playback
- `tts.worker.ts`: Comlink-exposed priority queue (foreground jumps ahead of prefetch), cache-first synthesis, and `cancelPending()` so seeks and voice changes are not starved by stale work. Transferable Float32 PCM to the main thread.
- `engine.ts`: Kokoro via `kokoro-js` with `@huggingface/transformers` 3.8.1; OPFS custom model cache; WebGPU → WASM fallback; monotonic load progress (Transformers.js reports per-file progress); voice-style blending; eSpeak phonemization of whole spans; long-phrase splitting at ≤38 words / ≤500 phoneme tokens.
- Audio cache: 16-bit PCM in OPFS under `cache/<bookId>/<voiceKey>/<key>.i16`, metadata and word timings in IndexedDB. Cache key = engine version + voice key + sentence id + SHA-256 of the TTS text, so pronunciation changes never reuse stale audio.
- Playback: `AudioScheduler` schedules sentences sample-accurately on the Web Audio clock with a 0.3 s lead; `PlayerSession` runs 6-sentence lookahead, suspends the context while buffering, resumes when audio arrives, and persists progress. MediaSession + Wake Lock wired.
- UI: Live Lyrics stage with clipped-duplicate word fills written from `requestAnimationFrame` (no per-word React renders), glass transport dock with a scrubber, chapter drawer, voice sheet with two-voice blend slider, first-run model overlay, and a start-listening CTA that preserves the iOS user gesture.
- Fixed static-copy targets to strip `node_modules/...` base paths; voices now resolve at `/voices/*.bin`, ORT at `/wasm/`, PDF.js at `/pdfjs/cmaps` and `/pdfjs/standard_fonts`.
- Fixed a drain bug that dropped ready audio when the graph could not accept it, and empty-audio sentences now advance the timeline instead of stalling it.
- Real-browser QA with Edge + `playwright-core` on a persistent profile: confirmed playback, prefetch growth, pause/resume, next sentence, chapter jump, and both `af_heart` and `bf_emma` cache directories.
- Performance observation: on the 15 W i5-8265U QA laptop, q8 WASM is ~0.2× real time and fp32 is not faster; 4 threads add ~10% over 1. The dock now says "Synthesizing on this device — slower than real time…" after 6 s of buffering.
- Verified: 14 test files / 78 tests, typecheck, lint (0 warnings), production build.

### 2026-11-13 — Phase 3 Live Lyrics + voice/speed
- Added offline WSOLA (`wsola.ts`, 10 tests) and `stretch.worker.ts`/`stretchClient.ts`. Speed changes never re-synthesize or shift pitch; timings are scaled with the audio.
- `PlayerSession` now maps playback time to 1× content time for seeking, positions, and MediaSession, stretches as synthesis resolves, and keeps in-flight inference when nothing is scheduled instead of restarting the timeline.
- Added `SpeedSheet` (0.5–3×, 0.05 steps, presets, finish-time preview) and a dock speed pill; `playbackRate` persists in settings.
- Added Book Page reader mode: memoized chapter paragraphs, active-sentence illumination, imperative word sweep, auto-scroll with a resume pill, and tap-to-seek. `lyricsMode` persists; the header toggles focus lyrics ↔ Book Page.
- Added per-chapter cache rings and spinner in the chapter drawer, filtered by the active narrator.
- Added a 3-voice barycentric mixer (`VoiceBlendPad`), `tertiary`/`tertiaryWeight` in `VoiceSelection`, normalized `voiceWeightsFor()` blending, three-voice cache keys and labels, and auto-scroll to the pad when enabled. The engine sums N style rows.
- Real-browser QA: 1.5× duration exactly `52082.03 / 1.5 = 34721.35`, playback resumed, Book Page 24 sentences with word sweep and tap seek, auto-scroll pill, 76 chapter rows (75 rings + 1 spinner), and a 3-voice mix synthesized under `af_heart+bf_emma-48+am_michael-47` with `Narrated by Heart 28% · Emma 25% · Michael 47%`.
- Verified: 17 test files / 105 tests, typecheck, lint (0 warnings), production build (stretch worker emitted).

### 2026-11-13 — Phase 4 export studio (MP3 + M4B)
- Added `core/export/chpl.ts`: 32/64-bit box parsing, `chpl` insert/replace, title trimming, and moov growth in place; 15 tests.
- Added `core/export/plan.ts`: ordered chapter/sentence plans, portable file stems, suggested names, cover MIME detection; 7 tests.
- `exporter.worker.ts` streams Int16 PCM from OPFS into Mediabunny, through `StreamTarget` into an `exports/<jobId>.<format>` writable, then patches `moov/udta/chpl` at EOF so no media offset moves. MP3 uses LAME via `@mediabunny/mp3-encoder` at 128 kbps; M4B uses WebCodecs AAC at 96 kbps, resampled to 48 kHz (44.1 kHz fallback) because platform AAC encoders reject 24 kHz.
- `ensureCached()` in `tts.worker.ts` caches without transferring PCM, uses prefetch priority, retries after playback `cancelPending()`, and loads the model lazily only on a cache miss. Export never crosses the main thread with book-scale audio.
- Added the export store (start/pause/resume/cancel, 1.5 s persistence throttle, interrupted-job recovery, streamed `showSaveFilePicker` download with blob fallback) and the Export Studio sheet (format + scope + chapter picker, progress, history with download/delete), reachable from the library detail sheet and the player header.
- Real-browser QA (headed Edge, synthetic 2-chapter/45-sentence book with pre-seeded cache): M4B whole-book → 865,332 B, 77.40 s, `ftyp/mdat/moov`, moov at EOF, `chpl` at 0 s + 68.8 s, decoded 77.42 s; MP3 chapter → 138,932 B, 8.60 s, decoded 8.64 s; pause held, resume completed, cancel removed the partial file; 3 history rows; player-header entry works; no console errors.
- Verified: 19 test files / 127 tests, typecheck, lint (0 warnings), production build (exporter worker emitted).

### 2026-11-13 — Phase 4 settings, lexicon, and cache management
- Added `types/speech.ts` (`LexiconEntry`, `NormalizationRules`, `SpeechProfile`, defaults, 8-word phrase limit) and `core/parsing/speech.ts` exports so the parser and the lexicon share one expansion path. `buildSpokenWords()` is now exported and rebuilds word spans/chunks from existing ids.
- Added `core/tts/respell.ts`: case/punctuation-insensitive matching, longest multi-word match, possessive handling, disabled entries, empty replacement = skip, Roman numerals after chapter-like words, bracketed/author-year citation removal, and URL → "link". Display text, ids, spans, and chunk layout are preserved. 12 tests.
- Cache correctness: `AudioCacheEntry.speechKey` records an FNV-1a fingerprint of the canonical profile; chapter rings filter by it and a cache hit refreshes it. Speech is applied in the TTS worker before `sentenceCacheKey()`, so stale audio is never reused. Added `cachePolicy.ts` (2 GB default, oldest-first eviction) and `cacheManager.ts` (usage, apply cap, clear all rendered audio); 5 tests.
- Playback/settings wiring: `PlayerSession` accepts `speech` and `cacheCapBytes`, restarts the timeline when the profile changes, and tracks `loadedTier` so a tier change reloads/disposes the old ONNX session on the next start. `playerStore` syncs settings through a store subscription; exports capture voice, profile, cap, and tier at job start.
- Added `Switch` and the `SettingsSheet` (Narration / Pronunciation / Storage), mounted in the library shell and player; gear buttons in both headers. Storage shows usage, cap options, and clear-all with confirmation.
- Real-browser QA (fresh Edge profile, synthetic 1-chapter/3-sentence book): tier/lexicon/rules persisted across reloads; default cache read `0 of 1 fully cached`, seeded `speechKey 7d177ad4` read `1 of 1 fully cached`; playback advanced to 0.5 s from the seeded cache and stayed at 6 entries (no new inference); a 512 MB cap reclaimed 7 oldest-first entries leaving 2; clear-all left 0; no console or page errors.
- Known limitation: replacements are respellings, not IPA. The bundled `phonemizer` only emits IPA and espeak's `[[...]]` phoneme input is unavailable, so users spell the sound (`Her-my-oh-nee`).
- Verified: 21 test files / 146 tests, typecheck, lint (0 warnings), production build.

### 2026-11-13 — GitHub Pages deployment
- Added `.github/workflows/deploy-pages.yml`: Node 24, `npm ci`, lint, test, build with `VITE_BASE=/Cadence/`, then `configure-pages`/`upload-pages-artifact`/`deploy-pages` on every push to `main`.
- `vite.config.ts` now takes `base` from `VITE_BASE` (default `/`), and PDF.js CMap/standard-font URLs derive from `import.meta.env.BASE_URL` instead of hardcoded roots.
- Local no-isolation smoke test (Edge, `playwright-core`, static server without COOP/COEP to mirror Pages): `crossOriginIsolated: false`, q8 model loaded, seeded OPFS cache played from 0 to 0.5 s in 16 s on a warm profile, cache stayed at one entry (no re-synthesis), zero console/page errors.
- README now links the live demo and states the single-thread Pages limitation; AGENTS records the base-URL rule.
- Verified: typecheck, lint (0 warnings), 21 test files / 146 tests, production build with `/Cadence/` base (favicon, entry assets, PDF CMaps, ORT WASM all prefixed correctly).

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
4. Record new decisions, API gotchas, and failed approaches in this file immediately.
5. Update **Current Status**, **Phase Tracker**, and **Progress Log** before ending a session.
6. Before claiming completion, run the full verification command set.
7. Commit and push at every coherent milestone. Do not leave the working tree dirty at the end of a session.
8. When unsure about a package API, inspect the installed types under `node_modules` or the package README instead of guessing.

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
- Rendered PCM can still reach multiple GB before eviction; the default 2 GB soft cap sweeps oldest-first every 8 writes and immediately when lowered. Clearing rendered audio keeps models, books, progress, and exports.
- WASM-only devices may synthesize slower than real time; measured ~0.2× real time on a 15 W i5 with q8, so buffering can last tens of seconds per sentence. The dock labels this, but the next real lever is WebGPU (real adapter) and/or a faster WASM configuration.
- Lexicon replacements are respellings, not IPA: `phonemizer` only emits IPA and espeak `[[...]]` input is not exposed, so users must spell the sound (`Her-my-oh-nee`). Revisit if the engine gains phoneme input.
- A tier change disposes and reloads the ONNX session on the next narration start. The old session stays resident until then; switching back and forth repeatedly can re-download nothing (OPFS cache) but does pay session init each time.
- Seek, voice change, and pause call `cancelPending()`; the one in-flight inference still finishes and is cached, so a switch can lag by at most one sentence.
- Blended voices are phonemized in the primary voice's language; the style rows mix timbre and prosody but not phoneme inventories. Mixing en-US and en-GB voices therefore uses the primary accent's phonemes.
- Speed changes restart the current sentence only when audio is already scheduled; if synthesis is still running, the request resolves at the new rate and no inference is wasted.
- PDF layout extraction is heuristic; test with varied real-world PDFs.
- Large books stress IndexedDB/OPFS; avoid loading entire audio or all sentences into memory at once.
