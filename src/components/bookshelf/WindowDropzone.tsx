import { UploadCloud } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

export function DropOverlay({ active }: { active: boolean }) {
  const reduceMotion = useReducedMotion();

  return (
    <AnimatePresence>
      {active ? (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center p-6"
          aria-live="polite"
        >
          <div className="absolute inset-3 rounded-[32px] border-2 border-dashed border-brand/70 bg-canvas/70 backdrop-blur-2xl" />
          <div className="relative flex flex-col items-center text-center">
            <div className="grid size-16 place-items-center rounded-full bg-brand text-white shadow-glow">
              <UploadCloud size={26} aria-hidden="true" />
            </div>
            <p className="mt-5 text-[22px] font-semibold tracking-[-0.03em]">Drop to import</p>
            <p className="mt-1.5 text-[13px] text-ink-secondary">
              EPUB and PDF books · parsed entirely on this device
            </p>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
