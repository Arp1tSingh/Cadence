import { describe, expect, it } from 'vitest';
import { identityForTier, sentenceCacheKey } from './cacheKey';
import { KOKORO_ENGINE_VERSION, PIPER_ENGINE_VERSION } from './constants';
import { sha256Hex } from './hash';
import type { VoiceSelection } from '@/types/tts';

const sentence = {
  id: 'ch01_p02_s03',
  ttsText: 'The harbor bell chimed twice.',
};

const studio = (voice: VoiceSelection) => identityForTier('balanced', voice);

describe('sha256Hex', () => {
  it('matches the known SHA-256 digest', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('sentenceCacheKey', () => {
  it('is stable for the same sentence and voice', async () => {
    const first = await sentenceCacheKey(sentence, studio({ primary: 'af_heart' }));
    const second = await sentenceCacheKey(sentence, studio({ primary: 'af_heart' }));
    expect(first.key).toBe(second.key);
    expect(first.voiceKey).toBe('af_heart');
  });

  it('keeps the legacy Kokoro version string so existing cache keys still hit', async () => {
    expect(KOKORO_ENGINE_VERSION).toBe('kokoro-1.0.0');
    const identity = studio({ primary: 'af_heart' });
    expect(identity.engine).toBe('kokoro');
    expect(identity.version).toBe('kokoro-1.0.0');
  });

  it('changes when the spoken text changes', async () => {
    const first = await sentenceCacheKey(sentence, studio({ primary: 'af_heart' }));
    const second = await sentenceCacheKey(
      { ...sentence, ttsText: 'The harbor bell chimed three times.' },
      studio({ primary: 'af_heart' }),
    );
    expect(first.key).not.toBe(second.key);
  });

  it('changes when the voice changes', async () => {
    const first = await sentenceCacheKey(sentence, studio({ primary: 'af_heart' }));
    const second = await sentenceCacheKey(sentence, studio({ primary: 'bf_emma' }));
    expect(first.key).not.toBe(second.key);
    expect(second.voiceKey).toBe('bf_emma');
  });

  it('encodes blended voices by rounded secondary weight', async () => {
    const first = await sentenceCacheKey(
      sentence,
      studio({ primary: 'af_heart', secondary: 'bf_emma', blend: 0.3 }),
    );
    expect(first.voiceKey).toBe('af_heart+bf_emma-30');

    const same = await sentenceCacheKey(
      sentence,
      studio({ primary: 'af_heart', secondary: 'bf_emma', blend: 0.304 }),
    );
    expect(same.key).toBe(first.key);
  });

  it('ignores a secondary voice equal to the primary', async () => {
    const result = await sentenceCacheKey(
      sentence,
      studio({ primary: 'af_heart', secondary: 'af_heart', blend: 0.5 }),
    );
    expect(result.voiceKey).toBe('af_heart');
  });

  it('separates Flash and Studio audio for the same sentence', async () => {
    const flash = identityForTier('flash', { primary: 'af_heart' }, 'en_US-kathleen-medium');
    expect(flash.engine).toBe('piper');
    expect(flash.version).toBe(PIPER_ENGINE_VERSION);
    expect(flash.voiceKey).toBe('flash-en_US-kathleen-medium');

    const flashKey = await sentenceCacheKey(sentence, flash);
    const studioKey = await sentenceCacheKey(sentence, studio({ primary: 'af_heart' }));
    expect(flashKey.key).not.toBe(studioKey.key);
  });

  it('changes Flash cache keys when the Piper voice changes', async () => {
    const kathleen = await sentenceCacheKey(
      sentence,
      identityForTier('flash', { primary: 'af_heart' }, 'en_US-kathleen-medium'),
    );
    const amy = await sentenceCacheKey(
      sentence,
      identityForTier('flash', { primary: 'af_heart' }, 'en_US-amy-medium'),
    );
    expect(kathleen.key).not.toBe(amy.key);
  });
});
