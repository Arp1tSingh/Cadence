import {
  FastForward,
  ListMusic,
  Loader2,
  Mic,
  Pause,
  Play,
  Rewind,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { BookDocument } from '@/types/domain';
import type { PlayerSnapshot } from '@/core/player/session';
import { useSettingsStore } from '@/store/settingsStore';
import { usePlayerFrame } from '@/store/playerStore';
import { voiceLabelFor } from '@/core/tts/voices';
import { formatPlaybackRate } from '@/core/audio/rate';
import { BookCover } from '@/components/bookshelf/BookCover';
import { IconButton } from '@/components/ui/IconButton';
import { cn } from '@/lib/cn';
import { formatClock } from '@/lib/time';

type PlayerDockProps = {
  book: BookDocument;
  snapshot: PlayerSnapshot;
  onToggle: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeekBy: (seconds: number) => void;
  onSeekTo: (seconds: number) => void;
  onOpenChapters: () => void;
  onOpenVoice: () => void;
  onOpenSpeed: () => void;
};

export function PlayerDock({
  book,
  snapshot,
  onToggle,
  onNext,
  onPrevious,
  onSeekBy,
  onSeekTo,
  onOpenChapters,
  onOpenVoice,
  onOpenSpeed,
}: PlayerDockProps) {
  const voice = useSettingsStore((state) => state.voice);
  const playbackRate = useSettingsStore((state) => state.playbackRate);
  const rangeRef = useRef<HTMLInputElement>(null);
  const elapsedRef = useRef<HTMLSpanElement>(null);
  const remainingRef = useRef<HTMLSpanElement>(null);
  const scrubbingRef = useRef(false);
  const pendingRef = useRef<number | null>(null);
  const lastLabelRef = useRef(0);

  const playing =
    snapshot.status === 'playing' || snapshot.status === 'buffering' ||
    snapshot.status === 'preparing';
  const busy = snapshot.status === 'buffering' || snapshot.status === 'preparing';
  const duration = Math.max(0, snapshot.durationSeconds);

  useEffect(() => {
    if (rangeRef.current) {
      rangeRef.current.max = String(duration || 0);
      rangeRef.current.value = String(snapshot.positionSeconds);
      rangeRef.current.style.setProperty(
        '--progress',
        duration > 0 ? `${(snapshot.positionSeconds / duration) * 100}%` : '0%',
      );
    }
    if (elapsedRef.current) elapsedRef.current.textContent = formatClock(snapshot.positionSeconds);
    if (remainingRef.current) {
      remainingRef.current.textContent = `-${formatClock(Math.max(0, duration - snapshot.positionSeconds))}`;
    }
    lastLabelRef.current = performance.now();
  }, [duration, snapshot.positionSeconds, snapshot.sentenceIndex, snapshot.status]);

  usePlayerFrame(
    useCallback(
      (frame) => {
        if (scrubbingRef.current) return;
        const range = rangeRef.current;
        if (!range) return;

        range.value = String(frame.positionSeconds);
        range.style.setProperty(
          '--progress',
          duration > 0 ? `${Math.min(100, (frame.positionSeconds / duration) * 100)}%` : '0%',
        );

        const now = performance.now();
        if (now - lastLabelRef.current > 250) {
          lastLabelRef.current = now;
          if (elapsedRef.current) {
            elapsedRef.current.textContent = formatClock(frame.positionSeconds);
          }
          if (remainingRef.current) {
            remainingRef.current.textContent = `-${formatClock(Math.max(0, duration - frame.positionSeconds))}`;
          }
        }
      },
      [duration],
    ),
  );

  const preview = (value: number) => {
    const range = rangeRef.current;
    if (range) {
      range.style.setProperty(
        '--progress',
        duration > 0 ? `${(value / duration) * 100}%` : '0%',
      );
    }
    if (elapsedRef.current) elapsedRef.current.textContent = formatClock(value);
    if (remainingRef.current) {
      remainingRef.current.textContent = `-${formatClock(Math.max(0, duration - value))}`;
    }
  };

  const commit = () => {
    scrubbingRef.current = false;
    const value = pendingRef.current;
    pendingRef.current = null;
    if (value !== null) onSeekTo(value);
  };

  const [slowBuffer, setSlowBuffer] = useState(false);
  const [firstBuffer, setFirstBuffer] = useState(false);

  useEffect(() => {
    if (snapshot.status !== 'buffering') {
      setSlowBuffer(false);
      return;
    }
    setFirstBuffer(snapshot.sentenceIndex === 0 && snapshot.positionSeconds === 0);
    const timer = window.setTimeout(() => setSlowBuffer(true), 6000);
    return () => window.clearTimeout(timer);
  }, [snapshot.status, snapshot.sentenceIndex, snapshot.positionSeconds]);

  const statusLine =
    snapshot.status === 'preparing'
      ? 'Preparing the narration engine…'
      : snapshot.status === 'buffering'
        ? slowBuffer
          ? 'Synthesizing on this device — slower than real time…'
          : firstBuffer
            ? 'Synthesizing the first sentence…'
            : 'Buffering the next sentence…'
        : snapshot.status === 'ended'
          ? 'Finished'
          : snapshot.status === 'error'
            ? 'Playback stopped'
            : `Narrated by ${voiceLabelFor(voice)}`;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-[max(env(safe-area-inset-bottom),14px)] sm:px-5">
      <div className="glass-dock pointer-events-auto w-full max-w-3xl rounded-[30px] px-3.5 pb-3 pt-2.5">
        <div className="flex items-center gap-2.5">
          <div className="w-9 shrink-0 sm:w-10">
            <BookCover book={book} className="rounded-[8px] shadow-none" />
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-semibold leading-tight tracking-[-0.01em]">
              {snapshot.chapterTitle || book.metadata.title}
            </p>
            <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-ink-tertiary">
              {busy ? <Loader2 size={10} className="animate-spin" aria-hidden="true" /> : null}
              <span className="truncate">{statusLine}</span>
            </p>
          </div>

          <div className="flex items-center gap-0.5">
            <IconButton
              label="Previous sentence"
              onClick={onPrevious}
              variant="ghost"
              className="hidden size-9 sm:inline-flex"
            >
              <SkipBack size={15} />
            </IconButton>

            <IconButton
              label="Back 15 seconds"
              onClick={() => onSeekBy(-15)}
              variant="ghost"
              className="size-9"
            >
              <Rewind size={16} />
            </IconButton>

            <button
              type="button"
              onClick={onToggle}
              aria-label={playing ? 'Pause narration' : 'Play narration'}
              className={cn(
                'mx-0.5 grid size-11 shrink-0 place-items-center rounded-full bg-brand text-white',
                'shadow-glow transition-[filter,transform] duration-200 hover:brightness-110 active:scale-95',
              )}
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={playing ? 'pause' : 'play'}
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.7 }}
                  transition={{ duration: 0.16 }}
                  className="grid place-items-center"
                >
                  {playing ? (
                    <Pause size={17} fill="currentColor" aria-hidden="true" />
                  ) : (
                    <Play size={17} fill="currentColor" className="translate-x-[1px]" aria-hidden="true" />
                  )}
                </motion.span>
              </AnimatePresence>
            </button>

            <IconButton
              label="Forward 15 seconds"
              onClick={() => onSeekBy(15)}
              variant="ghost"
              className="size-9"
            >
              <FastForward size={16} />
            </IconButton>

            <IconButton
              label="Next sentence"
              onClick={onNext}
              variant="ghost"
              className="hidden size-9 sm:inline-flex"
            >
              <SkipForward size={15} />
            </IconButton>
          </div>

          <div className="ml-0.5 flex items-center gap-0.5">
            <IconButton
              label="Choose narrator"
              onClick={onOpenVoice}
              variant="ghost"
              className="size-9"
            >
              <Mic size={16} />
            </IconButton>
            <IconButton
              label="Open chapters"
              onClick={onOpenChapters}
              variant="ghost"
              className="size-9"
            >
              <ListMusic size={16} />
            </IconButton>
          </div>
        </div>

        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenSpeed}
            aria-label={`Playback speed, ${formatPlaybackRate(playbackRate)}`}
            className="shrink-0 rounded-pill border border-hairline px-1.5 py-[2px] text-[9.5px] font-semibold tabular-nums text-ink-secondary transition-colors duration-150 hover:bg-surface-muted hover:text-ink"
          >
            {formatPlaybackRate(playbackRate)}
          </button>

          <span
            ref={elapsedRef}
            className="w-9 shrink-0 text-right text-[9.5px] tabular-nums text-ink-tertiary"
          >
            {formatClock(snapshot.positionSeconds)}
          </span>

          <input
            ref={rangeRef}
            type="range"
            min={0}
            max={duration || 0}
            step={0.5}
            defaultValue={0}
            aria-label="Narration position"
            className="scrubber"
            onPointerDown={() => {
              scrubbingRef.current = true;
            }}
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              pendingRef.current = value;
              preview(value);
            }}
            onPointerUp={commit}
            onPointerCancel={commit}
            onBlur={commit}
            onKeyUp={(event) => {
              if (event.key.startsWith('Arrow')) {
                pendingRef.current = Number(event.currentTarget.value);
                commit();
              }
            }}
          />

          <span
            ref={remainingRef}
            className="w-9 shrink-0 text-[9.5px] tabular-nums text-ink-tertiary"
          >
            -{formatClock(Math.max(0, duration - snapshot.positionSeconds))}
          </span>
        </div>
      </div>
    </div>
  );
}
