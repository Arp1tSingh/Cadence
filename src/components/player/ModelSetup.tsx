import { AnimatePresence, motion } from 'motion/react';
import { Cpu, Download, ShieldCheck, X } from 'lucide-react';
import type { ModelLoadProgress } from '@/types/tts';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { Button } from '@/components/ui/Button';

type ModelSetupProps = {
  progress: ModelLoadProgress | null;
  onCancel: () => void;
};

function megabytes(bytes?: number): string {
  if (!bytes) return '';
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function ModelSetup({ progress, onCancel }: ModelSetupProps) {
  const value = progress?.progress ?? 0;
  const percent = Math.round(value * 100);
  const downloaded =
    progress?.loadedBytes && progress?.totalBytes
      ? `${megabytes(progress.loadedBytes)} of ${megabytes(progress.totalBytes)}`
      : '';

  return (
    <AnimatePresence>
      <motion.div
        key="model-setup"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 px-5 backdrop-blur-xl"
      >
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="glass relative w-full max-w-sm rounded-sheet p-6 text-center"
        >
          <button
            type="button"
            onClick={onCancel}
            aria-label="Pause narration"
            className="absolute right-3 top-3 grid size-8 place-items-center rounded-full text-ink-tertiary transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <X size={15} aria-hidden="true" />
          </button>

          <div className="relative mx-auto grid size-24 place-items-center">
            <ProgressRing
              value={value}
              size={96}
              strokeWidth={4}
              label="Narration model download"
              className="absolute inset-0"
            />
            {progress?.stage === 'download' ? (
              <Download size={22} className="text-ink-secondary" aria-hidden="true" />
            ) : (
              <Cpu size={22} className="text-ink-secondary" aria-hidden="true" />
            )}
          </div>

          <p className="mt-4 text-[19px] font-semibold tracking-[-0.03em]">
            {percent > 0 ? `${percent}%` : 'Starting'}
          </p>
          <p className="mt-1.5 min-h-[34px] text-[12px] leading-relaxed text-ink-secondary">
            {progress?.message ?? 'Preparing the narration engine…'}
          </p>
          <p className="mt-1 text-[10.5px] leading-relaxed text-ink-tertiary">
            The first start compiles the model on this device and can take a minute.
          </p>
          {downloaded ? (
            <p className="mt-1 text-[10.5px] tabular-nums text-ink-tertiary">{downloaded}</p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
            {progress?.device ? (
              <span className="inline-flex items-center gap-1 rounded-pill border border-hairline px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-[0.1em] text-ink-tertiary">
                <Cpu size={10} aria-hidden="true" />
                {progress.device === 'webgpu' ? 'WebGPU' : 'WASM'}
              </span>
            ) : null}
            {progress?.dtype ? (
              <span className="rounded-pill border border-hairline px-2.5 py-1 text-[9.5px] font-semibold uppercase tracking-[0.1em] text-ink-tertiary">
                {progress.dtype === 'q8' ? 'Quantized' : 'Full precision'}
              </span>
            ) : null}
          </div>

          <p className="mt-5 rounded-card border border-hairline bg-surface-muted/50 px-3 py-2.5 text-[11px] leading-relaxed text-ink-secondary">
            <ShieldCheck size={13} className="mr-1 inline text-success" aria-hidden="true" />
            Downloaded once, then kept in this browser. Your book and narration never leave this
            device.
          </p>

          <Button variant="ghost" size="sm" className="mt-3" onClick={onCancel}>
            Pause narration
          </Button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
