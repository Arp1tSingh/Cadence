import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { BookDocument } from '@/types/domain';
import type { ParseProgress } from '@/types/parser';
import { deleteBook as deleteBookRecord, listBooks, putBook } from '@/core/storage/db';
import { deleteBookBlobs } from '@/core/storage/opfs';
import { parseBook } from '@/core/workers/parserClient';

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

      await deleteBookRecord(id);
      await deleteBookBlobs(id);
    },
  })),
);

export const selectLibraryCount = (state: LibraryState): number => state.books.length;

export const selectIsImporting = (state: LibraryState): boolean =>
  state.importing.some((item) => item.status === 'queued' || item.status === 'parsing');
