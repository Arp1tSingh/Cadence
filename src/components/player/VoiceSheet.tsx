import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, Mic2, Shuffle } from 'lucide-react';
import type { VoiceSelection } from '@/types/tts';
import { DEFAULT_VOICE_ID, VOICES, getVoice, isKnownVoice, normalizeVoiceSelection } from '@/core/tts/voices';
import { useSettingsStore } from '@/store/settingsStore';
import { usePlayerStore } from '@/store/playerStore';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { VoiceBlendPad, type VoicePadWeights } from './VoiceBlendPad';
import { cn } from '@/lib/cn';

type VoiceSheetProps = {
  open: boolean;
  onClose: () => void;
};

function anotherVoice(excluded: string[], preferred?: string): string {
  if (preferred && isKnownVoice(preferred) && !excluded.includes(preferred)) return preferred;
  return VOICES.find((voice) => !excluded.includes(voice.id))?.id ?? DEFAULT_VOICE_ID;
}

export function VoiceSheet({ open, onClose }: VoiceSheetProps) {
  const current = useSettingsStore((state) => state.voice);
  const applyVoice = usePlayerStore((state) => state.applyVoice);

  const [primary, setPrimary] = useState(current.primary);
  const [blending, setBlending] = useState(Boolean(current.secondary));
  const [secondary, setSecondary] = useState(
    current.secondary ?? (current.primary === 'bm_george' ? 'bf_emma' : 'bm_george'),
  );
  const [third, setThird] = useState(Boolean(current.tertiary));
  const [tertiary, setTertiary] = useState(
    current.tertiary ?? anotherVoice([current.primary, secondary], 'af_bella'),
  );
  const [blend, setBlend] = useState(Math.round((current.blend ?? 0.5) * 100));
  const [tertiaryWeight, setTertiaryWeight] = useState(
    Math.round((current.tertiaryWeight ?? 1 / 3) * 100),
  );
  const padRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const safeSecondary =
      current.secondary ?? (current.primary === 'bm_george' ? 'bf_emma' : 'bm_george');
    setPrimary(current.primary);
    setBlending(Boolean(current.secondary));
    setSecondary(safeSecondary);
    setThird(Boolean(current.tertiary));
    setTertiary(
      current.tertiary ?? anotherVoice([current.primary, safeSecondary], 'af_bella'),
    );
    setBlend(Math.round((current.blend ?? 0.5) * 100));
    setTertiaryWeight(Math.round((current.tertiaryWeight ?? 1 / 3) * 100));
  }, [current, open]);

  const choosePrimary = (id: string) => {
    setPrimary(id);
    if (secondary === id) setSecondary(anotherVoice([id]));
    if (tertiary === id) setTertiary(anotherVoice([id, secondary === id ? '' : secondary]));
  };

  const chooseSecondary = (id: string) => {
    setSecondary(id);
    if (tertiary === id) setTertiary(anotherVoice([primary, id]));
  };

  const enableThird = (enabled: boolean) => {
    setThird(enabled);
    if (enabled && (tertiary === primary || tertiary === secondary)) {
      setTertiary(anotherVoice([primary, secondary]));
    }
  };

  // The pad lives below the voice grid; bring it into view when the third
  // voice is enabled so the mixer is not hidden behind the sheet footer.
  useEffect(() => {
    if (!open || !third) return;
    const frame = window.requestAnimationFrame(() => {
      padRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, third]);

  const padWeights: VoicePadWeights = (() => {
    const tertiaryShare = tertiaryWeight / 100;
    const pairShare = 1 - tertiaryShare;
    return [pairShare * (1 - blend / 100), pairShare * (blend / 100), tertiaryShare];
  })();

  const handlePad = (weights: VoicePadWeights) => {
    const [weightA, weightB, weightC] = weights;
    const pair = weightA + weightB;
    setBlend(pair > 0.0001 ? Math.round((weightB / pair) * 100) : 50);
    setTertiaryWeight(Math.min(95, Math.round(weightC * 100)));
  };

  const apply = () => {
    const selection: VoiceSelection = blending
      ? third
        ? {
            primary,
            secondary,
            blend: blend / 100,
            tertiary,
            tertiaryWeight: tertiaryWeight / 100,
          }
        : { primary, secondary, blend: blend / 100 }
      : { primary };
    applyVoice(normalizeVoiceSelection(selection));
    onClose();
  };

  const secondVoiceOptions = VOICES.filter((voice) => voice.id !== primary);
  const thirdVoiceOptions = VOICES.filter(
    (voice) => voice.id !== primary && voice.id !== secondary,
  );

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
              <p className="text-[12.5px] font-semibold">Blend voices</p>
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
              aria-label="Blend voices"
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
                onChange={(event) => chooseSecondary(event.target.value)}
                aria-label="Second voice"
                className="mt-1 w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-[12.5px] text-ink outline-none focus:border-brand/50"
              >
                {secondVoiceOptions.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.name} · {voice.accent} {voice.gender}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex items-center justify-between gap-3 rounded-xl border border-hairline bg-surface/60 px-3 py-2">
              <span className="text-[12px] font-medium">Add a third voice</span>
              <span className="relative inline-flex shrink-0 cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={third}
                  onChange={(event) => enableThird(event.target.checked)}
                  aria-label="Include a third voice"
                  className="peer sr-only"
                />
                <span className="h-5 w-9 rounded-pill bg-surface-muted transition-colors peer-checked:bg-brand" />
                <span className="absolute left-0.5 top-0.5 size-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
              </span>
            </label>

            {third ? (
              <>
                <label className="block">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-tertiary">
                    Third voice
                  </span>
                  <select
                    value={tertiary}
                    onChange={(event) => setTertiary(event.target.value)}
                    aria-label="Third voice"
                    className="mt-1 w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-[12.5px] text-ink outline-none focus:border-brand/50"
                  >
                    {thirdVoiceOptions.map((voice) => (
                      <option key={voice.id} value={voice.id}>
                        {voice.name} · {voice.accent} {voice.gender}
                      </option>
                    ))}
                  </select>
                </label>

                <div ref={padRef}>
                  <VoiceBlendPad
                    voices={[getVoice(primary), getVoice(secondary), getVoice(tertiary)]}
                    weights={padWeights}
                    onChange={handlePad}
                  />
                </div>

                <p className="text-center text-[10.5px] leading-relaxed text-ink-tertiary">
                  Drag inside the triangle to mix all three style vectors. The puck always
                  represents a 100% blend.
                </p>
              </>
            ) : (
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
            )}
          </div>
        ) : null}
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-ink-tertiary">
        Changing the narrator restarts the current sentence and caches new audio for this voice.
      </p>
    </Sheet>
  );
}
