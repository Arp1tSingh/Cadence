import type { SentenceNode, WordTiming } from './domain';
import type { SpeechProfile } from './speech';

export type TtsDevice = 'webgpu' | 'wasm';
export type TtsDtype = 'q8' | 'fp32';

/** A model family. Flash is Piper/VITS; Studio is Kokoro. */
export type TtsEngineId = 'kokoro' | 'piper';

/**
 * `flash` is Piper/VITS at 22.05 kHz (~63 MB) and runs faster than real time on
 * a laptop CPU. `balanced` is Kokoro q8 WASM (~92 MB). `quality` is Kokoro fp32
 * on WebGPU when available. There is no `auto`: stored `auto` migrates to
 * `flash`.
 */
export type ModelTier = 'flash' | 'balanced' | 'quality';

export type VoiceSelection = {
  primary: string;
  secondary?: string;
  /** 0 = all primary, 1 = all secondary. Ignored without a secondary voice. */
  blend?: number;
  /** Optional third voice for the 2D style pad. */
  tertiary?: string;
  /**
   * Share of the final mix given to the tertiary voice (0–0.95). The remaining
   * `1 - tertiaryWeight` is split between primary and secondary by `blend`.
   */
  tertiaryWeight?: number;
};

export type ModelLoadRequest = {
  tier: ModelTier;
  /** Piper voice id; ignored by Kokoro tiers. */
  flashVoice?: string;
  /**
   * Explicit WASM thread count. Only diagnostics and the device benchmark set
   * this; normal playback lets the engine size the pool from the device.
   */
  threads?: number;
};

export type ModelLoadProgress = {
  stage: 'checking' | 'download' | 'prepare' | 'ready';
  progress: number;
  message: string;
  engine?: TtsEngineId;
  device?: TtsDevice;
  dtype?: TtsDtype;
  loadedBytes?: number;
  totalBytes?: number;
};

export type ModelInfo = {
  engine: TtsEngineId;
  device: TtsDevice;
  dtype: TtsDtype;
  tier: ModelTier;
  /** Native sample rate of the loaded model. */
  sampleRate: number;
  cacheHit: boolean;
  /** Nice name of the loaded voice, when the engine has one. */
  voiceName?: string;
  /** WASM thread count the session was initialized with. */
  threads?: number;
};

export type SynthesisRequest = {
  bookId: string;
  /** Active tier; selects the engine and its cache identity. */
  tier: ModelTier;
  voice: VoiceSelection;
  /** Piper voice id. Required for the `flash` tier. */
  flashVoice?: string;
  sentence: SentenceNode;
  /** Foreground requests run before prefetch requests. */
  priority?: 'foreground' | 'prefetch';
  /** Lexicon and normalization rules applied to the spoken text. */
  speech?: SpeechProfile;
  /**
   * Soft size limit for the PCM cache. The worker evicts the oldest entries
   * after a batch of writes; zero or negative means unlimited.
   */
  cacheCapBytes?: number;
  /**
   * Skip the OPFS/IndexedDB write for this result. Used by the dev thread
   * benchmark so disk I/O does not hide inference scaling.
   */
  skipCache?: boolean;
};

export type SynthesizedSentence = {
  sentenceId: string;
  sampleRate: number;
  duration: number;
  audio: Float32Array;
  timings: WordTiming[];
  fromCache: boolean;
};

/** Metadata returned by the cache-only path used by the exporter. */
export type CachedSentenceInfo = {
  cacheKey: string;
  voiceKey: string;
  engine: TtsEngineId;
  sampleRate: number;
  duration: number;
  fromCache: boolean;
};

export type TtsWorkerApi = {
  ensureModel(
    request: ModelLoadRequest,
    onProgress?: (progress: ModelLoadProgress) => void,
  ): Promise<ModelInfo>;
  synthesize(request: SynthesisRequest): Promise<SynthesizedSentence>;
  /**
   * Ensures a sentence is in the OPFS cache and returns its key and duration
   * without transferring the PCM to the main thread. Used by book export so a
   * whole book never crosses the thread boundary as audio.
   */
  ensureCached(request: SynthesisRequest): Promise<CachedSentenceInfo>;
  /**
   * Drops every queued job. In-flight inference finishes so its audio is still
   * cached, but callers ignore the result once the timeline generation moves on.
   */
  cancelPending(): Promise<void>;
  /** Reports whether a sentence is already cached without synthesizing it. */
  isCached(request: SynthesisRequest): Promise<boolean>;
};
