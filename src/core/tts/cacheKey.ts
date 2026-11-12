import { TTS_ENGINE_VERSION } from './constants';
import { sha256Hex } from './hash';
import { voiceKeyFor } from './voices';
import type { SentenceNode } from '@/types/domain';
import type { VoiceSelection } from '@/types/tts';

/**
 * Cache identity includes the sentence id, a hash of the spoken text, the
 * voice key, and the engine version. Timing arrays are keyed by word id, so
 * reusing audio across two different sentences would be unsafe.
 */
export async function sentenceCacheKey(
  sentence: Pick<SentenceNode, 'id' | 'ttsText'>,
  voice: VoiceSelection,
): Promise<{ key: string; voiceKey: string }> {
  const voiceKey = voiceKeyFor(voice);
  const key = await sha256Hex(
    [TTS_ENGINE_VERSION, voiceKey, sentence.id, sentence.ttsText].join('\u0000'),
  );
  return { key, voiceKey };
}
