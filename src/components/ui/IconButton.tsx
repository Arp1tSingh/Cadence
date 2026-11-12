import type { ReactNode } from 'react';
import { Button, type ButtonProps } from './Button';

export type IconButtonProps = Omit<ButtonProps, 'children' | 'aria-label' | 'size'> & {
  label: string;
  children: ReactNode;
};

/** An icon-only button with a required accessible label. */
export function IconButton({
  label,
  title,
  variant = 'ghost',
  children,
  ...props
}: IconButtonProps) {
  return (
    <Button variant={variant} size="icon" aria-label={label} title={title ?? label} {...props}>
      {children}
    </Button>
  );
}
