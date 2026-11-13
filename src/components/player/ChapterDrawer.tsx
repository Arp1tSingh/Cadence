import { Check } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { BookDocument } from '@/types/domain';
import { formatDuration } from '@/core/parsing/text';
import {
  cacheRatio,
  readChapterCacheStats,
  type ChapterCacheStat,
} from '@/core/tts/cacheStats';
import { voiceLabelFor } from '@/core/tts/voices';
import { usePlayerStore } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { Sheet } from '@/components/ui/Sheet';
import { cn } from '@/lib/cn';

type ChapterDrawerProps = {
  open: boolean;
  onClose: () => void;
  book: BookDocument;
  currentChapter: number;
  onSelect: (chapterIndex: number) => void;
};

/**
 * Shows per-chapter synthesis progress for the active narrator: a grey ring
 * when nothing is cached, a partial arc while prefetch fills it in, and a check
 * once every sentence in the chapter is on disk.
 */
export function ChapterDrawer({
  open,
  onClose,
  book,
  currentChapter,
  onSelect,
}: ChapterDrawerProps) {
  const voice = useSettingsStore((state) => state.voice);
  const status = usePlayerStore((state) => state.snapshot.status);
  const [stats, setStats] = useState<Map<number, ChapterCacheStat>>(() => new Map());

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const refresh = () => {
      void readChapterCacheStats(book, voice).then((next) => {
        if (!cancelled) setStats(next);
      });
    };

    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [book, open, voice]);

  const completeChapters = useMemo(() => {
    let count = 0;
    for (const chapter of book.chapters) {
      const stat = stats.get(chapter.index);
      if (stat && stat.total > 0 && stat.cached >= stat.total) count += 1;
    }
    return count;
  }, [book.chapters, stats]);

  const activeCaching =
    status === 'playing' || status === 'buffering' || status === 'preparing';

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Chapters"
      description={`${book.chapters.length} chapters · ${formatDuration(book.estimatedDuration)} of narration · ${completeChapters} of ${book.chapters.length} fully cached for ${voiceLabelFor(voice)}`}
      size="lg"
    >
      <ol className="no-scrollbar -mx-1 max-h-[58vh] space-y-1 overflow-y-auto px-1 pb-1">
        {book.chapters.map((chapter) => {
          const activeChapter = chapter.index === currentChapter;
          const stat = stats.get(chapter.index);
          const ratio = cacheRatio(stat);
          const total = stat?.total ?? 0;
          const complete = total > 0 && ratio >= 1;
          const spinning = activeChapter && activeCaching && !complete;

          return (
            <li key={chapter.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(chapter.index);
                  onClose();
                }}
                className={cn(
                  'flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors duration-150',
                  activeChapter
                    ? 'bg-brand-soft text-ink'
                    : 'text-ink-secondary hover:bg-surface-muted hover:text-ink',
                )}
              >
                <span className="relative grid size-7 shrink-0 place-items-center">
                  {complete ? (
                    <span className="grid size-7 place-items-center rounded-full bg-brand text-white">
                      <Check size={13} aria-hidden="true" />
                    </span>
                  ) : (
                    <>
                      {spinning ? (
                        <span
                          aria-hidden="true"
                          className="absolute inset-0 animate-spin rounded-full border-2 border-brand/20 border-t-brand"
                        />
                      ) : (
                        <ProgressRing
                          value={ratio}
                          size={28}
                          strokeWidth={2.5}
                          label={
                            total > 0
                              ? `${stat?.cached ?? 0} of ${total} sentences cached`
                              : 'Not cached'
                          }
                          className="absolute inset-0"
                          trackClassName="stroke-hairline"
                          indicatorClassName="stroke-brand/70"
                        />
                      )}
                      <span
                        className={cn(
                          'relative text-[10px] font-semibold tabular-nums',
                          ratio > 0 ? 'text-ink' : 'text-ink-tertiary',
                        )}
                      >
                        {chapter.index + 1}
                      </span>
                    </>
                  )}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{chapter.title}</span>
                  <span className="mt-0.5 block text-[10.5px] text-ink-tertiary">
                    {formatDuration(chapter.estimatedDuration)} ·{' '}
                    {chapter.wordCount.toLocaleString()} words
                    {total > 0 ? (
                      <>
                        {' '}
                        · {spinning && !complete ? 'synthesizing' : `${Math.round(ratio * 100)}% cached`}
                      </>
                    ) : null}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      <p className="mt-3 px-1 text-[10.5px] leading-relaxed text-ink-tertiary">
        Rings reflect narration cached for {voiceLabelFor(voice)}. Switching narrator or
        pronunciation rules re-renders audio, so cached chapters may reset.
      </p>
    </Sheet>
  );
}
