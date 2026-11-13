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
  const tertiary =
    secondary &&
    selection.tertiary &&
    isKnownVoice(selection.tertiary) &&
    selection.tertiary !== primary &&
    selection.tertiary !== secondary
      ? selection.tertiary
      : undefined;
  const tertiaryWeight = clampTertiaryWeight(selection.tertiaryWeight ?? 1 / 3);

  return {
    primary,
    ...(secondary ? { secondary } : {}),
    ...(secondary ? { blend: clampBlend(selection.blend ?? 0.5) } : {}),
    ...(tertiary && tertiaryWeight > 0.005 ? { tertiary, tertiaryWeight } : {}),
  };
}

function clampBlend(value: number): number {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

function clampTertiaryWeight(value: number): number {
  if (!Number.isFinite(value)) return 1 / 3;
  return Math.min(0.95, Math.max(0, value));
}

export type VoiceMixWeight = {
  id: string;
  weight: number;
};

/**
 * Resolves a selection into normalised per-voice weights. The engine multiplies
 * each 256-float style row by these before summing.
 */
export function voiceWeightsFor(selection: VoiceSelection): VoiceMixWeight[] {
  const voice = normalizeVoiceSelection(selection);
  if (!voice.secondary) return [{ id: voice.primary, weight: 1 }];

  const blend = clampBlend(voice.blend ?? 0.5);
  if (!voice.tertiary) {
    return [
      { id: voice.primary, weight: 1 - blend },
      { id: voice.secondary, weight: blend },
    ].filter((entry) => entry.weight > 0);
  }

  const tertiaryWeight = clampTertiaryWeight(voice.tertiaryWeight ?? 1 / 3);
  const remainder = 1 - tertiaryWeight;
  return [
    { id: voice.primary, weight: remainder * (1 - blend) },
    { id: voice.secondary, weight: remainder * blend },
    { id: voice.tertiary, weight: tertiaryWeight },
  ].filter((entry) => entry.weight > 0);
}

/**
 * Voice keys double as OPFS directory names, so they must stay filesystem
 * safe. Blends encode each weight as an integer percentage.
 */
export function voiceKeyFor(selection: VoiceSelection): string {
  const voice = normalizeVoiceSelection(selection);
  if (!voice.secondary) return voice.primary;

  const secondaryPercent = Math.round(clampBlend(voice.blend ?? 0.5) * 100);
  if (!voice.tertiary) return `${voice.primary}+${voice.secondary}-${secondaryPercent}`;

  const tertiaryPercent = Math.round(clampTertiaryWeight(voice.tertiaryWeight ?? 1 / 3) * 100);
  return `${voice.primary}+${voice.secondary}-${secondaryPercent}+${voice.tertiary}-${tertiaryPercent}`;
}

export function voiceLabelFor(selection: VoiceSelection): string {
  const voice = normalizeVoiceSelection(selection);
  if (!voice.secondary) return getVoice(voice.primary).name;

  const weights = voiceWeightsFor(voice);
  return weights
    .map((entry) => `${getVoice(entry.id).name} ${Math.round(entry.weight * 100)}%`)
    .join(' · ');
}

/** Maps a voice id to the eSpeak language used for phonemization. */
export function phonemeLanguageFor(voiceId: string): string {
  return voiceId.startsWith('b') ? 'en-gb' : 'en-us';
}
