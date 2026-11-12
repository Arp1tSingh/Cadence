import { describe, expect, it } from 'vitest';
import {
  buildChapter,
  buildSentence,
  splitSentences,
  tokenizeDisplayText,
} from './sentences';

describe('splitSentences', () => {
  it('splits normal prose', () => {
    expect(splitSentences('The rain stopped. Elena stepped outside.')).toEqual([
      'The rain stopped.',
      'Elena stepped outside.',
    ]);
  });

  it('protects abbreviations, initials, and decimals', () => {
    expect(splitSentences('Mr. Smith paid 3.14 dollars. Dr. Jones left.')).toEqual([
      'Mr. Smith paid 3.14 dollars.',
      'Dr. Jones left.',
    ]);
    expect(splitSentences('J. K. Rowling wrote it. It sold well.')).toEqual([
      'J. K. Rowling wrote it.',
      'It sold well.',
    ]);
  });

  it('keeps dialogue punctuation attached', () => {
    expect(splitSentences('“Hello.” She waved. “Goodbye.”')).toEqual([
      '“Hello.”',
      'She waved.',
      '“Goodbye.”',
    ]);
  });

  it('does not split lowercase continuations', () => {
    expect(splitSentences('The sign read “open. closed. gone.”')).toEqual([
      'The sign read “open. closed. gone.”',
    ]);
  });
});

describe('buildSentence', () => {
  it('maps every display word to a TTS span', () => {
    const sentence = buildSentence({
      chapterIndex: 0,
      paragraphIndex: 0,
      sentenceIndex: 0,
      text: 'Mr. Smith paid $12.50 in 1984.',
    });

    expect(sentence.id).toBe('ch01_p01_s01');
    expect(sentence.words).toHaveLength(6);
    expect(sentence.ttsText).toContain('Mister');
    expect(sentence.ttsText).toContain('twelve dollars and fifty cents');
    expect(sentence.ttsText).toContain('nineteen eighty-four');

    for (const word of sentence.words) {
      expect(sentence.ttsText.slice(word.ttsStart, word.ttsEnd).length).toBeGreaterThan(0);
    }
    expect(sentence.chunks).toHaveLength(1);
    expect(sentence.chunks[0].wordIds).toEqual(sentence.words.map((word) => word.id));
  });

  it('splits very long sentences into contiguous TTS chunks', () => {
    const longText = Array.from(
      { length: 120 },
      (_, index) => `This is clause number ${index + 1}; it keeps the sentence going`,
    ).join(' ') + '.';

    const sentence = buildSentence({
      chapterIndex: 1,
      paragraphIndex: 2,
      sentenceIndex: 0,
      text: longText,
    });

    expect(sentence.chunks.length).toBeGreaterThan(1);
    const covered = sentence.chunks.flatMap((chunk) => chunk.wordIds);
    expect(covered).toEqual(sentence.words.map((word) => word.id));

    for (const chunk of sentence.chunks) {
      expect(chunk.text).toBe(
        sentence.ttsText.slice(chunk.startTtsOffset, chunk.endTtsOffset),
      );
    }
  });
});

describe('tokenizeDisplayText', () => {
  it('tracks display offsets', () => {
    const tokens = tokenizeDisplayText('One  two three');
    expect(tokens.map((token) => token.text)).toEqual(['One', 'two', 'three']);
    expect(tokens[2].start).toBe(9);
  });
});

describe('buildChapter', () => {
  it('builds stable IDs and counts', () => {
    const chapter = buildChapter({
      index: 1,
      title: 'The Glass Horizon',
      blocks: [
        { kind: 'heading', text: 'The Glass Horizon', level: 1 },
        { kind: 'paragraph', text: 'The rain had stopped. Elena stepped outside.' },
      ],
    });

    expect(chapter).not.toBeNull();
    expect(chapter?.id).toBe('ch02');
    expect(chapter?.paragraphs[0].sentences[0].id).toBe('ch02_p01_s01');
    expect(chapter?.paragraphs[1].sentences[1].id).toBe('ch02_p02_s02');
    expect(chapter?.wordCount).toBe(10);
    expect(chapter?.startSentenceId).toBe('ch02_p01_s01');
  });
});
