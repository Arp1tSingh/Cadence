import { DEFAULT_NORMALIZATION_RULES, type SpeechProfile } from '@/types/speech';

/** FNV-1a over the canonical profile. Short, stable, and synchronous. */
function hashProfile(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Identity of the active speech settings. Audio-cache entries record this so
 * chapter rings can ignore narration rendered under a different lexicon or
 * rule set. Correctness still comes from the cache key's hash of `ttsText`.
 */
export function speechProfileKey(profile?: SpeechProfile): string {
  const rules = { ...DEFAULT_NORMALIZATION_RULES, ...profile?.rules };
  const lexicon = (profile?.lexicon ?? [])
    .filter((entry) => entry.enabled && entry.phrase.trim())
    .map((entry) => `${entry.phrase.trim().toLocaleLowerCase()}\u001f${entry.say.trim()}`)
    .sort();

  return hashProfile(
    [
      rules.abbreviations ? 'a1' : 'a0',
      rules.citations ? 'c1' : 'c0',
      rules.urls ? 'u1' : 'u0',
      lexicon.join('\u001d'),
    ].join('\u001e'),
  );
}

/** Cache entries written before the lexicon existed have no speech key. */
export const DEFAULT_SPEECH_PROFILE_KEY = speechProfileKey();
