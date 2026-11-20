# Cadence

**A 100% local, browser-native eBook-to-audiobook studio with Apple Music-style Live Lyrics.**

**Live demo:** https://cadenceaudio.vercel.app/

Cadence turns `.epub` and `.pdf` books into studio-quality audiobooks directly in the browser using two neural narration engines — **Flash** (Piper/VITS, real-time on a laptop CPU) and **Studio** (Kokoro-82M, WebGPU/WASM) — with OPFS storage and a 60fps live-lyrics player. There is no backend. Books, audio, and reading progress never leave your device.

## Status

The core implementation is complete across five milestones:

1. ✅ Scaffold and Apple-inspired design system
2. ✅ EPUB/PDF ingestion, full-page PDF artwork extraction, normalization, and bookshelf
3. ✅ Local Kokoro TTS, OPFS caching, and gapless playback
4. ✅ Word-synced Live Lyrics, Book Page mode, voice blending, and speed control
5. ✅ MP3/M4B export, pronunciation lexicon, normalization rules, model tiers, and cache management
6. ✅ Flash mode: Piper narration at or above real time, with a per-voice download and Studio/Flash export choice

See [AGENTS.md](./AGENTS.md) for the engineering guide, architecture, and current progress.

## Deployment

Cadence is deployed on Vercel at [cadenceaudio.vercel.app](https://cadenceaudio.vercel.app/). The `main` branch is linked through Vercel's Git integration, so every push to `main` creates a production deployment.

Cadence is a static Vite SPA with no server-side code. To deploy your own copy, import the repository at [vercel.com/new](https://vercel.com/new) or run:

```bash
npx vercel --prod
```

No environment variables are required. [`vercel.json`](./vercel.json) pins the install (`npm ci`), build (`npm run build`), and output (`dist`) settings, and sends COOP/COEP headers so the deployed app is cross-origin isolated and can use multi-threaded WASM. Hosts that cannot set those headers still work with a single WASM thread, just slower. A Netlify config is included for parity.

PDF imports use the document outline for chapter titles and boundaries when it has at least two chapter-like entries, and the cover is rendered on an OffscreenCanvas inside the parser worker. Full-page illustrations are detected during import (low-text pages inside the narrated outline range that paint a large image), rendered to JPEG, and stored in local browser storage. When the next page is artwork, the player pins it above the lyrics or Book Page while the previous page is narrated; this can be turned off in Settings → Narration → Reading. Image-only pages have no text layer, so they are not narrated, and PDFs imported before this feature need to be added again to gain page provenance and artwork.

For a deployment served from a subpath, set `VITE_BASE` at build time (for example `VITE_BASE=/cadence/`).

## Tech Stack

- Vite 7, React 19, TypeScript 5.9
- Tailwind CSS v4, Motion
- Zustand + Immer, IndexedDB (`idb`), Origin Private File System
- `kokoro-js`, `@huggingface/transformers`, ONNX Runtime Web
- Piper/VITS voices through ONNX Runtime Web, with bundled eSpeak phonemization (`phonemizer`)
- `pdfjs-dist`, JSZip, `fast-xml-parser`, `linkedom`
- Mediabunny, `@mediabunny/mp3-encoder`, WebCodecs
- Comlink workers

## Development

Requires Node 24+ and npm 11+.

```bash
npm install
npm run dev
```

The app requires cross-origin isolation for threaded WASM. The dev and preview servers set the necessary headers. Without them the app still runs with a single WASM thread. See [AGENTS.md](./AGENTS.md) for deployment notes.

In development, the browser console logs the narration backend, dtype, WASM thread count, cross-origin isolation status, and the real-time factor of every synthesized sentence. These diagnostics are compiled out of production builds.

## Privacy

- No accounts, analytics, or telemetry.
- No book, audio, or reading data is uploaded.
- The only network requests are the one-time downloads of the local narration models and voice files from Hugging Face.

## Narration voices

**Flash** uses six 22.05 kHz Piper “medium” voices, downloaded on first use (about 63 MB each):

| Voice | License |
|---|---|
| `en_US-kathleen-medium` (default) | CC0 |
| `en_US-amy-medium` | CC BY-SA 4.0 |
| `en_GB-alba-medium` | CC BY 4.0 |
| `en_US-joe-medium` | CC0 |
| `en_US-norman-medium` | public domain |
| `en_GB-northern_english_male-medium` | CC BY-SA 4.0 |

Voices are fetched at runtime from [`rhasspy/piper-voices`](https://huggingface.co/rhasspy/piper-voices); their licenses stay with the voice authors. **Studio** uses the built-in Kokoro-82M voice catalog. Exports can be rendered with either engine, and cached audio is keyed by engine, voice, and speech settings so renderings never mix.

## License

TBD.
