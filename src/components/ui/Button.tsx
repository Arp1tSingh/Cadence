import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const baseClasses =
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap font-medium tracking-[-0.01em] transition-[background-color,box-shadow,color,opacity,transform,filter] duration-200 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45';

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white shadow-glow hover:brightness-105',
  secondary: 'glass text-ink hover:bg-surface-strong',
  ghost: 'text-ink-secondary hover:bg-surface-muted hover:text-ink',
  outline: 'border border-hairline text-ink hover:bg-surface-muted',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-9 rounded-pill px-4 text-[13px]',
  md: 'h-11 rounded-pill px-5 text-sm',
  lg: 'h-[54px] rounded-pill px-6 text-[15px]',
  icon: 'size-10 rounded-pill p-0',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(baseClasses, variantClasses[variant], sizeClasses[size], className)}
      {...props}
    />
  );
});
