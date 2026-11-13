# Cadence

**A 100% local, browser-native eBook-to-audiobook studio with Apple Music-style Live Lyrics.**

Cadence turns `.epub` and `.pdf` books into studio-quality audiobooks directly in the browser using Kokoro-82M, WebGPU/WASM inference, OPFS storage, and a 60fps live-lyrics player. There is no backend. Books, audio, and reading progress never leave your device.

## Status

Early development. The first four milestones are complete:

1. ✅ Scaffold and Apple-inspired design system
2. ✅ EPUB/PDF ingestion, normalization, and bookshelf
3. ✅ Local Kokoro TTS, OPFS caching, and gapless playback
4. ✅ Word-synced Live Lyrics, Book Page mode, voice blending, and speed control
5. 🚧 MP3/M4B export (studio complete), lexicon, normalization rules, and polish

See [AGENTS.md](./AGENTS.md) for the engineering guide, architecture, and current progress.

## Tech Stack

- Vite 7, React 19, TypeScript 5.9
- Tailwind CSS v4, Motion
- Zustand + Immer, IndexedDB (`idb`), Origin Private File System
- `kokoro-js`, `@huggingface/transformers`, ONNX Runtime Web
- `pdfjs-dist`, JSZip, `fast-xml-parser`, `linkedom`
- Mediabunny, `@mediabunny/mp3-encoder`, WebCodecs
- Comlink workers

## Development

Requires Node 24+ and npm 11+.

```bash
npm install
npm run dev
```

The app requires cross-origin isolation for threaded WASM. The dev and preview servers set the necessary headers. See [AGENTS.md](./AGENTS.md) for deployment notes.

## Privacy

- No accounts, analytics, or telemetry.
- No book, audio, or reading data is uploaded.
- The only network request is the one-time download of the local Kokoro model and voice files from Hugging Face.

## License

TBD.
