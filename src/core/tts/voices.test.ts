import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOICE_ID,
  VOICES,
  getVoice,
  normalizeVoiceSelection,
  phonemeLanguageFor,
  voiceKeyFor,
  voiceLabelFor,
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
});

describe('voiceLabelFor', () => {
  it('describes a blended narrator with both shares', () => {
    const label = voiceLabelFor({ primary: 'af_bella', secondary: 'bf_emma', blend: 0.3 });
    expect(label).toBe('Bella 70% · Emma 30%');
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
