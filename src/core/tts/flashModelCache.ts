import { FLASH_MODEL_CACHE_VERSION } from './constants';
import { modelSegments, opfs } from '@/core/storage/opfs';

export type FlashModelFile = {
  bytes: Uint8Array;
  fromCache: boolean;
};

/**
 * Piper weights live apart from the transformers cache: different loader,
 * different invalidation rules. Bump `FLASH_MODEL_CACHE_VERSION` when the
 * adapter or file layout changes.
 */
export function flashModelSegments(voiceId: string, extension: 'onnx' | 'json'): string[] {
  return modelSegments('flash', FLASH_MODEL_CACHE_VERSION, `${voiceId}.${extension}`);
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Reads a voice file from OPFS or downloads it once. Progress is reported in
 * bytes so the setup overlay can show a real ring for a 63 MB model.
 */
export async function loadFlashFile(
  url: string,
  segments: string[],
  onProgress?: (received: number, total: number) => void,
): Promise<FlashModelFile> {
  const existing = await opfs.file(segments);
  if (existing && existing.size > 0) {
    return { bytes: new Uint8Array(await existing.arrayBuffer()), fromCache: true };
  }

  const response = await fetch(url, { mode: 'cors' });
  if (!response.ok) {
    throw new Error(`The Flash voice download failed (${response.status}).`);
  }

  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0) throw new Error('The Flash voice download was empty.');
    await opfs.write(segments, bytes as BlobPart);
    onProgress?.(bytes.byteLength, bytes.byteLength);
    return { bytes, fromCache: false };
  }

  const fixed = total > 0 ? new Uint8Array(total) : null;
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (fixed) fixed.set(value, received);
    else chunks.push(value);
    received += value.byteLength;
    onProgress?.(received, total);
  }

  const bytes = fixed ? fixed.subarray(0, received) : concatChunks(chunks, received);
  if (bytes.byteLength === 0) throw new Error('The Flash voice download was empty.');
  await opfs.write(segments, bytes as BlobPart);
  return { bytes, fromCache: false };
}
