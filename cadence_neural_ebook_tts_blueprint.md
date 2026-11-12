# Cadence: 100% Local Neural eBook TTS & Live Lyrics Web Application
**System Architecture, AI Pipeline & Apple Human Interface Design Blueprint**

---

## 1. Executive Summary & Core Philosophy

**Cadence** is a privacy-first, zero-server web application that transforms `.epub` and `.pdf` eBooks into studio-quality audiobooks directly inside the browser. By combining **WebGPU-accelerated ONNX neural speech synthesis (Kokoro-82M)**, **Origin Private File System (OPFS)** storage, and an **Apple Music-inspired Live Lyrics interface**, Cadence achieves native-app fluidity without sending a single byte of user data to the cloud.

### Core Architectural Pillars
1. **100% Client-Side Execution:** All parsing, text normalization, neural inference, audio encoding, and storage occur locally on the user's device.
2. **Zero-Latency Lookahead Synthesis:** Users press play and hear audio within $<800\text{ ms}$. A background Web Worker synthesizes upcoming sentences ahead of the playhead.
3. **Memory-Safe Full Book Export:** Synthesizes and streams hours of audio directly to disk via `FileSystemWritableFileStream` and OPFS without exceeding browser RAM limits.
4. **Apple-Grade Fluidity:** Built around spring physics, dynamic cover-art mesh gradients, Gaussian blur materials, and 60fps `requestAnimationFrame` audio-synced typography.

---

## 2. Recommended Tech Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Framework** | **Next.js 15 (App Router, Static Export `output: 'export'`)** or **Vite + React 19 (TypeScript)** | Pure static SPA bundle deployable to Cloudflare Pages / Vercel / GitHub Pages. |
| **Styling & Motion** | **Tailwind CSS v4 + Motion (Framer Motion)** | Apple spring physics, layout transitions, squircle radii, and backdrop materials. |
| **State Management** | **Zustand + Immer** | High-frequency reactive state for playback queues, worker status, and UI drawers. |
| **EPUB Engine** | **`@lingo-reader/epub-parser` or custom `JSZip` + `DOMParser`** | Fast, worker-compatible Spine/NCX/OPF extraction and HTML chapter sanitization. |
| **PDF Engine** | **`pdfjs-dist` (v4.x Web Worker build)** | Bounding-box aware text extraction, geometric header/footer stripping, font metric inspection. |
| **Neural TTS Engine** | **`kokoro-js` (`onnxruntime-web` + `@huggingface/transformers`)** | Local execution of **Kokoro-82M** (82M params, Apache 2.0) via WebGPU (`fp16`/`q8`) with WASM SIMD fallback. |
| **Phonemizer** | **`espeak-ng` (WASM build) + Custom Lexicon** | Converts normalized text into IPA phonemes for Kokoro-82M and calculates phoneme weights for word-sync. |
| **Audio Playback** | **Web Audio API (`AudioContext` + `AudioWorklet`)** | Sample-accurate gapless scheduling, pitch-preserving time stretch (WSOLA), and real-time clock tracking. |
| **Audio Encoding** | **`mp4-muxer` + WebCodecs `AudioEncoder` (AAC) / `lamejs` (MP3)** | Hardware-accelerated M4B (with chapter markers) and MP3 stream encoding. |
| **Local Storage** | **Origin Private File System (OPFS) + `idb` (IndexedDB)** | OPFS stores binary `.onnx` weights, `.pcm`/`.aac` cached audio chunks, and raw eBooks; IndexedDB stores book metadata & reading progress. |

---

## 3. System Architecture & Threading Model

To keep the Apple-style UI running at a locked $60\text{--}120\text{ fps}$, **zero heavy computation is permitted on the Main UI Thread**. Cadence partitions execution across four contexts:

```
+-----------------------------------------------------------------------------------+
|                                  MAIN UI THREAD                                   |
|  - React 19 + Motion Spring UI          - Web Audio API Graph & Playhead Clock    |
|  - rAF Live Lyrics Scroll & Highlight   - MediaSession API (OS Lock Screen)       |
+-------------------+-----------------------------------+---------------------------+
                    | Comlink RPC / Transferable ArrayBuffers
        +-----------+---------------+-------------------+---------------+
        |                           |                                   |
        v                           v                                   v
+-------+---------------+   +-------+-----------------------+   +-------+---------------+
|   PARSER WEB WORKER   |   |  NEURAL TTS INFERENCE WORKER  |   |  ENCODER / IO WORKER  |
| - PDF Bounding-Box    |   | - ONNX Runtime Web (WebGPU)   |   | - OPFS Read/Write     |
|   Filter & De-hyphen  |   | - Kokoro-82M Model Execution  |   | - LAME MP3 / M4B Mux  |
| - EPUB Spine Parser   |   | - eSpeak-NG WASM Phonemizer   |   | - FileSystemWritable  |
| - Smart Sentence      |   | - Lookahead Queue Manager     |   |   Stream to User Disk |
|   Tokenizer & Cleaner |   | - Custom Lexicon Replacement  |   | - Cache Garbage Coll. |
+-----------------------+   +-------------------------------+   +-----------------------+
```

---

## 4. End-to-End Functional Modules & Pipeline Specifications

### Module 1: Intelligent Document Ingestion (PDF & EPUB)

#### 1.1 PDF Geometric Layout & Artifact Stripper
Standard PDF text extraction pulls running headers, footers, page numbers, and broken hyphenated lines, which destroys TTS immersion. Cadence implements a geometric heuristic cleaner:
1. **Bounding-Box Extraction:** For each page $P_i$ with height $H$ and width $W$, extract all text items via `page.getTextContent()`. Each item carries a transformation matrix $[a, b, c, d, x, y]$.
2. **Header/Footer Pruning:** Discard any text item where normalized vertical coordinate $y_{\text{norm}} = \frac{y}{H}$ satisfies:
   $$y_{\text{norm}} > 0.92 \quad \text{or} \quad y_{\text{norm}} < 0.08$$
   *(Confirmed further by checking if the string matches purely numeric page patterns `^\s*\d+\s*$` or repeats verbatim across $\ge 3$ consecutive pages).*
3. **De-Hyphenation & Line Reconstruction:** Merge lines where line $L_k$ ends with a hyphen (`-` or `\u00AD`) and the first token of $L_{k+1}$ starts with a lowercase ASCII character, verifying against a lightweight dictionary/heuristic so compound words (e.g., *state-of-the-art*) retain their hyphens.
4. **Paragraph Grouping:** Group text runs into paragraphs based on vertical line-spacing deltas ($\Delta y > 1.4 \times \text{fontHeight}$).

#### 1.2 EPUB Spine & Semantic Sanitizer
1. Unzip `.epub` in memory via `JSZip`.
2. Parse `META-INF/container.xml` $\rightarrow$ `content.opf` $\rightarrow$ extract metadata (Title, Author, Cover Blob) and ordered `<spine>` + `toc.ncx` / Navigation Document.
3. Parse each XHTML chapter file, stripping `<script>`, `<style>`, `<sup class="footnote">`, `<aside>`, and invisible ARIA nodes.
4. Extract semantic headings (`<h1>`–`<h3>`) to construct a clean Chapter Tree.

#### 1.3 Smart Text Normalization & Skip Rules Engine
Before any text reaches the TTS model, it passes through a configurable Regex + AST normalizer:
* **Skip Inline Citations:** Toggles to strip academic citations such as `[12]`, `[1, 4–7]`, and `(Smith et al., 2021)`.
* **Skip URLs & Raw Code:** Replaces long URLs with `"link"` (or skips entirely) and skips `<pre><code>` blocks or markdown tables.
* **Abbreviation Expansion:** Converts `e.g.` $\rightarrow$ `"for example"`, `i.e.` $\rightarrow$ `"that is"`, `Ch.` $\rightarrow$ `"Chapter"`, `Fig.` $\rightarrow$ `"Figure"`, `Dr.` $\rightarrow$ `"Doctor"`, and Roman numerals (`Chapter IV` $\rightarrow$ `"Chapter 4"`).
* **Custom Pronunciation Lexicon:** Users can add custom word-to-phonetic/IPA overrides via a clean UI modal (e.g., `"Hermione"` $\rightarrow$ `"Her-my-oh-nee"` or direct IPA `/hɜːˈmaɪəni/`).

#### 1.4 Hierarchical Tokenization Schema
Every book is normalized into a deterministic JSON schema stored in IndexedDB:
```typescript
interface BookDocument {
  id: string; // SHA-256 hash of file binary
  title: string;
  author: string;
  coverBlobUrl?: string;
  dominantColors: [string, string, string]; // Extracted for Apple Music Mesh Gradient
  chapters: Chapter[];
}

interface Chapter {
  id: string;
  title: string;
  index: number;
  paragraphs: Paragraph[];
}

interface Paragraph {
  id: string;
  sentences: SentenceNode[];
}

interface SentenceNode {
  id: string; // e.g., "ch02_p14_s03"
  rawText: string;
  normalizedText: string;
  words: WordToken[];
  audioStatus: 'unrendered' | 'queued' | 'synthesizing' | 'cached';
  durationMs?: number; // Populated once synthesized
}

interface WordToken {
  text: string;
  charStart: number;
  charEnd: number;
  weight: number; // Phoneme/syllable + punctuation pause weight
  startMs?: number; // Computed exactly upon AudioBuffer generation
  endMs?: number;
}
```

---

### Module 2: 100% Local Neural TTS Engine & OPFS Caching

#### 2.1 Primary Model: Kokoro-82M (ONNX WebGPU / WASM)
* **Why Kokoro-82M:** At only $82\text{ million}$ parameters ($\sim 86\text{ MB}$ quantized `q8` / `fp16`), Kokoro-82M rivals ElevenLabs in prosody, breathiness, and emotional cadence while running $8\times\text{--}25\times$ faster than real-time on Apple Silicon / modern GPUs via WebGPU, and $2\times\text{--}4\times$ faster than real-time on CPU via WASM SIMD.
* **Included Curated Human Voices:**
  * `af_heart` / `af_bella` (Warm, expressive American Female — ideal for fiction)
  * `am_adam` / `am_michael` (Deep, articulate American Male — ideal for non-fiction)
  * `bf_emma` (Refined British Female — ideal for classics & history)
  * `bm_george` (Warm British Male — narrative storytelling)
* **Voice Blending Support:** Because Kokoro uses style vectors ($256\text{-dim}$ float arrays), users can blend two voices using an Apple-style continuous XY pad (e.g., $70\%$ `af_bella` + $30\%$ `bf_emma`).

#### 2.2 First-Run Model Onboarding & OPFS Persistence
1. On first launch, a sleek Apple-style floating setup sheet downloads the Kokoro ONNX weights with a smooth progress ring and speed readout.
2. Weights are streamed directly into the **Origin Private File System (OPFS)** under `/models/kokoro-v1.0-q8.onnx` so they persist permanently across browser restarts and are never re-downloaded.
3. Hardware capability detection automatically selects `executionProviders: ['webgpu', 'wasm']`.

#### 2.3 Lookahead Streaming Buffer (Zero-Latency Playback)
When the user taps **Play** on Sentence $S_k$:
1. **Priority Interrupt:** If $S_k$ is not yet cached in OPFS (`/cache/{bookId}/{voiceId}/{sentenceId}.pcm`), the TTS Worker immediately halts any low-priority background batching and synthesizes $S_k$.
2. **Immediate Playback:** As soon as $S_k$ finishes synthesis ($\sim 300\text{--}600\text{ ms}$), its `Float32Array` ($24,000\text{ Hz}$ mono PCM) is transferred zero-copy to the Main Thread and scheduled on the `AudioContext`.
3. **Rolling Lookahead Window:** The Worker automatically maintains a rolling buffer of the next $N = 6$ sentences ($S_{k+1} \dots S_{k+6}$).
4. **Gapless Scheduling:** The Main Thread uses `AudioBufferSourceNode.start(nextStartTime)` where:
   $$\text{nextStartTime}_{k+1} = \text{startTime}_k + \frac{\text{buffer}_k.\text{duration}}{\text{playbackRate}}$$
   This guarantees sample-accurate, zero-gap transitions between sentences.

---

### Module 3: Apple Music "Live Lyrics" Synchronization Engine

To achieve the signature Apple Music Live Lyrics experience without running a heavy secondary Whisper forced-alignment model in the browser, **Cadence** combines **Exact Sentence Audio Boundaries** with **Phoneme-Weighted Intra-Sentence Interpolation**.

```
Sentence AudioBuffer Duration: D = 3,420 ms (Exact from Web Audio API)
+-------------------------------------------------------------------------+
| "The"    | "ancient"      | "library,"        | "silent"    | "for..."  |
| w = 0.06 | w = 0.16       | w = 0.26 (+pause) | w = 0.15    | w = 0.37  |
+----------+----------------+-------------------+-------------+-----------+
0 ms     205 ms           752 ms             1,641 ms      2,154 ms    3,420 ms
```

#### 3.1 Phoneme & Punctuation Weighted Timing Formula
When the TTS Worker phonemizes a sentence $S$ with $M$ words $w_1, w_2, \dots, w_M$, each word $w_i$ is assigned a temporal weight $\omega_i$:
$$\omega_i = \left(\alpha \cdot N_{\text{phonemes}}(w_i) + \beta \cdot N_{\text{vowels}}(w_i)\right) + P_{\text{punct}}(w_i)$$
Where:
* $N_{\text{phonemes}}(w_i)$ is the phoneme count returned by `espeak-ng` for word $w_i$.
* $N_{\text{vowels}}(w_i)$ adds slight extra weight for elongated vowel nuclei.
* $P_{\text{punct}}(w_i)$ accounts for natural prosodic pauses generated by Kokoro after punctuation:
  * Comma `,` / Semicolon `;` / Em-dash `—`: $+4.5$ phoneme-equivalents
  * Colon `:`: $+5.5$ phoneme-equivalents
  * Period `.` / Question `?` / Exclamation `!` (mid-chunk): $+8.0$ phoneme-equivalents

Once the `AudioBuffer` for sentence $S$ is generated with exact acoustic duration $D_{\text{exact}}$ (after trimming leading/trailing silence below $-45\text{ dBFS}$):
$$\text{startMs}(w_i) = T_{\text{lead}} + D_{\text{active}} \cdot \frac{\sum_{j=1}^{i-1} \omega_j}{\sum_{j=1}^{M} \omega_j}, \qquad \text{endMs}(w_i) = T_{\text{lead}} + D_{\text{active}} \cdot \frac{\sum_{j=1}^{i} \omega_j}{\sum_{j=1}^{M} \omega_j}$$
Because the clock resets to an **exact acoustic boundary at the start of every single sentence**, timing drift is mathematically impossible across a chapter.

#### 3.2 60fps `requestAnimationFrame` Visual Synchronization
Inside the Cadence Live Lyrics view:
* A `requestAnimationFrame` loop polls `audioContext.currentTime` to compute the exact millisecond offset within the active sentence.
* **Sentence State Hierarchy:**
  * **Active Sentence:** Scale `1.03`, opacity `1.0`, crisp `0px` blur, font-weight `600`, anchored at $35\%$ from the top of the viewport.
  * **Past Sentences:** Opacity `0.32`, blur `1.5px`, scale `0.97`.
  * **Upcoming Sentences:** Opacity `0.45`, blur `1px` (progressively increasing to `3px` for sentences further down), scale `0.98`.
* **Word-Level Karaoke Fill & Lift:**
  * Within the active sentence, the currently spoken word smoothly transitions its vertical offset (`translateY(-2px)`), text glow (`text-shadow: 0 0 18px rgba(255,255,255,0.45)`), and a CSS background-clip gradient sweep proportional to word completion percentage $p \in [0, 1]$.
* **Spring Scroll Physics:**
  * Whenever the active sentence increments ($S_k \rightarrow S_{k+1}$), the container scrolls using an Apple-tuned spring solver (`stiffness: 220, damping: 28, mass: 0.9`) with staggered cascade delays (`35ms` per paragraph line).
* **Interactive Scrubbing:**
  * If the user touches/scrolls the lyrics manually, auto-scroll immediately disengages, all blurred lines sharpen to `0px` blur, and a translucent **"Resume Auto-Scroll"** pill appears. Tapping any sentence immediately seeks playback to that sentence.

---

### Module 4: Full-Book & Chapter Audio Export Pipeline (OOM-Safe)

Synthesizing an entire $12\text{-hour}$ book into RAM at once would allocate $>8\text{ GB}$ of raw `Float32Array` buffers and crash the browser tab. **Cadence** solves this with a **Streaming Disk-Backed Batch Exporter**:

```
[Sentence Queue] ---> [TTS Worker (Kokoro)] ---> [Raw PCM Float32 (24kHz)]
                                                        |
      +-------------------------------------------------+
      v
[OPFS Cache Write] ---> [Encoder Worker (LAME MP3 / WebCodecs AAC + mp4-muxer)]
                                                        |
                                                        v
                        [FileSystemWritableFileStream (Direct to User Disk)]
                                (Memory freed after every sentence!)
```

#### 4.1 Export Modes
1. **Export Current Chapter (.mp3 or .m4b):** Fast synthesis of a single chapter.
2. **Export Complete Audiobook (.m4b with Embedded Chapter Markers & Cover Art):**
   * Uses `mp4-muxer` in `fastStart: 'fragmented'` or streaming mode + WebCodecs `AudioEncoder` (`mp4a.40.2` AAC-LC at $64\text{--}96\text{ kbps}$ mono) or `lamejs` MP3 ($128\text{ kbps}$).
   * Writes directly to the user's disk using `window.showSaveFilePicker()` (`FileSystemWritableFileStream`). For browsers without File System Access API (e.g., iOS Safari), chunks are written sequentially to an OPFS temporary file and triggered as a zero-copy `Blob` download from disk upon completion.
3. **Cache Reuse:** Any sentence already listened to during normal reading is pulled straight from the OPFS PCM cache without re-running the neural model.
4. **Pause / Resume Export:** Because each synthesized sentence is committed to OPFS before encoding, users can pause a full-book render, close the browser tab, and resume at $64\%$ the next day without losing progress.

---

### Module 5: Dynamic Speed, Pitch & OS Media Integration

* **Instantaneous Speed Adjustment (No Re-Synthesis):**
  * Uses an **AudioWorklet WSOLA (Waveform Similarity Overlap-Add)** node (or pitch-preserved HTMLMediaElement / AudioBuffer resampling pipeline) so users can slide playback speed between `0.5x` and `3.0x` in `0.05x` increments with **zero delay** and no "chipmunk" pitch distortion.
* **Native Media Session API (`navigator.mediaSession`):**
  * Populates the macOS, iOS, Windows, and Android lock screen / Dynamic Island / Control Center with the book's cover art, chapter title, book title, play/pause, $\pm 15\text{s}$ skip, and previous/next chapter hardware buttons.

---

## 5. Apple Human Interface Design Specification (UI/UX)

### 5.1 Visual Language & Materials
* **Dynamic Mesh Backdrop:** When a book is opened in Cadence, a canvas extracts the 3 dominant HSL colors from the book cover (or generates a curated palette if no cover exists) and renders a slow-moving, ultra-blurred ($120\text{px}$ Gaussian blur) animated mesh gradient behind the interface—identical to Apple Music's full-screen lyrics view.
* **Translucent Vibrancy Surfaces:**
  * Floating Control Pill: `backdrop-filter: blur(40px) saturate(190%)`, background `rgba(28, 28, 30, 0.55)` (dark mode) / `rgba(255, 255, 255, 0.65)` (light mode), `1px solid rgba(255, 255, 255, 0.14)` inner specular border.
* **Typography:**
  * **UI Chrome:** `-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", sans-serif` with tight tracking (`-0.02em`).
  * **Live Lyrics / Reader Canvas:** Switchable between **SF Pro Rounded / Display** (Apple Music style—bold, high-contrast, modern) and **New York / Charter Serif** (Apple Books style—literary, warm).
* **Squircle Geometry:** Continuous corner radii (`border-radius: 22px` for cards, `9999px` for floating pills) with subtle multi-layered ambient shadows.

### 5.2 Core Application Views

```
+-----------------------------------------------------------------------------------+
| [Cadence]  Ch 4: The Glass Horizon          [AA Font] [Lexicon] [Export Audiobook]|
|                                                                                   |
|                                                                                   |
|          The rain had stopped hours ago, leaving the cobblestones                 |  <- Past (32% opacity,
|          slick with the reflection of amber streetlamps.                          |     1.5px blur)
|                                                                                   |
|                                                                                   |
|      **  Elena stepped onto the balcony, holding the                              |  <- ACTIVE SENTENCE
|          [ancient] brass compass toward the northern ridge.  **                   |     (100% opacity, 1.03x scale,
|           ^^^^^^^ (Glowing active word fill)                                      |      0px blur, word highlight)
|                                                                                   |
|                                                                                   |
|          Below her, the harbor bell chimed twice against the                      |  <- Upcoming (45% opacity,
|          gathering fog, warning the last merchant vessels.                        |     1.0px blur)
|                                                                                   |
|          She knew the cipher had to be hidden inside the                          |  <- Upcoming (30% opacity,
|          binding of the third ledger.                                             |     2.0px blur)
|                                                                                   |
|               +---------------------------------------------------+               |
|               | [Cover] Ch 4 • 14:22 left   |<  ( || )  >|  [1.2x]|               |  <- Floating Glass Dock
|               |         Voice: Heart (HD)   [====o--------] [Wave]|               |
|               +---------------------------------------------------+               |
+-----------------------------------------------------------------------------------+
```

#### 1. Bookshelf & Dropzone View (Home)
* Clean grid of imported books with 3D cover tilt on hover, progress badges (`68% • 2h 14m left`), and cached audio indicator badges.
* Drag-and-drop any `.epub` or `.pdf` anywhere on the window—triggers a fluid Apple-style spring sheet displaying real-time layout cleaning and chapter extraction.

#### 2. Split / Full-Screen Live Lyrics Player View
* **Left Collapsible Drawer:** Table of Contents with per-chapter synthesis status rings (grey = unrendered, spinning arc = buffering in background, solid checkmark = 100% cached on device).
* **Center Stage:** The Apple Music Live Lyrics canvas. Users can toggle between **Focus Lyrics Mode** (large, bold sentence-by-sentence cascade) and **Book Page Mode** (structured paragraphs with live sentence illumination and word sweep).
* **Bottom Floating Dynamic Island Dock:**
  * Houses mini cover art, current chapter title, scrubbable timeline, Play/Pause morphing SVG button, $\pm 15\text{s}$ skip, Voice Selector popover (with live preview and 2D voice-blending pad), and Speed slider.

#### 3. Export & Batch Synthesis Studio Drawer
* Slide-over glass panel showing chapter-by-chapter checkboxes, output format selector (`M4B Audiobook with Chapters` vs `MP3`), bitrate selector, estimated file size, real-time synthesis speed multiplier (e.g., `14.2x real-time via WebGPU`), and an ETA countdown.

---

## 6. Project Directory Structure

```text
cadence/
├── public/
│   ├── wasm/                          # espeak-ng.wasm & ort-wasm-simd-threaded.wasm
│   └── worklets/
│       └── time-stretch-processor.js  # WSOLA pitch-preserving AudioWorklet
├── src/
│   ├── app/                           # App shell, global providers & theme
│   ├── components/
│   │   ├── bookshelf/                 # BookCard, DropzoneModal, StorageManager
│   │   ├── player/
│   │   │   ├── LiveLyricsCanvas.tsx   # 60fps rAF Apple Music lyrics engine
│   │   │   ├── SentenceRow.tsx        # Spring-animated sentence & word karaoke spans
│   │   │   ├── FloatingGlassDock.tsx  # Dynamic Island playback bar
│   │   │   ├── MeshGradientBg.tsx     # Cover-art WebGL/Canvas blurred mesh
│   │   │   └── VoiceBlenderPopover.tsx# Kokoro voice picker & 2D style mixer
│   │   ├── modals/
│   │   │   ├── ExportStudioModal.tsx  # Full-book & chapter streaming exporter UI
│   │   │   ├── LexiconModal.tsx       # Custom pronunciation / IPA rules
│   │   │   └── NormalizationRules.tsx # Citation/URL/header skip toggles
│   ├── core/
│   │   ├── audio/
│   │   │   ├── AudioScheduler.ts      # Gapless Web Audio API buffer queue
│   │   │   ├── WordSyncInterpolator.ts# Phoneme + punctuation duration solver
│   │   │   └── MediaSessionBridge.ts  # OS lock-screen & hardware key bindings
│   │   ├── storage/
│   │   │   ├── opfsManager.ts         # Binary model weights & PCM audio chunk I/O
│   │   │   └── db.ts                  # IndexedDB schema for books, chapters & bookmarks
│   ├── workers/
│   │   ├── parser.worker.ts           # PDF geometric cleaner + EPUB spine parser
│   │   ├── tts.worker.ts              # ONNX Runtime Web + Kokoro-82M inference queue
│   │   └── exporter.worker.ts         # LAME MP3 / mp4-muxer streaming file writer
│   └── store/
│       ├── usePlayerStore.ts          # Active book, sentence cursor, playback state
│       └── useSynthesisStore.ts       # Worker queue status, OPFS cache map, export progress
├── package.json
└── vite.config.ts                     # Configured with COOP/COEP headers for SharedArrayBuffer
```

---

## 7. Critical Browser Headers & Edge Cases

1. **Cross-Origin Isolation (`COOP` / `COEP`):**
   To unlock multi-threaded WASM SIMD and high-performance `SharedArrayBuffer` in `onnxruntime-web`, configure static hosting headers:
   ```http
   Cross-Origin-Opener-Policy: same-origin
   Cross-Origin-Embedder-Policy: require-corp
   ```
2. **Long Sentence Splitting (> 400 characters):**
   Kokoro-82M's context window performs best on clauses under $450$ phoneme tokens. The sentence tokenizer automatically splits overly long academic/literary sentences at semicolons, em-dashes, or coordinating conjunctions while keeping them visually grouped in the UI.
3. **Storage Quota & Eviction Protection:**
   Call `navigator.storage.persist()` on first book import so the browser never automatically evicts cached audiobooks or the $86\text{ MB}$ neural voice model from OPFS. Include a one-click **"Manage Local Audio Cache"** meter in Settings.
4. **Wake Lock API (`navigator.wakeLock`):**
   Acquire a screen wake lock while the Live Lyrics view is active in foreground, and seamlessly release it when minimized to background playback.

---

## 8. Phased Implementation Roadmap

* **Phase 1: Core Ingestion & Apple UI Shell (Milestone 1)**
  * Build the Cadence Bookshelf, PDF geometric bounding-box cleaner, EPUB spine parser, and smart text normalizer inside `parser.worker.ts`.
  * Implement the Apple Music Mesh Gradient background and static Live Lyrics typography layout.
* **Phase 2: Local Kokoro-82M WebGPU Engine & Lookahead Streaming (Milestone 2)**
  * Wire up `tts.worker.ts` with `kokoro-js` / `onnxruntime-web` and OPFS model weight persistence.
  * Build the `AudioScheduler` gapless Web Audio pipeline and lookahead buffer manager.
* **Phase 3: 60fps Live Lyrics Word Sync & Voice Blending (Milestone 3)**
  * Implement `WordSyncInterpolator.ts` using phoneme + punctuation weighting.
  * Connect the `requestAnimationFrame` loop to drive word-level karaoke fill, blur transitions, and Framer Motion spring auto-scrolling.
* **Phase 4: OOM-Safe Full Book Exporter & Polish (Milestone 4)**
  * Build `exporter.worker.ts` with `mp4-muxer` (M4B with chapters) and `lamejs` (MP3) streaming directly to `FileSystemWritableFileStream`.
  * Add the Pronunciation Lexicon editor, WSOLA speed control, and OS `MediaSession` integration.