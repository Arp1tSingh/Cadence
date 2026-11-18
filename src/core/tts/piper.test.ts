import { describe, expect, it } from 'vitest';
import {
  buildPiperIds,
  flattenPiperAudio,
  parsePiperConfig,
  piperScales,
  tokenizePiperPhonemes,
} from './piper';

const MAP: Record<string, number[]> = {
  _: [0],
  '^': [1],
  $: [2],
  ' ': [3],
  a: [4],
  h: [5],
  ɪ: [6],
  aɪ: [161],
  oʊ: [162],
};

const CONFIG = {
  audio: { sample_rate: 22050, quality: 'medium' },
  espeak: { voice: 'en-us' },
  inference: { noise_scale: 0.5, length_scale: 1, noise_w: 0.333 },
  phoneme_id_map: MAP,
  num_speakers: 1,
  speaker_id_map: {},
};

describe('tokenizePiperPhonemes', () => {
  it('matches multi-codepoint diphthongs before single characters', () => {
    const tokens = tokenizePiperPhonemes('haɪ', MAP);
    expect(tokens.map((token) => token.symbol)).toEqual(['h', 'aɪ']);
  });

  it('keeps unknown symbols so the caller can report them', () => {
    const tokens = tokenizePiperPhonemes('h?x', MAP);
    expect(tokens.map((token) => token.symbol)).toEqual(['h', '?', 'x']);
    expect(tokens[1].ids).toEqual([]);
  });
});

describe('buildPiperIds', () => {
  it('wraps phonemes with BOS/EOS and a PAD after each symbol', () => {
    const result = buildPiperIds('haɪ', MAP);
    expect(result.ids).toEqual([1, 5, 0, 161, 0, 2]);
    expect(result.unknown).toEqual([]);
  });

  it('includes spaces and records unknown symbols', () => {
    const result = buildPiperIds('h a?', MAP);
    expect(result.ids).toEqual([1, 5, 0, 3, 0, 4, 0, 2]);
    expect(result.unknown).toEqual(['?']);
  });
});

describe('parsePiperConfig', () => {
  it('reads the fields the engine needs', () => {
    const config = parsePiperConfig(CONFIG);
    expect(config.audio.sample_rate).toBe(22050);
    expect(config.espeak.voice).toBe('en-us');
    expect(config.inference.length_scale).toBe(1);
    expect(config.phoneme_id_map.aɪ).toEqual([161]);
  });

  it('rejects a config without a sample rate or phoneme map', () => {
    expect(() => parsePiperConfig({ ...CONFIG, audio: {} })).toThrow(/sample_rate/);
    expect(() => parsePiperConfig({ ...CONFIG, phoneme_id_map: undefined })).toThrow(
      /phoneme_id_map/,
    );
  });
});

describe('piperScales', () => {
  it('uses the voice inference defaults and accepts a length override', () => {
    expect(piperScales(parsePiperConfig(CONFIG))).toEqual([0.5, 1, 0.333]);
    expect(piperScales(parsePiperConfig(CONFIG), 1.1)).toEqual([0.5, 1.1, 0.333]);
  });
});

describe('flattenPiperAudio', () => {
  it('passes mono PCM through unchanged', () => {
    const audio = new Float32Array([0.1, 0.2]);
    expect(flattenPiperAudio(audio)).toBe(audio);
  });
});
