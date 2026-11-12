import { describe, expect, it } from 'vitest';
import { sentenceCacheKey } from './cacheKey';
import { sha256Hex } from './hash';

const sentence = {
  id: 'ch01_p02_s03',
  ttsText: 'The harbor bell chimed twice.',
};

describe('sha256Hex', () => {
  it('matches the known SHA-256 digest', async () => {
    expect(await sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});

describe('sentenceCacheKey', () => {
  it('is stable for the same sentence and voice', async () => {
    const first = await sentenceCacheKey(sentence, { primary: 'af_heart' });
    const second = await sentenceCacheKey(sentence, { primary: 'af_heart' });
    expect(first.key).toBe(second.key);
    expect(first.voiceKey).toBe('af_heart');
  });

  it('changes when the spoken text changes', async () => {
    const first = await sentenceCacheKey(sentence, { primary: 'af_heart' });
    const second = await sentenceCacheKey(
      { ...sentence, ttsText: 'The harbor bell chimed three times.' },
      { primary: 'af_heart' },
    );
    expect(first.key).not.toBe(second.key);
  });

  it('changes when the voice changes', async () => {
    const first = await sentenceCacheKey(sentence, { primary: 'af_heart' });
    const second = await sentenceCacheKey(sentence, { primary: 'bf_emma' });
    expect(first.key).not.toBe(second.key);
    expect(second.voiceKey).toBe('bf_emma');
  });

  it('encodes blended voices by rounded secondary weight', async () => {
    const first = await sentenceCacheKey(sentence, {
      primary: 'af_heart',
      secondary: 'bf_emma',
      blend: 0.3,
    });
    expect(first.voiceKey).toBe('af_heart+bf_emma-30');

    const same = await sentenceCacheKey(sentence, {
      primary: 'af_heart',
      secondary: 'bf_emma',
      blend: 0.304,
    });
    expect(same.key).toBe(first.key);
  });

  it('ignores a secondary voice equal to the primary', async () => {
    const result = await sentenceCacheKey(sentence, {
      primary: 'af_heart',
      secondary: 'af_heart',
      blend: 0.5,
    });
    expect(result.voiceKey).toBe('af_heart');
  });
});
