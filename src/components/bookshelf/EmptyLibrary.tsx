import { AudioLines, Captions, Plus, ShieldCheck, Sparkles, type LucideIcon } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { BookShowcase } from '@/components/bookshelf/BookShowcase';
import { Button } from '@/components/ui/Button';

type EmptyLibraryProps = {
  onImport: () => void;
};

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

export function EmptyLibrary({ onImport }: EmptyLibraryProps) {
  const reduceMotion = useReducedMotion();

  return (
    <div className="grid w-full items-center gap-12 lg:grid-cols-[1.02fr_0.98fr] lg:gap-8">
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

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Button size="lg" onClick={onImport}>
            <Plus size={18} aria-hidden="true" />
            Add your first book
          </Button>
          <span className="text-[12px] text-ink-tertiary">or drop an EPUB / PDF anywhere</span>
        </div>

        <div className="glass mt-8 flex max-w-[34rem] items-start gap-3.5 rounded-card p-4">
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
            <Sparkles size={16} aria-hidden="true" />
          </div>
          <div>
            <p className="text-[13px] font-semibold">Ingestion is ready</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">
              Import a book and Cadence will detect chapters, split sentences, expand numbers and
              abbreviations for narration, and keep every word mapped for karaoke-style lyrics.
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
