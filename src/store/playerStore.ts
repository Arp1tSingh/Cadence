import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { BookDocument } from '@/types/domain';
import type { PlayerFrame, PlayerSnapshot } from '@/core/player/session';
import { playerSession } from '@/core/player/session';
import { activeSpeechProfile, useSettingsStore } from './settingsStore';

export const EMPTY_PLAYER_SNAPSHOT: PlayerSnapshot = {
  bookId: null,
  status: 'idle',
  chapterIndex: 0,
  chapterTitle: '',
  sentenceIndex: 0,
  totalSentences: 0,
  sentence: null,
  modelProgress: null,
  error: null,
  positionSeconds: 0,
  durationSeconds: 0,
};

type PlayerState = {
  bookId: string | null;
  snapshot: PlayerSnapshot;
  openBook: (book: BookDocument) => Promise<void>;
  closePlayer: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  toggle: () => Promise<void>;
  next: () => void;
  previous: () => void;
  seekToSentence: (index: number) => void;
  seekToChapter: (chapterIndex: number) => void;
  seekToSeconds: (seconds: number) => void;
  seekBy: (seconds: number) => void;
  setVolume: (volume: number) => void;
  setPlaybackRate: (rate: number) => void;
  applyVoice: (voice: Parameters<typeof playerSession.setVoice>[0]) => void;
};

export const usePlayerStore = create<PlayerState>()(
  immer((set) => ({
    bookId: null,
    snapshot: EMPTY_PLAYER_SNAPSHOT,

    openBook: async (book) => {
      const settings = useSettingsStore.getState();
      set((state) => {
        state.bookId = book.id;
      });
      await playerSession.open(book, {
        voice: settings.voice,
        tier: settings.modelTier,
        volume: settings.volume,
        rate: settings.playbackRate,
        speech: activeSpeechProfile(settings),
        cacheCapBytes: settings.cacheCapBytes,
      });
      set((state) => {
        state.snapshot = playerSession.getSnapshot();
      });
    },

    closePlayer: async () => {
      await playerSession.close();
      set((state) => {
        state.bookId = null;
        state.snapshot = EMPTY_PLAYER_SNAPSHOT;
      });
    },

    play: async () => {
      await playerSession.play();
    },

    pause: async () => {
      await playerSession.pause();
    },

    toggle: async () => {
      await playerSession.toggle();
    },

    next: () => playerSession.next(),
    previous: () => playerSession.previous(),
    seekToSentence: (index) => playerSession.seekToSentence(index),
    seekToChapter: (index) => playerSession.seekToChapter(index),
    seekToSeconds: (seconds) => playerSession.seekToSeconds(seconds),
    seekBy: (seconds) => playerSession.seekBy(seconds),

    setVolume: (volume) => {
      useSettingsStore.getState().setVolume(volume);
      playerSession.setVolume(volume);
    },

    setPlaybackRate: (rate) => {
      useSettingsStore.getState().setPlaybackRate(rate);
      playerSession.setRate(rate);
    },

    applyVoice: (voice) => {
      useSettingsStore.getState().setVoice(voice);
      playerSession.setVoice(voice);
    },
  })),
);

playerSession.subscribe(() => {
  usePlayerStore.setState({ snapshot: playerSession.getSnapshot() });
});

/**
 * Settings can change from the library or the player, so the session follows
 * the store instead of relying on each sheet to call the right method.
 */
useSettingsStore.subscribe((state, previous) => {
  if (state.modelTier !== previous.modelTier) playerSession.setTier(state.modelTier);
  if (state.cacheCapBytes !== previous.cacheCapBytes) {
    playerSession.setCacheCap(state.cacheCapBytes);
  }
  if (
    state.lexicon !== previous.lexicon ||
    state.normalizationRules !== previous.normalizationRules
  ) {
    playerSession.setSpeech(activeSpeechProfile(state));
  }
});

export function usePlayerFrame(listener: (frame: PlayerFrame) => void): void {
  const listenerRef = useRef(listener);
  listenerRef.current = listener;

  useEffect(() => playerSession.onFrame((frame) => listenerRef.current(frame)), []);
}

export { playerSession };
