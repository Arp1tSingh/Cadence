import { Gauge, RotateCcw } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import {
  MAX_PLAYBACK_RATE,
  MIN_PLAYBACK_RATE,
  PLAYBACK_RATE_PRESETS,
  clampPlaybackRate,
  formatPlaybackRate,
} from '@/core/audio/rate';
import { formatDuration } from '@/core/parsing/text';
import { usePlayerStore } from '@/store/playerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { cn } from '@/lib/cn';

type SpeedSheetProps = {
  open: boolean;
  onClose: () => void;
  /** Narration length at 1×, used to preview the new finish time. */
  durationSeconds: number;
};

/**
 * Speed is applied by stretching cached PCM, so changing it never
 * re-synthesizes audio and the narrator's pitch stays intact.
 */
export function SpeedSheet({ open, onClose, durationSeconds }: SpeedSheetProps) {
  const rate = useSettingsStore((state) => state.playbackRate);
  const applyRate = usePlayerStore((state) => state.setPlaybackRate);
  const [value, setValue] = useState(rate);

  useEffect(() => {
    if (open) setValue(rate);
  }, [open, rate]);

  const commit = (next: number) => {
    const clamped = clampPlaybackRate(next);
    setValue(clamped);
    applyRate(clamped);
  };

  const close = () => {
    if (Math.abs(value - rate) >= 0.001) applyRate(value);
    onClose();
  };

  const progress = ((value - MIN_PLAYBACK_RATE) / (MAX_PLAYBACK_RATE - MIN_PLAYBACK_RATE)) * 100;

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Playback speed"
      description="Time-stretched on this device with WSOLA, so the narrator keeps their natural pitch."
      className="bg-surface-strong"
      footer={
        <>
          <Button
            variant="ghost"
            onClick={() => commit(1)}
            disabled={Math.abs(value - 1) < 0.001}
          >
            <RotateCcw size={14} aria-hidden="true" />
            Normal
          </Button>
          <Button onClick={close}>{formatPlaybackRate(value)} · Done</Button>
        </>
      }
    >
      <div className="rounded-card border border-hairline bg-surface-muted/40 p-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-tertiary">
              Current speed
            </p>
            <p className="mt-1 font-rounded text-[40px] font-semibold leading-none tracking-[-0.04em] tabular-nums">
              {formatPlaybackRate(value)}
            </p>
          </div>
          <div className="text-right text-[11px] leading-relaxed text-ink-secondary">
            {durationSeconds > 0 ? (
              Math.abs(value - 1) < 0.001 ? (
                <>
                  <p>{formatDuration(durationSeconds)} total</p>
                  <p className="text-ink">Pitch preserved</p>
                </>
              ) : (
                <>
                  <p>{formatDuration(durationSeconds)} at 1×</p>
                  <p className="text-ink">
                    {formatDuration(durationSeconds / value)} at {formatPlaybackRate(value)}
                  </p>
                </>
              )
            ) : (
              <p className="flex items-center gap-1.5">
                <Gauge size={13} aria-hidden="true" />
                No re-synthesis
              </p>
            )}
          </div>
        </div>

        <input
          type="range"
          min={MIN_PLAYBACK_RATE}
          max={MAX_PLAYBACK_RATE}
          step={0.05}
          value={value}
          onChange={(event) => setValue(Number(event.currentTarget.value))}
          onPointerUp={() => commit(value)}
          onPointerCancel={() => commit(value)}
          onKeyUp={(event) => {
            if (event.key.startsWith('Arrow') || event.key === 'Home' || event.key === 'End') {
              commit(value);
            }
          }}
          onBlur={() => commit(value)}
          aria-label="Playback speed"
          aria-valuetext={formatPlaybackRate(value)}
          className="scrubber mt-5"
          style={{ '--progress': `${progress}%` } as CSSProperties}
        />
        <div className="mt-1.5 flex justify-between text-[9.5px] tabular-nums text-ink-tertiary">
          <span>{MIN_PLAYBACK_RATE}×</span>
          <span>1×</span>
          <span>{MAX_PLAYBACK_RATE}×</span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {PLAYBACK_RATE_PRESETS.map((preset) => {
          const selected = Math.abs(value - preset) < 0.001;
          return (
            <button
              key={preset}
              type="button"
              onClick={() => commit(preset)}
              className={cn(
                'rounded-2xl border px-2 py-2.5 text-[12px] font-semibold tabular-nums transition-colors duration-150',
                selected
                  ? 'border-brand/50 bg-brand-soft text-ink'
                  : 'border-hairline bg-surface-muted/30 text-ink-secondary hover:bg-surface-muted',
              )}
            >
              {formatPlaybackRate(preset)}
            </button>
          );
        })}
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-ink-tertiary">
        Changing speed restarts the current sentence from its beginning. Cached narration is
        reused, so the switch is instant once a sentence has been synthesized.
      </p>
    </Sheet>
  );
}
