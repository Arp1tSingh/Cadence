import { expose } from 'comlink';
import {
  AudioSample,
  AudioSampleSource,
  canEncodeAudio,
  Mp3OutputFormat,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  type StreamTargetChunk,
} from 'mediabunny';
import { registerMp3Encoder } from '@mediabunny/mp3-encoder';
import type {
  ExportEncodeOptions,
  ExportEncodeResult,
  ExportFormat,
  ExportProgressUpdate,
  ExportProbe,
  ExporterWorkerApi,
} from '@/types/export';
import { SAMPLE_RATE } from '@/core/tts/constants';
import { int16ToFloat32 } from '@/core/tts/pcm';
import { audioCacheSegments, exportSegments, opfs } from '@/core/storage/opfs';
import { patchMoovWithChpl, type ChapterMarker } from '@/core/export/chpl';

const MP3_BITRATE = 128_000;
const AAC_BITRATE = 96_000;
/**
 * Kokoro narrates at 24 kHz, but platform AAC encoders (Media Foundation,
 * AudioToolbox) usually reject 24 kHz. Encode at 48 kHz and let Mediabunny
 * resample; 44.1 kHz is the fallback on stricter platforms.
 */
const AAC_SAMPLE_RATES = [48_000, 44_100, 24_000];
/** Flush granularity for the streaming target. */
const STREAM_CHUNK_BYTES = 4 * 1024 * 1024;

type Session = {
  options: ExportEncodeOptions;
  output: Output;
  source: AudioSampleSource;
  writable: FileSystemWritableFileStream;
  meter: { bytes: number };
  timeline: number;
  chapters: ChapterMarker[];
};

let session: Session | null = null;
let mp3Registered = false;

async function ensureMp3Encoder(): Promise<void> {
  if (mp3Registered) return;
  let native: boolean;
  try {
    native = await canEncodeAudio('mp3');
  } catch {
    native = false;
  }
  // Browsers ship no MP3 encoder, so LAME covers this in practice. Registering
  // the custom coder also overrides a native one, so only do it when needed.
  if (!native) registerMp3Encoder();
  mp3Registered = true;
}

/** Finds the first AAC sample rate this browser can actually encode, if any. */
async function aacSampleRate(): Promise<number | null> {
  for (const sampleRate of AAC_SAMPLE_RATES) {
    try {
      if (await canEncodeAudio('aac', { numberOfChannels: 1, sampleRate })) return sampleRate;
    } catch {
      // Try the next rate.
    }
  }
  return null;
}

function processingError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Audio encoding failed: ${message}`);
}

const workerApi: ExporterWorkerApi = {
  async probe(format: ExportFormat): Promise<ExportProbe> {
    if (format === 'm4b') {
      const sampleRate = await aacSampleRate();
      return {
        format,
        supported: sampleRate !== null,
        codec: 'aac',
        reason:
          sampleRate !== null
            ? undefined
            : 'This browser exposes no AAC encoder, so M4B is unavailable. Export MP3 instead.',
      };
    }

    try {
      await ensureMp3Encoder();
      return { format, supported: true, codec: 'mp3' };
    } catch (error) {
      return {
        format,
        supported: false,
        codec: 'mp3',
        reason: error instanceof Error ? error.message : 'The MP3 encoder could not be loaded.',
      };
    }
  },

  async begin(options: ExportEncodeOptions): Promise<void> {
    if (session) throw new Error('An export is already running in this worker.');

    const writable = await opfs.createWritable(exportSegments(options.fileName));
    const meter = { bytes: 0 };

    // StreamTarget writes into a generic WritableStream. Wrapping the OPFS
    // writable lets us track the output size without re-reading the file.
    const stream = new WritableStream<StreamTargetChunk>({
      write: async (chunk) => {
        await writable.write({
          type: 'write',
          data: chunk.data,
          position: chunk.position,
        });
        meter.bytes = Math.max(meter.bytes, chunk.position + chunk.data.byteLength);
      },
      close: async () => {
        await writable.close();
      },
      abort: async (reason) => {
        await writable.abort(reason).catch(() => undefined);
      },
    });

    try {
      let output: Output;
      let source: AudioSampleSource;

      if (options.format === 'm4b') {
        const sampleRate = await aacSampleRate();
        if (sampleRate === null) {
          throw new Error('This browser cannot encode AAC audio for M4B export.');
        }
        output = new Output({
          format: new Mp4OutputFormat({ fastStart: false, metadataFormat: 'udta' }),
          target: new StreamTarget(stream, {
            chunked: true,
            chunkSize: STREAM_CHUNK_BYTES,
          }),
        });
        source = new AudioSampleSource({
          codec: 'aac',
          bitrate: AAC_BITRATE,
          transform: { sampleRate, numberOfChannels: 1 },
        });
      } else {
        await ensureMp3Encoder();
        output = new Output({
          format: new Mp3OutputFormat(),
          target: new StreamTarget(stream, {
            chunked: true,
            chunkSize: STREAM_CHUNK_BYTES,
          }),
        });
        source = new AudioSampleSource({ codec: 'mp3', bitrate: MP3_BITRATE });
      }

      output.addAudioTrack(source);

      const cover = options.cover
        ? await opfs.read(options.cover.path.split('/')).catch(() => null)
        : null;

      output.setMetadataTags({
        title: options.title,
        artist: options.artist,
        album: options.album,
        albumArtist: options.artist,
        genre: 'Audiobook',
        trackNumber: 1,
        tracksTotal: 1,
        images: cover
          ? [
              {
                data: cover,
                mimeType: options.cover?.mimeType ?? 'image/jpeg',
                kind: 'coverFront',
              },
            ]
          : undefined,
      });

      await output.start();

      session = {
        options,
        output,
        source,
        writable,
        meter,
        timeline: 0,
        chapters: [],
      };
    } catch (error) {
      await writable.abort(error).catch(() => undefined);
      await opfs.remove(exportSegments(options.fileName)).catch(() => undefined);
      throw processingError(error);
    }
  },

  async markChapter(title: string): Promise<void> {
    if (!session) throw new Error('Start an export before marking chapters.');

    const label = title.trim() || `Chapter ${session.chapters.length + 1}`;
    const last = session.chapters[session.chapters.length - 1];
    // Empty chapters collapse onto the next boundary; keep one marker there.
    if (last && Math.abs(last.startSeconds - session.timeline) < 1e-6) {
      last.title = label;
      return;
    }
    session.chapters.push({ title: label, startSeconds: session.timeline });
  },

  async addSentence(cacheKey: string): Promise<ExportProgressUpdate> {
    if (!session) throw new Error('Start an export before adding sentences.');

    const { options, source } = session;
    const bytes = await opfs.read(audioCacheSegments(options.bookId, options.voiceKey, cacheKey));
    if (!bytes || bytes.byteLength === 0) {
      throw new Error(
        'Sentence audio is missing from the local cache. Re-synthesize it and try again.',
      );
    }

    const pcm = int16ToFloat32(bytes);
    const gapFrames = Math.max(0, Math.round(options.gapSeconds * SAMPLE_RATE));
    // The gap trails each sentence, so chapter marks land exactly on the first
    // spoken frame of the next chapter.
    const data = new Float32Array(pcm.length + gapFrames);
    data.set(pcm, 0);

    const sample = new AudioSample({
      data,
      format: 'f32-planar',
      numberOfChannels: 1,
      sampleRate: SAMPLE_RATE,
      timestamp: session.timeline,
    });

    try {
      await source.add(sample);
    } finally {
      sample.close();
    }

    session.timeline += data.length / SAMPLE_RATE;
    return { durationSeconds: session.timeline, bytes: session.meter.bytes };
  },

  async finish(): Promise<ExportEncodeResult> {
    const active = session;
    if (!active) throw new Error('No export is running.');
    session = null;

    try {
      await active.output.finalize();

      if (active.options.format === 'm4b' && active.chapters.length > 0) {
        await patchChapters(active.options.fileName, active.chapters);
      }

      const file = await opfs.file(exportSegments(active.options.fileName));
      if (!file) throw new Error('The encoded file disappeared from local storage.');

      return {
        fileName: active.options.fileName,
        size: file.size,
        durationSeconds: active.timeline,
        chapterCount: active.chapters.length,
      };
    } catch (error) {
      await active.output.cancel().catch(() => undefined);
      await active.writable.abort(error).catch(() => undefined);
      await opfs.remove(exportSegments(active.options.fileName)).catch(() => undefined);
      throw processingError(error);
    }
  },

  async cancel(): Promise<void> {
    const active = session;
    session = null;
    if (!active) return;

    await active.output.cancel().catch(() => undefined);
    await active.writable.abort().catch(() => undefined);
    await opfs.remove(exportSegments(active.options.fileName)).catch(() => undefined);
  },
};

/**
 * Finds the last top-level `moov` box by walking box headers with small reads.
 * The exporter uses `fastStart: false`, so the moov must sit at EOF where it can
 * grow in place without shifting any media offsets.
 */
async function findMoov(file: File): Promise<{ start: number; size: number } | null> {
  let position = 0;
  while (position + 8 <= file.size) {
    const header = new Uint8Array(await file.slice(position, position + 16).arrayBuffer());
    if (header.byteLength < 8) return null;

    const view = new DataView(header.buffer);
    const rawSize = view.getUint32(0);
    const type = String.fromCharCode(header[4], header[5], header[6], header[7]);

    let size = rawSize;
    if (rawSize === 1) {
      if (header.byteLength < 16) return null;
      size = Number(view.getBigUint64(8));
    } else if (rawSize === 0) {
      size = file.size - position;
    }

    if (!Number.isFinite(size) || size < 8 || position + size > file.size) return null;
    if (type === 'moov') return { start: position, size };
    position += size;
  }
  return null;
}

async function patchChapters(fileName: string, chapters: ChapterMarker[]): Promise<void> {
  const path = exportSegments(fileName);
  const file = await opfs.file(path);
  if (!file) throw new Error('The encoded file disappeared before chapters were written.');

  const moov = await findMoov(file);
  if (!moov) throw new Error('Could not find the MP4 movie box to add chapters to.');
  if (moov.start + moov.size !== file.size) {
    throw new Error('The movie box is not at the end of the file, so chapters cannot be added safely.');
  }

  const bytes = new Uint8Array(
    await file.slice(moov.start, moov.start + moov.size).arrayBuffer(),
  );
  // Re-wrap into an ArrayBuffer-backed view so the File System Access types
  // accept it (a patched buffer may be typed over a shared ArrayBuffer).
  const patched = new Uint8Array(patchMoovWithChpl(bytes, chapters));

  const handle = await opfs.fileHandle(path);
  const writable = await handle.createWritable({ keepExistingData: true });
  try {
    // The moov is last, so growing it never moves media data. Truncate in case
    // a re-patch makes the metadata smaller than the original.
    await writable.write({ type: 'write', data: patched, position: moov.start });
    await writable.truncate(moov.start + patched.length);
    await writable.close();
  } catch (error) {
    await writable.abort(error).catch(() => undefined);
    throw error;
  }
}

expose(workerApi satisfies ExporterWorkerApi);
