import { AlignCenter, BookOpenText, ChevronLeft, Download, ListMusic, Mic2, Play } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BookDocument } from '@/types/domain';
import { usePlayerFrame, usePlayerStore } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useExportStore } from '@/store/exportStore';
import { MeshBackdrop } from './MeshBackdrop';
import { LyricsStage } from './LyricsStage';
import { BookPage } from './BookPage';
import { PlayerDock } from './PlayerDock';
import { ChapterDrawer } from './ChapterDrawer';
import { VoiceSheet } from './VoiceSheet';
import { SpeedSheet } from './SpeedSheet';
import { ModelSetup } from './ModelSetup';
import { PlayerError } from './PlayerError';
import { ExportStudio } from '@/components/modals/ExportStudio';
import { IconButton } from '@/components/ui/IconButton';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

type PlayerViewProps = {
  book: BookDocument;
};

export function PlayerView({ book }: PlayerViewProps) {
  const snapshot = usePlayerStore((state) => state.snapshot);
  const closePlayer = usePlayerStore((state) => state.closePlayer);
  const toggle = usePlayerStore((state) => state.toggle);
  const next = usePlayerStore((state) => state.next);
  const previous = usePlayerStore((state) => state.previous);
  const seekToSeconds = usePlayerStore((state) => state.seekToSeconds);
  const seekBy = usePlayerStore((state) => state.seekBy);
  const seekToChapter = usePlayerStore((state) => state.seekToChapter);
  const seekToSentence = usePlayerStore((state) => state.seekToSentence);
  const lyricsMode = useSettingsStore((state) => state.lyricsMode);
  const setLyricsMode = useSettingsStore((state) => state.setLyricsMode);
  const openExport = useExportStore((state) => state.openStudio);

  const [chaptersOpen, setChaptersOpen] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [speedOpen, setSpeedOpen] = useState(false);

  const progressRef = useRef<HTMLDivElement>(null);
  const lastProgressRef = useRef(0);

  const flat = useMemo(
    () =>
      book.chapters.flatMap((chapter) =>
        chapter.paragraphs.flatMap((paragraph) => paragraph.sentences),
      ),
    [book],
  );

  const currentIndex = snapshot.sentenceIndex;
  const previousText = flat[currentIndex - 1]?.displayText;
  const nextText = flat[currentIndex + 1]?.displayText;
  const duration = snapshot.durationSeconds;

  const sentenceIndexById = useMemo(() => {
    const map = new Map<string, number>();
    flat.forEach((sentence, index) => map.set(sentence.id, index));
    return map;
  }, [flat]);

  const seekToSentenceById = useCallback(
    (sentenceId: string) => {
      const index = sentenceIndexById.get(sentenceId);
      if (index !== undefined) seekToSentence(index);
    },
    [seekToSentence, sentenceIndexById],
  );

  usePlayerFrame(
    useCallback(
      (frame) => {
        if (!progressRef.current || duration <= 0) return;
        const ratio = Math.min(1, Math.max(0, frame.positionSeconds / duration));
        if (Math.abs(ratio - lastProgressRef.current) < 0.0004) return;
        lastProgressRef.current = ratio;
        progressRef.current.style.transform = `scaleX(${ratio})`;
      },
      [duration],
    ),
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;

      if (event.code === 'Space') {
        if (target?.closest('button, a')) return;
        event.preventDefault();
        void toggle();
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        seekBy(15);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        seekBy(-15);
      } else if (event.key === 'Escape' && !chaptersOpen && !voiceOpen && !speedOpen) {
        event.preventDefault();
        void closePlayer();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [chaptersOpen, closePlayer, seekBy, speedOpen, toggle, voiceOpen]);

  const close = useCallback(() => {
    void closePlayer();
  }, [closePlayer]);

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden">
      <MeshBackdrop colors={book.palette.colors} />

      <div className="fixed inset-x-0 top-0 z-40 h-[3px] bg-hairline/60">
        <div
          ref={progressRef}
          className="h-full origin-left bg-ink/70 transition-transform duration-200 ease-linear"
          style={{ transform: 'scaleX(0)' }}
        />
      </div>

      <header className="relative z-20 pt-safe px-3 sm:px-6">
        <div className="mx-auto flex h-[66px] w-full max-w-5xl items-center gap-2">
          <IconButton label="Back to library" onClick={close} variant="ghost">
            <ChevronLeft size={19} />
          </IconButton>

          <div className="min-w-0 flex-1 text-center">
            <p className="truncate text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-tertiary">
              {book.metadata.author ?? 'Cadence'} · Chapter {snapshot.chapterIndex + 1} of{' '}
              {book.chapters.length}
            </p>
            <p className="mt-0.5 truncate text-[12.5px] font-semibold tracking-[-0.02em]">
              {snapshot.chapterTitle || book.metadata.title}
            </p>
          </div>

          <div className="flex items-center gap-0.5">
            <IconButton
              label={lyricsMode === 'focus' ? 'Switch to Book Page' : 'Switch to focus lyrics'}
              onClick={() =>
                setLyricsMode(lyricsMode === 'focus' ? 'book' : 'focus')
              }
              variant="ghost"
            >
              {lyricsMode === 'focus' ? (
                <BookOpenText size={17} />
              ) : (
                <AlignCenter size={17} />
              )}
            </IconButton>
            <IconButton
              label="Choose narrator"
              onClick={() => setVoiceOpen(true)}
              variant="ghost"
            >
              <Mic2 size={17} />
            </IconButton>
            <IconButton
              label="Export audiobook"
              onClick={() => void openExport(book)}
              variant="ghost"
            >
              <Download size={17} />
            </IconButton>
            <IconButton
              label="Open chapters"
              onClick={() => setChaptersOpen(true)}
              variant="ghost"
            >
              <ListMusic size={17} />
            </IconButton>
          </div>
        </div>
      </header>

      <main
        className={cn(
          'relative z-10 mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col',
          lyricsMode === 'focus'
            ? 'px-4 pb-44 pt-2 sm:px-8 sm:pb-48'
            : 'px-2 pb-40 pt-0 sm:px-4 sm:pb-44',
        )}
      >
        {lyricsMode === 'focus' ? (
          <LyricsStage
            sentence={snapshot.sentence}
            previousText={previousText}
            nextText={nextText}
            active={snapshot.status === 'playing'}
          />
        ) : (
          <BookPage
            key={book.chapters[snapshot.chapterIndex]?.id ?? snapshot.chapterIndex}
            book={book}
            chapterIndex={snapshot.chapterIndex}
            onSeekSentence={seekToSentenceById}
          />
        )}
      </main>

      <PlayerDock
        book={book}
        snapshot={snapshot}
        onToggle={() => void toggle()}
        onNext={next}
        onPrevious={previous}
        onSeekBy={seekBy}
        onSeekTo={seekToSeconds}
        onOpenChapters={() => setChaptersOpen(true)}
        onOpenVoice={() => setVoiceOpen(true)}
        onOpenSpeed={() => setSpeedOpen(true)}
      />

      {snapshot.status === 'idle' && snapshot.sentence ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-36 z-20 flex justify-center sm:bottom-40">
          <Button
            size="lg"
            onClick={() => void toggle()}
            className="pointer-events-auto shadow-glow"
          >
            <Play size={17} fill="currentColor" aria-hidden="true" />
            Start listening
          </Button>
        </div>
      ) : null}

      <ChapterDrawer
        open={chaptersOpen}
        onClose={() => setChaptersOpen(false)}
        book={book}
        currentChapter={snapshot.chapterIndex}
        onSelect={seekToChapter}
      />

      <VoiceSheet open={voiceOpen} onClose={() => setVoiceOpen(false)} />

      <SpeedSheet
        open={speedOpen}
        onClose={() => setSpeedOpen(false)}
        durationSeconds={book.estimatedDuration}
      />

      {snapshot.status === 'preparing' ? (
        <ModelSetup
          progress={snapshot.modelProgress}
          onCancel={() => void usePlayerStore.getState().pause()}
        />
      ) : null}

      {snapshot.status === 'error' && snapshot.error ? (
        <PlayerError
          message={snapshot.error}
          onRetry={() => void usePlayerStore.getState().play()}
          onClose={close}
        />
      ) : null}

      <ExportStudio />
    </div>
  );
}
