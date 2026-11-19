import { PIPER_MODEL_BASE_URL, PIPER_SAMPLE_RATE } from './constants';

export type FlashVoiceDefinition = {
  /** Piper voice id, also used as the OPFS model file name. */
  id: string;
  name: string;
  language: 'en-US' | 'en-GB';
  gender: 'Female' | 'Male';
  accent: string;
  description: string;
  /** eSpeak-ng voice name from the model's `.onnx.json`. */
  espeak: string;
  sampleRate: number;
  /** Path inside `rhasspy/piper-voices`, without the extension. */
  path: string;
  sizeBytes: number;
  license: string;
};

/**
 * Curated Piper voices. Every entry is 22.05 kHz / medium quality because the
 * spike measured 2.36× real time at four threads. Licenses are per training
 * dataset; weights are downloaded from Hugging Face at runtime and never
 * redistributed with the app. Rejected voices: `ryan` and `hfc_*` (CC BY-NC-SA),
 * `lessac` (Blizzard license), `jenny_dioco` (no license file).
 */
export const FLASH_VOICES: readonly FlashVoiceDefinition[] = [
  {
    id: 'en_US-kathleen-medium',
    name: 'Kathleen',
    language: 'en-US',
    gender: 'Female',
    accent: 'American',
    description: 'Clear and even — the default for long reading sessions.',
    espeak: 'en-us',
    sampleRate: 22_050,
    path: 'en/en_US/kathleen/medium/en_US-kathleen-medium',
    sizeBytes: 63_221_984,
    license: 'CC0',
  },
  {
    id: 'en_US-amy-medium',
    name: 'Amy',
    language: 'en-US',
    gender: 'Female',
    accent: 'American',
    description: 'Warm and conversational, with a gentle narrative lilt.',
    espeak: 'en-us',
    sampleRate: 22_050,
    path: 'en/en_US/amy/medium/en_US-amy-medium',
    sizeBytes: 63_221_984,
    license: 'CC BY-SA 4.0',
  },
  {
    id: 'en_GB-alba-medium',
    name: 'Alba',
    language: 'en-GB',
    gender: 'Female',
    accent: 'British',
    description: 'A crisp Scottish-accented British narration voice.',
    espeak: 'en-gb-x-rp',
    sampleRate: 22_050,
    path: 'en/en_GB/alba/medium/en_GB-alba-medium',
    sizeBytes: 63_221_984,
    license: 'CC BY 4.0',
  },
  {
    id: 'en_US-joe-medium',
    name: 'Joe',
    language: 'en-US',
    gender: 'Male',
    accent: 'American',
    description: 'Steady and understated — suited to nonfiction.',
    espeak: 'en-us',
    sampleRate: 22_050,
    path: 'en/en_US/joe/medium/en_US-joe-medium',
    sizeBytes: 63_221_984,
    license: 'CC0',
  },
  {
    id: 'en_US-norman-medium',
    name: 'Norman',
    language: 'en-US',
    gender: 'Male',
    accent: 'American',
    description: 'A classic audiobook baritone trained on LibriVox recordings.',
    espeak: 'en',
    sampleRate: 22_050,
    path: 'en/en_US/norman/medium/en_US-norman-medium',
    sizeBytes: 63_531_379,
    license: 'Public domain',
  },
  {
    id: 'en_GB-northern_english_male-medium',
    name: 'Northern',
    language: 'en-GB',
    gender: 'Male',
    accent: 'British',
    description: 'A Northern English male voice with a distinct regional cadence.',
    espeak: 'en-gb-x-rp',
    sampleRate: 22_050,
    path: 'en/en_GB/northern_english_male/medium/en_GB-northern_english_male-medium',
    sizeBytes: 63_201_294,
    license: 'CC BY-SA 4.0',
  },
] as const;

export const DEFAULT_FLASH_VOICE_ID = 'en_US-kathleen-medium';

const FLASH_VOICE_IDS = new Set(FLASH_VOICES.map((voice) => voice.id));

export function isKnownFlashVoice(id: string | undefined): boolean {
  return typeof id === 'string' && FLASH_VOICE_IDS.has(id);
}

export function getFlashVoice(id: string | undefined): FlashVoiceDefinition {
  return (
    FLASH_VOICES.find((voice) => voice.id === id) ??
    FLASH_VOICES.find((voice) => voice.id === DEFAULT_FLASH_VOICE_ID) ??
    FLASH_VOICES[0]
  );
}

export function normalizeFlashVoice(id: string | undefined): string {
  return getFlashVoice(id).id;
}

export function flashVoiceLabel(id: string | undefined): string {
  return getFlashVoice(id).name;
}

/** OPFS directory name. Piper ids already use filesystem-safe characters. */
export function flashVoiceKey(id: string | undefined): string {
  return `flash-${normalizeFlashVoice(id)}`;
}

export function flashModelUrl(voice: FlashVoiceDefinition): string {
  return `${PIPER_MODEL_BASE_URL}${voice.path}.onnx`;
}

export function flashConfigUrl(voice: FlashVoiceDefinition): string {
  return `${PIPER_MODEL_BASE_URL}${voice.path}.onnx.json`;
}

export function flashDownloadBytes(voice: FlashVoiceDefinition): number {
  return voice.sizeBytes + 7_000;
}

export const FLASH_SAMPLE_RATE = PIPER_SAMPLE_RATE;
