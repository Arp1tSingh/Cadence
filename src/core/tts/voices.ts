import type { VoiceSelection } from '@/types/tts';

export type VoiceDefinition = {
  id: string;
  name: string;
  language: 'en-US' | 'en-GB';
  gender: 'Female' | 'Male';
  accent: string;
  description: string;
};

/**
 * Curated Kokoro voices. Every `.bin` here is copied from `kokoro-js/voices`
 * at build time, so voices never require a network request.
 */
export const VOICES: readonly VoiceDefinition[] = [
  {
    id: 'af_heart',
    name: 'Heart',
    language: 'en-US',
    gender: 'Female',
    accent: 'American',
    description: 'Warm and expressive — the default for fiction.',
  },
  {
    id: 'af_bella',
    name: 'Bella',
    language: 'en-US',
    gender: 'Female',
    accent: 'American',
    description: 'Bright, clear, and gently dramatic.',
  },
  {
    id: 'af_nicole',
    name: 'Nicole',
    language: 'en-US',
    gender: 'Female',
    accent: 'American',
    description: 'Soft, intimate, and close-miked.',
  },
  {
    id: 'am_michael',
    name: 'Michael',
    language: 'en-US',
    gender: 'Male',
    accent: 'American',
    description: 'Measured and articulate — ideal for nonfiction.',
  },
  {
    id: 'am_fenrir',
    name: 'Fenrir',
    language: 'en-US',
    gender: 'Male',
    accent: 'American',
    description: 'Deep and cinematic without sounding heavy.',
  },
  {
    id: 'bf_emma',
    name: 'Emma',
    language: 'en-GB',
    gender: 'Female',
    accent: 'British',
    description: 'Refined and literary — made for classics.',
  },
  {
    id: 'bm_george',
    name: 'George',
    language: 'en-GB',
    gender: 'Male',
    accent: 'British',
    description: 'Warm storytelling with a British cadence.',
  },
  {
    id: 'bm_fable',
    name: 'Fable',
    language: 'en-GB',
    gender: 'Male',
    accent: 'British',
    description: 'Playful, animated, and a little theatrical.',
  },
];

export const DEFAULT_VOICE_ID = 'af_heart';

const VOICE_IDS = new Set(VOICES.map((voice) => voice.id));

export function isKnownVoice(id: string): boolean {
  return VOICE_IDS.has(id);
}

export function getVoice(id: string): VoiceDefinition {
  return VOICES.find((voice) => voice.id === id) ?? VOICES[0];
}

export function normalizeVoiceSelection(selection: VoiceSelection): VoiceSelection {
  const primary = isKnownVoice(selection.primary) ? selection.primary : DEFAULT_VOICE_ID;
  const secondary =
    selection.secondary && isKnownVoice(selection.secondary) && selection.secondary !== primary
      ? selection.secondary
      : undefined;
  return {
    primary,
    ...(secondary ? { secondary } : {}),
    ...(secondary ? { blend: clampBlend(selection.blend ?? 0.5) } : {}),
  };
}

function clampBlend(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

/**
 * Voice keys double as OPFS directory names, so they must stay filesystem
 * safe. Blends encode the secondary weight as an integer percentage.
 */
export function voiceKeyFor(selection: VoiceSelection): string {
  const normalized = normalizeVoiceSelection(selection);
  if (!normalized.secondary) return normalized.primary;
  const percent = Math.round(clampBlend(normalized.blend ?? 0.5) * 100);
  return `${normalized.primary}+${normalized.secondary}-${percent}`;
}

export function voiceLabelFor(selection: VoiceSelection): string {
  const normalized = normalizeVoiceSelection(selection);
  const primary = getVoice(normalized.primary);
  if (!normalized.secondary) return primary.name;
  const secondary = getVoice(normalized.secondary);
  const percent = Math.round(clampBlend(normalized.blend ?? 0.5) * 100);
  return `${primary.name} ${100 - percent}% · ${secondary.name} ${percent}%`;
}

/** Maps a voice id to the eSpeak language used for phonemization. */
export function phonemeLanguageFor(voiceId: string): string {
  return voiceId.startsWith('b') ? 'en-gb' : 'en-us';
}
