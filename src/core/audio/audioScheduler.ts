import { SENTENCE_GAP_SECONDS } from '@/core/tts/constants';
import type { WordTiming } from '@/types/domain';

export type AudioSchedulerOptions = {
  /** How much audio to schedule before the clock starts. */
  startDelaySeconds?: number;
  volume?: number;
};

export type ScheduledSentence = {
  sentenceId: string;
  chapterIndex: number;
  /** Global sentence index in the book, used for lookahead bookkeeping. */
  index: number;
  startAt: number;
  endAt: number;
  duration: number;
  timings: WordTiming[];
  source: AudioBufferSourceNode | null;
};

export type SentenceTimelinePosition = {
  entry: ScheduledSentence;
  /** Seconds elapsed inside the sentence, clamped to its duration. */
  elapsed: number;
};

const MIN_LEAD_SECONDS = 0.3;
const HISTORY_SECONDS = 8;

/**
 * Owns the Web Audio graph for streaming narration. Sentences are scheduled
 * sample-accurately on the AudioContext clock; the React layer only polls
 * `locate()` from requestAnimationFrame, so playback never re-renders on a
 * per-word cadence.
 */
export class AudioScheduler {
  private context: AudioContext | null = null;
  private gain: GainNode | null = null;
  private entries: ScheduledSentence[] = [];
  private readonly startDelaySeconds: number;
  private pendingVolume: number;

  constructor(options: AudioSchedulerOptions = {}) {
    this.startDelaySeconds = options.startDelaySeconds ?? 0.08;
    this.pendingVolume = options.volume ?? 1;
  }

  get audioContext(): AudioContext | null {
    return this.context;
  }

  get state(): AudioContextState | 'closed' {
    return this.context?.state ?? 'closed';
  }

  get currentTime(): number {
    return this.context?.currentTime ?? 0;
  }

  get queuedCount(): number {
    return this.entries.filter((entry) => entry.endAt > this.currentTime).length;
  }

  /** Creates the AudioContext. Must be called from a user gesture. */
  async ensureContext(): Promise<AudioContext> {
    if (this.context && this.context.state !== 'closed') {
      if (this.context.state === 'suspended') await this.context.resume();
      return this.context;
    }

    const context = new AudioContext({ latencyHint: 'playback' });
    const gain = context.createGain();
    gain.gain.value = this.pendingVolume;
    gain.connect(context.destination);

    this.context = context;
    this.gain = gain;
    return context;
  }

  setVolume(value: number): void {
    this.pendingVolume = Math.min(1, Math.max(0, value));
    if (this.gain) this.gain.gain.value = this.pendingVolume;
  }

  /**
   * Appends a sentence to the timeline. Returns its scheduled entry, or null
   * when the context is unavailable.
   */
  schedule(params: {
    sentenceId: string;
    chapterIndex: number;
    index: number;
    audio: Float32Array;
    sampleRate: number;
    timings: WordTiming[];
    /** Skip the inter-sentence breath after a seek. */
    gapSeconds?: number;
  }): ScheduledSentence | null {
    const context = this.context;
    if (!context || context.state === 'closed' || params.audio.length === 0) return null;

    if (this.entries.some((entry) => entry.sentenceId === params.sentenceId)) {
      return this.entries.find((entry) => entry.sentenceId === params.sentenceId) ?? null;
    }

    const duration = params.audio.length / params.sampleRate;
    const tail = this.tail();
    const gap = this.entries.length === 0 ? 0 : (params.gapSeconds ?? SENTENCE_GAP_SECONDS);
    const lead = Math.max(MIN_LEAD_SECONDS, this.startDelaySeconds);
    const earliest = context.currentTime + lead;
    const startAt = Math.max(earliest, tail + gap);

    const buffer = context.createBuffer(1, params.audio.length, params.sampleRate);
    buffer.copyToChannel(params.audio as Float32Array<ArrayBuffer>, 0);

    const source = context.createBufferSource();
    source.buffer = buffer;
    if (this.gain) source.connect(this.gain);

    const entry: ScheduledSentence = {
      sentenceId: params.sentenceId,
      chapterIndex: params.chapterIndex,
      index: params.index,
      startAt,
      endAt: startAt + duration,
      duration,
      timings: params.timings,
      source,
    };

    source.onended = () => {
      entry.source = null;
      this.prune();
    };

    source.start(startAt);
    this.entries.push(entry);
    this.entries.sort((a, b) => a.startAt - b.startAt);
    return entry;
  }

  /** Last scheduled clock position, including the leading start delay. */
  tail(): number {
    return this.entries.length > 0
      ? Math.max(...this.entries.map((entry) => entry.endAt))
      : 0;
  }

  /** True when audio is already queued past `time`. */
  hasAudioAfter(time: number): boolean {
    return this.entries.some((entry) => entry.endAt > time);
  }

  locate(time = this.currentTime): SentenceTimelinePosition | null {
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      const entry = this.entries[index];
      if (time < entry.startAt) continue;
      const elapsed = Math.min(entry.duration, Math.max(0, time - entry.startAt));
      return { entry, elapsed };
    }
    return null;
  }

  /** Stops every source and clears the timeline. Used by seek and unload. */
  reset(): void {
    for (const entry of this.entries) {
      if (!entry.source) continue;
      entry.source.onended = null;
      entry.source.stop();
      entry.source.disconnect();
      entry.source = null;
    }
    this.entries = [];
  }

  async suspend(): Promise<void> {
    if (this.context?.state === 'running') await this.context.suspend();
  }

  async resume(): Promise<void> {
    if (this.context?.state === 'suspended') await this.context.resume();
  }

  async close(): Promise<void> {
    this.reset();
    const context = this.context;
    this.context = null;
    this.gain = null;
    if (context && context.state !== 'closed') await context.close();
  }

  private prune(): void {
    if (this.entries.length === 0) return;
    const cutoff = this.currentTime - HISTORY_SECONDS;
    // Keep the most recent entry even if it is old: it still drives the UI
    // while the next sentence is being synthesized.
    while (this.entries.length > 1 && this.entries[0].endAt < cutoff) {
      this.entries.shift();
    }
  }
}
