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

function getApi(): Comlink.Remote<TtsWorkerApi> {
  if (!api) {
    worker = new Worker(new URL('../../workers/tts.worker.ts', import.meta.url), {
      type: 'module',
      name: 'cadence-tts',
    });
    api = Comlink.wrap<TtsWorkerApi>(worker);
  }
  return api;
}

export async function ensureTtsModel(
  tier: ModelTier,
  onProgress?: (progress: ModelLoadProgress) => void,
): Promise<ModelInfo> {
  return getApi().ensureModel(
    { tier },
    onProgress ? Comlink.proxy(onProgress) : undefined,
  );
}

export async function synthesizeSentence(
  request: SynthesisRequest,
): Promise<SynthesizedSentence> {
  return getApi().synthesize(request);
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
}

export type {
  CachedSentenceInfo,
  ModelInfo,
  ModelLoadProgress,
  ModelTier,
  SynthesisRequest,
  SynthesizedSentence,
};
