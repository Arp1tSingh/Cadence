import { CheckCircle2, CircleAlert, Clock3, CopyCheck, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Sheet } from '@/components/ui/Sheet';
import { cn } from '@/lib/cn';
import { useLibraryStore, type ImportItem } from '@/store/libraryStore';

type ImportSheetProps = {
  open: boolean;
  onClose: () => void;
};

function StatusIcon({ status }: { status: ImportItem['status'] }) {
  switch (status) {
    case 'done':
      return <CheckCircle2 size={16} className="text-success" aria-hidden="true" />;
    case 'duplicate':
      return <CopyCheck size={16} className="text-amber" aria-hidden="true" />;
    case 'error':
      return <CircleAlert size={16} className="text-danger" aria-hidden="true" />;
    case 'parsing':
      return <Loader2 size={16} className="animate-spin text-brand" aria-hidden="true" />;
    default:
      return <Clock3 size={16} className="text-ink-tertiary" aria-hidden="true" />;
  }
}

export function ImportSheet({ open, onClose }: ImportSheetProps) {
  const items = useLibraryStore((state) => state.importing);
  const dismissImport = useLibraryStore((state) => state.dismissImport);
  const clearFinishedImports = useLibraryStore((state) => state.clearFinishedImports);
  const active = items.some((item) => item.status === 'queued' || item.status === 'parsing');
  const finished = items.some((item) => item.status !== 'queued' && item.status !== 'parsing');

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={active ? 'Importing books' : 'Import complete'}
      description={
        active
          ? 'Everything is parsed and stored on this device. You can keep browsing.'
          : 'Your books are ready on the shelf.'
      }
      footer={
        <>
          {finished ? (
            <Button variant="ghost" onClick={clearFinishedImports}>
              Clear finished
            </Button>
          ) : null}
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      {items.length === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-ink-secondary">
          No imports in this session.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const isActive = item.status === 'queued' || item.status === 'parsing';
            return (
              <li
                key={item.id}
                className={cn(
                  'rounded-card border border-hairline p-3 transition-colors',
                  item.status === 'error' ? 'bg-danger/5' : 'bg-surface-muted/40',
                )}
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0">
                    <StatusIcon status={item.status} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-semibold">{item.fileName}</p>
                    <p
                      className={cn(
                        'mt-0.5 text-[11.5px] leading-snug',
                        item.status === 'error' ? 'text-danger' : 'text-ink-secondary',
                      )}
                    >
                      {item.message}
                    </p>

                    {isActive ? (
                      <ProgressBar
                        value={item.progress}
                        label={`Importing ${item.fileName}`}
                        className="mt-2"
                      />
                    ) : null}
                  </div>

                  {isActive ? (
                    <span className="mt-0.5 shrink-0 text-[11px] tabular-nums text-ink-tertiary">
                      {Math.round(item.progress * 100)}%
                    </span>
                  ) : (
                    <IconButton
                      label={`Dismiss ${item.fileName}`}
                      onClick={() => dismissImport(item.id)}
                      className="-mr-1 -mt-1 size-8"
                    >
                      <X size={13} />
                    </IconButton>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
