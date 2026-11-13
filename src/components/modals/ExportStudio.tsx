import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileAudio,
  Pause,
  Play,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Sheet } from '@/components/ui/Sheet';
import { buildExportPlan } from '@/core/export/plan';
import { formatDuration } from '@/core/parsing/text';
import { voiceLabelFor } from '@/core/tts/voices';
import { cn } from '@/lib/cn';
import { formatBytes, formatRelativeTime } from '@/lib/format';
import { formatClock } from '@/lib/time';
import { useExportStore } from '@/store/exportStore';
import { usePlayerStore } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';
import type { ExportJobRecord } from '@/types/domain';
import type { ExportFormat, ExportScope } from '@/types/export';

const FORMAT_COPY: Record<ExportFormat, { title: string; blurb: string; detail: string }> = {
  m4b: {
    title: 'M4B audiobook',
    blurb: 'AAC · chapter markers',
    detail: 'Best for iPhone, iPad, and Apple Books. Chapter markers are written as a Nero chpl list.',
  },
  mp3: {
    title: 'MP3 audio',
    blurb: '128 kbps · plays everywhere',
    detail: 'The universal fallback. No chapter metadata, but every player and car stereo accepts it.',
  },
};

/** Modal orchestration surface for MP3/M4B export, progress, and downloads. */
export function ExportStudio() {
  const open = useExportStore((state) => state.open);
  const book = useExportStore((state) => state.book);
  const phase = useExportStore((state) => state.phase);
  const message = useExportStore((state) => state.message);
  const active = useExportStore((state) => state.active);
  const bytes = useExportStore((state) => state.bytes);
  const durationSeconds = useExportStore((state) => state.durationSeconds);
  const probes = useExportStore((state) => state.probes);
  const jobs = useExportStore((state) => state.jobs);
  const error = useExportStore((state) => state.error);
  const closeStudio = useExportStore((state) => state.closeStudio);
  const start = useExportStore((state) => state.start);
  const pause = useExportStore((state) => state.pause);
  const resume = useExportStore((state) => state.resume);
  const cancel = useExportStore((state) => state.cancel);
  const resetRun = useExportStore((state) => state.resetRun);
  const dismissError = useExportStore((state) => state.dismissError);
  const download = useExportStore((state) => state.download);
  const remove = useExportStore((state) => state.remove);

  const voice = useSettingsStore((state) => state.voice);
  const playerChapter = usePlayerStore((state) => state.snapshot.chapterIndex);

  const [format, setFormat] = useState<ExportFormat | null>(null);
  const [scope, setScope] = useState<ExportScope>('chapter');
  const [chapterIndex, setChapterIndex] = useState(0);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const playerChapterRef = useRef(playerChapter);
  playerChapterRef.current = playerChapter;
  const chapterCount = book?.chapters.length ?? 0;

  // Opening the studio always starts from the chapter being listened to.
  useEffect(() => {
    if (!open) return;
    setScope('chapter');
    setChapterIndex(Math.min(playerChapterRef.current, Math.max(0, chapterCount - 1)));
    setFormat(null);
    setConfirmCancel(false);
  }, [open, book?.id, chapterCount]);

  const plan = useMemo(
    () => (book ? buildExportPlan(book, scope, chapterIndex) : null),
    [book, scope, chapterIndex],
  );

  const selected: ExportFormat = format ?? (probes.m4b?.supported ? 'm4b' : 'mp3');
  const selectedProbe = probes[selected];
  const voiceLabel = voiceLabelFor(voice);
  const plannedChapters = plan?.chapters.length ?? 0;

  const busy =
    phase === 'preparing' || phase === 'synthesizing' || phase === 'encoding' || phase === 'finalizing';
  const running = busy || phase === 'paused';
  const progress = active?.progress ?? 0;
  const completed = active?.completedSentences ?? 0;
  const total = active?.totalSentences ?? 0;

  // A finished job shows in the success banner and in the history list, so it
  // can still be downloaded after the banner is dismissed. Only hide the job
  // that is actively encoding to avoid showing it twice.
  const history = jobs.filter(
    (job) => job.status !== 'running' && !(running && job.id === active?.id),
  );

  const begin = () => {
    if (!plan || plan.totalSentences === 0) return;
    void start({ format: selected, scope, chapterIndex });
  };

  const close = () => {
    if (confirmCancel || running) {
      setConfirmCancel(false);
      closeStudio();
      return;
    }
    closeStudio();
  };

  const footer = running ? (
    <>
      <Button
        variant="ghost"
        className="text-danger hover:bg-danger/10"
        onClick={() => setConfirmCancel(true)}
      >
        Cancel export
      </Button>
      {busy ? (
        <Button variant="secondary" onClick={pause}>
          <Pause size={15} aria-hidden="true" />
          Pause
        </Button>
      ) : (
        <Button onClick={resume}>
          <Play size={15} fill="currentColor" aria-hidden="true" />
          Resume
        </Button>
      )}
    </>
  ) : phase === 'done' ? (
    <>
      <Button variant="ghost" onClick={resetRun}>
        Start another
      </Button>
      <Button onClick={() => (active ? void download(active) : undefined)}>
        <Download size={15} aria-hidden="true" />
        Download
      </Button>
    </>
  ) : (
    <>
      <Button variant="ghost" onClick={closeStudio}>
        Close
      </Button>
      <Button
        onClick={begin}
        disabled={!plan || plan.totalSentences === 0 || selectedProbe?.supported === false}
      >
        <FileAudio size={15} aria-hidden="true" />
        Start export
      </Button>
    </>
  );

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Export studio"
      description="Encode the narration into one file, entirely on this device."
      size="lg"
      footer={footer}
    >
      <div className="flex flex-col gap-6">
        {error ? (
          <div className="flex items-start gap-3 rounded-card border border-danger/30 bg-danger/10 px-3.5 py-3">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
            <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-ink-secondary">{error}</p>
            <button
              type="button"
              onClick={dismissError}
              className="shrink-0 text-[11px] font-semibold text-ink-tertiary hover:text-ink"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {running && active ? (
          <section className="rounded-card border border-hairline bg-surface-muted/50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[13.5px] font-semibold">{active.suggestedName}</p>
                <p
                  role="status"
                  aria-live="polite"
                  className="mt-0.5 truncate text-[11.5px] text-ink-secondary"
                >
                  {message || 'Working…'}
                </p>
              </div>
              <span className="shrink-0 rounded-pill border border-hairline px-2 py-1 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-ink-tertiary">
                {active.format}
              </span>
            </div>

            <ProgressBar
              value={progress}
              label="Export progress"
              className="mt-3.5"
              indicatorClassName={phase === 'paused' ? 'bg-ink-tertiary' : undefined}
            />

            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] tabular-nums text-ink-tertiary">
              <span>
                {completed.toLocaleString()} of {total.toLocaleString()} sentences
              </span>
              <span>
                {formatClock(durationSeconds)} encoded · {formatBytes(bytes)}
              </span>
            </div>

            <p className="mt-3 border-t border-hairline pt-3 text-[11px] leading-relaxed text-ink-tertiary">
              {phase === 'paused'
                ? 'Paused between sentences. Encoder state stays in memory — a reload cannot resume this job.'
                : 'Already-cached narration is reused, so sentences you have listened to encode instantly. Closing this sheet keeps the export running.'}
            </p>
          </section>
        ) : null}

        {phase === 'done' && active ? (
          <section
            role="status"
            aria-live="polite"
            className="rounded-card border border-success/30 bg-success/10 p-4"
          >
            <div className="flex items-start gap-3">
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] font-semibold">Export ready</p>
                <p className="mt-0.5 truncate text-[11.5px] text-ink-secondary">
                  {active.suggestedName} · {formatClock(active.durationSeconds)} ·{' '}
                  {formatBytes(active.size)}
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {busy || phase === 'done' ? null : (
          <>
            <section>
              <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-tertiary">
                Format
              </h3>
              <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                {(['m4b', 'mp3'] as const).map((option) => {
                  const probe = probes[option];
                  const supported = probe?.supported !== false;
                  const copy = FORMAT_COPY[option];
                  const chosen = selected === option && supported;
                  return (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={chosen}
                      disabled={!supported}
                      onClick={() => setFormat(option)}
                      className={cn(
                        'rounded-card border p-3.5 text-left transition-colors duration-200',
                        chosen
                          ? 'border-brand/60 bg-brand-soft/60'
                          : 'border-hairline bg-surface-muted/40 hover:border-brand/30',
                        !supported && 'cursor-not-allowed opacity-50',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-semibold">{copy.title}</span>
                        <span
                          className={cn(
                            'grid size-4 place-items-center rounded-full border',
                            chosen ? 'border-brand bg-brand' : 'border-hairline',
                          )}
                          aria-hidden="true"
                        >
                          {chosen ? <span className="size-1.5 rounded-full bg-white" /> : null}
                        </span>
                      </div>
                      <p className="mt-1 text-[11.5px] text-ink-secondary">{copy.blurb}</p>
                      <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-tertiary">
                        {probe && !probe.supported
                          ? (probe.reason ?? 'Unavailable in this browser.')
                          : probe
                            ? copy.detail
                            : 'Checking this browser…'}
                      </p>
                    </button>
                  );
                })}
              </div>
            </section>

            <section>
              <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-tertiary">
                What to encode
              </h3>
              <div className="mt-2.5 flex rounded-pill border border-hairline bg-surface-muted/40 p-1">
                {(
                  [
                    ['chapter', 'One chapter'],
                    ['book', 'Whole book'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={scope === value}
                    onClick={() => setScope(value)}
                    className={cn(
                      'h-8 flex-1 rounded-pill text-[12px] font-medium transition-colors duration-200',
                      scope === value
                        ? 'bg-surface text-ink shadow-sm'
                        : 'text-ink-secondary hover:text-ink',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {scope === 'chapter' ? (
                <select
                  value={chapterIndex}
                  onChange={(event) => setChapterIndex(Number(event.target.value))}
                  aria-label="Chapter to export"
                  className="mt-2.5 h-10 w-full appearance-none rounded-input border border-hairline bg-surface px-3 text-[12.5px] text-ink outline-none focus:border-brand/50"
                >
                  {book?.chapters.map((chapter) => (
                    <option key={chapter.id} value={chapter.index}>
                      {chapter.index + 1}. {chapter.title}
                    </option>
                  ))}
                </select>
              ) : null}

              {plan ? (
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-ink-secondary">
                  <span>
                    {plan.totalSentences.toLocaleString()}{' '}
                    {plan.totalSentences === 1 ? 'sentence' : 'sentences'}
                  </span>
                  <span>≈ {formatDuration(plan.estimatedDuration)} at 1×</span>
                  {selected === 'm4b' ? (
                    <span>
                      {plannedChapters} {plannedChapters === 1 ? 'chapter mark' : 'chapter marks'}
                    </span>
                  ) : null}
                  <span>Narrated by {voiceLabel}</span>
                </div>
              ) : null}

              {plan && plan.totalSentences > 200 ? (
                <p className="mt-2.5 rounded-card border border-hairline bg-surface-muted/40 px-3 py-2 text-[11px] leading-relaxed text-ink-tertiary">
                  Large selections can take a long time on this device. Unlistened sentences are
                  synthesized first at roughly real-time speed on WASM, so keep the tab open and
                  plug in. Anything already cached encodes almost instantly.
                </p>
              ) : null}
            </section>
          </>
        )}

        {confirmCancel && running ? (
          <div className="rounded-card border border-danger/30 bg-danger/10 p-3.5">
            <p className="text-[12px] font-semibold">Discard this export?</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-secondary">
              The partial file is deleted. Audio already synthesized stays cached, so a new attempt
              skips that work.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(false)}>
                Keep going
              </Button>
              <Button
                size="sm"
                className="bg-danger shadow-none hover:brightness-110"
                onClick={() => {
                  setConfirmCancel(false);
                  void cancel();
                }}
              >
                Discard export
              </Button>
            </div>
          </div>
        ) : null}

        <section>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-tertiary">
              On this device
            </h3>
            <span className="text-[10.5px] text-ink-tertiary">
              {history.length} {history.length === 1 ? 'file' : 'files'}
            </span>
          </div>

          {history.length === 0 ? (
            <p className="mt-2.5 rounded-card border border-dashed border-hairline px-3.5 py-4 text-[11.5px] leading-relaxed text-ink-tertiary">
              No exports yet. Finished files appear here for downloading or deleting. They live in
              this browser&rsquo;s private storage, never on a server.
            </p>
          ) : (
            <ul className="mt-2.5 divide-y divide-hairline overflow-hidden rounded-card border border-hairline bg-surface-muted/30">
              {history.map((job) => (
                <ExportJobRow
                  key={job.id}
                  job={job}
                  onDownload={() => void download(job)}
                  onRemove={() => void remove(job)}
                />
              ))}
            </ul>
          )}
        </section>

        <p className="text-[10.5px] leading-relaxed text-ink-tertiary">
          Rendering and encoding use Mediabunny plus a WASM LAME encoder (MP3) or WebCodecs AAC
          (M4B). No audio ever leaves this device.
        </p>
      </div>
    </Sheet>
  );
}

type ExportJobRowProps = {
  job: ExportJobRecord;
  onDownload: () => void;
  onRemove: () => void;
};

function ExportJobRow({ job, onDownload, onRemove }: ExportJobRowProps) {
  const done = job.status === 'done';
  const meta = done
    ? `${formatClock(job.durationSeconds)} · ${formatBytes(job.size)} · ${formatRelativeTime(job.updatedAt)}`
    : job.error
      ? job.error
      : job.status === 'paused'
        ? 'Interrupted — not resumable'
        : 'Export failed';

  return (
    <li className="flex items-center gap-3 px-3.5 py-2.5">
      <span
        className={cn(
          'grid size-7 shrink-0 place-items-center rounded-full',
          done ? 'bg-brand-soft text-brand' : 'bg-surface text-ink-tertiary',
        )}
        aria-hidden="true"
      >
        <FileAudio size={13} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-medium">{job.suggestedName}</p>
        <p className="mt-0.5 truncate text-[10.5px] text-ink-tertiary">{meta}</p>
      </div>

      <span className="shrink-0 rounded-pill border border-hairline px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-ink-tertiary">
        {job.format}
      </span>

      {done ? (
        <button
          type="button"
          onClick={onDownload}
          aria-label={`Download ${job.suggestedName}`}
          className="grid size-7 shrink-0 place-items-center rounded-full text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink"
        >
          <Download size={13} />
        </button>
      ) : null}

      <button
        type="button"
        onClick={onRemove}
        aria-label={`Delete ${job.suggestedName}`}
        className="grid size-7 shrink-0 place-items-center rounded-full text-ink-tertiary transition-colors hover:bg-danger/10 hover:text-danger"
      >
        <Trash2 size={13} />
      </button>
    </li>
  );
}
