import { useEffect, useState, type CSSProperties } from 'react';
import { Check, Mic2, Shuffle } from 'lucide-react';
import type { VoiceSelection } from '@/types/tts';
import { VOICES, getVoice, normalizeVoiceSelection } from '@/core/tts/voices';
import { useSettingsStore } from '@/store/settingsStore';
import { usePlayerStore } from '@/store/playerStore';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { cn } from '@/lib/cn';

type VoiceSheetProps = {
  open: boolean;
  onClose: () => void;
};

export function VoiceSheet({ open, onClose }: VoiceSheetProps) {
  const current = useSettingsStore((state) => state.voice);
  const applyVoice = usePlayerStore((state) => state.applyVoice);

  const [primary, setPrimary] = useState(current.primary);
  const [blending, setBlending] = useState(Boolean(current.secondary));
  const [secondary, setSecondary] = useState(
    current.secondary ?? (current.primary === 'bm_george' ? 'bf_emma' : 'bm_george'),
  );
  const [blend, setBlend] = useState(Math.round((current.blend ?? 0.5) * 100));

  useEffect(() => {
    if (!open) return;
    setPrimary(current.primary);
    setBlending(Boolean(current.secondary));
    setSecondary(current.secondary ?? (current.primary === 'bm_george' ? 'bf_emma' : 'bm_george'));
    setBlend(Math.round((current.blend ?? 0.5) * 100));
  }, [current, open]);

  const choosePrimary = (id: string) => {
    setPrimary(id);
    if (secondary === id) {
      const fallback = VOICES.find((voice) => voice.id !== id);
      if (fallback) setSecondary(fallback.id);
    }
  };

  const apply = () => {
    const selection: VoiceSelection = blending
      ? { primary, secondary, blend: blend / 100 }
      : { primary };
    applyVoice(normalizeVoiceSelection(selection));
    onClose();
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Narrator voice"
      description="All voices are bundled with Cadence and run on this device."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={apply}>
            <Mic2 size={15} aria-hidden="true" />
            Use this voice
          </Button>
        </>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {VOICES.map((voice) => {
          const selected = voice.id === primary;
          return (
            <button
              key={voice.id}
              type="button"
              onClick={() => choosePrimary(voice.id)}
              className={cn(
                'relative rounded-card border p-3.5 text-left transition-colors duration-150',
                selected
                  ? 'border-brand/50 bg-brand-soft'
                  : 'border-hairline bg-surface-muted/40 hover:bg-surface-muted/80',
              )}
            >
              <span className="flex items-center gap-2">
                <span className="text-[13px] font-semibold">{voice.name}</span>
                <span className="rounded-pill border border-hairline px-1.5 py-0.5 text-[8.5px] font-semibold uppercase tracking-[0.1em] text-ink-tertiary">
                  {voice.accent} · {voice.gender}
                </span>
                {selected ? (
                  <span className="ml-auto grid size-5 place-items-center rounded-full bg-brand text-white">
                    <Check size={11} aria-hidden="true" />
                  </span>
                ) : null}
              </span>
              <span className="mt-1.5 block text-[11.5px] leading-relaxed text-ink-secondary">
                {voice.description}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-5 rounded-card border border-hairline bg-surface-muted/40 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Shuffle size={15} className="text-ink-tertiary" aria-hidden="true" />
            <div>
              <p className="text-[12.5px] font-semibold">Blend two voices</p>
              <p className="mt-0.5 text-[11px] text-ink-secondary">
                Interpolates the 256-dimension style vectors for a custom timbre.
              </p>
            </div>
          </div>
          <label className="relative inline-flex shrink-0 cursor-pointer items-center">
            <input
              type="checkbox"
              checked={blending}
              onChange={(event) => setBlending(event.target.checked)}
              className="peer sr-only"
            />
            <span className="h-6 w-10 rounded-pill bg-surface-muted transition-colors peer-checked:bg-brand" />
            <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
          </label>
        </div>

        {blending ? (
          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-tertiary">
                Second voice
              </span>
              <select
                value={secondary}
                onChange={(event) => setSecondary(event.target.value)}
                className="mt-1 w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-[12.5px] text-ink outline-none focus:border-brand/50"
              >
                {VOICES.filter((voice) => voice.id !== primary).map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name} · {voice.accent} {voice.gender}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-tertiary">
                <span>
                  {getVoice(primary).name} {100 - blend}%
                </span>
                <span>
                  {getVoice(secondary).name} {blend}%
                </span>
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={blend}
                onChange={(event) => setBlend(Number(event.target.value))}
                className="scrubber mt-1"
                style={{ '--progress': `${blend}%` } as CSSProperties}
                aria-label="Second voice blend"
              />
            </label>
          </div>
        ) : null}
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-ink-tertiary">
        Changing the narrator restarts the current sentence and caches new audio for this voice.
      </p>
    </Sheet>
  );
}
