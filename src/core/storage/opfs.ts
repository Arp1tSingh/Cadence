const BOOKS_DIR = 'books';
const COVERS_DIR = 'covers';
const CACHE_DIR = 'cache';
const MODELS_DIR = 'models';
const EXPORTS_DIR = 'exports';

type DirectoryHandle = FileSystemDirectoryHandle;

function assertOpfs(): void {
  if (
    typeof navigator === 'undefined' ||
    !navigator.storage ||
    typeof navigator.storage.getDirectory !== 'function'
  ) {
    throw new Error('This browser does not expose the Origin Private File System.');
  }
}

async function directory(
  root: DirectoryHandle,
  name: string,
  create: boolean,
): Promise<DirectoryHandle> {
  return root.getDirectoryHandle(name, { create });
}

/**
 * Thin promise-based wrapper over OPFS. All binary payloads (sources, covers,
 * PCM cache, exports, model files) live here; IndexedDB only stores metadata.
 */
export class OpfsStore {
  private rootPromise: Promise<DirectoryHandle> | null = null;

  private async root(): Promise<DirectoryHandle> {
    if (!this.rootPromise) {
      assertOpfs();
      this.rootPromise = navigator.storage.getDirectory();
    }
    return this.rootPromise;
  }

  async ensureDir(...segments: string[]): Promise<DirectoryHandle> {
    let handle = await this.root();
    for (const segment of segments) {
      handle = await directory(handle, segment, true);
    }
    return handle;
  }

  async write(segments: string[], data: BlobPart | Blob): Promise<void> {
    const fileName = segments[segments.length - 1];
    const dir = await this.ensureDir(...segments.slice(0, -1));
    const file = await dir.getFileHandle(fileName, { create: true });
    const writable = await file.createWritable();
    try {
      if (data instanceof Blob) await writable.write(data);
      else await writable.write(data as BlobPart);
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => undefined);
      throw error;
    }
  }

  async read(segments: string[]): Promise<Uint8Array | null> {
    const fileName = segments[segments.length - 1];
    const dir = await this.ensureDir(...segments.slice(0, -1));
    try {
      const file = await dir.getFileHandle(fileName);
      const blob = await file.getFile();
      return new Uint8Array(await blob.arrayBuffer());
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return null;
      throw error;
    }
  }

  async readBlob(segments: string[], type = 'application/octet-stream'): Promise<Blob | null> {
    const bytes = await this.read(segments);
    if (!bytes) return null;
    return new Blob([bytes.slice()], { type });
  }

  async exists(segments: string[]): Promise<boolean> {
    const fileName = segments[segments.length - 1];
    const dir = await this.ensureDir(...segments.slice(0, -1));
    try {
      await dir.getFileHandle(fileName);
      return true;
    } catch {
      return false;
    }
  }

  async remove(segments: string[]): Promise<void> {
    const fileName = segments[segments.length - 1];
    const dir = await this.ensureDir(...segments.slice(0, -1));
    await dir.removeEntry(fileName).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'NotFoundError') return;
      throw error;
    });
  }

  async removeDir(...segments: string[]): Promise<void> {
    const parent = await this.ensureDir(...segments.slice(0, -1));
    const name = segments[segments.length - 1];
    if (!name) return;
    await parent.removeEntry(name, { recursive: true }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === 'NotFoundError') return;
      throw error;
    });
  }

  async estimate(): Promise<{ usage: number; quota: number }> {
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      return { usage: usage ?? 0, quota: quota ?? 0 };
    }
    return { usage: 0, quota: 0 };
  }
}

export const opfs = new OpfsStore();

export const bookSourceSegments = (bookId: string, extension: string): string[] => [
  BOOKS_DIR,
  `${bookId}.${extension}`,
];

export const coverSegments = (bookId: string, extension: string): string[] => [
  COVERS_DIR,
  `${bookId}.${extension}`,
];

export const exportSegments = (fileName: string): string[] => [EXPORTS_DIR, fileName];

export const modelSegments = (...path: string[]): string[] => [MODELS_DIR, ...path];

export async function saveBookSource(
  bookId: string,
  extension: string,
  data: BlobPart,
): Promise<string> {
  await opfs.write(bookSourceSegments(bookId, extension), data);
  return bookSourceSegments(bookId, extension).join('/');
}

export async function readBookSource(sourcePath: string): Promise<Uint8Array | null> {
  return opfs.read(sourcePath.split('/'));
}

export async function saveBookCover(
  bookId: string,
  extension: string,
  bytes: Uint8Array,
  mimeType: string,
): Promise<string> {
  await opfs.write(coverSegments(bookId, extension), new Blob([bytes.slice()], { type: mimeType }));
  return coverSegments(bookId, extension).join('/');
}

export async function readBookCover(coverPath: string): Promise<Blob | null> {
  return opfs.readBlob(coverPath.split('/'));
}

export async function deleteBookBlobs(bookId: string): Promise<void> {
  const booksDir = await opfs.ensureDir(BOOKS_DIR);
  for await (const [name] of booksDir.entries()) {
    if (name.startsWith(`${bookId}.`)) {
      await booksDir.removeEntry(name).catch(() => undefined);
    }
  }

  const coversDir = await opfs.ensureDir(COVERS_DIR);
  for await (const [name] of coversDir.entries()) {
    if (name.startsWith(`${bookId}.`)) {
      await coversDir.removeEntry(name).catch(() => undefined);
    }
  }

  await opfs.removeDir(CACHE_DIR, bookId);
}

export async function clearAudioCache(bookId: string): Promise<void> {
  await opfs.removeDir(CACHE_DIR, bookId);
}

export const audioCacheSegments = (
  bookId: string,
  voiceKey: string,
  cacheKey: string,
): string[] => [CACHE_DIR, bookId, voiceKey, `${cacheKey}.i16`];
