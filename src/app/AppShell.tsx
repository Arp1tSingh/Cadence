import { AlertTriangle, Moon, Plus, ShieldCheck, Sun } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DropOverlay } from '@/components/bookshelf/WindowDropzone';
import { EmptyLibrary } from '@/components/bookshelf/EmptyLibrary';
import { ImportSheet } from '@/components/bookshelf/ImportSheet';
import { LibraryView } from '@/components/bookshelf/LibraryView';
import { MeshBackdrop } from '@/components/player/MeshBackdrop';
import { PlayerView } from '@/components/player/PlayerView';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { LogoMark } from '@/components/ui/LogoMark';
import { useStorageEstimate, formatBytes } from '@/hooks/useStorageEstimate';
import { useTheme } from '@/hooks/useTheme';
import { useWindowFileDrop } from '@/hooks/useWindowFileDrop';
import { cn } from '@/lib/cn';
import { useLibraryStore } from '@/store/libraryStore';
import { usePlayerStore } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';

function LibrarySkeleton() {
  return (
    <div className="w-full" aria-busy="true" aria-label="Loading your library">
      <div className="h-3 w-24 animate-pulse rounded-full bg-surface-muted" />
      <div className="mt-4 h-9 w-56 animate-pulse rounded-xl bg-surface-muted" />
      <div className="mt-9 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="animate-pulse">
            <div className="aspect-[2/3] rounded-[14px] bg-surface-muted" />
            <div className="mt-3 h-3 w-4/5 rounded-full bg-surface-muted" />
            <div className="mt-2 h-2.5 w-3/5 rounded-full bg-surface-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

function LibraryError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="glass mx-auto max-w-md rounded-sheet p-7 text-center">
      <div className="mx-auto grid size-11 place-items-center rounded-full bg-danger/10 text-danger">
        <AlertTriangle size={19} aria-hidden="true" />
      </div>
      <h1 className="mt-4 text-xl font-semibold tracking-[-0.03em]">Your library could not open</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-ink-secondary">{message}</p>
      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-tertiary">
        Cadence stores books in the Origin Private File System. Private browsing windows and
        storage-restricted profiles can block it.
      </p>
      <Button className="mt-5" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

export function AppShell() {
  const { resolved, toggle } = useTheme();
  const books = useLibraryStore((state) => state.books);
  const loaded = useLibraryStore((state) => state.loaded);
  const loadError = useLibraryStore((state) => state.loadError);
  const load = useLibraryStore((state) => state.load);
  const addFiles = useLibraryStore((state) => state.addFiles);
  const playerBookId = usePlayerStore((state) => state.bookId);
  const openBook = usePlayerStore((state) => state.openBook);
  const closePlayer = usePlayerStore((state) => state.closePlayer);

  const inputRef = useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const storage = useStorageEstimate(`${books.length}:${loaded}`);

  useEffect(() => {
    void load();
    void useSettingsStore.getState().load();
  }, [load]);

  // If the open book disappears from the library (for example while it is
  // being removed), leave the player instead of showing a stale snapshot.
  useEffect(() => {
    if (!loaded || !playerBookId) return;
    if (!books.some((book) => book.id === playerBookId)) {
      void closePlayer();
    }
  }, [books, closePlayer, loaded, playerBookId]);

  const handleFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      setImportOpen(true);
      void addFiles(files);
    },
    [addFiles],
  );

  const dragging = useWindowFileDrop(handleFiles);
  const pickFiles = useCallback(() => inputRef.current?.click(), []);

  const isEmpty = loaded && !loadError && books.length === 0;
  const playerBook = playerBookId
    ? (books.find((book) => book.id === playerBookId) ?? null)
    : null;

  if (playerBook) {
    return <PlayerView book={playerBook} />;
  }

  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-hidden">
      <MeshBackdrop />

      <header className="pt-safe relative z-10 px-5 sm:px-8">
        <div className="mx-auto flex h-[72px] w-full max-w-6xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <LogoMark className="size-8" />
            <div className="flex items-center gap-2">
              <span className="text-[17px] font-semibold tracking-[-0.035em]">Cadence</span>
              <span className="rounded-pill border border-hairline px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-ink-tertiary">
                Preview
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {storage.supported ? (
              <span className="hidden items-center gap-1.5 rounded-pill border border-hairline bg-surface px-3 py-1.5 text-[11px] font-medium text-ink-secondary backdrop-blur-xl lg:inline-flex">
                <ShieldCheck size={13} className="text-success" aria-hidden="true" />
                {formatBytes(storage.usage)} on-device
              </span>
            ) : null}

            <Button size="sm" onClick={pickFiles} className="shrink-0">
              <Plus size={15} aria-hidden="true" />
              <span className="hidden sm:inline">Import</span>
              <span className="sr-only sm:hidden">Import a book</span>
            </Button>

            <IconButton
              label={`Switch to ${resolved === 'dark' ? 'light' : 'dark'} appearance`}
              onClick={toggle}
              variant="secondary"
            >
              {resolved === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </IconButton>
          </div>
        </div>
      </header>

      <main
        className={cn(
          'relative z-10 mx-auto flex w-full max-w-6xl flex-1 px-5 sm:px-8',
          isEmpty || !loaded ? 'items-center py-10 lg:py-16' : 'items-start py-8 sm:py-10',
        )}
      >
        {!loaded ? (
          <LibrarySkeleton />
        ) : loadError ? (
          <LibraryError message={loadError} onRetry={() => void load()} />
        ) : books.length === 0 ? (
          <EmptyLibrary onImport={pickFiles} />
        ) : (
          <LibraryView onImport={pickFiles} onListen={(book) => void openBook(book)} />
        )}
      </main>

      <footer className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-1 px-5 pb-6 text-[11px] text-ink-tertiary sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p>Cadence 0.1 &middot; Preview build</p>
        <p>No accounts. No telemetry. No uploads.</p>
      </footer>

      <input
        ref={inputRef}
        type="file"
        accept=".epub,.pdf,application/epub+zip,application/pdf"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = '';
          handleFiles(files);
        }}
      />

      <ImportSheet open={importOpen} onClose={() => setImportOpen(false)} />
      <DropOverlay active={dragging} />
    </div>
  );
}
