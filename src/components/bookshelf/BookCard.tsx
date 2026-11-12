import { Clock3, FileText, Trash2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/core/parsing/text';
import { IconButton } from '@/components/ui/IconButton';
import type { BookDocument } from '@/types/domain';
import { BookCover } from './BookCover';

type BookCardProps = {
  book: BookDocument;
  onOpen: (book: BookDocument) => void;
  onRemove: (book: BookDocument) => void;
  className?: string;
};

export function BookCard({ book, onOpen, onRemove, className }: BookCardProps) {
  const chapterLabel = book.chapters.length === 1 ? '1 chapter' : `${book.chapters.length} chapters`;

  return (
    <article className={cn('group relative', className)}>
      <button
        type="button"
        onClick={() => onOpen(book)}
        className="block w-full text-left focus-visible:outline-none"
        aria-label={`Open ${book.metadata.title}`}
      >
        <div className="relative transition-transform duration-300 ease-out group-hover:-translate-y-1 group-focus-within:-translate-y-1">
          <BookCover book={book} />
          <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-pill bg-black/45 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-white backdrop-blur-md">
            <FileText size={10} aria-hidden="true" />
            {book.format}
          </span>
        </div>

        <div className="mt-3 px-0.5">
          <h3 className="line-clamp-2 text-[13.5px] font-semibold leading-snug tracking-[-0.015em]">
            {book.metadata.title}
          </h3>
          <p className="mt-1 truncate text-[12px] text-ink-secondary">
            {book.metadata.author ?? 'Unknown author'}
          </p>
          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-ink-tertiary">
            <span>{chapterLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <Clock3 size={10} aria-hidden="true" />
              {formatDuration(book.estimatedDuration)}
            </span>
          </p>
        </div>
      </button>

      <div className="absolute right-2 top-2 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover:opacity-100">
        <IconButton
          label={`Remove ${book.metadata.title}`}
          onClick={() => onRemove(book)}
          variant="secondary"
          className="size-8 bg-black/40 text-white backdrop-blur-md hover:bg-black/60"
        >
          <Trash2 size={13} />
        </IconButton>
      </div>
    </article>
  );
}
