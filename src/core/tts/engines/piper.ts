import * as ort from 'onnxruntime-web';
import { phonemize } from 'phonemizer';
import type { SentenceNode, WordTiming, WordToken } from '@/types/domain';
import type {
  ModelInfo,
  ModelLoadProgress,
  SynthesizedSentence,
} from '@/types/tts';
import {
  MAX_PIECE_WORDS,
  PIECE_GAP_SECONDS,
  PIPER_SAMPLE_RATE,
} from '../constants';
import {
  flashConfigUrl,
  flashModelUrl,
  getFlashVoice,
  normalizeFlashVoice,
  type FlashVoiceDefinition,
} from '../flashVoices';
import { flashModelSegments, loadFlashFile } from '../flashModelCache';
import {
  buildPiperIds,
  flattenPiperAudio,
  parsePiperConfig,
  piperScales,
  type PiperConfig,
} from '../piper';
import { concatPcm } from '../pcm';
import { defaultTtsThreads, parseThreadOverride } from '../threads';
import { alignWords, offsetTimings } from '../timing';
import { devLog, realTimeFactor } from '@/lib/devLog';

type InputNames = {
  ids: string;
  lengths: string;
  scales: string | null;
  sid: string | null;
};

type LoadedPiper = {
  session: ort.InferenceSession;
  config: PiperConfig;
  voice: FlashVoiceDefinition;
  info: ModelInfo;
  inputs: InputNames;
  outputName: string;
};

let runtimeConfigured = false;
let ortThreads = 1;
let loaded: LoadedPiper | null = null;
let loading: Promise<LoadedPiper> | null = null;

function configureOrt(threads?: number): void {
  if (runtimeConfigured) return;
  runtimeConfigured = true;

  ort.env.wasm.wasmPaths = new URL(
    `${import.meta.env.BASE_URL}wasm/`,
    self.location.href,
  ).href;
  ort.env.wasm.proxy = false;

  const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
  const requested =
    threads ??
    parseThreadOverride(typeof self !== 'undefined' ? self.name : undefined) ??
    defaultTtsThreads(
      typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined,
      isolated,
    );
  // ORT cannot spawn pthreads without SharedArrayBuffer.
  ortThreads = isolated ? requested : 1;
  ort.env.wasm.numThreads = ortThreads;
}

function pickInput(
  names: readonly string[],
  patterns: readonly RegExp[],
  fallback?: string,
): string | null {
  for (const pattern of patterns) {
    const match = names.find((name) => pattern.test(name));
    if (match) return match;
  }
  return fallback && names.includes(fallback) ? fallback : null;
}

/**
 * Piper exports vary slightly between piper versions. Resolve the tensor names
 * once at load time rather than assuming a fixed schema.
 */
function resolveInputs(names: readonly string[]): InputNames {
  const ids =
    pickInput(names, [/^input$/, /input_ids/, /^tokens$/, /^ids$/, /^x$/]) ?? names[0];
  const lengths =
    pickInput(names, [/input_lengths/, /^lengths$/, /^input_len$/]) ?? names[1];
  if (!ids) throw new Error('The Flash voice has no input tensor.');
  if (!lengths) throw new Error('The Flash voice has no phoneme-length tensor.');

  return {
    ids,
    lengths,
    scales: pickInput(names, [/^scales$/, /^noise_scale$/, /^speed$/]),
    sid: pickInput(names, [/^sid$/, /speaker/]),
  };
}

function modelInfoFor(active: LoadedPiper): ModelInfo {
  return active.info;
}

export async function loadPiper(
  voiceId: string | undefined,
  onProgress?: (progress: ModelLoadProgress) => void,
  threads?: number,
): Promise<ModelInfo> {
  const requested = getFlashVoice(voiceId);

  if (loading) await loading.catch(() => undefined);
  if (loaded && loaded.voice.id === requested.id) return modelInfoFor(loaded);
  if (loaded) await disposePiper();

  configureOrt(threads);

  let progressFloor = 0.01;
  const emit = (progress: ModelLoadProgress) => {
    progressFloor =
      progress.stage === 'ready'
        ? 1
        : Math.max(progressFloor, Math.min(0.99, progress.progress));
    onProgress?.({
      ...progress,
      progress: progressFloor,
      engine: 'piper',
      // Piper always runs on the WASM backend; the badges use these fields.
      device: 'wasm',
      dtype: 'q8',
    });
  };

  loading = (async (): Promise<LoadedPiper> => {
    emit({
      stage: 'checking',
      progress: 0.01,
      message: 'Checking the Flash voice…',
    });

    const configFile = await loadFlashFile(
      flashConfigUrl(requested),
      flashModelSegments(requested.id, 'json'),
    );
    const config = parsePiperConfig(
      JSON.parse(new TextDecoder().decode(configFile.bytes)),
    );
    emit({
      stage: configFile.fromCache ? 'prepare' : 'download',
      progress: configFile.fromCache ? 0.08 : 0.04,
      message: configFile.fromCache
        ? 'Loading the Flash voice from this device…'
        : 'Downloading the Flash voice…',
    });

    const modelFile = await loadFlashFile(
      flashModelUrl(requested),
      flashModelSegments(requested.id, 'onnx'),
      (received, total) => {
        emit({
          stage: 'download',
          progress: total > 0 ? 0.05 + (received / total) * 0.75 : 0.1,
          message: 'Downloading the Flash voice…',
          loadedBytes: received,
          totalBytes: total || requested.sizeBytes,
        });
      },
    );

    emit({
      stage: 'prepare',
      progress: 0.85,
      message: 'Starting the Flash voice…',
    });

    const session = await ort.InferenceSession.create(modelFile.bytes, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });

    const inputs = resolveInputs(session.inputNames);
    const outputName = session.outputNames[0];
    if (!outputName) throw new Error('The Flash voice returned no output tensor.');

    const sampleRate = config.audio.sample_rate || PIPER_SAMPLE_RATE;
    const info: ModelInfo = {
      engine: 'piper',
      device: 'wasm',
      dtype: 'q8',
      tier: 'flash',
      sampleRate,
      cacheHit: configFile.fromCache && modelFile.fromCache,
      voiceName: requested.name,
      threads: ortThreads,
    };

    devLog('model loaded', {
      engine: 'piper',
      crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated,
      voice: requested.id,
      sampleRate,
      modelBytes: modelFile.bytes.byteLength,
      fromCache: modelFile.fromCache,
      inputs: session.inputNames,
      outputs: session.outputNames,
      threads: ortThreads,
      hardwareConcurrency: navigator.hardwareConcurrency,
      cacheHit: info.cacheHit,
    });

    emit({ stage: 'ready', progress: 1, message: 'Flash voice ready.' });

    return { session, config, voice: requested, info, inputs, outputName };
  })()
    .then((active) => {
      loaded = active;
      return active;
    })
    .catch((error: unknown) => {
      loading = null;
      throw error;
    });

  const active = await loading;
  loading = null;
  return modelInfoFor(active);
}

export async function disposePiper(): Promise<void> {
  const active = loaded;
  loaded = null;
  if (active) await active.session.release().catch(() => undefined);
}

export function isPiperLoaded(): boolean {
  return loaded !== null;
}

function requirePiper(): LoadedPiper {
  if (!loaded) throw new Error('The Flash voice is still loading.');
  return loaded;
}

function splitWords(words: WordToken[], text: string): string {
  if (words.length === 0) return text;
  return text.slice(words[0].ttsStart, words[words.length - 1].ttsEnd);
}

type Piece = {
  audio: Float32Array;
  timings: WordTiming[];
};

async function synthesizeWords(
  active: LoadedPiper,
  words: WordToken[],
  sentenceText: string,
  sampleRate: number,
): Promise<Piece> {
  if (words.length === 0) return { audio: new Float32Array(0), timings: [] };

  const text = splitWords(words, sentenceText);
  const parts = await phonemize(text, active.voice.espeak);
  const phonemes = parts.join(' ').trim();
  if (!phonemes) return { audio: new Float32Array(0), timings: [] };

  const { ids, unknown } = buildPiperIds(phonemes, active.config.phoneme_id_map);
  if (ids.length < 3) return { audio: new Float32Array(0), timings: [] };
  if (import.meta.env.DEV && unknown.length > 0) {
    console.info(`[cadence] Flash ignored ${unknown.length} unknown phoneme(s)`, unknown);
  }

  const feeds: Record<string, ort.Tensor> = {
    [active.inputs.ids]: new ort.Tensor(
      'int64',
      BigInt64Array.from(ids.map((id) => BigInt(id))),
      [1, ids.length],
    ),
    [active.inputs.lengths]: new ort.Tensor(
      'int64',
      BigInt64Array.from([BigInt(ids.length)]),
      [1],
    ),
  };
  if (active.inputs.scales) {
    feeds[active.inputs.scales] = new ort.Tensor(
      'float32',
      Float32Array.from(piperScales(active.config)),
      [3],
    );
  }
  if (active.inputs.sid) {
    feeds[active.inputs.sid] = new ort.Tensor(
      'int64',
      BigInt64Array.from([0n]),
      [1],
    );
  }

  const results = await active.session.run(feeds);
  const output = results[active.outputName];
  if (!output) throw new Error('The Flash voice returned no audio.');

  const audio = flattenPiperAudio(output.data as Float32Array).slice();
  const duration = audio.length / sampleRate;

  return {
    audio,
    timings: alignWords(
      words.map((word) => ({
        id: word.id,
        text: sentenceText.slice(word.ttsStart, word.ttsEnd),
      })),
      duration,
    ),
  };
}

function mergePieces(pieces: Piece[], sampleRate: number): Piece {
  const nonEmpty = pieces.filter((piece) => piece.audio.length > 0);
  if (nonEmpty.length === 0) return { audio: new Float32Array(0), timings: [] };

  const gapSamples = Math.round(PIECE_GAP_SECONDS * sampleRate);
  const audio = concatPcm(
    nonEmpty.map((piece) => piece.audio),
    gapSamples,
  );

  const timings: WordTiming[] = [];
  let offset = 0;
  nonEmpty.forEach((piece, index) => {
    timings.push(...offsetTimings(piece.timings, offset));
    offset += piece.audio.length / sampleRate;
    if (index < nonEmpty.length - 1) offset += PIECE_GAP_SECONDS;
  });

  return { audio, timings };
}

export async function synthesizePiperSentence(request: {
  sentence: SentenceNode;
  flashVoice?: string;
}): Promise<SynthesizedSentence> {
  const startedAt = performance.now();
  const active = requirePiper();
  const requested = getFlashVoice(request.flashVoice);
  if (loaded && active.voice.id !== requested.id) {
    throw new Error('The active Flash voice changed while a sentence was being rendered.');
  }

  const sampleRate = active.info.sampleRate;
  const sentence = request.sentence;
  const byId = new Map(sentence.words.map((word) => [word.id, word]));
  const pieces: Piece[] = [];

  for (const chunk of sentence.chunks) {
    const chunkWords = chunk.wordIds
      .map((id) => byId.get(id))
      .filter((word): word is WordToken => Boolean(word));
    if (chunkWords.length === 0) continue;

    for (let start = 0; start < chunkWords.length; start += MAX_PIECE_WORDS) {
      const group = chunkWords.slice(start, start + MAX_PIECE_WORDS);
      pieces.push(await synthesizeWords(active, group, sentence.ttsText, sampleRate));
    }
  }

  const merged = mergePieces(pieces, sampleRate);
  const duration = merged.audio.length / sampleRate;
  const wallMs = performance.now() - startedAt;

  devLog('synthesis', {
    engine: 'piper',
    voice: active.voice.id,
    sentenceId: sentence.id,
    audioSeconds: Number(duration.toFixed(2)),
    wallMs: Math.round(wallMs),
    realTimeFactor: Number(realTimeFactor(duration, wallMs).toFixed(2)),
  });

  return {
    sentenceId: sentence.id,
    sampleRate,
    duration,
    audio: merged.audio,
    timings: merged.timings,
    fromCache: false,
  };
}

export function loadedFlashVoice(): string | null {
  return loaded ? normalizeFlashVoice(loaded.voice.id) : null;
}
