import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { getSetting, putSetting } from '@/core/storage/db';
import { clampPlaybackRate } from '@/core/audio/rate';
import { DEFAULT_CACHE_CAP_BYTES } from '@/core/tts/cachePolicy';
import { DEFAULT_VOICE_ID, normalizeVoiceSelection } from '@/core/tts/voices';
import {
  DEFAULT_NORMALIZATION_RULES,
  type LexiconEntry,
  type NormalizationRules,
} from '@/types/speech';
import type { ModelTier, VoiceSelection } from '@/types/tts';

export type LyricsMode = 'focus' | 'book';
export type SettingsTab = 'narration' | 'pronunciation' | 'storage';

export type LexiconDraft = Pick<LexiconEntry, 'phrase' | 'say' | 'enabled'>;

type SettingsState = {
  loaded: boolean;
  modelTier: ModelTier;
  voice: VoiceSelection;
  volume: number;
  playbackRate: number;
  lyricsMode: LyricsMode;
  lexicon: LexiconEntry[];
  normalizationRules: NormalizationRules;
  cacheCapBytes: number;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  load: () => Promise<void>;
  setModelTier: (tier: ModelTier) => void;
  setVoice: (voice: VoiceSelection) => void;
  setVolume: (volume: number) => void;
  setPlaybackRate: (rate: number) => void;
  setLyricsMode: (mode: LyricsMode) => void;
  addLexiconEntry: (draft: LexiconDraft) => void;
  updateLexiconEntry: (id: string, patch: Partial<LexiconDraft>) => void;
  removeLexiconEntry: (id: string) => void;
  setNormalizationRules: (patch: Partial<NormalizationRules>) => void;
  setCacheCapBytes: (bytes: number) => void;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
};

const DEFAULT_VOICE: VoiceSelection = { primary: DEFAULT_VOICE_ID };

const MAX_LEXICON_ENTRIES = 500;
const MAX_PHRASE_CHARS = 120;
const MAX_SAY_CHARS = 240;

function normalizeLexicon(value: unknown): LexiconEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();

  return value
    .filter((entry): entry is LexiconEntry => {
      if (!entry || typeof entry !== 'object') return false;
      const candidate = entry as Partial<LexiconEntry>;
      return (
        typeof candidate.id === 'string' &&
        typeof candidate.phrase === 'string' &&
        typeof candidate.say === 'string' &&
        typeof candidate.enabled === 'boolean'
      );
    })
    .filter((entry) => entry.phrase.trim().length > 0)
    .filter((entry) => {
      const key = entry.phrase.trim().toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_LEXICON_ENTRIES)
    .map((entry) => ({
      id: entry.id,
      phrase: entry.phrase.trim().slice(0, MAX_PHRASE_CHARS),
      say: entry.say.trim().slice(0, MAX_SAY_CHARS),
      enabled: entry.enabled,
      createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : Date.now(),
    }));
}

function normalizeRules(value: unknown): NormalizationRules {
  if (!value || typeof value !== 'object') return DEFAULT_NORMALIZATION_RULES;
  const candidate = value as Partial<NormalizationRules>;
  return {
    abbreviations:
      typeof candidate.abbreviations === 'boolean'
        ? candidate.abbreviations
        : DEFAULT_NORMALIZATION_RULES.abbreviations,
    citations:
      typeof candidate.citations === 'boolean'
        ? candidate.citations
        : DEFAULT_NORMALIZATION_RULES.citations,
    urls:
      typeof candidate.urls === 'boolean' ? candidate.urls : DEFAULT_NORMALIZATION_RULES.urls,
  };
}

function normalizeCap(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return DEFAULT_CACHE_CAP_BYTES;
  }
  return value;
}

function trimDraft(draft: LexiconDraft): LexiconDraft | null {
  const phrase = draft.phrase.trim().slice(0, MAX_PHRASE_CHARS);
  if (!phrase) return null;
  return {
    phrase,
    say: draft.say.trim().slice(0, MAX_SAY_CHARS),
    enabled: draft.enabled,
  };
}

export const useSettingsStore = create<SettingsState>()(
  immer((set, get) => ({
    loaded: false,
    // The blueprint's default is the ~92 MB quantized WASM model. WebGPU fp32
    // is an opt-in quality mode; `auto` is available for explicit selection.
    modelTier: 'balanced',
    voice: DEFAULT_VOICE,
    volume: 1,
    playbackRate: 1,
    lyricsMode: 'focus',
    lexicon: [],
    normalizationRules: DEFAULT_NORMALIZATION_RULES,
    cacheCapBytes: DEFAULT_CACHE_CAP_BYTES,
    settingsOpen: false,
    settingsTab: 'narration',

    load: async () => {
      try {
        const [tier, voice, volume, playbackRate, lyricsMode, lexicon, rules, cacheCap] =
          await Promise.all([
            getSetting<ModelTier>('modelTier'),
            getSetting<VoiceSelection>('voice'),
            getSetting<number>('volume'),
            getSetting<number>('playbackRate'),
            getSetting<LyricsMode>('lyricsMode'),
            getSetting<LexiconEntry[]>('lexicon'),
            getSetting<NormalizationRules>('normalizationRules'),
            getSetting<number>('cacheCapBytes'),
          ]);
        set((state) => {
          state.modelTier =
            tier === 'auto' || tier === 'quality' || tier === 'balanced' ? tier : 'balanced';
          state.voice = voice ? normalizeVoiceSelection(voice) : DEFAULT_VOICE;
          state.volume = typeof volume === 'number' ? Math.min(1, Math.max(0, volume)) : 1;
          state.playbackRate =
            typeof playbackRate === 'number' ? clampPlaybackRate(playbackRate) : 1;
          state.lyricsMode = lyricsMode === 'book' ? 'book' : 'focus';
          state.lexicon = normalizeLexicon(lexicon);
          state.normalizationRules = normalizeRules(rules);
          state.cacheCapBytes = normalizeCap(cacheCap);
          state.loaded = true;
        });
      } catch {
        set((state) => {
          state.loaded = true;
        });
      }
    },

    setModelTier: (tier) => {
      set((state) => {
        state.modelTier = tier;
      });
      void putSetting('modelTier', tier).catch(() => undefined);
    },

    setVoice: (voice) => {
      const normalized = normalizeVoiceSelection(voice);
      set((state) => {
        state.voice = normalized;
      });
      void putSetting('voice', normalized).catch(() => undefined);
    },

    setVolume: (volume) => {
      const clamped = Math.min(1, Math.max(0, volume));
      set((state) => {
        state.volume = clamped;
      });
      void putSetting('volume', clamped).catch(() => undefined);
    },

    setPlaybackRate: (rate) => {
      const clamped = clampPlaybackRate(rate);
      set((state) => {
        state.playbackRate = clamped;
      });
      void putSetting('playbackRate', clamped).catch(() => undefined);
    },

    setLyricsMode: (mode) => {
      set((state) => {
        state.lyricsMode = mode;
      });
      void putSetting('lyricsMode', mode).catch(() => undefined);
    },

    addLexiconEntry: (draft) => {
      const next = trimDraft(draft);
      if (!next) return;
      set((state) => {
        if (state.lexicon.length >= MAX_LEXICON_ENTRIES) return;
        state.lexicon.unshift({
          id: crypto.randomUUID(),
          ...next,
          createdAt: Date.now(),
        });
      });
      void putSetting('lexicon', get().lexicon).catch(() => undefined);
    },

    updateLexiconEntry: (id, patch) => {
      set((state) => {
        const entry = state.lexicon.find((item) => item.id === id);
        if (!entry) return;
        if (patch.phrase !== undefined) {
          const phrase = patch.phrase.trim().slice(0, MAX_PHRASE_CHARS);
          if (phrase) entry.phrase = phrase;
        }
        if (patch.say !== undefined) entry.say = patch.say.trim().slice(0, MAX_SAY_CHARS);
        if (patch.enabled !== undefined) entry.enabled = patch.enabled;
      });
      void putSetting('lexicon', get().lexicon).catch(() => undefined);
    },

    removeLexiconEntry: (id) => {
      set((state) => {
        state.lexicon = state.lexicon.filter((entry) => entry.id !== id);
      });
      void putSetting('lexicon', get().lexicon).catch(() => undefined);
    },

    setNormalizationRules: (patch) => {
      set((state) => {
        state.normalizationRules = { ...state.normalizationRules, ...patch };
      });
      void putSetting('normalizationRules', get().normalizationRules).catch(() => undefined);
    },

    setCacheCapBytes: (bytes) => {
      const next = normalizeCap(bytes);
      set((state) => {
        state.cacheCapBytes = next;
      });
      void putSetting('cacheCapBytes', next).catch(() => undefined);
    },

    openSettings: (tab) => {
      set((state) => {
        state.settingsOpen = true;
        if (tab) state.settingsTab = tab;
      });
    },

    closeSettings: () => {
      set((state) => {
        state.settingsOpen = false;
      });
    },
  })),
);

/** Active lexicon/rules as one object, ready for a synthesis request. */
export function activeSpeechProfile(state: SettingsState = useSettingsStore.getState()) {
  return { lexicon: state.lexicon, rules: state.normalizationRules };
}
