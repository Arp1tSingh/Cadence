import { cn } from '@/lib/cn';

export type ProgressBarProps = {
  value: number;
  label: string;
  className?: string;
  indicatorClassName?: string;
};

/** A thin determinate progress bar. */
export function ProgressBar({ value, label, className, indicatorClassName }: ProgressBarProps) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      className={cn('h-1 overflow-hidden rounded-full bg-ink/10', className)}
    >
      <div
        className={cn('h-full rounded-full bg-brand transition-[width] duration-300', indicatorClassName)}
        style={{ width: `${clamped * 100}%` }}
      />
    </div>
  );
}
