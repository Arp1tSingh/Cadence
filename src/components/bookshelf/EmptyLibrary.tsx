import { AudioLines, Captions, ShieldCheck, Sparkles, type LucideIcon } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { BookShowcase } from '@/components/bookshelf/BookShowcase';

type FeatureProps = {
  icon: LucideIcon;
  label: string;
};

function Feature({ icon: Icon, label }: FeatureProps) {
  return (
    <div className="flex items-center gap-2 text-[12px] font-medium text-ink-secondary">
      <Icon size={14} className="text-brand" aria-hidden="true" />
      {label}
    </div>
  );
}

export function EmptyLibrary() {
  const reduceMotion = useReducedMotion();

  return (
    <div className="grid items-center gap-12 lg:grid-cols-[1.02fr_0.98fr] lg:gap-8">
      <motion.section
        initial={reduceMotion ? false : { opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="inline-flex items-center gap-2 rounded-pill border border-hairline bg-surface px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-secondary backdrop-blur-xl">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
            <span className="relative inline-flex size-1.5 rounded-full bg-brand" />
          </span>
          Private by design
        </div>

        <h1 className="mt-7 text-[clamp(2.9rem,7vw,5.2rem)] font-semibold leading-[0.94] tracking-[-0.055em] text-ink">
          Every book,
          <br />
          <span className="text-gradient">read aloud.</span>
        </h1>

        <p className="mt-6 max-w-[31rem] text-[16px] leading-[1.65] text-ink-secondary sm:text-[17px]">
          Cadence turns EPUB and PDF books into studio-quality audiobooks right here in your
          browser &mdash; with a neural voice, word-synced lyrics, and nothing leaving your device.
        </p>

        <div className="mt-7 flex flex-wrap gap-x-6 gap-y-3">
          <Feature icon={AudioLines} label="Neural narration" />
          <Feature icon={Captions} label="Word-synced lyrics" />
          <Feature icon={ShieldCheck} label="Nothing uploaded" />
        </div>

        <div className="glass mt-9 flex max-w-[34rem] items-start gap-3.5 rounded-card p-4">
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
            <Sparkles size={16} aria-hidden="true" />
          </div>
          <div>
            <p className="text-[13px] font-semibold">Foundation complete</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">
              The scaffold, design system, and theme engine are in place. Next: EPUB and PDF
              ingestion, chapter detection, and the library shelf.
            </p>
          </div>
        </div>
      </motion.section>

      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 22, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.85, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        className="lg:pl-4"
      >
        <BookShowcase />
      </motion.div>
    </div>
  );
}
