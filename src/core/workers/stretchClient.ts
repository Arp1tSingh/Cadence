import * as Comlink from 'comlink';
import type { StretchWorkerApi } from '@/types/audio';

let api: Comlink.Remote<StretchWorkerApi> | null = null;
let worker: Worker | null = null;

function getApi(): Comlink.Remote<StretchWorkerApi> {
  if (!api) {
    worker = new Worker(new URL('../../workers/stretch.worker.ts', import.meta.url), {
      type: 'module',
      name: 'cadence-stretch',
    });
    api = Comlink.wrap<StretchWorkerApi>(worker);
  }
  return api;
}

/**
 * Returns pitch-preserving PCM at `rate`. The input buffer is transferred to
 * the worker, so callers must treat `audio` as consumed.
 */
export async function stretchAudio(audio: Float32Array, rate: number): Promise<Float32Array> {
  return getApi().stretch(Comlink.transfer({ audio, rate }, [audio.buffer]));
}

export function disposeStretchWorker(): void {
  worker?.terminate();
  worker = null;
  api = null;
}
