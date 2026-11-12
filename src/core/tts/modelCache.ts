import { modelSegments, opfs } from '@/core/storage/opfs';
import { sha256Hex } from './hash';

type CacheRequest = RequestInfo | URL;

function requestUrl(request: CacheRequest): string | null {
  const url =
    typeof request === 'string'
      ? request
      : request instanceof URL
        ? request.href
        : request.url;
  return /^https?:\/\//i.test(url) ? url : null;
}

function extensionFor(url: string): string {
  const match = /\.([a-z0-9]{2,5})(?:\?|#|$)/i.exec(url);
  return match ? match[1].toLowerCase() : 'bin';
}

function contentTypeFor(extension: string): string {
  switch (extension) {
    case 'json':
      return 'application/json';
    case 'txt':
      return 'text/plain';
    case 'onnx':
      return 'application/octet-stream';
    default:
      return 'application/octet-stream';
  }
}

async function entryName(url: string): Promise<string> {
  return `${await sha256Hex(`model:${url}`)}.${extensionFor(url)}`;
}

/**
 * Transformers.js custom cache backed by OPFS. Every model/tokenizer file is
 * stored once under `/models/cache/<sha256>.<ext>` and survives reloads.
 */
export const opfsModelCache = {
  async match(request: CacheRequest): Promise<Response | undefined> {
    const url = requestUrl(request);
    if (!url) return undefined;

    const extension = extensionFor(url);
    const bytes = await opfs.read(modelSegments('cache', await entryName(url)));
    if (!bytes) return undefined;

    return new Response(bytes.slice(), {
      status: 200,
      headers: {
        'Content-Type': contentTypeFor(extension),
        'Content-Length': String(bytes.byteLength),
      },
    });
  },

  async put(request: CacheRequest, response: Response): Promise<void> {
    const url = requestUrl(request);
    if (!url) return;

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) return;
    await opfs.write(modelSegments('cache', await entryName(url)), bytes);
  },
};

export async function clearModelCache(): Promise<void> {
  await opfs.removeDir('models', 'cache');
}

export async function modelCacheStats(): Promise<{ files: number; bytes: number }> {
  try {
    const dir = await opfs.ensureDir('models', 'cache');
    let files = 0;
    let bytes = 0;
    for await (const [name, handle] of dir.entries()) {
      if (!name) continue;
      if (handle.kind !== 'file') continue;
      const file = await (handle as FileSystemFileHandle).getFile();
      files += 1;
      bytes += file.size;
    }
    return { files, bytes };
  } catch {
    return { files: 0, bytes: 0 };
  }
}
