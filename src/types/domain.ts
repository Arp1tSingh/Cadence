export type BookFormat = 'epub' | 'pdf';

export type ParagraphKind = 'paragraph' | 'heading' | 'quote' | 'list' | 'caption' | 'pre';

export type CoverPalette = {
  colors: [string, string, string];
  isFallback: boolean;
};

export type WordToken = {
  id: string;
  text: string;
  ttsStart: number;
  ttsEnd: number;
  isWord: boolean;
};

export type TtsChunk = {
  id: string;
  text: string;
  startTtsOffset: number;
  endTtsOffset: number;
  wordIds: string[];
};

export type SentenceNode = {
  id: string;
  chapterIndex: number;
  paragraphIndex: number;
  sentenceIndex: number;
  displayText: string;
  ttsText: string;
  words: WordToken[];
  chunks: TtsChunk[];
  charCount: number;
  wordCount: number;
  estimatedDuration: number;
  /** Zero-based source PDF page; absent for EPUBs and older imports. */
  pageIndex?: number;
};

export type ParagraphNode = {
  id: string;
  kind: ParagraphKind;
  level?: number;
  displayText: string;
  sentences: SentenceNode[];
  /** First and last source PDF pages this paragraph came from. */
  pageIndex?: number;
  pageEndIndex?: number;
};

/** A rendered, image-heavy PDF page kept in OPFS next to the book source. */
export type BookIllustration = {
  /** Zero-based source page index. */
  pageIndex: number;
  path: string;
  width: number;
  height: number;
  mimeType: string;
  byteSize: number;
};

export type ChapterNode = {
  id: string;
  index: number;
  title: string;
  href?: string;
  paragraphs: ParagraphNode[];
  wordCount: number;
  charCount: number;
  estimatedDuration: number;
  startSentenceId: string;
};

export type BookMetadata = {
  title: string;
  author?: string;
  language?: string;
  publisher?: string;
  publishedAt?: string;
  description?: string;
  identifier?: string;
  rights?: string;
};

export type BookDocument = {
  id: string;
  fingerprint: string;
  format: BookFormat;
  metadata: BookMetadata;
  chapters: ChapterNode[];
  palette: CoverPalette;
  coverPath?: string;
  /** Full-page illustrations detected during PDF import, sorted by page. */
  illustrations?: BookIllustration[];
  sourcePath: string;
  byteSize: number;
  createdAt: number;
  updatedAt: number;
  totalWords: number;
  totalChars: number;
  estimatedDuration: number;
  parserVersion: string;
};

export type WordTiming = {
  wordId: string;
  start: number;
  end: number;
};

export type ReadingProgress = {
  bookId: string;
  chapterIndex: number;
  sentenceId: string;
  sentenceIndex: number;
  /**
   * Seconds into the sentence on the 1× narration timeline. Playback divides
   * by the current rate, so the same record is correct at any speed.
   */
  offsetSeconds: number;
  updatedAt: number;
};

export type AudioCacheEntry = {
  key: string;
  bookId: string;
  voiceKey: string;
  sentenceId: string;
  chapterIndex: number;
  duration: number;
  timings: WordTiming[];
  size: number;
  createdAt: number;
  /**
   * Fingerprint of the lexicon/rules that produced the spoken text. Entries
   * written before speech settings existed omit it and are treated as default.
   */
  speechKey?: string;
  /**
   * Engine that produced the PCM. Rows written before Flash existed omit it and
   * are read as Kokoro at 24 kHz.
   */
  engine?: 'kokoro' | 'piper';
  /** Native sample rate of the PCM, so 22.05 kHz Flash audio decodes correctly. */
  sampleRate?: number;
};

export type ExportJobRecord = {
  id: string;
  bookId: string;
  bookTitle: string;
  format: 'mp3' | 'm4b';
  scope: 'book' | 'chapter';
  chapterIndex?: number;
  chapterTitle?: string;
  status: 'queued' | 'running' | 'paused' | 'done' | 'error';
  /** 0..1 across the sentences selected for this job. */
  progress: number;
  totalSentences: number;
  completedSentences: number;
  durationSeconds: number;
  /** Final file size in bytes; zero until the job finishes. */
  size: number;
  /** File name inside OPFS `/exports`. */
  fileName: string;
  /** User-facing download name, e.g. `Pride and Prejudice.m4b`. */
  suggestedName: string;
  voiceKey: string;
  /** Engine that rendered this job: `piper` for Flash, `kokoro` for Studio. */
  engine?: 'kokoro' | 'piper';
  title: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

export type SettingRecord<T = unknown> = {
  key: string;
  value: T;
  updatedAt: number;
};
