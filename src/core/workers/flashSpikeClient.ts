import * as Comlink from 'comlink';
import type {
  FlashSpikeLoadRequest,
  FlashSpikeModelInfo,
  FlashSpikeSynthesis,
  FlashSpikeSynthesisRequest,
  FlashSpikeWorkerApi,
} from '@/workers/flashSpike.worker';

export type FlashSpikeHandle = {
  load(
    request: Omit<FlashSpikeLoadRequest, 'threads'>,
  ): Promise<FlashSpikeModelInfo>;
  synthesize(request: FlashSpikeSynthesisRequest): Promise<FlashSpikeSynthesis>;
  dispose(): Promise<void>;
  terminate(): void;
};

/**
 * Creates a dedicated Piper worker. Thread count is part of the worker name
 * because ONNX Runtime reads `numThreads` once when its WASM backend starts;
 * a new count therefore needs a new worker, not a new session.
 */
export function createFlashSpikeWorker(threads?: number): FlashSpikeHandle {
  const name = threads
    ? `cadence-flash-spike:threads=${threads}`
    : 'cadence-flash-spike';
  const worker = new Worker(
    new URL('../../workers/flashSpike.worker.ts', import.meta.url),
    { type: 'module', name },
  );
  const api = Comlink.wrap<FlashSpikeWorkerApi>(worker);

  return {
    load: (request) =>
      api.load({
        ...request,
        threads,
        onProgress: request.onProgress
          ? Comlink.proxy(request.onProgress)
          : undefined,
      }),
    synthesize: (request) => api.synthesize(request),
    dispose: () => api.dispose(),
    terminate: () => worker.terminate(),
  };
}
