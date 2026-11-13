export type StretchRequest = {
  audio: Float32Array;
  /** Playback speed multiplier; the output duration is `audio.length / rate`. */
  rate: number;
};

export type StretchWorkerApi = {
  /**
   * Time-stretches a sentence without changing pitch. Runs in a worker because
   * WSOLA touches every sample and must stay off the main thread.
   */
  stretch(request: StretchRequest): Promise<Float32Array>;
};
