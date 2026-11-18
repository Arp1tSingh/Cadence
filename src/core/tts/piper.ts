/**
 * Piper (VITS) adapter primitives.
 *
 * Piper voices ship an `.onnx.json` beside the model with the eSpeak voice,
 * sample rate, inference scales, and a `phoneme_id_map`. The map contains both
 * single IPA characters and multi-codepoint diphthongs (`aɪ`, `oʊ`, …), so the
 * tokenizer must match the longest symbol instead of iterating code points.
 */

export type PiperConfig = {
  audio: {
    sample_rate: number;
    quality?: string;
  };
  espeak: {
    voice: string;
  };
  inference: {
    noise_scale: number;
    length_scale: number;
    noise_w: number;
  };
  phoneme_id_map: Record<string, number[]>;
  num_speakers?: number;
  speaker_id_map?: Record<string, number>;
  [key: string]: unknown;
};

export type PiperToken = {
  symbol: string;
  ids: number[];
};

export type PiperIds = {
  ids: number[];
  unknown: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parsePiperConfig(value: unknown): PiperConfig {
  if (!isRecord(value)) throw new Error('Piper voice config is not an object.');
  const audio = value.audio;
  const espeak = value.espeak;
  const inference = value.inference;
  const map = value.phoneme_id_map;
  if (!isRecord(audio) || typeof audio.sample_rate !== 'number') {
    throw new Error('Piper voice config is missing audio.sample_rate.');
  }
  if (!isRecord(espeak) || typeof espeak.voice !== 'string') {
    throw new Error('Piper voice config is missing espeak.voice.');
  }
  if (!isRecord(inference)) {
    throw new Error('Piper voice config is missing inference scales.');
  }
  if (!isRecord(map)) throw new Error('Piper voice config is missing phoneme_id_map.');

  const phonemeMap: Record<string, number[]> = {};
  for (const [symbol, ids] of Object.entries(map)) {
    if (!Array.isArray(ids) || ids.some((id) => !Number.isInteger(id))) {
      throw new Error(`Piper phoneme_id_map entry "${symbol}" is invalid.`);
    }
    phonemeMap[symbol] = ids as number[];
  }

  const speakerMap = isRecord(value.speaker_id_map)
    ? Object.fromEntries(
        Object.entries(value.speaker_id_map).filter(
          (entry): entry is [string, number] => typeof entry[1] === 'number',
        ),
      )
    : undefined;

  return {
    ...value,
    audio: {
      sample_rate: audio.sample_rate,
      quality: typeof audio.quality === 'string' ? audio.quality : undefined,
    },
    espeak: { voice: espeak.voice },
    inference: {
      noise_scale:
        typeof inference.noise_scale === 'number' ? inference.noise_scale : 0.5,
      length_scale:
        typeof inference.length_scale === 'number' ? inference.length_scale : 1,
      noise_w: typeof inference.noise_w === 'number' ? inference.noise_w : 0.333,
    },
    phoneme_id_map: phonemeMap,
    num_speakers:
      typeof value.num_speakers === 'number' ? value.num_speakers : undefined,
    speaker_id_map: speakerMap,
  };
}

/**
 * Splits an eSpeak IPA string into the longest symbols present in the voice
 * map. Unknown symbols are kept so callers can log them in development; they
 * are omitted when the ID sequence is built.
 */
export function tokenizePiperPhonemes(
  phonemes: string,
  map: Record<string, readonly number[]>,
): PiperToken[] {
  const keys = Object.keys(map).sort(
    (a, b) => Array.from(b).length - Array.from(a).length || b.length - a.length,
  );
  const maxLength = keys.length > 0 ? Array.from(keys[0]).length : 1;
  const chars = Array.from(phonemes);
  const tokens: PiperToken[] = [];

  for (let index = 0; index < chars.length; ) {
    let matched: string | null = null;
    for (let length = Math.min(maxLength, chars.length - index); length >= 1; length -= 1) {
      const candidate = chars.slice(index, index + length).join('');
      if (map[candidate]) {
        matched = candidate;
        break;
      }
    }
    if (matched) {
      tokens.push({ symbol: matched, ids: [...map[matched]] });
      index += Array.from(matched).length;
    } else {
      tokens.push({ symbol: chars[index], ids: [] });
      index += 1;
    }
  }

  return tokens;
}

/**
 * Piper's reference sequence: BOS, then every phoneme's IDs followed by PAD,
 * then EOS. Spaces and punctuation are ordinary phonemes in the map.
 */
export function buildPiperIds(
  phonemes: string,
  map: Record<string, readonly number[]>,
): PiperIds {
  const tokens = tokenizePiperPhonemes(phonemes, map);
  const ids: number[] = [];
  const unknown: string[] = [];
  const bos = map['^']?.[0];
  const eos = map['$']?.[0];
  const pad = map['_']?.[0];

  if (bos !== undefined) ids.push(bos);
  for (const token of tokens) {
    if (token.ids.length === 0) {
      unknown.push(token.symbol);
      continue;
    }
    ids.push(...token.ids);
    if (pad !== undefined) ids.push(pad);
  }
  if (eos !== undefined) ids.push(eos);

  return { ids, unknown };
}

export function piperScales(
  config: PiperConfig,
  lengthScale = config.inference.length_scale,
): [number, number, number] {
  return [
    config.inference.noise_scale,
    lengthScale,
    config.inference.noise_w,
  ];
}

/** Flattens `[1, 1, N]`, `[1, N]`, or `[N]` VITS output into mono PCM. */
export function flattenPiperAudio(data: Float32Array): Float32Array {
  return data instanceof Float32Array ? data : new Float32Array(data as ArrayLike<number>);
}
