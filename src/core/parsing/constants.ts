export const PARSER_VERSION = '1.0.0';

/** Average adult narration pace used for duration estimates before synthesis. */
export const WORDS_PER_MINUTE = 155;

/** Long sentences are split into TTS chunks at natural boundaries. */
export const MAX_TTS_CHUNK_CHARS = 400;

/** Refuse enormous files before reading them into memory. */
export const MAX_IMPORT_BYTES = 512 * 1024 * 1024;

export const FALLBACK_PALETTES: ReadonlyArray<[string, string, string]> = [
  ['#fa2d48', '#ff9f0a', '#5e5ce6'],
  ['#0a84ff', '#30d158', '#5e5ce6'],
  ['#bf5af2', '#ff375f', '#ff9f0a'],
  ['#64d2ff', '#0a84ff', '#30d158'],
  ['#ff9f0a', '#ff453a', '#bf5af2'],
  ['#30d158', '#64d2ff', '#0a84ff'],
];
