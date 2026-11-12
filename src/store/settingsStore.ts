import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { getSetting, putSetting } from '@/core/storage/db';
import { DEFAULT_VOICE_ID, normalizeVoiceSelection } from '@/core/tts/voices';
import type { ModelTier, VoiceSelection } from '@/types/tts';

type SettingsState = {
  loaded: boolean;
  modelTier: ModelTier;
  voice: VoiceSelection;
  volume: number;
  load: () => Promise<void>;
  setModelTier: (tier: ModelTier) => void;
  setVoice: (voice: VoiceSelection) => void;
  setVolume: (volume: number) => void;
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

    load: async () => {
      try {
        const [tier, voice, volume] = await Promise.all([
          getSetting<ModelTier>('modelTier'),
          getSetting<VoiceSelection>('voice'),
          getSetting<number>('volume'),
        ]);
        set((state) => {
          state.modelTier =
            tier === 'auto' || tier === 'quality' || tier === 'balanced' ? tier : 'balanced';
          state.voice = voice ? normalizeVoiceSelection(voice) : DEFAULT_VOICE;
          state.volume = typeof volume === 'number' ? Math.min(1, Math.max(0, volume)) : 1;
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
  })),
);
