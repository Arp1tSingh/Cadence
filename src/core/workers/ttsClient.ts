import * as Comlink from 'comlink';
import type {
  CachedSentenceInfo,
  ModelInfo,
  ModelLoadProgress,
  ModelTier,
  SynthesisRequest,
  SynthesizedSentence,
  TtsWorkerApi,
} from '@/types/tts';

let api: Comlink.Remote<TtsWorkerApi> | null = null;
let worker: Worker | null = null;
let workerName: string | null = null;

function getApi(name = 'cadence-tts'): Comlink.Remote<TtsWorkerApi> {
  // A worker cannot resize ORT's pool after startup. A different name (the
  // benchmark uses `cadence-tts:threads=N`) means a different configuration,
  // so replace the worker instead of silently reusing the old thread count.
  if (api && name !== workerName) disposeTtsWorker();
  if (!api) {
    worker = new Worker(new URL('../../workers/tts.worker.ts', import.meta.url), {
      type: 'module',
      name,
    });
    workerName = name;
    api = Comlink.wrap<TtsWorkerApi>(worker);
  }
  return api;
}

export async function ensureTtsModel(
  tier: ModelTier,
  onProgress?: (progress: ModelLoadProgress) => void,
  options?: { threads?: number; name?: string },
): Promise<ModelInfo> {
  return getApi(options?.name).ensureModel(
    { tier, threads: options?.threads },
    onProgress ? Comlink.proxy(onProgress) : undefined,
  );
}

export async function synthesizeSentence(
  request: SynthesisRequest,
  options?: { name?: string },
): Promise<SynthesizedSentence> {
  return getApi(options?.name).synthesize(request);
}

/** Caches a sentence for export without transferring its PCM. */
export async function ensureSentenceCached(
  request: SynthesisRequest,
): Promise<CachedSentenceInfo> {
  return getApi().ensureCached(request);
}

/** Drops queued jobs so a seek or voice change is not starved by stale work. */
export async function cancelPending(): Promise<void> {
  if (!api) return;
  await api.cancelPending();
}

export async function isSentenceCached(request: SynthesisRequest): Promise<boolean> {
  return getApi().isCached(request);
}

export function disposeTtsWorker(): void {
  worker?.terminate();
  worker = null;
  api = null;
  workerName = null;
}

export type {
  CachedSentenceInfo,
  ModelInfo,
  ModelLoadProgress,
  ModelTier,
  SynthesisRequest,
  SynthesizedSentence,
};
