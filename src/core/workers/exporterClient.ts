import * as Comlink from 'comlink';
import type {
  ExportEncodeOptions,
  ExportEncodeResult,
  ExportFormat,
  ExportProgressUpdate,
  ExportProbe,
  ExporterWorkerApi,
} from '@/types/export';

let api: Comlink.Remote<ExporterWorkerApi> | null = null;
let worker: Worker | null = null;

function getApi(): Comlink.Remote<ExporterWorkerApi> {
  if (!api) {
    worker = new Worker(new URL('../../workers/exporter.worker.ts', import.meta.url), {
      type: 'module',
      name: 'cadence-exporter',
    });
    api = Comlink.wrap<ExporterWorkerApi>(worker);
  }
  return api;
}

export const exporter = {
  probe(format: ExportFormat): Promise<ExportProbe> {
    return getApi().probe(format);
  },
  begin(options: ExportEncodeOptions): Promise<void> {
    return getApi().begin(options);
  },
  markChapter(title: string): Promise<void> {
    return getApi().markChapter(title);
  },
  addSentence(cacheKey: string): Promise<ExportProgressUpdate> {
    return getApi().addSentence(cacheKey);
  },
  finish(): Promise<ExportEncodeResult> {
    return getApi().finish();
  },
  cancel(): Promise<void> {
    return getApi().cancel();
  },
  dispose(): void {
    worker?.terminate();
    worker = null;
    api = null;
  },
};
