/**
 * User-configurable speech settings. These are applied at synthesis time (in
 * the TTS worker), never at parse time, so changing them re-renders narration
 * without rebuilding the library or losing the book's word-level tokenization.
 */

export type LexiconEntry = {
  id: string;
  /** Display word or phrase to match, case- and punctuation-insensitive. */
  phrase: string;
  /**
   * How it should be spoken. Plain text is passed to the offline phonemizer, so
   * a respelling such as "Her-my-oh-nee" works. An empty string skips the word.
   */
  say: string;
  enabled: boolean;
  createdAt: number;
};

export type NormalizationRules = {
  /** Dr. → Doctor, Ch. → Chapter, Chapter IV → Chapter four. */
  abbreviations: boolean;
  /** [12], [1, 4–7], (Smith et al., 2021) → silence. */
  citations: boolean;
  /** https://example.com → link. */
  urls: boolean;
};

export type SpeechProfile = {
  lexicon: LexiconEntry[];
  rules: NormalizationRules;
};

export const DEFAULT_NORMALIZATION_RULES: NormalizationRules = {
  abbreviations: true,
  citations: false,
  urls: false,
};

export const EMPTY_SPEECH_PROFILE: SpeechProfile = {
  lexicon: [],
  rules: DEFAULT_NORMALIZATION_RULES,
};

/** Largest accepted lexicon phrase, in words. Keeps matching bounded. */
export const MAX_LEXICON_WORDS = 8;
