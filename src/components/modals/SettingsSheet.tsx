import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  Check,
  Database,
  Plus,
  Sparkles,
  Trash2,
  Volume2,
} from 'lucide-react';
import type { NormalizationRules } from '@/types/speech';
import { MAX_LEXICON_WORDS } from '@/types/speech';
import {
  MAX_PLAYBACK_RATE,
  MIN_PLAYBACK_RATE,
  clampPlaybackRate,
} from '@/core/audio/rate';
import {
  CACHE_CAP_OPTIONS,
  DEFAULT_CACHE_CAP_BYTES,
} from '@/core/tts/cachePolicy';
import {
  applyAudioCacheCap,
  clearRenderedAudio,
  readAudioCacheUsage,
  type AudioCacheUsage,
} from '@/core/tts/cacheManager';
import { VOICES, voiceLabelFor } from '@/core/tts/voices';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/cn';
import { usePlayerStore } from '@/store/playerStore';
import {
  useSettingsStore,
  type SettingsTab,
} from '@/store/settingsStore';
import { Button } from '@/components/ui/Button';
import { IconButton } from '@/components/ui/IconButton';
import { Sheet } from '@/components/ui/Sheet';
import { Switch } from '@/components/ui/Switch';
import { useStorageEstimate } from '@/hooks/useStorageEstimate';

const TABS: ReadonlyArray<{ id: SettingsTab; label: string }> = [
  { id: 'narration', label: 'Narration' },
  { id: 'pronunciation', label: 'Pronunciation' },
  { id: 'storage', label: 'Storage' },
];

const TIER_COPY = {
  balanced: {
    title: 'Balanced',
    meta: 'WASM q8 · 92 MB',
    description: 'Runs everywhere. Fast to download and light on memory.',
  },
  quality: {
    title: 'Quality',
    meta: 'WebGPU fp32 · 326 MB',
    description: 'Sharper synthesis on supported GPUs. Falls back to q8.',
  },
  auto: {
    title: 'Auto',
    meta: 'Best available',
    description: 'Picks WebGPU when the browser exposes an adapter.',
  },
} as const;

type TierId = keyof typeof TIER_COPY;

const RULE_COPY: ReadonlyArray<{
  key: keyof NormalizationRules;
  title: string;
  description: string;
}> = [
  {
    key: 'abbreviations',
    title: 'Expand abbreviations',
    description: 'Dr. → Doctor, Ch. → Chapter, and Chapter IV → Chapter four.',
  },
  {
    key: 'citations',
    title: 'Skip citations',
    description: 'Removes [12], [1, 4–7], and (Smith et al., 2021) from speech.',
  },
  {
    key: 'urls',
    title: 'Read URLs as “link”',
    description: 'Long web addresses and bare domains become one spoken word.',
  },
];

function hasWebGpu(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

export function SettingsSheet() {
  const open = useSettingsStore((state) => state.settingsOpen);
  const tab = useSettingsStore((state) => state.settingsTab);
  const close = useSettingsStore((state) => state.closeSettings);
  const openTab = useSettingsStore((state) => state.openSettings);

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Settings"
      description="Narration, pronunciation, and storage. Everything stays on this device."
      size="lg"
    >
      <div
        role="tablist"
        aria-label="Settings sections"
        className="flex gap-1 rounded-pill border border-hairline bg-surface-muted/50 p-1"
      >
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            onClick={() => openTab(entry.id)}
            className={cn(
              'flex-1 rounded-pill px-3 py-2 text-[12px] font-semibold transition-colors duration-150',
              tab === entry.id
                ? 'bg-surface text-ink shadow-sm'
                : 'text-ink-secondary hover:text-ink',
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === 'narration' ? (
          <NarrationPanel />
        ) : tab === 'pronunciation' ? (
          <PronunciationPanel />
        ) : (
          <StoragePanel />
        )}
      </div>
    </Sheet>
  );
}

function NarrationPanel() {
  const tier = useSettingsStore((state) => state.modelTier);
  const setTier = useSettingsStore((state) => state.setModelTier);
  const voice = useSettingsStore((state) => state.voice);
  const rate = useSettingsStore((state) => state.playbackRate);
  const setRate = usePlayerStore((state) => state.setPlaybackRate);
  const applyVoice = usePlayerStore((state) => state.applyVoice);
  const webgpu = useMemo(hasWebGpu, []);

  return (
    <div className="space-y-5">
      <section>
        <div className="flex items-center gap-2">
          <Sparkles size={15} className="text-ink-tertiary" aria-hidden="true" />
          <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-tertiary">
            Narration model
          </h3>
        </div>
        <div className="mt-2.5 grid gap-2.5 sm:grid-cols-3">
          {(Object.keys(TIER_COPY) as TierId[]).map((id) => {
            const copy = TIER_COPY[id];
            const chosen = tier === id;
            const meta =
              id === 'quality' && !webgpu ? 'q8 fallback · 92 MB' : copy.meta;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={chosen}
                onClick={() => setTier(id)}
                className={cn(
                  'relative rounded-card border p-3.5 text-left transition-colors duration-150',
                  chosen
                    ? 'border-brand/50 bg-brand-soft'
                    : 'border-hairline bg-surface-muted/40 hover:bg-surface-muted/80',
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold">{copy.title}</span>
                  {chosen ? (
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-brand text-white">
                      <Check size={11} aria-hidden="true" />
                    </span>
                  ) : null}
                </span>
                <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-tertiary">
                  {meta}
                </span>
                <span className="mt-1.5 block text-[11.5px] leading-relaxed text-ink-secondary">
                  {copy.description}
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-tertiary">
          A tier change applies the next time narration starts. Models are
          downloaded once and kept on this device.
        </p>
      </section>

      <section>
        <div className="flex items-center gap-2">
          <Volume2 size={15} className="text-ink-tertiary" aria-hidden="true" />
          <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-tertiary">
            Voice and pace
          </h3>
        </div>

        <label className="mt-2.5 block">
          <span className="text-[11px] font-medium text-ink-secondary">
            Default narrator
          </span>
          <select
            value={voice.primary}
            onChange={(event) => applyVoice({ primary: event.target.value })}
            className="mt-1 w-full rounded-xl border border-hairline bg-surface px-3 py-2.5 text-[12.5px] text-ink outline-none focus:border-brand/50"
          >
            {VOICES.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name} · {entry.accent} {entry.gender}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] leading-relaxed text-ink-tertiary">
            Now narrating: {voiceLabelFor(voice)}.
            {voice.secondary
              ? ' Choosing one voice clears the current blend; use the microphone button in the player to mix up to three.'
              : ' Blend up to three voices with the microphone button in the player.'}
          </span>
        </label>

        <label className="mt-4 block">
          <span className="flex items-center justify-between text-[11px] font-medium text-ink-secondary">
            <span>Playback speed</span>
            <span className="tabular-nums text-ink">{rate.toFixed(2)}×</span>
          </span>
          <input
            type="range"
            min={MIN_PLAYBACK_RATE}
            max={MAX_PLAYBACK_RATE}
            step={0.05}
            value={clampPlaybackRate(rate)}
            onChange={(event) => setRate(Number(event.target.value))}
            aria-label="Playback speed"
            className="scrubber mt-2"
            style={
              {
                '--progress': `${
                  ((clampPlaybackRate(rate) - MIN_PLAYBACK_RATE) /
                    (MAX_PLAYBACK_RATE - MIN_PLAYBACK_RATE)) *
                  100
                }%`,
              } as CSSProperties
            }
          />
          <span className="mt-1 block text-[11px] leading-relaxed text-ink-tertiary">
            Speed is applied with WSOLA time-stretching, so the voice keeps its pitch.
          </span>
        </label>
      </section>
    </div>
  );
}

function PronunciationPanel() {
  const lexicon = useSettingsStore((state) => state.lexicon);
  const rules = useSettingsStore((state) => state.normalizationRules);
  const addEntry = useSettingsStore((state) => state.addLexiconEntry);
  const updateEntry = useSettingsStore((state) => state.updateLexiconEntry);
  const removeEntry = useSettingsStore((state) => state.removeLexiconEntry);
  const setRules = useSettingsStore((state) => state.setNormalizationRules);

  const [phrase, setPhrase] = useState('');
  const [say, setSay] = useState('');
  const [error, setError] = useState<string | null>(null);

  const phraseWords = useMemo(
    () => phrase.trim().split(/\s+/u).filter(Boolean).length,
    [phrase],
  );

  const add = () => {
    const clean = phrase.trim();
    if (!clean) {
      setError('Enter a word or phrase to replace.');
      return;
    }
    if (phraseWords > MAX_LEXICON_WORDS) {
      setError(`Keep entries to ${MAX_LEXICON_WORDS} words or fewer.`);
      return;
    }
    if (
      lexicon.some(
        (entry) => entry.phrase.trim().toLocaleLowerCase() === clean.toLocaleLowerCase(),
      )
    ) {
      setError('That phrase is already in the lexicon.');
      return;
    }

    addEntry({ phrase: clean, say, enabled: true });
    setPhrase('');
    setSay('');
    setError(null);
  };

  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-tertiary">
          Text normalization
        </h3>
        <div className="mt-2 space-y-2">
          {RULE_COPY.map((rule) => (
            <div
              key={rule.key}
              className="flex items-start justify-between gap-4 rounded-card border border-hairline bg-surface-muted/40 px-3.5 py-3"
            >
              <div className="min-w-0">
                <p className="text-[12.5px] font-semibold">{rule.title}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-ink-secondary">
                  {rule.description}
                </p>
              </div>
              <Switch
                checked={rules[rule.key]}
                onCheckedChange={(checked) => {
                  const patch: Partial<NormalizationRules> = {};
                  patch[rule.key] = checked;
                  setRules(patch);
                }}
                label={rule.title}
              />
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-tertiary">
            Pronunciation lexicon
          </h3>
          <span className="text-[11px] tabular-nums text-ink-tertiary">
            {lexicon.length} {lexicon.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>

        <div className="mt-2 grid gap-2 rounded-card border border-hairline bg-surface-muted/40 p-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-tertiary">
              Written as
            </span>
            <input
              value={phrase}
              onChange={(event) => {
                setPhrase(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') add();
              }}
              placeholder="Hermione"
              aria-label="Word or phrase"
              className="mt-1 w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink-tertiary focus:border-brand/50"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-tertiary">
              Spoken as
            </span>
            <input
              value={say}
              onChange={(event) => {
                setSay(event.target.value);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') add();
              }}
              placeholder="Her-my-oh-nee"
              aria-label="Spoken replacement"
              className="mt-1 w-full rounded-xl border border-hairline bg-surface px-3 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink-tertiary focus:border-brand/50"
            />
          </label>
          <Button onClick={add} className="self-end" size="sm">
            <Plus size={14} aria-hidden="true" />
            Add
          </Button>
        </div>

        {error ? (
          <p role="alert" className="mt-1.5 text-[11px] font-medium text-danger">
            {error}
          </p>
        ) : (
          <p className="mt-1.5 text-[11px] leading-relaxed text-ink-tertiary">
            Write the replacement the way it should sound. Leave “Spoken as” empty to skip
            the word entirely. Multi-word phrases are matched longest-first.
          </p>
        )}

        {lexicon.length > 0 ? (
          <ul className="mt-2.5 space-y-1.5">
            {lexicon.map((entry) => (
              <li
                key={entry.id}
                className={cn(
                  'flex items-center gap-2.5 rounded-xl border border-hairline px-3 py-2',
                  entry.enabled ? 'bg-surface/60' : 'bg-surface-muted/30 opacity-70',
                )}
              >
                <Switch
                  checked={entry.enabled}
                  onCheckedChange={(checked) => updateEntry(entry.id, { enabled: checked })}
                  label={`Enable ${entry.phrase}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium">
                    {entry.phrase}
                    <span className="mx-1.5 text-ink-tertiary" aria-hidden="true">
                      →
                    </span>
                    <span className={cn(!entry.say && 'italic text-ink-tertiary')}>
                      {entry.say || 'skipped'}
                    </span>
                  </span>
                </span>
                <IconButton
                  label={`Remove ${entry.phrase}`}
                  variant="ghost"
                  onClick={() => removeEntry(entry.id)}
                >
                  <Trash2 size={14} />
                </IconButton>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2.5 rounded-xl border border-dashed border-hairline px-3 py-4 text-center text-[11.5px] text-ink-tertiary">
            No custom pronunciations yet. Add a name or invented word to hear it the way
            you want.
          </p>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-ink-tertiary">
          Changes restart the current sentence and create new cache entries. Previously
          rendered audio stays available until it is evicted or cleared.
        </p>
      </section>
    </div>
  );
}

function StoragePanel() {
  const cacheCapBytes = useSettingsStore((state) => state.cacheCapBytes);
  const setCacheCapBytes = useSettingsStore((state) => state.setCacheCapBytes);
  const [usage, setUsage] = useState<AudioCacheUsage>({ entries: 0, bytes: 0 });
  const [refreshKey, setRefreshKey] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const storage = useStorageEstimate(refreshKey);

  const refresh = useCallback(async () => {
    const next = await readAudioCacheUsage().catch(() => ({ entries: 0, bytes: 0 }));
    setUsage(next);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  const chooseCap = async (bytes: number) => {
    setBusy(true);
    setMessage(null);
    setCacheCapBytes(bytes);
    try {
      const evicted = await applyAudioCacheCap(bytes);
      await refresh();
      setRefreshKey((value) => value + 1);
      setMessage(
        evicted > 0
          ? `Reclaimed ${evicted} cached ${evicted === 1 ? 'sentence' : 'sentences'}.`
          : 'Cache limit saved.',
      );
    } catch {
      setMessage('The cache limit was saved, but old audio could not be evicted.');
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!confirming) {
      setConfirming(true);
      setMessage(null);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await clearRenderedAudio();
      setUsage({ entries: 0, bytes: 0 });
      setRefreshKey((value) => value + 1);
      setMessage('Rendered audio cleared. Books and downloaded models were kept.');
    } catch {
      setMessage('Cadence could not clear the rendered audio.');
    } finally {
      setConfirming(false);
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-card border border-hairline bg-surface-muted/40 p-4">
        <div className="flex items-start gap-3">
          <Database size={16} className="mt-0.5 shrink-0 text-ink-tertiary" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold">On this device</p>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-secondary">
              {formatBytes(storage.usage)} used
              {storage.quota > 0 ? ` of ${formatBytes(storage.quota)} available` : ''}.
              Books, covers, model files, voice styles, rendered audio, and exports all
              live in local browser storage.
            </p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-hairline pt-3 text-[11.5px]">
          <div>
            <p className="font-semibold tabular-nums">{formatBytes(usage.bytes)}</p>
            <p className="text-ink-tertiary">Rendered speech</p>
          </div>
          <div>
            <p className="font-semibold tabular-nums">{usage.entries.toLocaleString()}</p>
            <p className="text-ink-tertiary">Cached sentences</p>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.16em] text-ink-tertiary">
          Rendered audio limit
        </h3>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-tertiary">
          When the cache grows past this limit, the oldest sentences are removed first.
          Downloadable models and voice styles are not counted.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {CACHE_CAP_OPTIONS.map((option) => {
            const chosen = cacheCapBytes === option.bytes;
            return (
              <button
                key={option.label}
                type="button"
                aria-pressed={chosen}
                disabled={busy}
                onClick={() => void chooseCap(option.bytes)}
                className={cn(
                  'rounded-xl border px-3 py-2.5 text-left transition-colors duration-150 disabled:opacity-50',
                  chosen
                    ? 'border-brand/50 bg-brand-soft'
                    : 'border-hairline bg-surface-muted/40 hover:bg-surface-muted/80',
                  option.bytes === DEFAULT_CACHE_CAP_BYTES && !chosen && 'border-dashed',
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-[12.5px] font-semibold">{option.label}</span>
                  {chosen ? <Check size={12} className="text-brand" aria-hidden="true" /> : null}
                </span>
                <span className="mt-0.5 block text-[10px] text-ink-tertiary">
                  {option.hint}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-card border border-hairline bg-surface-muted/40 p-4">
        <p className="text-[13px] font-semibold">Clear rendered audio</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-secondary">
          Deletes every cached sentence for every book. Your library, reading progress,
          models, voice styles, and finished exports are untouched.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            variant={confirming ? 'primary' : 'outline'}
            size="sm"
            disabled={busy}
            onClick={() => void clear()}
            className={confirming ? 'bg-danger text-white hover:brightness-105' : undefined}
          >
            <Trash2 size={14} aria-hidden="true" />
            {confirming ? 'Delete all rendered audio' : 'Clear rendered audio'}
          </Button>
          {confirming ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </section>

      {message ? (
        <p role="status" aria-live="polite" className="text-[11.5px] font-medium text-ink-secondary">
          {message}
        </p>
      ) : null}
    </div>
  );
}
