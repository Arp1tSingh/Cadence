import { describe, expect, it } from 'vitest';
import { buildSentence } from '@/core/parsing/sentences';
import { sentenceCacheKey } from './cacheKey';
import { respellSentence } from './respell';
import { DEFAULT_NORMALIZATION_RULES, type LexiconEntry, type SpeechProfile } from '@/types/speech';

function lexicon(phrase: string, say: string, enabled = true): LexiconEntry {
  return {
    id: `lex-${phrase}`,
    phrase,
    say,
    enabled,
    createdAt: 1,
  };
}

function profile(
  entries: LexiconEntry[] = [],
  rules: Partial<SpeechProfile['rules']> = {},
): SpeechProfile {
  return { lexicon: entries, rules: { ...DEFAULT_NORMALIZATION_RULES, ...rules } };
}

function makeSentence(text: string) {
  return buildSentence({ chapterIndex: 2, paragraphIndex: 3, sentenceIndex: 4, text });
}

const spoken = (text: string): string => text.replace(/\s+/gu, ' ').trim();

describe('respellSentence', () => {
  it('returns the original sentence for the default profile', () => {
    const sentence = makeSentence('Pride and Prejudice was published in 1813.');
    expect(respellSentence(sentence, profile())).toBe(sentence);
    expect(respellSentence(sentence)).toBe(sentence);
  });

  it('replaces a word without touching display text or word ids', () => {
    const sentence = makeSentence('Hermione smiled at Harry.');
    const rewritten = respellSentence(sentence, profile([lexicon('Hermione', 'Her-my-oh-nee')]));

    expect(rewritten.displayText).toBe('Hermione smiled at Harry.');
    expect(rewritten.words.map((word) => word.id)).toEqual(sentence.words.map((word) => word.id));
    expect(rewritten.words.map((word) => word.text)).toEqual(
      sentence.words.map((word) => word.text),
    );
    expect(spoken(rewritten.ttsText)).toBe('Her-my-oh-nee smiled at Harry.');
  });

  it('matches case-insensitively and keeps trailing punctuation', () => {
    const sentence = makeSentence('HERMIONE, wait!');
    const rewritten = respellSentence(sentence, profile([lexicon('hermione', 'Her-my-oh-nee')]));
    expect(spoken(rewritten.ttsText)).toBe('Her-my-oh-nee, wait!');
  });

  it('matches possessives and preserves the possessive suffix', () => {
    const sentence = makeSentence("Hermione's wand.");
    const rewritten = respellSentence(sentence, profile([lexicon('Hermione', 'Her-my-oh-nee')]));
    expect(spoken(rewritten.ttsText)).toBe("Her-my-oh-nee's wand.");
  });

  it('matches multi-word phrases and prefers the longest entry', () => {
    const sentence = makeSentence('They reached New Orleans at dusk.');
    const rewritten = respellSentence(
      sentence,
      profile([lexicon('New', 'new'), lexicon('New Orleans', "N'awlins")]),
    );
    expect(spoken(rewritten.ttsText)).toBe("They reached N'awlins at dusk.");
  });

  it('ignores disabled entries and skips a word when the replacement is empty', () => {
    const disabled = respellSentence(
      makeSentence('Hermione waited.'),
      profile([lexicon('Hermione', 'Her-my-oh-nee', false)]),
    );
    expect(disabled.ttsText).toBe('Hermione waited.');

    const skipped = respellSentence(
      makeSentence('Hermione waited.'),
      profile([lexicon('Hermione', '')]),
    );
    expect(spoken(skipped.ttsText)).toBe('waited.');
  });

  it('honors the abbreviation toggle', () => {
    const sentence = makeSentence('Dr. Smith arrived at 5 p.m.');
    const expanded = respellSentence(sentence, profile());
    expect(spoken(expanded.ttsText)).toBe('Doctor Smith arrived at five P M');

    // Numbers are always expanded; only the abbreviation map is optional.
    const literal = respellSentence(
      sentence,
      profile([], { abbreviations: false }),
    );
    expect(literal.ttsText).toBe('Dr. Smith arrived at five p.m.');
  });

  it('strips bracketed and author-year citations when enabled', () => {
    const sentence = makeSentence('See [12] and [1, 4–7].');
    const stripped = respellSentence(sentence, profile([], { citations: true }));
    expect(spoken(stripped.ttsText)).toBe('See and.');

    const parenthetical = makeSentence('The result (Smith et al., 2021) stands.');
    expect(
      spoken(respellSentence(parenthetical, profile([], { citations: true })).ttsText),
    ).toBe('The result stands.');

    const normalParenthetical = makeSentence('The result (in 2021) stands.');
    expect(
      spoken(respellSentence(normalParenthetical, profile([], { citations: true })).ttsText),
    ).toBe('The result (in twenty twenty-one) stands.');
  });

  it('reads URLs as "link" only when enabled', () => {
    const sentence = makeSentence('Visit https://example.com today.');
    expect(spoken(respellSentence(sentence, profile([], { urls: true })).ttsText)).toBe(
      'Visit link today.',
    );
    expect(
      respellSentence(sentence, profile([], { urls: false })).ttsText,
    ).toBe('Visit https://example.com today.');
  });

  it('expands Roman numerals after a chapter-like word only', () => {
    const chapter = makeSentence('Chapter IV begins.');
    expect(respellSentence(chapter, profile()).ttsText).toBe('Chapter four begins.');

    const pronoun = makeSentence('I think so.');
    expect(respellSentence(pronoun, profile())).toBe(pronoun);
  });

  it('keeps every word span and chunk slice consistent', () => {
    const sentence = makeSentence('"Hermione," said Dr. Smith, "see [12]."');
    const rewritten = respellSentence(
      sentence,
      profile([lexicon('Hermione', 'Her-my-oh-nee')], { citations: true }),
    );

    for (const word of rewritten.words) {
      expect(word.ttsStart).toBeGreaterThanOrEqual(0);
      expect(word.ttsEnd).toBeGreaterThanOrEqual(word.ttsStart);
      expect(word.ttsEnd).toBeLessThanOrEqual(rewritten.ttsText.length);
    }

    expect(rewritten.chunks[0].startTtsOffset).toBe(
      rewritten.words[0].ttsStart,
    );
    expect(rewritten.chunks[rewritten.chunks.length - 1].endTtsOffset).toBe(
      rewritten.words[rewritten.words.length - 1].ttsEnd,
    );
    for (const chunk of rewritten.chunks) {
      expect(chunk.text).toBe(
        rewritten.ttsText.slice(chunk.startTtsOffset, chunk.endTtsOffset),
      );
    }
  });

  it('changes the cache key only when the spoken text changes', async () => {
    const sentence = makeSentence('Hermione smiled.');
    const voice = { primary: 'af_heart' };
    const original = await sentenceCacheKey(sentence, voice);

    const unchanged = respellSentence(sentence, profile());
    expect(await sentenceCacheKey(unchanged, voice)).toEqual(original);

    const rewritten = respellSentence(sentence, profile([lexicon('Hermione', 'Her-my-oh-nee')]));
    const changed = await sentenceCacheKey(rewritten, voice);
    expect(changed.key).not.toBe(original.key);
    expect(changed.voiceKey).toBe(original.voiceKey);

    const ruleChange = respellSentence(
      makeSentence('See [12].'),
      profile([], { citations: true }),
    );
    expect(await sentenceCacheKey(ruleChange, voice)).not.toEqual(original);
  });
});
