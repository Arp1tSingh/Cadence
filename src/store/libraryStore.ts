import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { BookDocument } from '@/types/domain';
import type { ParseProgress } from '@/types/parser';
import {
  clearAudioCacheIndex,
  deleteBook as deleteBookRecord,
  listBooks,
  listExportJobs,
  putBook,
} from '@/core/storage/db';
import { deleteBookBlobs, exportSegments, opfs } from '@/core/storage/opfs';
import { parseBook } from '@/core/workers/parserClient';
import { useExportStore } from './exportStore';

export type ImportStatus = 'queued' | 'parsing' | 'done' | 'duplicate' | 'error';

export type ImportItem = {
  id: string;
  fileName: string;
  fileSize: number;
  status: ImportStatus;
  progress: number;
  stage: string;
  message: string;
  bookId?: string;
};

type LibraryState = {
  books: BookDocument[];
  loaded: boolean;
  loadError: string | null;
  importing: ImportItem[];
  load: () => Promise<void>;
  addFiles: (files: File[]) => Promise<void>;
  dismissImport: (id: string) => void;
  clearFinishedImports: () => void;
  removeBook: (id: string) => Promise<void>;
};

const SUPPORTED = /\.(epub|pdf)$/i;

function describeStatus(item: ImportItem): string {
  switch (item.status) {
    case 'queued':
      return 'Waiting…';
    case 'done':
      return 'Added to your library';
    case 'duplicate':
      return 'Already in your library';
    case 'error':
      return item.message;
    default:
      return item.message || 'Importing…';
  }
}

export const useLibraryStore = create<LibraryState>()(
  immer((set, get) => ({
    books: [],
    loaded: false,
    loadError: null,
    importing: [],

    load: async () => {
      try {
        const books = await listBooks();
        set((state) => {
          state.books = books;
          state.loaded = true;
          state.loadError = null;
        });
      } catch (error) {
        set((state) => {
          state.loaded = true;
          state.loadError =
            error instanceof Error
              ? error.message
              : 'Cadence could not open its local library.';
        });
      }
    },

    addFiles: async (files) => {
      if (files.length === 0) return;

      const queued = files.map((file) => ({
        id: crypto.randomUUID(),
        fileName: file.name,
        fileSize: file.size,
        status: (SUPPORTED.test(file.name) ? 'queued' : 'error') as ImportStatus,
        progress: 0,
        stage: SUPPORTED.test(file.name) ? 'queued' : 'unsupported',
        message: SUPPORTED.test(file.name) ? 'Waiting…' : 'Only EPUB and PDF books are supported.',
      }));

      set((state) => {
        state.importing.push(...queued);
      });

      const update = (id: string, patch: Partial<ImportItem>) => {
        set((state) => {
          const item = state.importing.find((entry) => entry.id === id);
          if (!item) return;
          Object.assign(item, patch);
          item.message = describeStatus(item);
        });
      };

      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const item = queued[index];
        if (item.status === 'error') continue;

        update(item.id, { status: 'parsing', progress: 0, stage: 'hashing', message: 'Preparing…' });

        try {
          const outcome = await parseBook(
            { file, knownBooks: get().books.map((book) => ({ id: book.id, fingerprint: book.fingerprint })) },
            (progress: ParseProgress) => {
              update(item.id, {
                progress: Math.min(1, Math.max(0, progress.progress)),
                stage: progress.stage,
                message: progress.message,
              });
            },
          );

          if (outcome.status === 'created') {
            await putBook(outcome.book);
            set((state) => {
              state.books.unshift(outcome.book);
              const entry = state.importing.find((candidate) => candidate.id === item.id);
              if (entry) {
                entry.status = 'done';
                entry.progress = 1;
                entry.bookId = outcome.book.id;
                entry.message = describeStatus(entry);
              }
            });
          } else if (outcome.status === 'duplicate') {
            update(item.id, {
              status: 'duplicate',
              progress: 1,
              stage: 'duplicate',
              bookId: outcome.bookId,
            });
          } else {
            update(item.id, {
              status: 'error',
              progress: 1,
              stage: outcome.code,
              message: outcome.message,
            });
          }
        } catch (error) {
          update(item.id, {
            status: 'error',
            progress: 1,
            stage: 'unknown',
            message:
              error instanceof Error
                ? error.message
                : 'Cadence could not import this book.',
          });
        }
      }
    },

    dismissImport: (id) => {
      set((state) => {
        state.importing = state.importing.filter((item) => item.id !== id);
      });
    },

    clearFinishedImports: () => {
      set((state) => {
        state.importing = state.importing.filter(
          (item) => item.status === 'queued' || item.status === 'parsing',
        );
      });
    },

    removeBook: async (id) => {
      const book = get().books.find((candidate) => candidate.id === id);
      if (!book) return;

      set((state) => {
        state.books = state.books.filter((candidate) => candidate.id !== id);
      });

      // Closing the export sheet keeps a job running. Stop it before the
      // book's PCM cache and metadata disappear underneath the encoder.
      const exportState = useExportStore.getState();
      if (
        exportState.active?.bookId === id &&
        (exportState.active.status === 'running' || exportState.active.status === 'paused')
      ) {
        await exportState.cancel().catch(() => undefined);
      }

      // Finished exports are files in OPFS keyed by job id; the database rows
      // alone do not remove them. Delete them with the book so they cannot
      // linger unreachable after the history is gone.
      const jobs = await listExportJobs(id).catch(() => []);
      await Promise.all(
        jobs.flatMap((job) => [
          opfs.remove(exportSegments(job.fileName)).catch(() => undefined),
          opfs.remove(exportSegments(`${job.fileName}.crswap`)).catch(() => undefined),
        ]),
      );

      await deleteBookRecord(id);
      await deleteBookBlobs(id).catch((error: unknown) => {
        // A very slow in-flight cache write can outlast the retry window.
        // The book is already gone from the shelf; try once more rather than
        // surfacing an unhandled rejection.
        console.warn('[cadence] book storage cleanup failed', error);
        window.setTimeout(() => {
          void deleteBookBlobs(id).catch(() => undefined);
        }, 3000);
      });

      // Delete rows inserted by a cache write that was already past its
      // existence check when the book record disappeared.
      await clearAudioCacheIndex(id).catch(() => undefined);

      if (useExportStore.getState().active?.bookId === id) {
        useExportStore.getState().resetRun();
      }
    },
  })),
);

export const selectLibraryCount = (state: LibraryState): number => state.books.length;

export const selectIsImporting = (state: LibraryState): boolean =>
  state.importing.some((item) => item.status === 'queued' || item.status === 'parsing');
