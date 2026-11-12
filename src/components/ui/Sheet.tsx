import { X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { IconButton } from './IconButton';

export type SheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg';
  className?: string;
};

/** An accessible, backdrop-blurred sheet: centered on desktop, bottom-anchored on mobile. */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  className,
}: SheetProps) {
  const reduceMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    restoreFocus.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const frame = requestAnimationFrame(() => panelRef.current?.focus());

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreFocus.current?.focus?.();
    };
  }, [open]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, transition: { duration: 0.18 } }}
        >
          <button
            type="button"
            aria-label="Close dialog"
            tabIndex={-1}
            onClick={onClose}
            className="absolute inset-0 bg-black/45 backdrop-blur-md"
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            initial={reduceMotion ? false : { opacity: 0, y: 36, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.985 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              'glass relative flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-sheet outline-none',
              'pb-safe sm:rounded-sheet',
              size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg',
              className,
            )}
          >
            <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-ink/20 sm:hidden" />

            <header className="flex items-start justify-between gap-4 px-5 pb-3 pt-4 sm:px-7 sm:pt-6">
              <div className="min-w-0">
                <h2 className="text-[19px] font-semibold tracking-[-0.03em]">{title}</h2>
                {description ? (
                  <p className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">
                    {description}
                  </p>
                ) : null}
              </div>
              <IconButton label="Close" onClick={onClose} variant="ghost" className="-mr-1 -mt-1">
                <X size={16} />
              </IconButton>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-7">{children}</div>

            {footer ? (
              <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-hairline px-5 py-4 sm:px-7">
                {footer}
              </footer>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
