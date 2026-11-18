import { createFlashSpikeWorker } from '@/core/workers/flashSpikeClient';
import type { FlashSpikeModelInfo } from '@/workers/flashSpike.worker';

const VOICE_BASE =
  'https://huggingface.co/rhasspy/piper-voices/resolve/main/';

export type FlashSpikeVoiceSource = {
  key: string;
  label: string;
  language: string;
  path: string;
  sampleRate: number;
};

export const FLASH_SPIKE_VOICES: Record<string, FlashSpikeVoiceSource> = {
  'amy-medium': {
    key: 'en_US-amy-medium',
    label: 'Amy · US English · medium',
    language: 'en-us',
    path: 'en/en_US/amy/medium/en_US-amy-medium',
    sampleRate: 22_050,
  },
  'amy-low': {
    key: 'en_US-amy-low',
    label: 'Amy · US English · low',
    language: 'en-us',
    path: 'en/en_US/amy/low/en_US-amy-low',
    sampleRate: 16_000,
  },
};

export const FLASH_SPIKE_SENTENCES = [
  {
    id: 'short',
    text: 'The lanterns were already lit when the harbor bells began to ring.',
  },
  {
    id: 'medium',
    text: 'She folded the letter twice, slipped it beneath the clock, and walked out into the rain without looking back at the house.',
  },
  {
    id: 'long',
    text: 'By the time the last cart had rattled over the bridge, the market square was empty except for a boy sweeping leaves into a crooked pile, an old woman counting coins beneath the awning, and two pigeons arguing over a crust of bread near the fountain.',
  },
] as const;

export type FlashSpikeRun = {
  wallMs: number;
  audioSeconds: number;
  /** Audio seconds produced per wall second. */
  rtf: number;
};

export type FlashSpikeRow = {
  voice: string;
  threads: number;
  sampleRate: number;
  sentenceId: string;
  characters: number;
  runs: FlashSpikeRun[];
  medianWallMs: number;
  medianRtf: number;
};

export type FlashSpikeSample = {
  voice: string;
  threads: number;
  sentenceId: string;
  text: string;
  sampleRate: number;
  duration: number;
  audio: Float32Array;
};

export type FlashSpikeResult = {
  models: FlashSpikeModelInfo[];
  rows: FlashSpikeRow[];
  summary: Array<{
    voice: string;
    threads: number;
    sampleRate: number;
    medianRtf: number;
    medianWallMs: number;
    downloadedBytes: number;
    downloadMs: number;
    initMs: number;
  }>;
  samples: FlashSpikeSample[];
  totalElapsedMs: number;
};

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Measures Piper voices at explicit thread counts. Each configuration gets a
 * fresh worker because ORT cannot resize its WASM pool in place. The first
 * synthesis is a warm-up (phonemizer + ORT kernels) and is excluded.
 */
export async function runFlashSpike(options?: {
  voices?: readonly string[];
  threads?: readonly number[];
  runs?: number;
  sentences?: readonly { id: string; text: string }[];
  collectSamples?: boolean;
  onProgress?: (message: string) => void;
}): Promise<FlashSpikeResult> {
  const voices = options?.voices ?? ['amy-medium'];
  const threadCounts = options?.threads ?? [4];
  const runs = Math.max(1, Math.floor(options?.runs ?? 3));
  const sentences = options?.sentences ?? FLASH_SPIKE_SENTENCES;
  const collectSamples = options?.collectSamples ?? true;
  const started = performance.now();

  const models: FlashSpikeModelInfo[] = [];
  const rows: FlashSpikeRow[] = [];
  const samples: FlashSpikeSample[] = [];

  for (const voiceId of voices) {
    const voice = FLASH_SPIKE_VOICES[voiceId];
    if (!voice) throw new Error(`Unknown Flash spike voice "${voiceId}".`);

    for (const threadCount of threadCounts) {
      options?.onProgress?.(
        `${voice.label} · ${threadCount} thread${threadCount === 1 ? '' : 's'}`,
      );
      const handle = createFlashSpikeWorker(threadCount);
      try {
        const model = await handle.load({
          voiceKey: voice.key,
          modelUrl: `${VOICE_BASE}${voice.path}.onnx`,
          configUrl: `${VOICE_BASE}${voice.path}.onnx.json`,
        });
        models.push(model);

        // Warm-up: first phonemization loads the espeak dictionary, and ORT
        // selects kernels on the first run. Exclude both from the numbers.
        await handle.synthesize({
          text: sentences[0].text,
          language: voice.language,
        });

        for (const sentence of sentences) {
          // ORT re-selects kernels when the input shape changes, so every
          // sentence gets its own excluded warm-up.
          await handle.synthesize({
            text: sentence.text,
            language: voice.language,
          });
          const measured: FlashSpikeRun[] = [];
          for (let run = 0; run < runs; run += 1) {
            const result = await handle.synthesize({
              text: sentence.text,
              language: voice.language,
            });
            measured.push({
              wallMs: Math.round(result.wallMs),
              audioSeconds: Number(result.duration.toFixed(3)),
              rtf: Number((result.duration / (result.wallMs / 1000)).toFixed(3)),
            });
            if (collectSamples && run === runs - 1) {
              samples.push({
                voice: voice.key,
                threads: threadCount,
                sentenceId: sentence.id,
                text: sentence.text,
                sampleRate: result.sampleRate,
                duration: result.duration,
                audio: result.audio.slice(),
              });
            }
          }
          rows.push({
            voice: voice.key,
            threads: threadCount,
            sampleRate: model.sampleRate,
            sentenceId: sentence.id,
            characters: sentence.text.length,
            runs: measured,
            medianWallMs: Math.round(median(measured.map((run) => run.wallMs))),
            medianRtf: Number(
              median(measured.map((run) => run.rtf)).toFixed(3),
            ),
          });
        }
      } finally {
        await handle.dispose().catch(() => undefined);
        handle.terminate();
      }
    }
  }

  const byConfig = new Map<string, FlashSpikeRow[]>();
  for (const row of rows) {
    const key = `${row.voice}::${row.threads}`;
    const list = byConfig.get(key) ?? [];
    list.push(row);
    byConfig.set(key, list);
  }

  const summary = [...byConfig.entries()].map(([key, configRows]) => {
    const [voice, threadText] = key.split('::');
    const model = models.find((entry) => entry.voiceKey === voice);
    return {
      voice,
      threads: Number(threadText),
      sampleRate: configRows[0]?.sampleRate ?? 0,
      medianRtf: Number(
        median(configRows.map((row) => row.medianRtf)).toFixed(3),
      ),
      medianWallMs: Math.round(
        median(configRows.map((row) => row.medianWallMs)),
      ),
      downloadedBytes: model?.modelBytes ?? 0,
      downloadMs: model?.downloadMs ?? 0,
      initMs: model?.initMs ?? 0,
    };
  });

  return {
    models,
    rows,
    summary,
    samples,
    totalElapsedMs: Math.round(performance.now() - started),
  };
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

/** 16-bit mono WAV so spike samples can be listened to outside the browser. */
export function encodeWav(audio: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + audio.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + audio.length * 2, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, audio.length * 2, true);
  let offset = 44;
  for (let index = 0; index < audio.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, audio[index]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

/** Downloads one WAV per collected sample; mostly useful from the dev console. */
export function downloadFlashSamples(result: FlashSpikeResult): number {
  let index = 0;
  for (const sample of result.samples) {
    const blob = encodeWav(sample.audio, sample.sampleRate);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `cadence-flash-${sample.voice}-${sample.threads}t-${sample.sentenceId}.wav`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    index += 1;
  }
  return index;
}
