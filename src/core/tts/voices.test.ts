import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOICE_ID,
  VOICES,
  getVoice,
  normalizeVoiceSelection,
  phonemeLanguageFor,
  voiceKeyFor,
  voiceLabelFor,
  voiceWeightsFor,
} from './voices';

describe('voice catalog', () => {
  it('contains the curated voices used by the picker', () => {
    const ids = VOICES.map((voice) => voice.id);
    expect(ids).toContain('af_heart');
    expect(ids).toContain('bf_emma');
    expect(ids).toContain('bm_george');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('falls back to the default voice for unknown ids', () => {
    expect(getVoice('not-a-voice').id).toBe(VOICES[0].id);
    expect(normalizeVoiceSelection({ primary: 'not-a-voice' }).primary).toBe(DEFAULT_VOICE_ID);
  });
});

describe('normalizeVoiceSelection', () => {
  it('drops a secondary voice equal to the primary', () => {
    const normalized = normalizeVoiceSelection({
      primary: 'af_heart',
      secondary: 'af_heart',
      blend: 0.4,
    });
    expect(normalized.secondary).toBeUndefined();
    expect(normalized.blend).toBeUndefined();
  });

  it('clamps the blend into 0..1', () => {
    expect(
      normalizeVoiceSelection({ primary: 'af_heart', secondary: 'bf_emma', blend: 4 }).blend,
    ).toBe(1);
    expect(
      normalizeVoiceSelection({ primary: 'af_heart', secondary: 'bf_emma', blend: -2 }).blend,
    ).toBe(0);
  });

  it('keeps a third voice only when it is distinct and a second voice exists', () => {
    expect(
      normalizeVoiceSelection({
        primary: 'af_heart',
        secondary: 'bf_emma',
        tertiary: 'am_michael',
        tertiaryWeight: 0.4,
      }).tertiary,
    ).toBe('am_michael');

    // The pad is a triangle; a third voice without a second cannot be mixed.
    expect(
      normalizeVoiceSelection({ primary: 'af_heart', tertiary: 'am_michael' }).tertiary,
    ).toBeUndefined();
    expect(
      normalizeVoiceSelection({ primary: 'af_heart', secondary: 'bf_emma', tertiary: 'bf_emma' })
        .tertiary,
    ).toBeUndefined();
  });

  it('clamps the tertiary share so the other voices keep a voice', () => {
    expect(
      normalizeVoiceSelection({
        primary: 'af_heart',
        secondary: 'bf_emma',
        tertiary: 'am_michael',
        tertiaryWeight: 2,
      }).tertiaryWeight,
    ).toBe(0.95);
    expect(
      normalizeVoiceSelection({
        primary: 'af_heart',
        secondary: 'bf_emma',
        tertiary: 'am_michael',
        tertiaryWeight: -1,
      }).tertiaryWeight,
    ).toBeUndefined();
  });
});

describe('voiceWeightsFor', () => {
  it('gives a solo narrator all the weight', () => {
    expect(voiceWeightsFor({ primary: 'af_heart' })).toEqual([{ id: 'af_heart', weight: 1 }]);
  });

  it('splits two voices by the blend', () => {
    const weights = voiceWeightsFor({ primary: 'af_bella', secondary: 'bf_emma', blend: 0.25 });
    expect(weights).toHaveLength(2);
    expect(weights[0]).toEqual({ id: 'af_bella', weight: 0.75 });
    expect(weights[1].id).toBe('bf_emma');
    expect(weights[1].weight).toBeCloseTo(0.25);
  });

  it('normalises three voices to sum to one', () => {
    const weights = voiceWeightsFor({
      primary: 'af_bella',
      secondary: 'bf_emma',
      blend: 0.5,
      tertiary: 'am_michael',
      tertiaryWeight: 0.4,
    });
    expect(weights.map((entry) => entry.id)).toEqual(['af_bella', 'bf_emma', 'am_michael']);
    expect(weights[2].weight).toBeCloseTo(0.4);
    expect(weights[0].weight).toBeCloseTo(0.3);
    expect(weights[1].weight).toBeCloseTo(0.3);
    expect(weights.reduce((sum, entry) => sum + entry.weight, 0)).toBeCloseTo(1);
  });

  it('drops silent voices from the mix', () => {
    expect(
      voiceWeightsFor({ primary: 'af_heart', secondary: 'bf_emma', blend: 1 }),
    ).toEqual([{ id: 'bf_emma', weight: 1 }]);
  });
});

describe('voiceKeyFor', () => {
  it('uses the primary id alone without a secondary voice', () => {
    expect(voiceKeyFor({ primary: 'af_heart' })).toBe('af_heart');
  });

  it('encodes the secondary percentage for filesystem safety', () => {
    expect(voiceKeyFor({ primary: 'af_bella', secondary: 'bm_george', blend: 0.47 })).toBe(
      'af_bella+bm_george-47',
    );
  });

  it('encodes the third voice and its share without unsafe characters', () => {
    const key = voiceKeyFor({
      primary: 'af_bella',
      secondary: 'bm_george',
      blend: 0.4,
      tertiary: 'am_michael',
      tertiaryWeight: 0.35,
    });
    expect(key).toBe('af_bella+bm_george-40+am_michael-35');
    expect(key).not.toMatch(/[\\/:*?"<>|]/);
  });
});

describe('voiceLabelFor', () => {
  it('describes a blended narrator with both shares', () => {
    const label = voiceLabelFor({ primary: 'af_bella', secondary: 'bf_emma', blend: 0.3 });
    expect(label).toBe('Bella 70% · Emma 30%');
  });

  it('lists all three shares for the mixer', () => {
    const label = voiceLabelFor({
      primary: 'af_bella',
      secondary: 'bf_emma',
      blend: 0.5,
      tertiary: 'am_michael',
      tertiaryWeight: 0.2,
    });
    expect(label).toBe('Bella 40% · Emma 40% · Michael 20%');
  });
});

describe('phonemeLanguageFor', () => {
  it('routes British voices to en-gb and others to en-us', () => {
    expect(phonemeLanguageFor('bf_emma')).toBe('en-gb');
    expect(phonemeLanguageFor('bm_george')).toBe('en-gb');
    expect(phonemeLanguageFor('af_heart')).toBe('en-us');
    expect(phonemeLanguageFor('am_michael')).toBe('en-us');
  });
});
