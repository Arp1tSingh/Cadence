import type { SentenceNode, WordTiming } from './domain';
import type { SpeechProfile } from './speech';

export type TtsDevice = 'webgpu' | 'wasm';
export type TtsDtype = 'q8' | 'fp32';

/**
 * `balanced` is the default WASM q8 path (~92 MB). `quality` uses WebGPU fp32
 * when the browser exposes an adapter, and `auto` picks the best available.
 */
export type ModelTier = 'balanced' | 'quality' | 'auto';

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
};

export type ModelLoadProgress = {
  stage: 'checking' | 'download' | 'prepare' | 'ready';
  progress: number;
  message: string;
  device?: TtsDevice;
  dtype?: TtsDtype;
  loadedBytes?: number;
  totalBytes?: number;
};

export type ModelInfo = {
  device: TtsDevice;
  dtype: TtsDtype;
  tier: ModelTier;
  cacheHit: boolean;
};

export type SynthesisRequest = {
  bookId: string;
  voice: VoiceSelection;
  sentence: SentenceNode;
  /** Foreground requests run before prefetch requests. */
  priority?: 'foreground' | 'prefetch';
  /**
   * Model tier to load if the sentence is not cached. Only the cache-only
   * export path needs this; playback loads the model before requesting audio.
   */
  tier?: ModelTier;
  /** Lexicon and normalization rules applied to the spoken text. */
  speech?: SpeechProfile;
  /**
   * Soft size limit for the PCM cache. The worker evicts the oldest entries
   * after a batch of writes; zero or negative means unlimited.
   */
  cacheCapBytes?: number;
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
