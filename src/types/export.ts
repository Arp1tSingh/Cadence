/** Contracts shared by the export studio, the orchestrator, and the encoder worker. */

export type ExportFormat = 'mp3' | 'm4b';
export type ExportScope = 'book' | 'chapter';

/** A cover image already stored in OPFS. */
export type ExportCover = {
  path: string;
  mimeType: string;
};

export type ExportEncodeOptions = {
  format: ExportFormat;
  bookId: string;
  voiceKey: string;
  /** File name inside OPFS `/exports`, including its extension. */
  fileName: string;
  title: string;
  artist: string;
  album: string;
  /** Silence inserted between sentences, matching playback. */
  gapSeconds: number;
  cover?: ExportCover;
};

export type ExportEncodeResult = {
  fileName: string;
  size: number;
  durationSeconds: number;
  chapterCount: number;
};

export type ExportProgressUpdate = {
  /** Encoded duration so far, including inter-sentence gaps. */
  durationSeconds: number;
  /** High-water mark of the output file, in bytes. */
  bytes: number;
};

export type ExportProbe = {
  format: ExportFormat;
  supported: boolean;
  /** Codec that will actually be used (`aac`, `mp3`, ...). */
  codec: string;
  reason?: string;
};

/**
 * The worker keeps only the current sentence's PCM in memory. It reads the
 * Int16 cache directly from OPFS, so the main thread never handles book-scale
 * audio and never accumulates encoded output.
 */
export type ExporterWorkerApi = {
  probe(format: ExportFormat): Promise<ExportProbe>;
  begin(options: ExportEncodeOptions): Promise<void>;
  /** Marks the current timeline position as the start of a chapter. */
  markChapter(title: string): Promise<void>;
  addSentence(cacheKey: string): Promise<ExportProgressUpdate>;
  finish(): Promise<ExportEncodeResult>;
  cancel(): Promise<void>;
};
