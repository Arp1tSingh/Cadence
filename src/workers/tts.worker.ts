import { expose } from 'comlink';
import * as Comlink from 'comlink';
import type {
  CachedSentenceInfo,
  ModelInfo,
  ModelLoadProgress,
  ModelLoadRequest,
  SynthesisRequest,
  SynthesizedSentence,
  TtsWorkerApi,
} from '@/types/tts';
import { SAMPLE_RATE } from '@/core/tts/constants';
import { createJobCancelledError } from '@/core/tts/cancel';
import { sentenceCacheKey } from '@/core/tts/cacheKey';
import { readSentenceCache, writeSentenceCache } from '@/core/tts/audioCache';
import { respellSentence } from '@/core/tts/respell';
import { speechProfileKey } from '@/core/tts/speechProfile';
import { ensureModel, synthesizeSentence } from '@/core/tts/engine';
import type { SentenceNode } from '@/types/domain';

type Priority = 'foreground' | 'prefetch';

type JobBase = {
  request: SynthesisRequest;
  /** Sentence after the lexicon/rules have been applied. */
  sentence: SentenceNode;
  key: string;
  voiceKey: string;
  speechKey: string;
  priority: Priority;
  cancelled: boolean;
};

type AudioJob = JobBase & {
  mode: 'audio';
  resolve: (value: SynthesizedSentence) => void;
  reject: (reason: unknown) => void;
};

type CacheJob = JobBase & {
  mode: 'cache';
  resolve: (value: CachedSentenceInfo) => void;
  reject: (reason: unknown) => void;
};

type Job = AudioJob | CacheJob;

const queue: Job[] = [];
let running = false;
/** The job currently awaiting inference, if any. */
let current: Job | null = null;

async function runAudioJob(job: AudioJob): Promise<SynthesizedSentence> {
  const { bookId } = job.request;
  const { sentence } = job;

  const cached = await readSentenceCache(bookId, job.voiceKey, job.key, job.speechKey);
  if (cached) {
    return {
      sentenceId: sentence.id,
      sampleRate: SAMPLE_RATE,
      duration: cached.duration,
      audio: cached.audio,
      timings: cached.timings,
      fromCache: true,
    };
  }

  if (job.cancelled) throw createJobCancelledError();

  const synthesized = await synthesizeSentence({
    sentence,
    voice: job.request.voice,
  });

  // Persist before returning: Comlink transfers the Float32Array buffer to
  // the main thread, detaching it here.
  await writeSentenceCache({
    bookId,
    voiceKey: job.voiceKey,
    cacheKey: job.key,
    sentenceId: sentence.id,
    chapterIndex: sentence.chapterIndex,
    audio: synthesized.audio,
    timings: synthesized.timings,
    speechKey: job.speechKey,
    cacheCapBytes: job.request.cacheCapBytes,
  });

  return synthesized;
}

/**
 * Cache-only variant for export. The synthesized Float32 PCM stays in the
 * worker and is dropped after it is written as Int16, so exporting a book does
 * not stream gigabytes through the main thread.
 */
async function runCacheJob(job: CacheJob): Promise<CachedSentenceInfo> {
  const { bookId } = job.request;
  const { sentence } = job;

  const cached = await readSentenceCache(bookId, job.voiceKey, job.key, job.speechKey);
  if (cached) {
    return {
      cacheKey: job.key,
      voiceKey: job.voiceKey,
      duration: cached.duration,
      fromCache: true,
    };
  }

  if (job.cancelled) throw createJobCancelledError();

  // Exports can start before any playback, so load the model lazily on the
  // first cache miss. An all-cached export never touches the model at all.
  if (job.request.tier) await ensureModel(job.request.tier);

  const synthesized = await synthesizeSentence({
    sentence,
    voice: job.request.voice,
  });

  await writeSentenceCache({
    bookId,
    voiceKey: job.voiceKey,
    cacheKey: job.key,
    sentenceId: sentence.id,
    chapterIndex: sentence.chapterIndex,
    audio: synthesized.audio,
    timings: synthesized.timings,
    speechKey: job.speechKey,
    cacheCapBytes: job.request.cacheCapBytes,
  });

  return {
    cacheKey: job.key,
    voiceKey: job.voiceKey,
    duration: synthesized.duration,
    fromCache: false,
  };
}

async function pump(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (queue.length > 0) {
      const job = queue.shift();
      if (!job) break;

      if (job.cancelled) {
        job.reject(createJobCancelledError());
        continue;
      }

      // Everything ahead of this job was drained, so it is now the newest
      // request. Let `cancelPending` know it is the only work in flight.
      current = job;
      try {
        if (job.mode === 'audio') job.resolve(await runAudioJob(job));
        else job.resolve(await runCacheJob(job));
      } catch (error) {
        job.reject(error);
      } finally {
        current = null;
      }
    }
  } finally {
    running = false;
  }
}

function enqueue(job: Job): void {
  if (job.priority === 'foreground') {
    // Foreground work always jumps ahead of queued prefetches while keeping
    // the reading order within each priority class.
    const firstPrefetch = queue.findIndex((queued) => queued.priority === 'prefetch');
    if (firstPrefetch === -1) queue.push(job);
    else queue.splice(firstPrefetch, 0, job);
  } else {
    queue.push(job);
  }
  void pump();
}

function priorityOf(request: SynthesisRequest): Priority {
  return request.priority === 'prefetch' ? 'prefetch' : 'foreground';
}

/**
 * Applies the active lexicon and normalization rules before the cache key is
 * computed, so a pronunciation change is a natural cache miss and an unchanged
 * profile returns the parser's original sentence (and therefore cache key).
 */
async function prepareJob(request: SynthesisRequest): Promise<{
  sentence: SentenceNode;
  key: string;
  voiceKey: string;
  speechKey: string;
}> {
  const sentence = respellSentence(request.sentence, request.speech);
  const { key, voiceKey } = await sentenceCacheKey(sentence, request.voice);
  return { sentence, key, voiceKey, speechKey: speechProfileKey(request.speech) };
}

const workerApi: TtsWorkerApi = {
  async ensureModel(
    request: ModelLoadRequest,
    onProgress?: (progress: ModelLoadProgress) => void,
  ): Promise<ModelInfo> {
    return ensureModel(request.tier, onProgress);
  },

  async synthesize(request: SynthesisRequest): Promise<SynthesizedSentence> {
    const { sentence, key, voiceKey, speechKey } = await prepareJob(request);

    const result = await new Promise<SynthesizedSentence>((resolve, reject) => {
      enqueue({
        mode: 'audio',
        request,
        sentence,
        key,
        voiceKey,
        speechKey,
        priority: priorityOf(request),
        cancelled: false,
        resolve,
        reject,
      });
    });

    return Comlink.transfer(result, [result.audio.buffer]);
  },

  async ensureCached(request: SynthesisRequest): Promise<CachedSentenceInfo> {
    const { sentence, key, voiceKey, speechKey } = await prepareJob(request);

    return new Promise<CachedSentenceInfo>((resolve, reject) => {
      enqueue({
        mode: 'cache',
        request,
        sentence,
        key,
        voiceKey,
        speechKey,
        // Export work never jumps ahead of playback.
        priority: 'prefetch',
        cancelled: false,
        resolve,
        reject,
      });
    });
  },

  /**
   * Drops every queued job. The in-flight inference still finishes so its
   * audio is cached, but its result is ignored by the calling generation.
   */
  async cancelPending(): Promise<void> {
    const pending = queue.splice(0, queue.length);
    for (const job of pending) {
      job.cancelled = true;
      job.reject(createJobCancelledError());
    }
    if (current) current.cancelled = true;
  },

  async isCached(request: SynthesisRequest): Promise<boolean> {
    const { key, voiceKey, speechKey } = await prepareJob(request);
    const cached = await readSentenceCache(request.bookId, voiceKey, key, speechKey);
    return cached !== null;
  },
};

expose(workerApi satisfies TtsWorkerApi);
