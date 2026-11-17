import type { BookDocument, ReadingProgress, SentenceNode } from '@/types/domain';
import type {
  ModelLoadProgress,
  ModelTier,
  SynthesizedSentence,
  VoiceSelection,
} from '@/types/tts';
import type { SpeechProfile } from '@/types/speech';
import { EMPTY_SPEECH_PROFILE } from '@/types/speech';
import {
  getProgress,
  putProgress,
} from '@/core/storage/db';
import { readBookCover } from '@/core/storage/opfs';
import {
  cancelPending,
  ensureTtsModel,
  synthesizeSentence,
} from '@/core/workers/ttsClient';
import { AudioScheduler } from '@/core/audio/audioScheduler';
import { clampPlaybackRate } from '@/core/audio/rate';
import { clampResumeOffset, sentenceAtContentTime } from '@/core/audio/timeline';
import { scaleTimings } from '@/core/audio/wsola';
import { stretchAudio } from '@/core/workers/stretchClient';
import {
  clearMediaSession,
  configureMediaSession,
  setPlaybackState,
  updateMediaMetadata,
  updatePositionState,
} from '@/core/audio/mediaSession';
import { releaseWakeLock, requestWakeLock } from '@/core/audio/wakeLock';
import { LOOKAHEAD_SENTENCES } from '@/core/tts/constants';
import { isJobCancelled } from '@/core/tts/cancel';
import { speechProfileKey } from '@/core/tts/speechProfile';
import { wordIndexAt, wordProgressAt } from '@/core/tts/timing';
import { normalizeVoiceSelection } from '@/core/tts/voices';
import {
  INITIAL_PREROLL_SECONDS,
  nextPreroll,
  prerollReached,
} from './preroll';

export type PlayerStatus =
  | 'idle'
  | 'preparing'
  | 'buffering'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error';

export type PlayerSnapshot = {
  bookId: string | null;
  status: PlayerStatus;
  chapterIndex: number;
  chapterTitle: string;
  sentenceIndex: number;
  totalSentences: number;
  sentence: SentenceNode | null;
  modelProgress: ModelLoadProgress | null;
  error: string | null;
  positionSeconds: number;
  durationSeconds: number;
};

export type PlayerFrame = {
  sentenceId: string;
  sentenceIndex: number;
  wordIndex: number;
  wordProgress: number;
  sentenceProgress: number;
  positionSeconds: number;
};

type FlatSentence = {
  sentence: SentenceNode;
  chapterIndex: number;
  chapterTitle: string;
};

type OpenOptions = {
  voice: VoiceSelection;
  tier: ModelTier;
  volume?: number;
  /** Playback speed; audio is time-stretched without re-synthesis. */
  rate?: number;
  /** Lexicon and normalization rules for synthesis. */
  speech?: SpeechProfile;
  /** Soft PCM cache cap in bytes; zero or negative means unlimited. */
  cacheCapBytes?: number;
};

const EMPTY_SNAPSHOT: PlayerSnapshot = {
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

let loadedTier: ModelTier | null = null;

export class PlayerSession {
  private book: BookDocument | null = null;
  private flat: FlatSentence[] = [];
  private prefixDurations: number[] = [];
  private total = 0;

  private voice: VoiceSelection = { primary: 'af_heart' };
  private tier: ModelTier = 'auto';
  private playIntent = false;
  private rate = 1;
  private speech: SpeechProfile = EMPTY_SPEECH_PROFILE;
  private speechKey = speechProfileKey();
  private cacheCapBytes = 0;

  private currentIndex = 0;
  private nextScheduleIndex = 0;
  private requestCursor = 0;
  /**
   * First sentence after a seek or resume and how far into it to start, in
   * playback seconds. Consumed by `drain()` and cleared once scheduled.
   */
  private pendingOffset: { index: number; seconds: number } | null = null;

  private status: PlayerStatus = 'idle';
  private modelProgress: ModelLoadProgress | null = null;
  private error: string | null = null;

  private generation = 0;
  private requested = new Set<number>();
  private ready = new Map<number, SynthesizedSentence>();
  /** Seconds of narration to build up before the clock resumes. */
  private preroll = INITIAL_PREROLL_SECONDS;

  private scheduler = new AudioScheduler();
  private rafId: number | null = null;
  private lastPositionUpdate = 0;
  private artworkUrl: string | null = null;

  private snapshot: PlayerSnapshot = EMPTY_SNAPSHOT;
  private listeners = new Set<() => void>();
  private frameListeners = new Set<(frame: PlayerFrame) => void>();
  /** Narration length at 1×; playback duration is this divided by `rate`. */
  private contentDuration = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  onFrame = (listener: (frame: PlayerFrame) => void): (() => void) => {
    this.frameListeners.add(listener);
    return () => {
      this.frameListeners.delete(listener);
    };
  };

  getSnapshot = (): PlayerSnapshot => this.snapshot;

  getBook = (): BookDocument | null => this.book;

  get statusValue(): PlayerStatus {
    return this.status;
  }

  async open(book: BookDocument, options: OpenOptions): Promise<void> {
    this.stopClock();
    this.generation += 1;
    this.requested.clear();
    this.ready.clear();
    this.scheduler.reset();
    void cancelPending();

    this.book = book;
    this.voice = normalizeVoiceSelection(options.voice);
    this.tier = options.tier;
    this.rate = clampPlaybackRate(options.rate ?? 1);
    this.speech = options.speech ?? EMPTY_SPEECH_PROFILE;
    this.speechKey = speechProfileKey(this.speech);
    this.cacheCapBytes = options.cacheCapBytes ?? 0;
    this.playIntent = false;
    this.error = null;
    this.modelProgress = null;
    this.preroll = INITIAL_PREROLL_SECONDS;

    this.flat = [];
    this.prefixDurations = [];
    let elapsed = 0;
    for (const chapter of book.chapters) {
      for (const paragraph of chapter.paragraphs) {
        for (const sentence of paragraph.sentences) {
          this.prefixDurations.push(elapsed);
          elapsed += sentence.estimatedDuration;
          this.flat.push({
            sentence,
            chapterIndex: chapter.index,
            chapterTitle: chapter.title,
          });
        }
      }
    }
    this.total = this.flat.length;
    this.contentDuration = Math.max(book.estimatedDuration, elapsed);
    this.scheduler.setVolume(options.volume ?? 1);

    let saved: ReadingProgress | undefined;
    try {
      saved = await getProgress(book.id);
    } catch {
      saved = undefined;
    }
    const restored = saved ? this.indexOf(saved) : 0;
    this.currentIndex = restored;
    this.nextScheduleIndex = restored;
    this.requestCursor = restored;
    // Restore the saved position inside the sentence, not just its start. The
    // saved value is content seconds; the scheduler needs playback seconds.
    const restoreContent = clampResumeOffset(
      saved?.offsetSeconds ?? 0,
      this.flat[restored]?.sentence.estimatedDuration ?? 0,
    );
    this.pendingOffset =
      restoreContent > 0 ? { index: restored, seconds: restoreContent / this.rate } : null;

    this.status = 'idle';
    this.emit();
    this.configureMedia(book);
    this.preloadModel();
  }

  /**
   * Warms the narration model while the book is being opened instead of
   * waiting for the first play. It is deliberately fire-and-forget: a failed
   * download must not fail the book, and `play()` retries with an error path.
   */
  private preloadModel(): void {
    const tier = this.tier;
    void ensureTtsModel(tier, (progress) => this.updateModelProgress(progress))
      .then(() => {
        if (this.book && this.tier === tier) loadedTier = tier;
      })
      .catch(() => undefined);
  }

  async play(): Promise<void> {
    if (!this.book || this.total === 0) return;
    if (this.playIntent) return;

    // Create/resume the AudioContext inside the gesture before awaiting the
    // model, so iOS keeps the audio session unlocked.
    const contextReady = this.scheduler.ensureContext().catch(() => null);
    this.playIntent = true;
    this.error = null;

    if (this.status === 'ended') {
      await contextReady;
      this.startFrom(0);
      return;
    }

    if (loadedTier !== this.tier) {
      this.setStatus('preparing');
      this.modelProgress = null;
      this.emit();
      try {
        await ensureTtsModel(this.tier, (progress) => this.updateModelProgress(progress));
        loadedTier = this.tier;
      } catch (error) {
        await contextReady;
        this.fail(error, 'The narration model could not start.');
        return;
      }
      this.modelProgress = null;
      if (!this.playIntent) {
        this.emit();
        return;
      }
    }

    const context = await contextReady;
    if (!context) {
      this.fail(new Error('Audio is unavailable in this browser.'), 'Audio could not start.');
      return;
    }
    if (!this.playIntent) return;

    const resumable = this.status === 'paused' && this.scheduler.queuedCount > 0;
    if (!resumable) {
      this.startFrom(this.currentIndex);
      return;
    }

    await this.scheduler.resume();
    if (!this.playIntent) return;
    this.setStatus('playing');
    setPlaybackState('playing');
    void requestWakeLock();
    this.ensureClock();
  }

  async pause(): Promise<void> {
    this.playIntent = false;
    await this.scheduler.suspend();
    if (this.status === 'playing' || this.status === 'buffering' || this.status === 'preparing') {
      this.setStatus('paused');
    }
    setPlaybackState('paused');
    void releaseWakeLock();
    void cancelPending();
    this.saveProgress();
    this.updateMediaPosition();
  }

  async toggle(): Promise<void> {
    if (this.playIntent) await this.pause();
    else await this.play();
  }

  next(): void {
    if (this.currentIndex + 1 >= this.total) {
      this.seek(this.currentIndex);
      return;
    }
    this.seek(this.currentIndex + 1);
  }

  previous(): void {
    const located = this.scheduler.locate();
    const elapsed = located?.entry.index === this.currentIndex ? located.elapsed : 0;
    if (elapsed > 3 || this.currentIndex === 0) {
      this.seek(this.currentIndex);
      return;
    }
    this.seek(this.currentIndex - 1);
  }

  seekToSentence(index: number): void {
    this.seek(index);
  }

  seekToChapter(chapterIndex: number): void {
    const target = this.flat.findIndex((entry) => entry.chapterIndex >= chapterIndex);
    this.seek(target === -1 ? this.total - 1 : target);
  }

  seekToSeconds(seconds: number): void {
    if (this.total === 0) return;
    const duration = this.playbackDuration();
    const playback = Math.min(duration, Math.max(0, seconds));
    // Scrubber time is playback time; the sentence table is stored at 1×.
    const content = playback * this.rate;
    const { index, offsetSeconds } = sentenceAtContentTime(this.prefixDurations, content);
    this.seek(index, { offsetSeconds });
  }

  seekBy(seconds: number): void {
    this.seekToSeconds(this.positionSeconds() + seconds);
  }

  setVoice(voice: VoiceSelection): void {
    this.voice = normalizeVoiceSelection(voice);
    if (!this.book) return;
    // Every cached sentence is voice-specific, so the timeline restarts from
    // the current sentence with the new voice key.
    this.restartTimeline();
  }

  setTier(tier: ModelTier): void {
    this.tier = tier;
  }

  /** Applies new pronunciation settings; spoken text is cache-keyed, so the
   * current sentence is re-requested at the new rendering. */
  setSpeech(speech: SpeechProfile): void {
    const key = speechProfileKey(speech);
    this.speech = speech;
    if (key === this.speechKey) return;
    this.speechKey = key;
    if (!this.book) return;
    this.restartTimeline();
  }

  setCacheCap(capBytes: number): void {
    this.cacheCapBytes = capBytes;
  }

  setVolume(volume: number): void {
    this.scheduler.setVolume(volume);
  }

  setRate(rate: number): void {
    const next = clampPlaybackRate(rate);
    if (Math.abs(next - this.rate) < 1e-3) return;
    // Capture the position on the 1× timeline before the rate changes, so the
    // restarted sentence resumes where the voice was instead of from its start.
    const contentOffset = this.currentContentOffset();
    this.rate = next;
    if (!this.book || this.total === 0) {
      this.emit();
      return;
    }
    if (this.status === 'preparing') {
      this.emit();
      return;
    }

    // If nothing is queued yet, pending synthesis can safely finish: requests
    // stretch at whatever `this.rate` is when their audio resolves. Restarting
    // here would throw away minutes of inference on a slow device.
    if (this.scheduler.queuedCount === 0 && this.ready.size === 0) {
      this.emit();
      return;
    }

    this.restartTimeline(contentOffset);
  }

  getRate(): number {
    return this.rate;
  }

  async close(): Promise<void> {
    this.playIntent = false;
    this.stopClock();
    this.generation += 1;
    this.requested.clear();
    this.ready.clear();
    this.scheduler.reset();
    await cancelPending().catch(() => undefined);
    await this.scheduler.close().catch(() => undefined);
    void releaseWakeLock();
    clearMediaSession();
    if (this.artworkUrl) {
      URL.revokeObjectURL(this.artworkUrl);
      this.artworkUrl = null;
    }
    this.book = null;
    this.flat = [];
    this.prefixDurations = [];
    this.total = 0;
    this.currentIndex = 0;
    this.nextScheduleIndex = 0;
    this.requestCursor = 0;
    this.pendingOffset = null;
    this.contentDuration = 0;
    this.rate = 1;
    this.preroll = INITIAL_PREROLL_SECONDS;
    this.status = 'idle';
    this.modelProgress = null;
    this.error = null;
    this.snapshot = EMPTY_SNAPSHOT;
    this.emit();
  }

  private indexOf(progress: ReadingProgress): number {
    const byId = this.flat.findIndex((entry) => entry.sentence.id === progress.sentenceId);
    if (byId !== -1) return byId;
    const byChapter = this.flat.findIndex(
      (entry) => entry.chapterIndex === progress.chapterIndex,
    );
    return byChapter === -1 ? 0 : byChapter;
  }

  private startFrom(index: number): void {
    // Playing a restored or paused session must resume inside the sentence,
    // not replay it from the start.
    const offsetSeconds = index === this.currentIndex ? this.currentContentOffset() : 0;
    this.seek(index, { keepPlaying: true, offsetSeconds });
  }

  private seek(index: number, options: { keepPlaying?: boolean; offsetSeconds?: number } = {}): void {
    if (this.total === 0) return;
    this.stopClock();
    this.scheduler.reset();
    // Freeze the clock while the new position buffers: sources scheduled
    // ahead must not start playing under the buffering UI, and a frozen
    // clock makes `bufferedSeconds()` accumulate the preroll target.
    void this.scheduler.suspend();
    this.generation += 1;
    this.requested.clear();
    this.ready.clear();
    // Drop queued work for the old position or voice so the new requests are
    // not stuck behind minutes of stale synthesis.
    void cancelPending();

    const target = Math.min(this.total - 1, Math.max(0, index));
    this.currentIndex = target;
    this.nextScheduleIndex = target;
    this.requestCursor = target;

    // Keep the intra-sentence position across seeks, speed changes and voice
    // changes. `offsetSeconds` is content time; playback runs at `rate`.
    const contentOffset = clampResumeOffset(
      options.offsetSeconds ?? 0,
      this.flat[target]?.sentence.estimatedDuration ?? 0,
    );
    this.pendingOffset =
      contentOffset > 0 ? { index: target, seconds: contentOffset / this.rate } : null;

    const shouldPlay = options.keepPlaying ?? this.playIntent;
    this.playIntent = shouldPlay;

    this.emit();
    this.saveProgress();
    this.updateMediaPosition();

    if (shouldPlay) {
      this.setStatus('buffering');
      this.pump();
      this.ensureClock();
    }
  }

  private restartTimeline(contentOffsetSeconds?: number): void {
    this.seek(this.currentIndex, {
      keepPlaying: this.playIntent,
      offsetSeconds: contentOffsetSeconds ?? this.currentContentOffset(),
    });
  }

  /** Position inside the current sentence on the 1× content timeline. */
  private currentContentOffset(): number {
    const located = this.scheduler.locate();
    if (located && located.entry.index === this.currentIndex) return located.elapsed * this.rate;
    if (this.pendingOffset && this.pendingOffset.index === this.currentIndex) {
      return this.pendingOffset.seconds * this.rate;
    }
    return 0;
  }

  private pump(): void {
    if (!this.book || this.total === 0) return;

    // Guarantee forward progress even if a prefetch failed earlier.
    if (
      this.nextScheduleIndex < this.total &&
      !this.requested.has(this.nextScheduleIndex) &&
      !this.ready.has(this.nextScheduleIndex)
    ) {
      this.requestSentence(this.nextScheduleIndex);
    }

    const limit = Math.min(this.total, this.currentIndex + LOOKAHEAD_SENTENCES + 1);
    while (this.requestCursor < limit) {
      const index = this.requestCursor;
      this.requestCursor += 1;
      if (index < this.nextScheduleIndex) continue;
      if (this.requested.has(index) || this.ready.has(index)) continue;
      this.requestSentence(index);
    }
  }

  private requestSentence(index: number): void {
    const entry = this.flat[index];
    if (!entry || !this.book) return;

    this.requested.add(index);
    const generation = this.generation;
    const priority = index <= this.currentIndex + 1 ? 'foreground' : 'prefetch';

    void synthesizeSentence({
      bookId: this.book.id,
      voice: this.voice,
      sentence: entry.sentence,
      priority,
      speech: this.speech,
      cacheCapBytes: this.cacheCapBytes,
    })
      .then(async (result) => {
        if (generation !== this.generation) return;

        // Read the rate after synthesis resolves: the listener may have changed
        // speed while inference was running, and stretching is the cheap part.
        const rate = this.rate;
        let prepared = result;
        if (Math.abs(rate - 1) >= 0.001 && result.audio.length > 0) {
          const audio = await stretchAudio(result.audio, rate);
          // A seek, voice change, or another rate change may have landed while
          // the worker was stretching; drop the stale buffer.
          if (generation !== this.generation) return;
          if (Math.abs(this.rate - rate) >= 0.001) {
            // The original audio is already cached, so re-requesting is a fast
            // OPFS read followed by a stretch at the new rate.
            this.requested.delete(index);
            this.requestSentence(index);
            return;
          }
          prepared = {
            ...result,
            audio,
            duration: audio.length / result.sampleRate,
            timings: scaleTimings(result.timings, rate),
          };
        }

        this.requested.delete(index);
        if (generation !== this.generation) return;
        this.ready.set(index, prepared);
        this.drain();
      })
      .catch((error: unknown) => {
        if (generation !== this.generation) return;
        this.requested.delete(index);
        if (isJobCancelled(error)) return;
        if (index <= this.currentIndex + 1) {
          this.fail(error, 'This sentence could not be narrated.');
        }
      });
  }

  private drain(): void {
    let scheduled = false;
    while (this.ready.has(this.nextScheduleIndex)) {
      const result = this.ready.get(this.nextScheduleIndex);
      const entry = this.flat[this.nextScheduleIndex];
      if (!result || !entry) {
        this.ready.delete(this.nextScheduleIndex);
        break;
      }

      // Sentences with nothing to pronounce (punctuation-only) advance the
      // timeline without contributing audio.
      if (result.audio.length === 0) {
        this.ready.delete(this.nextScheduleIndex);
        if (this.pendingOffset?.index === this.nextScheduleIndex) this.pendingOffset = null;
        this.nextScheduleIndex += 1;
        continue;
      }

      const pending = this.pendingOffset;
      const startOffsetSeconds =
        pending && pending.index === this.nextScheduleIndex ? pending.seconds : undefined;
      const added = this.scheduler.schedule({
        sentenceId: entry.sentence.id,
        chapterIndex: entry.chapterIndex,
        index: this.nextScheduleIndex,
        audio: result.audio,
        sampleRate: result.sampleRate,
        timings: result.timings,
        ...(startOffsetSeconds ? { startOffsetSeconds } : {}),
      });
      // Keep the audio queued if the graph is not ready yet; dropping it here
      // would strand the timeline and force a second synthesis pass.
      if (!added) break;
      if (startOffsetSeconds) this.pendingOffset = null;
      this.ready.delete(this.nextScheduleIndex);
      this.nextScheduleIndex += 1;
      scheduled = true;
    }

    if (scheduled) {
      this.ensureClock();
      if (
        this.playIntent &&
        this.status === 'buffering' &&
        prerollReached(
          this.scheduler.bufferedSeconds(),
          this.preroll,
          this.nextScheduleIndex >= this.total,
        )
      ) {
        void this.startClock();
      }
    }
    this.pump();
  }

  private async startClock(): Promise<void> {
    await this.scheduler.resume();
    if (!this.playIntent) return;
    this.setStatus('playing');
    setPlaybackState('playing');
    void requestWakeLock();
    this.ensureClock();
  }

  private ensureClock(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(this.tick);
  }

  private stopClock(): void {
    if (this.rafId === null) return;
    cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  private tick = (): void => {
    this.rafId = null;
    if (!this.book || !this.playIntent) return;

    // Retry a sentence that was ready before the audio graph existed.
    if (this.ready.has(this.nextScheduleIndex)) this.drain();

    const now = this.scheduler.currentTime;
    const located = this.scheduler.locate(now);

    if (located) {
      if (located.entry.index !== this.currentIndex) {
        this.currentIndex = located.entry.index;
        this.emit();
        this.saveProgress();
        this.pump();
      }

      const elapsed = located.elapsed;
      const sentence = this.flat[this.currentIndex]?.sentence;
      if (sentence) {
        const wordIndex = wordIndexAt(located.entry.timings, elapsed);
        const frame: PlayerFrame = {
          sentenceId: sentence.id,
          sentenceIndex: this.currentIndex,
          wordIndex,
          wordProgress: wordProgressAt(located.entry.timings, elapsed),
          sentenceProgress:
            located.entry.duration > 0 ? Math.min(1, elapsed / located.entry.duration) : 0,
          // `elapsed` is already playback seconds inside the stretched buffer;
          // only the sentence start needs converting from content time.
          positionSeconds: (this.prefixDurations[this.currentIndex] ?? 0) / this.rate + elapsed,
        };
        for (const listener of this.frameListeners) listener(frame);
      }
    }

    this.updateMediaPosition();

    // A book whose remaining sentences are silent produces no scheduled audio
    // at all; finish instead of buffering forever on an empty timeline.
    if (
      this.nextScheduleIndex >= this.total &&
      this.ready.size === 0 &&
      this.scheduler.tail() === 0
    ) {
      this.finish();
      return;
    }

    const tail = this.scheduler.tail();
    if (now >= tail && tail > 0) {
      const finished = this.nextScheduleIndex >= this.total;
      if (finished && this.currentIndex >= this.total - 1) {
        this.finish();
        return;
      }
      if (this.status === 'playing') {
        this.setStatus('buffering');
        // The buffer ran dry: ask for more lead before resuming, so the next
        // stretch of playback is longer instead of stuttering per sentence.
        this.preroll = nextPreroll(this.preroll);
        void this.scheduler.suspend();
        setPlaybackState('paused');
      }
    }

    this.rafId = requestAnimationFrame(this.tick);
  };

  private finish(): void {
    this.playIntent = false;
    this.stopClock();
    this.setStatus('ended');
    setPlaybackState('none');
    void releaseWakeLock();
    void cancelPending();
    this.saveProgress();
    const duration = this.playbackDuration();
    updatePositionState(duration, duration);
  }

  private fail(error: unknown, fallback: string): void {
    this.playIntent = false;
    this.stopClock();
    this.error = error instanceof Error && error.message ? error.message : fallback;
    this.setStatus('error');
    void releaseWakeLock();
    void cancelPending();
  }

  private updateModelProgress(progress: ModelLoadProgress): void {
    this.modelProgress = progress;
    // Download progress arrives in bursts; coalesce to a single frame.
    if (this.status !== 'preparing') return;
    this.emit();
  }

  private setStatus(status: PlayerStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit();
  }

  private emit(): void {
    const entry = this.flat[this.currentIndex];
    const sentence = entry?.sentence ?? null;
    // Status changes (buffering, pause) also emit while a sentence is partly
    // played, so report the real offset instead of snapping back to the
    // sentence start in the scrubber.
    this.snapshot = {
      bookId: this.book?.id ?? null,
      status: this.status,
      chapterIndex: entry?.chapterIndex ?? 0,
      chapterTitle: entry?.chapterTitle ?? '',
      sentenceIndex: this.currentIndex,
      totalSentences: this.total,
      sentence,
      modelProgress: this.modelProgress,
      error: this.error,
      positionSeconds: this.positionSeconds(),
      durationSeconds: this.playbackDuration(),
    };
    for (const listener of this.listeners) listener();
  }

  private saveProgress(): void {
    if (!this.book) return;
    const entry = this.flat[this.currentIndex];
    if (!entry) return;
    // Offsets are stored on the 1× content timeline so the same record is
    // correct at any playback speed.
    const offset = this.currentContentOffset();

    const progress: ReadingProgress = {
      bookId: this.book.id,
      chapterIndex: entry.chapterIndex,
      sentenceId: entry.sentence.id,
      sentenceIndex: entry.sentence.sentenceIndex,
      offsetSeconds: offset,
      updatedAt: Date.now(),
    };
    void putProgress(progress).catch(() => undefined);
  }

  private updateMediaPosition(): void {
    const now = performance.now();
    if (now - this.lastPositionUpdate < 1000) return;
    this.lastPositionUpdate = now;
    // The media timeline is playback time (content / rate), so it advances at
    // 1× wall clock; the narration rate is already baked into the duration.
    updatePositionState(this.playbackDuration(), this.positionSeconds());
  }

  private playbackDuration(): number {
    return this.contentDuration / this.rate;
  }

  private positionSeconds(): number {
    const content = (this.prefixDurations[this.currentIndex] ?? 0) + this.currentContentOffset();
    return content / this.rate;
  }

  private configureMedia(book: BookDocument): void {
    configureMediaSession({
      play: () => void this.play(),
      pause: () => void this.pause(),
      next: () => this.next(),
      previous: () => this.previous(),
      seekTo: (seconds) => this.seekToSeconds(seconds),
      seekBy: (delta) => this.seekToSeconds(this.positionSeconds() + delta),
    });

    const apply = (artworkUrl?: string, artworkType?: string) => {
      updateMediaMetadata({
        title: book.metadata.title,
        author: book.metadata.author,
        album: 'Cadence',
        artworkUrl,
        artworkType,
      });
    };

    apply();

    if (!book.coverPath) return;
    void readBookCover(book.coverPath)
      .then((blob) => {
        if (!blob || this.book?.id !== book.id) return;
        this.artworkUrl = URL.createObjectURL(blob);
        apply(this.artworkUrl, blob.type);
      })
      .catch(() => undefined);
  }
}

export const playerSession = new PlayerSession();
