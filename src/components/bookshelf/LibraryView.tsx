import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { formatDuration } from '@/core/parsing/text';
import { formatBytes } from '@/hooks/useStorageEstimate';
import { useLibraryStore } from '@/store/libraryStore';
import type { BookDocument } from '@/types/domain';
import { BookCard } from './BookCard';
import { BookCover } from './BookCover';

type LibraryViewProps = {
  onImport: () => void;
};

export function LibraryView({ onImport }: LibraryViewProps) {
  const books = useLibraryStore((state) => state.books);
  const removeBook = useLibraryStore((state) => state.removeBook);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const selected = books.find((book) => book.id === selectedId) ?? null;
  const pendingRemoval = books.find((book) => book.id === removeId) ?? null;
  const totalDuration = books.reduce((total, book) => total + book.estimatedDuration, 0);

  const confirmRemoval = async () => {
    if (!pendingRemoval) return;
    setRemoving(true);
    try {
      await removeBook(pendingRemoval.id);
      setRemoveId(null);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <section className="w-full">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-ink-tertiary">
            On this device
          </p>
          <h1 className="mt-2 text-[clamp(2rem,4.4vw,2.9rem)] font-semibold leading-none tracking-[-0.045em]">
            Your library
          </h1>
          <p className="mt-2.5 text-[12.5px] text-ink-secondary">
            {books.length} {books.length === 1 ? 'book' : 'books'} ·{' '}
            {formatDuration(totalDuration)} of narration · nothing uploaded
          </p>
        </div>

        <Button onClick={onImport} size="md" className="shrink-0">
          <Plus size={16} aria-hidden="true" />
          Add book
        </Button>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-4 xl:grid-cols-5">
        {books.map((book) => (
          <BookCard
            key={book.id}
            book={book}
            onOpen={(next) => setSelectedId(next.id)}
            onRemove={(next) => setRemoveId(next.id)}
          />
        ))}

        <button
          type="button"
          onClick={onImport}
          className="group flex aspect-[2/3] w-full flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-hairline bg-surface-muted/40 text-ink-tertiary transition-colors duration-200 hover:border-brand/40 hover:bg-brand-soft/40 hover:text-ink"
        >
          <span className="grid size-10 place-items-center rounded-full border border-hairline bg-surface backdrop-blur-xl transition-transform duration-300 group-hover:scale-105">
            <Plus size={17} aria-hidden="true" />
          </span>
          <span className="text-[12px] font-medium">Add EPUB or PDF</span>
        </button>
      </div>

      <BookDetailSheet
        book={selected}
        open={Boolean(selected)}
        onClose={() => setSelectedId(null)}
        onRemove={(book) => {
          setSelectedId(null);
          setRemoveId(book.id);
        }}
      />

      <Sheet
        open={Boolean(pendingRemoval)}
        onClose={() => (removing ? undefined : setRemoveId(null))}
        title="Remove this book?"
        description="The book, its cover, and any cached narration are deleted from this device. Your original file is untouched."
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoveId(null)} disabled={removing}>
              Cancel
            </Button>
            <Button
              className="bg-danger shadow-none hover:brightness-110"
              onClick={() => void confirmRemoval()}
              disabled={removing}
            >
              {removing ? 'Removing…' : 'Remove book'}
            </Button>
          </>
        }
      >
        {pendingRemoval ? (
          <div className="flex items-center gap-4 rounded-card border border-hairline bg-surface-muted/60 p-3">
            <div className="w-16 shrink-0">
              <BookCover book={pendingRemoval} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-semibold">
                {pendingRemoval.metadata.title}
              </p>
              <p className="mt-1 truncate text-[12px] text-ink-secondary">
                {pendingRemoval.metadata.author ?? 'Unknown author'}
              </p>
              <p className="mt-1 text-[11px] text-ink-tertiary">
                {formatBytes(pendingRemoval.byteSize)} · {pendingRemoval.chapters.length} chapters
              </p>
            </div>
          </div>
        ) : null}
      </Sheet>
    </section>
  );
}

type BookDetailSheetProps = {
  book: BookDocument | null;
  open: boolean;
  onClose: () => void;
  onRemove: (book: BookDocument) => void;
};

function BookDetailSheet({ book, open, onClose, onRemove }: BookDetailSheetProps) {
  if (!book) return null;

  const facts = [
    { label: 'Format', value: book.format.toUpperCase() },
    { label: 'Chapters', value: String(book.chapters.length) },
    { label: 'Words', value: book.totalWords.toLocaleString() },
    { label: 'Narration', value: formatDuration(book.estimatedDuration) },
    { label: 'File size', value: formatBytes(book.byteSize) },
    {
      label: 'Imported',
      value: new Date(book.createdAt).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    },
  ];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={book.metadata.title}
      description={book.metadata.author ?? undefined}
      size="lg"
      footer={
        <>
          <Button
            variant="ghost"
            className="text-danger hover:bg-danger/10"
            onClick={() => onRemove(book)}
          >
            Remove
          </Button>
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <div className="mx-auto w-36 shrink-0 sm:mx-0 sm:w-40">
          <BookCover book={book} />
        </div>

        <div className="min-w-0 flex-1">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-tertiary">
                  {fact.label}
                </dt>
                <dd className="mt-0.5 text-[13px] font-medium">{fact.value}</dd>
              </div>
            ))}
          </dl>

          {book.metadata.description ? (
            <p className="mt-4 line-clamp-4 text-[12.5px] leading-relaxed text-ink-secondary">
              {book.metadata.description}
            </p>
          ) : null}

          <p className="mt-4 rounded-card border border-hairline bg-surface-muted/50 px-3 py-2 text-[11.5px] leading-relaxed text-ink-secondary">
            Chapters and sentences are parsed and timed. Narration and the Live Lyrics player
            arrive with the next milestone.
          </p>
        </div>
      </div>

      <div className="mt-6">
        <div className="flex items-center justify-between">
          <h3 className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-tertiary">
            Chapters
          </h3>
          <span className="text-[11px] text-ink-tertiary">{book.chapters.length} total</span>
        </div>

        <ol className="mt-3 divide-y divide-hairline overflow-hidden rounded-card border border-hairline bg-surface-muted/30">
          {book.chapters.map((chapter) => (
            <li key={chapter.id} className="flex items-center gap-3 px-3.5 py-2.5">
              <span className="w-6 shrink-0 text-right text-[11px] tabular-nums text-ink-tertiary">
                {chapter.index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">
                {chapter.title}
              </span>
              <span className="shrink-0 text-[11px] tabular-nums text-ink-tertiary">
                {formatDuration(chapter.estimatedDuration)}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </Sheet>
  );
}
