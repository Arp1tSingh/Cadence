import type { ModelTier, TtsDevice, TtsDtype } from '@/types/tts';

/** Changes when inference, phonemization, or timing behavior changes. */
export const TTS_ENGINE_VERSION = 'kokoro-1.0.0';

export const SAMPLE_RATE = 24_000;

export const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

export const MODEL_FILE_SIZES: Record<TtsDtype, number> = {
  q8: 92 * 1024 * 1024,
  fp32: 326 * 1024 * 1024,
};

/** Sentences are separated by a small breath of silence during playback. */
export const SENTENCE_GAP_SECONDS = 0.22;

/** Pieces inside a long sentence are joined with this much silence. */
export const PIECE_GAP_SECONDS = 0.05;

/** How many sentences ahead of the playhead the session keeps scheduled. */
export const LOOKAHEAD_SENTENCES = 6;

/** Safety cap so very long single sentences cannot overflow the model context. */
export const MAX_PIECE_WORDS = 38;
export const MAX_PHONEME_TOKENS = 500;

export function modelPlanForTier(tier: ModelTier, hasWebGpu: boolean): {
  device: TtsDevice;
  dtype: TtsDtype;
} {
  if (tier === 'balanced') return { device: 'wasm', dtype: 'q8' };
  if (tier === 'quality') {
    return hasWebGpu ? { device: 'webgpu', dtype: 'fp32' } : { device: 'wasm', dtype: 'q8' };
  }
  return hasWebGpu ? { device: 'webgpu', dtype: 'fp32' } : { device: 'wasm', dtype: 'q8' };
}

export const MODEL_LABELS: Record<TtsDtype, string> = {
  q8: 'Quantized · 92 MB',
  fp32: 'Full precision · 326 MB',
};
