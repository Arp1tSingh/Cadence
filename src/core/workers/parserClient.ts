import * as Comlink from 'comlink';
import type {
  ParseOutcome,
  ParseProgress,
  ParseRequest,
  ParserWorkerApi,
} from '@/types/parser';

let api: Comlink.Remote<ParserWorkerApi> | null = null;
let worker: Worker | null = null;

function getApi(): Comlink.Remote<ParserWorkerApi> {
  if (!api) {
    worker = new Worker(new URL('../../workers/parser.worker.ts', import.meta.url), {
      type: 'module',
      name: 'cadence-parser',
    });
    api = Comlink.wrap<ParserWorkerApi>(worker);
  }
  return api;
}

export async function parseBook(
  request: ParseRequest,
  onProgress?: (progress: ParseProgress) => void,
): Promise<ParseOutcome> {
  return getApi().parse(request, onProgress ? Comlink.proxy(onProgress) : undefined);
}

export function disposeParserWorker(): void {
  worker?.terminate();
  worker = null;
  api = null;
}

export type { ParseOutcome, ParseProgress, ParseRequest };
