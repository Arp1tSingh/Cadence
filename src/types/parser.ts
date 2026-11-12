import type { BookDocument } from './domain';

export type ParseStage =
  | 'hashing'
  | 'metadata'
  | 'chapters'
  | 'sentences'
  | 'cover'
  | 'palette'
  | 'saving'
  | 'done';

export type ParseProgress = {
  stage: ParseStage;
  progress: number;
  message: string;
  chapter?: number;
  chapterCount?: number;
};

export type KnownBook = {
  id: string;
  fingerprint: string;
};

export type ParseRequest = {
  file: File;
  knownBooks: KnownBook[];
};

export type ParseErrorCode =
  | 'unsupported'
  | 'invalid'
  | 'drm'
  | 'scanned'
  | 'password'
  | 'too-large'
  | 'storage'
  | 'unknown';

export type ParseOutcome =
  | { status: 'created'; book: BookDocument }
  | { status: 'duplicate'; bookId: string; fingerprint: string }
  | { status: 'error'; code: ParseErrorCode; message: string };

export type ParserWorkerApi = {
  parse(
    request: ParseRequest,
    onProgress?: (progress: ParseProgress) => void,
  ): Promise<ParseOutcome>;
};
