import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { BookIllustration } from '@/types/domain';
import { useIllustrationImage } from '@/hooks/useIllustrationImage';

type IllustrationStageProps = {
  illustration: BookIllustration | null;
};

/**
 * Pinned above the lyrics/reader so a full-page illustration stays visible
 * while the preceding text page is being narrated. The layout reserves space
 * instead of covering the prose, and the card animates between pages.
 */
export function IllustrationStage({ illustration }: IllustrationStageProps) {
  const source = useIllustrationImage(illustration);
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence initial={false}>
      {illustration && source ? (
        <motion.figure
          key={illustration.path}
          initial={reduceMotion ? false : { opacity: 0, y: 12, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: -8, scale: 0.99 }}
          transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto mb-2 mt-1 flex w-fit max-w-full shrink-0 items-center justify-center rounded-[20px] border border-hairline bg-surface/60 p-1 shadow-card backdrop-blur-xl sm:mb-3"
        >
          <img
            src={source}
            alt={`Illustration from page ${illustration.pageIndex + 1}`}
            draggable={false}
            className="block h-auto w-auto max-w-full rounded-[15px] object-contain"
            style={{ maxHeight: 'min(38vh, 460px)' }}
          />
        </motion.figure>
      ) : null}
    </AnimatePresence>
  );
}