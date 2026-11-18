import * as Comlink from 'comlink';
import { expose } from 'comlink';
import * as ort from 'onnxruntime-web';
import { phonemize } from 'phonemizer';
import {
  buildPiperIds,
  flattenPiperAudio,
  parsePiperConfig,
  piperScales,
  type PiperConfig,
} from '@/core/tts/piper';
import { modelSegments, opfs } from '@/core/storage/opfs';
import { defaultTtsThreads } from '@/core/tts/threads';

export type FlashSpikeLoadRequest = {
  voiceKey: string;
  modelUrl: string;
  configUrl: string;
  threads?: number;
  onProgress?: (progress: {
    stage: 'config' | 'download' | 'prepare';
    progress: number;
    message: string;
  }) => void;
};

export type FlashSpikeModelInfo = {
  voiceKey: string;
  sampleRate: number;
  inputNames: string[];
  outputNames: string[];
  modelBytes: number;
  fromCache: boolean;
  downloadMs: number;
  initMs: number;
  threads: number;
};

export type FlashSpikeSynthesisRequest = {
  text: string;
  language?: string;
  lengthScale?: number;
  speakerId?: number;
};

export type FlashSpikeSynthesis = {
  audio: Float32Array;
  sampleRate: number;
  duration: number;
  wallMs: number;
  phonemes: string;
  ids: number[];
  unknown: string[];
};

const CONFIG_CACHE_VERSION = 'v1';

function modelCacheSegments(voiceKey: string, extension: string): string[] {
  // Keep Piper weights out of the transformers cache: different loaders and
  // different invalidation rules.
  return modelSegments('flash', CONFIG_CACHE_VERSION, `${voiceKey}.${extension}`);
}

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchCached(
  url: string,
  segments: string[],
  onProgress?: (received: number, total: number) => void,
): Promise<{ bytes: Uint8Array; fromCache: boolean }> {
  const existing = await opfs.file(segments);
  if (existing && existing.size > 0) {
    return { bytes: new Uint8Array(await existing.arrayBuffer()), fromCache: true };
  }

  const response = await fetch(url, { mode: 'cors' });
  if (!response.ok) {
    throw new Error(`Download failed (${response.status}) for ${url}`);
  }

  const total = Number(response.headers.get('content-length')) || 0;
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    await opfs.write(segments, bytes);
    return { bytes, fromCache: false };
  }

  const fixed = total > 0 ? new Uint8Array(total) : null;
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    if (fixed) fixed.set(value, received);
    else chunks.push(value);
    received += value.byteLength;
    onProgress?.(received, total);
  }

  const bytes = fixed ? fixed.subarray(0, received) : concatChunks(chunks, received);
  if (bytes.byteLength === 0) throw new Error(`Downloaded an empty file from ${url}`);
  await opfs.write(segments, bytes as BlobPart);
  return { bytes, fromCache: false };
}

let session: ort.InferenceSession | null = null;
let config: PiperConfig | null = null;
let modelInfo: FlashSpikeModelInfo | null = null;
let inputNames = { ids: 'input', lengths: 'input_lengths', scales: 'scales', sid: null as string | null };
let outputName = 'output';

function pickInput(names: readonly string[], patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = names.find((name) => pattern.test(name));
    if (match) return match;
  }
  return null;
}

async function load(request: FlashSpikeLoadRequest): Promise<FlashSpikeModelInfo> {
  if (session && modelInfo?.voiceKey === request.voiceKey) return modelInfo;
  await dispose();

  const isolated = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated;
  const threads =
    request.threads ??
    defaultTtsThreads(
      typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined,
      isolated,
    );
  ort.env.wasm.wasmPaths = new URL(
    `${import.meta.env.BASE_URL}wasm/`,
    self.location.href,
  ).href;
  ort.env.wasm.numThreads = isolated ? threads : 1;
  ort.env.wasm.proxy = false;

  const started = performance.now();
  request.onProgress?.({ stage: 'config', progress: 0, message: 'Loading the voice config…' });
  const configFile = await fetchCached(
    request.configUrl,
    modelCacheSegments(request.voiceKey, 'json'),
  );
  config = parsePiperConfig(JSON.parse(new TextDecoder().decode(configFile.bytes)));
  request.onProgress?.({ stage: 'config', progress: 1, message: 'Voice config ready.' });

  request.onProgress?.({
    stage: 'download',
    progress: 0,
    message: configFile.fromCache
      ? 'Loading the voice model from this device…'
      : 'Downloading the voice model…',
  });
  const modelFile = await fetchCached(
    request.modelUrl,
    modelCacheSegments(request.voiceKey, 'onnx'),
    (received, total) => {
      request.onProgress?.({
        stage: 'download',
        progress: total > 0 ? received / total : 0,
        message: total > 0 ? 'Downloading the voice model…' : 'Loading the voice model…',
      });
    },
  );
  const downloadMs = performance.now() - started;

  request.onProgress?.({ stage: 'prepare', progress: 0.9, message: 'Starting the voice…' });
  const initStarted = performance.now();
  session = await ort.InferenceSession.create(modelFile.bytes, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  const initMs = performance.now() - initStarted;

  const names = session.inputNames;
  const ids = pickInput(names, [/^input$/, /input_ids/, /^tokens$/, /^ids$/]) ?? names[0];
  const lengths =
    pickInput(names, [/input_lengths/, /^lengths$/, /^input_len$/]) ?? names[1] ?? 'input_lengths';
  const scales = pickInput(names, [/^scales$/, /noise/, /^speed$/]);
  const sid = pickInput(names, [/^sid$/, /speaker/]);
  if (!ids) throw new Error('The Piper model has no input tensor.');
  inputNames = {
    ids,
    lengths,
    scales: scales ?? 'scales',
    sid,
  };
  outputName = session.outputNames[0];

  modelInfo = {
    voiceKey: request.voiceKey,
    sampleRate: config.audio.sample_rate,
    inputNames: [...names],
    outputNames: [...session.outputNames],
    modelBytes: modelFile.bytes.byteLength,
    fromCache: modelFile.fromCache,
    downloadMs: Math.round(downloadMs),
    initMs: Math.round(initMs),
    threads: ort.env.wasm.numThreads ?? 1,
  };
  request.onProgress?.({ stage: 'prepare', progress: 1, message: 'Voice ready.' });
  return modelInfo;
}

async function synthesize(request: FlashSpikeSynthesisRequest): Promise<FlashSpikeSynthesis> {
  if (!session || !config) throw new Error('Load a Flash voice before synthesizing.');
  const language = request.language ?? config.espeak.voice;
  const parts = await phonemize(request.text, language);
  const phonemes = parts.join(' ').trim();
  if (!phonemes) throw new Error('The phonemizer returned no phonemes.');

  const { ids, unknown } = buildPiperIds(phonemes, config.phoneme_id_map);
  if (ids.length < 3) throw new Error('The phoneme sequence is empty.');

  const feeds: Record<string, ort.Tensor> = {
    [inputNames.ids]: new ort.Tensor(
      'int64',
      BigInt64Array.from(ids.map((id) => BigInt(id))),
      [1, ids.length],
    ),
    [inputNames.lengths]: new ort.Tensor(
      'int64',
      BigInt64Array.from([BigInt(ids.length)]),
      [1],
    ),
  };

  if (config.inference && inputNames.scales) {
    feeds[inputNames.scales] = new ort.Tensor(
      'float32',
      Float32Array.from(piperScales(config, request.lengthScale)),
      [3],
    );
  }
  if (inputNames.sid) {
    feeds[inputNames.sid] = new ort.Tensor(
      'int64',
      BigInt64Array.from([BigInt(request.speakerId ?? 0)]),
      [1],
    );
  }

  const started = performance.now();
  const results = await session.run(feeds);
  const wallMs = performance.now() - started;
  const output = results[outputName];
  if (!output) throw new Error(`The Piper model returned no "${outputName}" output.`);
  const audio = flattenPiperAudio(output.data as Float32Array).slice();
  const duration = audio.length / config.audio.sample_rate;

  const result: FlashSpikeSynthesis = {
    audio,
    sampleRate: config.audio.sample_rate,
    duration,
    wallMs,
    phonemes,
    ids,
    unknown,
  };
  return Comlink.transfer(result, [result.audio.buffer]);
}

async function dispose(): Promise<void> {
  const active = session;
  session = null;
  modelInfo = null;
  config = null;
  if (active) {
    await active.release().catch(() => undefined);
  }
}

const api = { load, synthesize, dispose };
export type FlashSpikeWorkerApi = typeof api;

expose(api);
