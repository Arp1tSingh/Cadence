import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  AudioCacheEntry,
  BookDocument,
  ExportJobRecord,
  ReadingProgress,
  SettingRecord,
} from '@/types/domain';

export type CadenceDb = DBSchema;
export type StoredBook = BookDocument;

export interface CadenceSchema extends DBSchema {
  books: {
    key: string;
    value: StoredBook;
    indexes: { byFingerprint: string; byUpdatedAt: number };
  };
  progress: {
    key: string;
    value: ReadingProgress;
  };
  settings: {
    key: string;
    value: SettingRecord;
  };
  audioCache: {
    key: string;
    value: AudioCacheEntry;
    indexes: { byBook: string; byBookVoice: [string, string] };
  };
  exportJobs: {
    key: string;
    value: ExportJobRecord;
    indexes: { byBook: string };
  };
}

const DB_NAME = 'cadence';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<CadenceSchema>> | null = null;

export function getDb(): Promise<IDBPDatabase<CadenceSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<CadenceSchema>(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains('books')) {
          const books = database.createObjectStore('books', { keyPath: 'id' });
          books.createIndex('byFingerprint', 'fingerprint', { unique: true });
          books.createIndex('byUpdatedAt', 'updatedAt');
        }

        if (!database.objectStoreNames.contains('progress')) {
          database.createObjectStore('progress', { keyPath: 'bookId' });
        }

        if (!database.objectStoreNames.contains('settings')) {
          database.createObjectStore('settings', { keyPath: 'key' });
        }

        if (!database.objectStoreNames.contains('audioCache')) {
          const cache = database.createObjectStore('audioCache', { keyPath: 'key' });
          cache.createIndex('byBook', 'bookId');
          cache.createIndex('byBookVoice', ['bookId', 'voiceKey']);
        }

        if (!database.objectStoreNames.contains('exportJobs')) {
          const jobs = database.createObjectStore('exportJobs', { keyPath: 'id' });
          jobs.createIndex('byBook', 'bookId');
        }
      },
    });
  }
  return dbPromise;
}

export async function listBooks(): Promise<StoredBook[]> {
  const db = await getDb();
  const books = await db.getAllFromIndex('books', 'byUpdatedAt');
  return books.reverse();
}

export async function getBook(id: string): Promise<StoredBook | undefined> {
  const db = await getDb();
  return db.get('books', id);
}

export async function findBookByFingerprint(
  fingerprint: string,
): Promise<StoredBook | undefined> {
  const db = await getDb();
  return db.getFromIndex('books', 'byFingerprint', fingerprint);
}

export async function putBook(book: StoredBook): Promise<void> {
  const db = await getDb();
  await db.put('books', book);
}

export async function deleteBook(id: string): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction(['books', 'progress', 'audioCache', 'exportJobs'], 'readwrite');
  await transaction.objectStore('books').delete(id);
  await transaction.objectStore('progress').delete(id);

  const cache = transaction.objectStore('audioCache');
  const cacheKeys = await cache.index('byBook').getAllKeys(id);
  for (const key of cacheKeys) await cache.delete(key);

  const jobs = transaction.objectStore('exportJobs');
  const jobKeys = await jobs.index('byBook').getAllKeys(id);
  for (const key of jobKeys) await jobs.delete(key);

  await transaction.done;
}

export async function getProgress(bookId: string): Promise<ReadingProgress | undefined> {
  const db = await getDb();
  return db.get('progress', bookId);
}

export async function putProgress(progress: ReadingProgress): Promise<void> {
  const db = await getDb();
  await db.put('progress', progress);
}

export async function deleteProgress(bookId: string): Promise<void> {
  const db = await getDb();
  await db.delete('progress', bookId);
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const db = await getDb();
  const record = await db.get('settings', key);
  return record?.value as T | undefined;
}

export async function putSetting<T>(key: string, value: T): Promise<void> {
  const db = await getDb();
  await db.put('settings', { key, value, updatedAt: Date.now() });
}

export async function listAudioCacheForBook(bookId: string): Promise<AudioCacheEntry[]> {
  const db = await getDb();
  return db.getAllFromIndex('audioCache', 'byBook', bookId);
}

export async function listAllAudioCacheEntries(): Promise<AudioCacheEntry[]> {
  const db = await getDb();
  return db.getAll('audioCache');
}

export async function getAudioCacheEntry(key: string): Promise<AudioCacheEntry | undefined> {
  const db = await getDb();
  return db.get('audioCache', key);
}

export async function putAudioCacheEntry(entry: AudioCacheEntry): Promise<void> {
  const db = await getDb();
  await db.put('audioCache', entry);
}

export async function deleteAudioCacheEntry(key: string): Promise<void> {
  const db = await getDb();
  await db.delete('audioCache', key);
}

export async function clearAudioCacheIndex(bookId: string): Promise<void> {
  const db = await getDb();
  const transaction = db.transaction('audioCache', 'readwrite');
  const store = transaction.objectStore('audioCache');
  const keys = await store.index('byBook').getAllKeys(bookId);
  for (const key of keys) await store.delete(key);
  await transaction.done;
}

export async function clearAllAudioCacheIndex(): Promise<void> {
  const db = await getDb();
  await db.clear('audioCache');
}

export async function listExportJobs(bookId?: string): Promise<ExportJobRecord[]> {
  const db = await getDb();
  if (bookId) return db.getAllFromIndex('exportJobs', 'byBook', bookId);
  return db.getAll('exportJobs');
}

export async function getExportJob(id: string): Promise<ExportJobRecord | undefined> {
  const db = await getDb();
  return db.get('exportJobs', id);
}

export async function putExportJob(job: ExportJobRecord): Promise<void> {
  const db = await getDb();
  await db.put('exportJobs', job);
}

export async function deleteExportJob(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('exportJobs', id);
}

export async function estimateStorage(): Promise<{ usage: number; quota: number }> {
  if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
    const { usage, quota } = await navigator.storage.estimate();
    return { usage: usage ?? 0, quota: quota ?? 0 };
  }
  return { usage: 0, quota: 0 };
}
