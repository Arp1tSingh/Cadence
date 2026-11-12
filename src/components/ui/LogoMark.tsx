import { cn } from '@/lib/cn';

type LogoMarkProps = {
  className?: string;
};

/** The Cadence waveform mark. Purely decorative; pair it with the wordmark. */
export function LogoMark({ className }: LogoMarkProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('shrink-0', className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="cadence-logo-gradient" x1="4" y1="2" x2="29" y2="31">
          <stop stopColor="#FF7A59" />
          <stop offset="0.52" stopColor="#FA2D48" />
          <stop offset="1" stopColor="#C4186A" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9.5" fill="url(#cadence-logo-gradient)" />
      <rect x="8" y="13" width="2.6" height="6" rx="1.3" fill="white" fillOpacity="0.9" />
      <rect x="12.4" y="10" width="2.6" height="12" rx="1.3" fill="white" />
      <rect x="16.8" y="7" width="2.6" height="18" rx="1.3" fill="white" />
      <rect x="21.2" y="11" width="2.6" height="10" rx="1.3" fill="white" fillOpacity="0.9" />
    </svg>
  );
}
