import { ArrowDown, BookOpenText } from 'lucide-react';
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useReducedMotion } from 'motion/react';
import type { BookDocument, SentenceNode } from '@/types/domain';
import { playerSession, usePlayerFrame } from '@/store/playerStore';
import { cn } from '@/lib/cn';

type BookPageProps = {
  book: BookDocument;
  chapterIndex: number;
  onSeekSentence: (sentenceId: string) => void;
};

/**
 * Structured reader mode: every paragraph in the chapter stays on screen while
 * the active sentence and its word sweep are updated imperatively. The
 * component is memoised on `book`/`chapterIndex`, so playback advances without
 * re-rendering thousands of word spans.
 */
export const BookPage = memo(function BookPage({
  book,
  chapterIndex,
  onSeekSentence,
}: BookPageProps) {
  const chapter = book.chapters.find((entry) => entry.index === chapterIndex) ?? book.chapters[0];
  const reduceMotion = useReducedMotion();

  const scrollRef = useRef<HTMLDivElement>(null);
  const sentenceRefs = useRef(new Map<string, HTMLSpanElement>());
  const wordRefs = useRef(new Map<string, Array<HTMLSpanElement | null>>());
  const filledRef = useRef(new Set<string>());
  const lastWordRef = useRef(-1);
  const [autoScroll, setAutoScroll] = useState(true);
  const autoScrollRef = useRef(true);
  autoScrollRef.current = autoScroll;

  const order = useMemo(() => {
    const map = new Map<string, number>();
    if (!chapter) return map;
    let index = 0;
    for (const paragraph of chapter.paragraphs) {
      for (const sentence of paragraph.sentences) {
        map.set(sentence.id, index);
        index += 1;
      }
    }
    return map;
  }, [chapter]);

  const initialSentence = playerSession.getSnapshot().sentence;
  const initialActiveId =
    initialSentence && order.has(initialSentence.id) ? initialSentence.id : null;
  const activeIdRef = useRef<string | null>(initialActiveId);

  const setSentenceState = (sentenceId: string) => {
    const element = sentenceRefs.current.get(sentenceId);
    if (!element) return;
    const activeOrder = activeIdRef.current ? (order.get(activeIdRef.current) ?? -1) : -1;
    const sentenceOrder = order.get(sentenceId) ?? 0;
    const distance = sentenceOrder - activeOrder;
    element.dataset.state =
      distance === 0
        ? 'active'
        : distance === -1
          ? 'past'
          : distance < 0
            ? 'far-past'
            : distance === 1
              ? 'next'
              : 'later';
  };

  const refreshStates = () => {
    for (const sentenceId of sentenceRefs.current.keys()) setSentenceState(sentenceId);
  };

  const settleSentence = (sentenceId: string) => {
    const spans = wordRefs.current.get(sentenceId);
    if (!spans) return;
    for (const span of spans) {
      span?.style.setProperty('--fill', '100%');
      span?.removeAttribute('data-active');
    }
    filledRef.current.add(sentenceId);
  };

  const hasScrolledRef = useRef(false);

  const scrollToSentence = (sentenceId: string) => {
    const container = scrollRef.current;
    const element = sentenceRefs.current.get(sentenceId);
    if (!container || !element) return;

    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const top =
      container.scrollTop + elementRect.top - containerRect.top - container.clientHeight * 0.36;
    const instant = reduceMotion || !hasScrolledRef.current;
    hasScrolledRef.current = true;
    container.scrollTo({ top: Math.max(0, top), behavior: instant ? 'auto' : 'smooth' });
  };

  const activate = (sentenceId: string) => {
    const previousId = activeIdRef.current;
    if (previousId === sentenceId) return;

    const previousOrder = previousId ? (order.get(previousId) ?? -1) : -1;
    const nextOrder = order.get(sentenceId) ?? -1;

    if (previousId) settleSentence(previousId);

    // A backward jump invalidates fills that belonged to the old playhead.
    if (nextOrder < previousOrder) {
      for (const filledId of filledRef.current) {
        if ((order.get(filledId) ?? -1) <= nextOrder) continue;
        const spans = wordRefs.current.get(filledId);
        if (spans) {
          for (const span of spans) {
            span?.style.setProperty('--fill', '0%');
            span?.removeAttribute('data-active');
          }
        }
      }
    }

    activeIdRef.current = sentenceId;
    lastWordRef.current = -1;
    refreshStates();
    if (autoScrollRef.current) scrollToSentence(sentenceId);
  };

  usePlayerFrame((frame) => {
    if (!order.has(frame.sentenceId)) return;
    if (frame.sentenceId !== activeIdRef.current) activate(frame.sentenceId);

    const spans = wordRefs.current.get(frame.sentenceId);
    if (!spans || spans.length === 0) return;

    const index = Math.max(0, Math.min(spans.length - 1, frame.wordIndex));
    if (index !== lastWordRef.current) {
      for (let cursor = 0; cursor < index; cursor += 1) {
        spans[cursor]?.style.setProperty('--fill', '100%');
        spans[cursor]?.removeAttribute('data-active');
      }
      for (let cursor = index; cursor < spans.length; cursor += 1) {
        spans[cursor]?.style.setProperty('--fill', '0%');
      }
      spans[index]?.setAttribute('data-active', 'true');
      lastWordRef.current = index;
      filledRef.current.add(frame.sentenceId);
    }

    const activeSpan = spans[index];
    if (activeSpan) {
      activeSpan.style.setProperty('--fill', `${(frame.wordProgress * 100).toFixed(2)}%`);
    }
  });

  // Scroll to the restored sentence when the reader opens or the chapter changes.
  useEffect(() => {
    const id = activeIdRef.current;
    if (!id) return;

    const activeOrder = order.get(id) ?? -1;
    for (const [sentenceId, element] of sentenceRefs.current) {
      const sentenceOrder = order.get(sentenceId) ?? 0;
      const distance = sentenceOrder - activeOrder;
      element.dataset.state =
        distance === 0
          ? 'active'
          : distance === -1
            ? 'past'
            : distance < 0
              ? 'far-past'
              : distance === 1
                ? 'next'
                : 'later';
    }

    const container = scrollRef.current;
    const element = sentenceRefs.current.get(id);
    if (!container || !element) return;
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const top =
      container.scrollTop + elementRect.top - containerRect.top - container.clientHeight * 0.36;
    container.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
    hasScrolledRef.current = true;
  }, [order]);

  if (!chapter) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-ink-tertiary">
        This book has no readable chapters.
      </div>
    );
  }

  const activeOrder = activeIdRef.current ? (order.get(activeIdRef.current) ?? -1) : -1;

  const stateFor = (sentenceOrder: number): string => {
    const distance = sentenceOrder - activeOrder;
    if (distance === 0) return 'active';
    if (distance === -1) return 'past';
    if (distance < 0) return 'far-past';
    if (distance === 1) return 'next';
    return 'later';
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        tabIndex={0}
        aria-label={`${chapter.title} text`}
        onWheel={() => setAutoScroll(false)}
        onTouchMove={() => setAutoScroll(false)}
        className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 outline-none"
      >
        <article className="mx-auto w-full max-w-3xl pb-6 pt-4">
          <header className="mb-7 border-b border-hairline/70 pb-5">
            <p className="flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-ink-tertiary">
              <BookOpenText size={12} aria-hidden="true" />
              Chapter {chapter.index + 1}
            </p>
            <h1 className="mt-2 font-reader text-[clamp(1.6rem,3.4vw,2.3rem)] font-semibold leading-[1.15] tracking-[-0.02em]">
              {chapter.title}
            </h1>
          </header>

          <div className="space-y-5 font-reader">
            {chapter.paragraphs.map((paragraph) => {
              const heading = paragraph.kind === 'heading';
              const quote = paragraph.kind === 'quote';
              const small = paragraph.kind === 'caption' || paragraph.kind === 'pre';

              return (
                <p
                  key={paragraph.id}
                  className={cn(
                    'text-[clamp(1.06rem,1.9vw,1.3rem)] leading-[1.75] tracking-[-0.005em]',
                    heading && 'font-semibold text-ink',
                    quote && 'border-l-2 border-brand/40 pl-4 italic text-ink-secondary',
                    (paragraph.level ?? 0) >= 2 && 'text-[clamp(1.15rem,2.4vw,1.55rem)]',
                    small && 'font-ui text-[0.82em] text-ink-secondary',
                  )}
                >
                  {paragraph.sentences.map((sentence, index) => (
                    <SentenceSpan
                      key={sentence.id}
                      sentence={sentence}
                      state={stateFor(order.get(sentence.id) ?? 0)}
                      onSeek={(sentenceId) => {
                        // Give immediate feedback while the seek re-buffers.
                        activate(sentenceId);
                        onSeekSentence(sentenceId);
                      }}
                      registerSentence={(element) => {
                        if (element) sentenceRefs.current.set(sentence.id, element);
                        else sentenceRefs.current.delete(sentence.id);
                      }}
                      registerWord={(wordIndex, element) => {
                        let spans = wordRefs.current.get(sentence.id);
                        if (!spans) {
                          spans = [];
                          wordRefs.current.set(sentence.id, spans);
                        }
                        spans[wordIndex] = element;
                      }}
                      trailingSpace={index < paragraph.sentences.length - 1}
                    />
                  ))}
                </p>
              );
            })}
          </div>
        </article>
      </div>

      {!autoScroll ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 flex justify-center">
          <button
            type="button"
            onClick={() => {
              setAutoScroll(true);
              autoScrollRef.current = true;
              const id = activeIdRef.current;
              if (id) scrollToSentence(id);
            }}
            className="glass pointer-events-auto inline-flex items-center gap-1.5 rounded-pill px-3.5 py-2 text-[11px] font-medium text-ink shadow-card transition-transform active:scale-95"
          >
            <ArrowDown size={13} aria-hidden="true" />
            Resume auto-scroll
          </button>
        </div>
      ) : null}
    </div>
  );
});

type SentenceSpanProps = {
  sentence: SentenceNode;
  state: string;
  onSeek: (sentenceId: string) => void;
  registerSentence: (element: HTMLSpanElement | null) => void;
  registerWord: (index: number, element: HTMLSpanElement | null) => void;
  trailingSpace: boolean;
};

const SentenceSpan = memo(function SentenceSpan({
  sentence,
  state,
  onSeek,
  registerSentence,
  registerWord,
  trailingSpace,
}: SentenceSpanProps) {
  const past = state === 'past' || state === 'far-past';

  return (
    <>
      <span
        ref={registerSentence}
        data-sentence-id={sentence.id}
        data-state={state}
        onClick={() => onSeek(sentence.id)}
        className="book-sentence cursor-pointer rounded-[4px] outline-offset-2 hover:bg-surface-muted/40 focus-visible:bg-surface-muted/50"
      >
        {sentence.words.map((word, index) => (
          <span key={word.id}>
            <span
              ref={(element) => registerWord(index, element)}
              className="lyric-word book-word"
              data-text={word.text}
              style={past ? ({ '--fill': '100%' } as CSSProperties) : undefined}
            >
              {word.text}
              <span className="lyric-word-fill" aria-hidden="true">
                {word.text}
              </span>
            </span>
            {index < sentence.words.length - 1 ? ' ' : null}
          </span>
        ))}
      </span>
      {trailingSpace ? ' ' : null}
    </>
  );
});
