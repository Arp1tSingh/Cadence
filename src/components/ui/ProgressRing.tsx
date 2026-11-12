import { cn } from '@/lib/cn';

export type ProgressRingProps = {
  value: number;
  size?: number;
  strokeWidth?: number;
  label: string;
  className?: string;
  trackClassName?: string;
  indicatorClassName?: string;
};

/** A compact circular progress indicator used for chapter synthesis status. */
export function ProgressRing({
  value,
  size = 22,
  strokeWidth = 2.5,
  label,
  className,
  trackClassName,
  indicatorClassName,
}: ProgressRingProps) {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const center = size / 2;
  const radius = Math.max(0, center - strokeWidth / 2);
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped * 100)}
      className={cn('shrink-0', className)}
    >
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        className={cn('stroke-surface-muted', trackClassName)}
      />
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform={`rotate(-90 ${center} ${center})`}
        className={cn(
          'stroke-brand transition-[stroke-dashoffset] duration-500 ease-out',
          indicatorClassName,
        )}
      />
    </svg>
  );
}
