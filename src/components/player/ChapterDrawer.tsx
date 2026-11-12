import { Check } from 'lucide-react';
import type { BookDocument } from '@/types/domain';
import { formatDuration } from '@/core/parsing/text';
import { Sheet } from '@/components/ui/Sheet';
import { cn } from '@/lib/cn';

type ChapterDrawerProps = {
  open: boolean;
  onClose: () => void;
  book: BookDocument;
  currentChapter: number;
  onSelect: (chapterIndex: number) => void;
};

export function ChapterDrawer({
  open,
  onClose,
  book,
  currentChapter,
  onSelect,
}: ChapterDrawerProps) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Chapters"
      description={`${book.chapters.length} chapters · ${formatDuration(book.estimatedDuration)} of narration`}
      size="lg"
    >
      <ol className="no-scrollbar -mx-1 max-h-[58vh] space-y-1 overflow-y-auto px-1 pb-1">
        {book.chapters.map((chapter) => {
          const activeChapter = chapter.index === currentChapter;
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
                <span
                  className={cn(
                    'grid size-6 shrink-0 place-items-center rounded-full text-[10.5px] font-semibold tabular-nums',
                    activeChapter ? 'bg-brand text-white' : 'bg-surface-muted text-ink-tertiary',
                  )}
                >
                  {activeChapter ? <Check size={12} aria-hidden="true" /> : chapter.index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">{chapter.title}</span>
                  <span className="mt-0.5 block text-[10.5px] text-ink-tertiary">
                    {formatDuration(chapter.estimatedDuration)} ·{' '}
                    {chapter.wordCount.toLocaleString()} words
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </Sheet>
  );
}
