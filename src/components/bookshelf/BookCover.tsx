import { BookOpen } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useBookCover } from '@/hooks/useBookCover';
import type { BookDocument } from '@/types/domain';

type BookCoverProps = {
  book: BookDocument;
  className?: string;
};

/** Renders the stored cover, or a palette-generated book jacket as fallback. */
export function BookCover({ book, className }: BookCoverProps) {
  const coverUrl = useBookCover(book);
  const [first, second, third] = book.palette.colors;

  return (
    <div
      className={cn(
        'relative aspect-[2/3] w-full overflow-hidden rounded-[14px] border border-white/10 bg-canvas-deep shadow-[0_18px_40px_rgba(0,0,0,0.28)]',
        className,
      )}
      style={{ background: `linear-gradient(155deg, ${first} 0%, ${second} 58%, ${third} 100%)` }}
    >
      {coverUrl ? (
        <img
          src={coverUrl}
          alt={`${book.metadata.title} cover`}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <div className="absolute inset-0" aria-hidden="true">
          <div
            className="absolute -right-16 -top-20 size-52 rounded-full opacity-70 blur-2xl"
            style={{ background: third }}
          />
          <div
            className="absolute -bottom-16 -left-12 size-44 rounded-full opacity-60 blur-2xl"
            style={{ background: first }}
          />
          <div className="absolute inset-0 flex flex-col p-4">
            <span className="text-[8px] font-semibold uppercase tracking-[0.28em] text-white/55">
              {book.format.toUpperCase()}
            </span>
            <span className="mt-auto font-reader text-[clamp(0.9rem,3vw,1.3rem)] font-semibold leading-[1.05] text-white drop-shadow-sm">
              {book.metadata.title}
            </span>
            {book.metadata.author ? (
              <span className="mt-2 truncate text-[9px] font-medium uppercase tracking-[0.14em] text-white/65">
                {book.metadata.author}
              </span>
            ) : null}
          </div>
          <BookOpen
            size={18}
            className="absolute bottom-4 right-4 text-white/45"
            aria-hidden="true"
          />
        </div>
      )}

      <div className="absolute inset-y-0 left-0 w-[7px] bg-gradient-to-r from-black/35 to-transparent" />
      <div className="absolute inset-0 rounded-[inherit] ring-1 ring-inset ring-white/10" />
    </div>
  );
}
