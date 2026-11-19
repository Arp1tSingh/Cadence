import { KOKORO_ENGINE_VERSION, PIPER_ENGINE_VERSION, engineForTier } from './constants';
import { flashVoiceKey } from './flashVoices';
import { sha256Hex } from './hash';
import { voiceKeyFor } from './voices';
import type { SentenceNode } from '@/types/domain';
import type { ModelTier, TtsEngineId, VoiceSelection } from '@/types/tts';

export type CacheIdentity = {
  engine: TtsEngineId;
  /** Engine version string; part of the hash so behavior changes miss. */
  version: string;
  /** Voice key doubles as the OPFS directory name. */
  voiceKey: string;
};

/**
 * Resolves the engine identity for a tier. Kokoro keeps the exact
 * `kokoro-1.0.0` string so existing cache keys stay byte-identical.
 */
export function identityForTier(
  tier: ModelTier,
  voice: VoiceSelection,
  flashVoice?: string,
): CacheIdentity {
  if (engineForTier(tier) === 'piper') {
    return {
      engine: 'piper',
      version: PIPER_ENGINE_VERSION,
      voiceKey: flashVoiceKey(flashVoice),
    };
  }
  return {
    engine: 'kokoro',
    version: KOKORO_ENGINE_VERSION,
    voiceKey: voiceKeyFor(voice),
  };
}

/**
 * Cache identity includes the sentence id, a hash of the spoken text, the
 * voice key, and the engine version. Timing arrays are keyed by word id, so
 * reusing audio across two different sentences would be unsafe.
 */
export async function sentenceCacheKey(
  sentence: Pick<SentenceNode, 'id' | 'ttsText'>,
  identity: CacheIdentity,
): Promise<{ key: string; voiceKey: string }> {
  const key = await sha256Hex(
    [identity.version, identity.voiceKey, sentence.id, sentence.ttsText].join('\u0000'),
  );
  return { key, voiceKey: identity.voiceKey };
}
