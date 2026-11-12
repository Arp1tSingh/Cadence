import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/Button';

type PlayerErrorProps = {
  message: string;
  onRetry: () => void;
  onClose: () => void;
};

export function PlayerError({ message, onRetry, onClose }: PlayerErrorProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 px-5 backdrop-blur-xl">
      <div className="glass w-full max-w-sm rounded-sheet p-6 text-center">
        <div className="mx-auto grid size-11 place-items-center rounded-full bg-danger/10 text-danger">
          <AlertTriangle size={19} aria-hidden="true" />
        </div>
        <h2 className="mt-4 text-[18px] font-semibold tracking-[-0.03em]">
          Narration could not continue
        </h2>
        <p className="mt-2 text-[12px] leading-relaxed text-ink-secondary">{message}</p>
        <div className="mt-5 flex justify-center gap-2">
          <Button variant="ghost" onClick={onClose}>
            Back to library
          </Button>
          <Button onClick={onRetry}>Try again</Button>
        </div>
      </div>
    </div>
  );
}
