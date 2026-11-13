import { cn } from '@/lib/cn';

export type SwitchProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
};

/**
 * A small accessible switch. The label is for assistive technology only; rows
 * that need visible text render it beside the control.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled = false,
  className,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-10 shrink-0 items-center rounded-pill transition-colors duration-200',
        checked ? 'bg-brand' : 'bg-surface-muted',
        disabled && 'opacity-45',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'size-5 rounded-full bg-white shadow transition-transform duration-200',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}
