import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';
import type { SentenceNode } from '@/types/domain';
import { usePlayerFrame } from '@/store/playerStore';
import { cn } from '@/lib/cn';

type LyricsStageProps = {
  sentence: SentenceNode | null;
  previousText?: string;
  nextText?: string;
  active: boolean;
};

/**
 * Apple Music-style focus lyrics. Word fills are written straight to the DOM
 * from `requestAnimationFrame`; this component only re-renders when the
 * sentence (or its neighbours) changes.
 */
export function LyricsStage({ sentence, previousText, nextText, active }: LyricsStageProps) {
  const wordRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const lastWordRef = useRef(-1);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    lastWordRef.current = -1;
    wordRefs.current = [];
  }, [sentence?.id]);

  usePlayerFrame((frame) => {
    if (!sentence || frame.sentenceId !== sentence.id) return;
    const spans = wordRefs.current;
    if (spans.length === 0) return;

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
    }

    const activeSpan = spans[index];
    if (activeSpan) {
      activeSpan.style.setProperty('--fill', `${(frame.wordProgress * 100).toFixed(2)}%`);
    }
  });

  if (!sentence) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-ink-tertiary">
        This book has no narratable text.
      </div>
    );
  }

  return (
    <div className="flex w-full flex-1 flex-col items-center justify-center gap-8 py-10">
      {previousText ? (
        <p
          aria-hidden="true"
          className="line-clamp-2 max-w-2xl text-center font-rounded text-[clamp(1rem,2vw,1.35rem)] font-medium leading-[1.45] text-ink opacity-30 blur-[1.4px]"
        >
          {previousText}
        </p>
      ) : (
        <span className="h-6" aria-hidden="true" />
      )}

      <motion.div
        key={sentence.id}
        initial={reduceMotion ? false : { opacity: 0, y: 12, filter: 'blur(6px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-3xl px-2"
      >
        <p
          className={cn(
            'text-center font-rounded text-[clamp(1.45rem,3.5vw,2.55rem)] font-semibold leading-[1.32] tracking-[-0.03em] transition-opacity duration-300',
            active ? 'opacity-100' : 'opacity-70',
          )}
        >
          {sentence.words.map((word, index) => (
            <span key={word.id}>
              <span
                ref={(element) => {
                  wordRefs.current[index] = element;
                }}
                className="lyric-word"
                data-text={word.text}
              >
                {word.text}
                <span className="lyric-word-fill" aria-hidden="true">
                  {word.text}
                </span>
              </span>
              {index < sentence.words.length - 1 ? ' ' : null}
            </span>
          ))}
        </p>
      </motion.div>

      {nextText ? (
        <p
          aria-hidden="true"
          className="line-clamp-2 max-w-2xl text-center font-rounded text-[clamp(1rem,2vw,1.35rem)] font-medium leading-[1.45] text-ink opacity-45 blur-[1px]"
        >
          {nextText}
        </p>
      ) : (
        <span className="h-6" aria-hidden="true" />
      )}
    </div>
  );
}
