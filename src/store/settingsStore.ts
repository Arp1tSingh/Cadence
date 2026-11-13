import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { getSetting, putSetting } from '@/core/storage/db';
import { clampPlaybackRate } from '@/core/audio/rate';
import { DEFAULT_VOICE_ID, normalizeVoiceSelection } from '@/core/tts/voices';
import type { ModelTier, VoiceSelection } from '@/types/tts';

export type LyricsMode = 'focus' | 'book';

type SettingsState = {
  loaded: boolean;
  modelTier: ModelTier;
  voice: VoiceSelection;
  volume: number;
  playbackRate: number;
  lyricsMode: LyricsMode;
  load: () => Promise<void>;
  setModelTier: (tier: ModelTier) => void;
  setVoice: (voice: VoiceSelection) => void;
  setVolume: (volume: number) => void;
  setPlaybackRate: (rate: number) => void;
  setLyricsMode: (mode: LyricsMode) => void;
};

const DEFAULT_VOICE: VoiceSelection = { primary: DEFAULT_VOICE_ID };

export const useSettingsStore = create<SettingsState>()(
  immer((set) => ({
    loaded: false,
    // The blueprint's default is the ~92 MB quantized WASM model. WebGPU fp32
    // is an opt-in quality mode; `auto` is available for explicit selection.
    modelTier: 'balanced',
    voice: DEFAULT_VOICE,
    volume: 1,
    playbackRate: 1,
    lyricsMode: 'focus',

    load: async () => {
      try {
        const [tier, voice, volume, playbackRate, lyricsMode] = await Promise.all([
          getSetting<ModelTier>('modelTier'),
          getSetting<VoiceSelection>('voice'),
          getSetting<number>('volume'),
          getSetting<number>('playbackRate'),
          getSetting<LyricsMode>('lyricsMode'),
        ]);
        set((state) => {
          state.modelTier =
            tier === 'auto' || tier === 'quality' || tier === 'balanced' ? tier : 'balanced';
          state.voice = voice ? normalizeVoiceSelection(voice) : DEFAULT_VOICE;
          state.volume = typeof volume === 'number' ? Math.min(1, Math.max(0, volume)) : 1;
          state.playbackRate =
            typeof playbackRate === 'number' ? clampPlaybackRate(playbackRate) : 1;
          state.lyricsMode = lyricsMode === 'book' ? 'book' : 'focus';
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
  })),
);
