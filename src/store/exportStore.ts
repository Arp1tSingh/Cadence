import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { BookDocument, ExportJobRecord } from '@/types/domain';
import type { ExportFormat, ExportProbe, ExportScope } from '@/types/export';
import { deleteExportJob, listExportJobs, putExportJob } from '@/core/storage/db';
import { exportSegments, opfs } from '@/core/storage/opfs';
import { exporter } from '@/core/workers/exporterClient';
import { ensureSentenceCached } from '@/core/workers/ttsClient';
import { buildExportPlan, coverMimeType, suggestedExportName } from '@/core/export/plan';
import type { ExportPlan } from '@/core/export/plan';
import { SENTENCE_GAP_SECONDS } from '@/core/tts/constants';
import { voiceKeyFor } from '@/core/tts/voices';
import { isJobCancelled } from '@/core/tts/cancel';
import { formatClock } from '@/lib/time';
import { formatBytes } from '@/lib/format';
import { useSettingsStore } from './settingsStore';

export type ExportPhase =
  | 'idle'
  | 'preparing'
  | 'synthesizing'
  | 'encoding'
  | 'finalizing'
  | 'paused'
  | 'done'
  | 'error';

export type StartExportOptions = {
  format: ExportFormat;
  scope: ExportScope;
  chapterIndex?: number;
};

type Runtime = {
  token: number;
  job: ExportJobRecord;
  book: BookDocument;
  paused: boolean;
  cancelled: boolean;
  resumed: (() => void) | null;
};

let runtime: Runtime | null = null;
let nextToken = 0;
let lastPersistedAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function persistJob(job: ExportJobRecord, force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastPersistedAt < 1500) return;
  lastPersistedAt = now;
  job.updatedAt = now;
  await putExportJob({ ...job });
}

async function ensureCachedWithRetry(
  job: ExportJobRecord,
  sentence: ExportPlan['chapters'][number]['sentences'][number],
  cancelled: () => boolean,
) {
  const voice = useSettingsStore.getState().voice;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await ensureSentenceCached({
        bookId: job.bookId,
        voice,
        sentence,
        priority: 'prefetch',
        tier: useSettingsStore.getState().modelTier,
      });
    } catch (error) {
      // Playback pauses/seeks call cancelPending(), which drops queued export
      // work too. That is expected; re-queue unless the export itself stopped.
      if (!isJobCancelled(error) || cancelled() || attempt >= 8) throw error;
      await sleep(80 * (attempt + 1));
    }
  }
}

type ExportState = {
  open: boolean;
  book: BookDocument | null;
  jobs: ExportJobRecord[];
  active: ExportJobRecord | null;
  phase: ExportPhase;
  message: string;
  bytes: number;
  durationSeconds: number;
  probes: Record<ExportFormat, ExportProbe | null>;
  error: string | null;

  openStudio: (book: BookDocument) => Promise<void>;
  closeStudio: () => void;
  refreshJobs: () => Promise<void>;
  start: (options: StartExportOptions) => Promise<void>;
  pause: () => void;
  resume: () => void;
  cancel: () => Promise<void>;
  dismissError: () => void;
  resetRun: () => void;
  download: (job: ExportJobRecord) => Promise<void>;
  remove: (job: ExportJobRecord) => Promise<void>;
};

export const useExportStore = create<ExportState>()(
  immer((set, get) => {
    const setActive = (job: ExportJobRecord, phase: ExportPhase, message: string) => {
      set((state) => {
        state.active = { ...job };
        state.phase = phase;
        state.message = message;
        state.bytes = job.size;
        state.durationSeconds = job.durationSeconds;
      });
    };

    const finishRun = async (
      job: ExportJobRecord,
      phase: ExportPhase,
      message: string,
      patch: Partial<ExportJobRecord>,
    ) => {
      Object.assign(job, patch, { updatedAt: Date.now() });
      await putExportJob({ ...job });
      setActive(job, phase, message);
      await get().refreshJobs();
    };

    const run = async (active: Runtime, plan: ExportPlan) => {
      const { job } = active;
      const total = plan.totalSentences;

      try {
        set((state) => {
          state.phase = 'preparing';
          state.message = 'Preparing the encoder…';
          state.error = null;
        });

        await exporter.begin({
          format: job.format,
          bookId: job.bookId,
          voiceKey: job.voiceKey,
          fileName: job.fileName,
          title: plan.title,
          artist: plan.artist,
          album: plan.album,
          gapSeconds: SENTENCE_GAP_SECONDS,
          cover: active.book.coverPath
            ? {
                path: active.book.coverPath,
                mimeType: coverMimeType(active.book.coverPath),
              }
            : undefined,
        });

        let completed = 0;
        let durationSeconds = 0;
        let bytes = 0;

        const waitIfPaused = async () => {
          while (active.paused && !active.cancelled) {
            await new Promise<void>((resolve) => {
              active.resumed = resolve;
            });
          }
        };

        for (const chapter of plan.chapters) {
          if (active.cancelled) return;
          await waitIfPaused();
          if (active.cancelled) return;

          await exporter.markChapter(chapter.title);

          for (const sentence of chapter.sentences) {
            await waitIfPaused();
            if (active.cancelled) return;

            set((state) => {
              state.phase = 'synthesizing';
              state.message = `Narrating ${completed + 1} of ${total}`;
            });

            const cached = await ensureCachedWithRetry(job, sentence, () => active.cancelled);
            if (active.cancelled) return;

            set((state) => {
              state.phase = 'encoding';
              state.message = `Encoding ${completed + 1} of ${total}`;
            });

            const update = await exporter.addSentence(cached.cacheKey);
            completed += 1;
            durationSeconds = update.durationSeconds;
            bytes = update.bytes;

            job.completedSentences = completed;
            job.progress = total > 0 ? completed / total : 0;
            job.durationSeconds = durationSeconds;
            job.size = bytes;

            set((state) => {
              if (!state.active) return;
              state.active.completedSentences = completed;
              state.active.progress = job.progress;
              state.active.durationSeconds = durationSeconds;
              state.active.size = bytes;
              state.durationSeconds = durationSeconds;
              state.bytes = bytes;
            });
            await persistJob(job);
          }
        }

        if (active.cancelled) return;

        set((state) => {
          state.phase = 'finalizing';
          state.message = job.format === 'm4b' ? 'Writing chapters…' : 'Finalizing the MP3…';
        });

        const result = await exporter.finish();
        if (active.cancelled) return;

        job.completedSentences = total;
        job.progress = 1;
        job.status = 'done';
        job.durationSeconds = result.durationSeconds;
        job.size = result.size;
        job.error = undefined;
        runtime = null;

        await finishRun(
          job,
          'done',
          `Ready · ${formatClock(result.durationSeconds)} · ${formatBytes(result.size)}`,
          {},
        );
      } catch (error) {
        if (active.cancelled) return;
        const message = error instanceof Error ? error.message : 'The export failed.';
        job.status = 'error';
        job.error = message;
        runtime = null;
        await exporter.cancel().catch(() => undefined);
        await finishRun(job, 'error', message, {});
        set((state) => {
          state.error = message;
        });
      }
    };

    return {
      open: false,
      book: null,
      jobs: [],
      active: null,
      phase: 'idle',
      message: '',
      bytes: 0,
      durationSeconds: 0,
      probes: { mp3: null, m4b: null },
      error: null,

      openStudio: async (book) => {
        set((state) => {
          state.open = true;
          state.book = book;
          state.error = null;
        });

        const probes = await Promise.all([
          exporter.probe('mp3').catch(
            (error: unknown): ExportProbe => ({
              format: 'mp3',
              supported: false,
              codec: 'mp3',
              reason: error instanceof Error ? error.message : 'The MP3 encoder is unavailable.',
            }),
          ),
          exporter.probe('m4b').catch(
            (error: unknown): ExportProbe => ({
              format: 'm4b',
              supported: false,
              codec: 'aac',
              reason: error instanceof Error ? error.message : 'The AAC encoder is unavailable.',
            }),
          ),
        ]);
        set((state) => {
          for (const probe of probes) state.probes[probe.format] = probe;
        });

        const jobs = await listExportJobs(book.id);
        // A running job cannot survive a reload: encoders are not
        // serializable. Mark it interrupted so the history is honest.
        for (const job of jobs) {
          if (job.status === 'running') {
            job.status = 'paused';
            job.error = 'Interrupted when the tab closed. Start a new export to rebuild from cached audio.';
            job.updatedAt = Date.now();
            await putExportJob(job);
          }
        }
        jobs.sort((a, b) => b.createdAt - a.createdAt);
        set((state) => {
          state.jobs = jobs;
          const current = jobs.find((job) => job.id === runtime?.job.id);
          if (current) {
            state.active = current;
            state.phase = 'paused';
            state.message = 'Interrupted';
          }
        });
      },

      closeStudio: () => {
        set((state) => {
          state.open = false;
        });
      },

      refreshJobs: async () => {
        const book = get().book;
        if (!book) return;
        const jobs = await listExportJobs(book.id);
        jobs.sort((a, b) => b.createdAt - a.createdAt);
        set((state) => {
          state.jobs = jobs;
        });
      },

      start: async (options) => {
        const book = get().book;
        if (!book) throw new Error('Open a book before exporting.');
        if (runtime) throw new Error('Another export is already running.');

        const plan = buildExportPlan(book, options.scope, options.chapterIndex);
        if (plan.totalSentences === 0 || plan.chapters.length === 0) {
          set((state) => {
            state.error = 'There is no narrated text in this selection.';
          });
          return;
        }

        const probe = get().probes[options.format];
        if (probe && !probe.supported) {
          set((state) => {
            state.error = probe.reason ?? `${options.format.toUpperCase()} is unavailable here.`;
          });
          return;
        }

        const voice = useSettingsStore.getState().voice;
        const id = crypto.randomUUID();
        const suggestedName = suggestedExportName(plan, options.format);
        const chapter =
          options.scope === 'chapter'
            ? book.chapters.find((entry) => entry.index === options.chapterIndex)
            : undefined;
        const now = Date.now();

        const job: ExportJobRecord = {
          id,
          bookId: book.id,
          bookTitle: book.metadata.title,
          format: options.format,
          scope: options.scope,
          chapterIndex: options.scope === 'chapter' ? options.chapterIndex : undefined,
          chapterTitle: chapter?.title,
          status: 'running',
          progress: 0,
          totalSentences: plan.totalSentences,
          completedSentences: 0,
          durationSeconds: 0,
          size: 0,
          fileName: `${id}.${options.format}`,
          suggestedName,
          voiceKey: voiceKeyFor(voice),
          title: plan.title,
          createdAt: now,
          updatedAt: now,
        };

        await putExportJob(job);
        lastPersistedAt = Date.now();

        const active: Runtime = {
          token: (nextToken += 1),
          job,
          book,
          paused: false,
          cancelled: false,
          resumed: null,
        };
        runtime = active;

        set((state) => {
          state.active = { ...job };
          state.phase = 'preparing';
          state.message = 'Preparing the encoder…';
          state.bytes = 0;
          state.durationSeconds = 0;
          state.error = null;
        });

        void run(active, plan);
      },

      pause: () => {
        if (!runtime) return;
        runtime.paused = true;
        runtime.job.status = 'paused';
        runtime.job.updatedAt = Date.now();
        void putExportJob({ ...runtime.job });
        set((state) => {
          if (state.active) state.active.status = 'paused';
          state.phase = 'paused';
          state.message = 'Paused';
        });
      },

      resume: () => {
        if (!runtime) return;
        runtime.paused = false;
        runtime.job.status = 'running';
        runtime.job.updatedAt = Date.now();
        void putExportJob({ ...runtime.job });
        runtime.resumed?.();
        runtime.resumed = null;
        set((state) => {
          if (state.active) state.active.status = 'running';
          state.phase = 'synthesizing';
          state.message = 'Resuming…';
        });
      },

      cancel: async () => {
        const active = runtime;
        runtime = null;
        if (!active) return;
        active.cancelled = true;
        active.resumed?.();

        // Do not call cancelPending() here: the TTS queue is shared with
        // playback, and only one export job is ever in flight. Letting it finish
        // caches one extra sentence and never stalls the narration.
        await exporter.cancel().catch(() => undefined);
        await deleteExportJob(active.job.id).catch(() => undefined);

        set((state) => {
          state.active = null;
          state.phase = 'idle';
          state.message = '';
          state.bytes = 0;
          state.durationSeconds = 0;
        });
        await get().refreshJobs();
      },

      dismissError: () => {
        set((state) => {
          state.error = null;
        });
      },

      resetRun: () => {
        // Never clear a live run; only a finished/errored summary is dismissible.
        if (runtime) return;
        set((state) => {
          state.active = null;
          state.phase = 'idle';
          state.message = '';
          state.bytes = 0;
          state.durationSeconds = 0;
          state.error = null;
        });
      },

      download: async (job) => {
        const file = await opfs.file(exportSegments(job.fileName));
        if (!file) {
          set((state) => {
            state.error = 'That export file is no longer in local storage.';
          });
          return;
        }

        const picker = (
          window as Window & {
            showSaveFilePicker?: (options: {
              suggestedName?: string;
              types?: { description: string; accept: Record<string, string[]> }[];
            }) => Promise<FileSystemFileHandle>;
          }
        ).showSaveFilePicker;

        if (picker) {
          try {
            const handle = await picker({
              suggestedName: job.suggestedName,
              types: [
                {
                  description: job.format === 'm4b' ? 'Audiobook' : 'MP3 audio',
                  accept: {
                    [job.format === 'm4b' ? 'audio/mp4' : 'audio/mpeg']: [
                      `.${job.format}`,
                    ],
                  },
                },
              ],
            });
            const writable = await handle.createWritable();
            await file.stream().pipeTo(writable);
            return;
          } catch (error) {
            if (error instanceof DOMException && error.name === 'AbortError') return;
            // Permission or API failure: fall back to a streamed blob download.
          }
        }

        const url = URL.createObjectURL(file);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = job.suggestedName;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      },

      remove: async (job) => {
        if (runtime?.job.id === job.id) await get().cancel();
        await opfs.remove(exportSegments(job.fileName)).catch(() => undefined);
        await deleteExportJob(job.id).catch(() => undefined);
        if (get().active?.id === job.id) {
          set((state) => {
            state.active = null;
            state.phase = 'idle';
            state.message = '';
          });
        }
        await get().refreshJobs();
      },
    };
  }),
);

