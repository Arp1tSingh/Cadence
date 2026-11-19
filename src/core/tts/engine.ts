import type { SentenceNode } from '@/types/domain';
import type {
  ModelInfo,
  ModelLoadProgress,
  ModelTier,
  SynthesizedSentence,
  VoiceSelection,
} from '@/types/tts';
import { engineForTier } from './constants';
import {
  disposeKokoro,
  isKokoroLoaded,
  loadKokoro,
  synthesizeKokoroSentence,
} from './engines/kokoro';
import {
  disposePiper,
  isPiperLoaded,
  loadPiper,
  loadedFlashVoice,
  synthesizePiperSentence,
} from './engines/piper';
import { normalizeFlashVoice } from './flashVoices';

export type EnsureModelOptions = {
  /** Explicit WASM thread count. Diagnostics and the benchmark only. */
  threads?: number;
  /** Piper voice id; ignored by Studio tiers. */
  flashVoice?: string;
};

/**
 * Loads the engine that serves a tier.
 *
 * The two engines are allowed to stay resident together: an export can render
 * with Studio while Flash keeps narrating, and disposing on every crossing job
 * would reload a 63–92 MB session per sentence. Each engine still replaces its
 * own previous session (Kokoro tier, Piper voice), so at most one Kokoro and
 * one Piper session are resident. `disposeEngine()` frees both.
 */
export async function ensureModel(
  tier: ModelTier,
  onProgress?: (progress: ModelLoadProgress) => void,
  options?: EnsureModelOptions,
): Promise<ModelInfo> {
  if (engineForTier(tier) === 'piper') {
    return loadPiper(options?.flashVoice, onProgress, options?.threads);
  }
  return loadKokoro(tier, onProgress, options?.threads);
}

export async function disposeEngine(): Promise<void> {
  await disposeKokoro();
  await disposePiper();
}

/**
 * Synthesizes one sentence with the engine selected by the tier. Callers are
 * expected to have awaited `ensureModel` first; a missing session is a bug, not
 * a reason to start a second download mid-request.
 */
export async function synthesizeSentence(request: {
  sentence: SentenceNode;
  voice: VoiceSelection;
  tier: ModelTier;
  flashVoice?: string;
}): Promise<SynthesizedSentence> {
  if (engineForTier(request.tier) === 'piper') {
    if (!isPiperLoaded()) throw new Error('The Flash voice is still loading.');

    const voice = normalizeFlashVoice(request.flashVoice);
    // A voice switch can land between jobs; reload before rendering rather
    // than failing the sentence and leaving a hole in the timeline.
    if (loadedFlashVoice() !== voice) await loadPiper(voice);
    return synthesizePiperSentence({ sentence: request.sentence, flashVoice: voice });
  }

  if (!isKokoroLoaded()) throw new Error('The narration model is still loading.');
  return synthesizeKokoroSentence({ sentence: request.sentence, voice: request.voice });
}
