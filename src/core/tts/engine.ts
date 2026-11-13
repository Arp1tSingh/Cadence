import { env, Tensor } from '@huggingface/transformers';
import { KokoroTTS } from 'kokoro-js';
import { phonemize } from 'phonemizer';
import type { SentenceNode, WordTiming, WordToken } from '@/types/domain';
import type {
  ModelInfo,
  ModelLoadProgress,
  ModelTier,
  SynthesizedSentence,
  VoiceSelection,
} from '@/types/tts';
import { opfsModelCache } from './modelCache';
import {
  KOKORO_MODEL_ID,
  MAX_PHONEME_TOKENS,
  MAX_PIECE_WORDS,
  PIECE_GAP_SECONDS,
  SAMPLE_RATE,
  modelPlanForTier,
} from './constants';
import { alignWords, offsetTimings } from './timing';
import { concatPcm } from './pcm';
import {
  getVoice,
  normalizeVoiceSelection,
  phonemeLanguageFor,
  voiceKeyFor,
  voiceWeightsFor,
} from './voices';

const MODEL_BASE_URL = `https://huggingface.co/${KOKORO_MODEL_ID}/resolve/main/`;
const STYLE_ROWS = 510;
const STYLE_WIDTH = 256;

const modelCache = new Map<string, Float32Array>();

type ProgressInfo = {
  status?: string;
  file?: string;
  name?: string;
  progress?: number;
  loaded?: number;
  total?: number;
};

type VoiceVector = Float32Array;

function assetUrl(path: string): string {
  return new URL(`${import.meta.env.BASE_URL}${path}`, self.location.href).href;
}

let configured = false;

function configureEnvironment(): void {
  if (configured) return;
  configured = true;

  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = false;
  env.useFSCache = false;
  env.useCustomCache = true;
  env.customCache = opfsModelCache;

  const wasm = env.backends.onnx.wasm;
  if (wasm) {
    wasm.wasmPaths = assetUrl('wasm/');
    wasm.proxy = false;
    wasm.numThreads =
      typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated
        ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2))
        : 1;
  }
}

async function detectWebGpu(): Promise<boolean> {
  const gpu = (
    navigator as Navigator & {
      gpu?: { requestAdapter: () => Promise<unknown | null> };
    }
  ).gpu;
  if (!gpu) return false;
  try {
    return Boolean(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

async function modelFileIsCached(dtype: 'q8' | 'fp32'): Promise<boolean> {
  const suffix = dtype === 'q8' ? '_quantized' : '';
  const response = await opfsModelCache.match(`${MODEL_BASE_URL}onnx/model${suffix}.onnx`);
  return response !== undefined;
}

async function loadVoiceVector(id: string): Promise<VoiceVector> {
  const cached = modelCache.get(id);
  if (cached) return cached;

  const response = await fetch(assetUrl(`voices/${id}.bin`));
  if (!response.ok) throw new Error(`The ${id} voice could not be loaded.`);
  const vector = new Float32Array(await response.arrayBuffer());
  if (vector.length !== STYLE_ROWS * STYLE_WIDTH) {
    throw new Error(`The ${id} voice file is invalid.`);
  }
  modelCache.set(id, vector);
  return vector;
}

/**
 * Kokoro style rows are selected by phoneme length. Blending happens on the
 * 256-float row so intonation and timbre interpolate together.
 */
async function styleFor(selection: VoiceSelection, tokenCount: number): Promise<Float32Array> {
  const voice = normalizeVoiceSelection(selection);
  const row = Math.min(STYLE_ROWS - 1, Math.max(0, tokenCount - 2));
  const offset = row * STYLE_WIDTH;
  const weights = voiceWeightsFor(voice);

  if (weights.length === 1) {
    const vector = await loadVoiceVector(weights[0].id);
    return vector.slice(offset, offset + STYLE_WIDTH);
  }

  const vectors = await Promise.all(weights.map((entry) => loadVoiceVector(entry.id)));
  const style = new Float32Array(STYLE_WIDTH);
  for (let weightIndex = 0; weightIndex < weights.length; weightIndex += 1) {
    const vector = vectors[weightIndex];
    const weight = weights[weightIndex].weight;
    for (let index = 0; index < STYLE_WIDTH; index += 1) {
      style[index] += vector[offset + index] * weight;
    }
  }
  return style;
}

/**
 * Kokoro was trained on eSpeak output, including punctuation. Feeding the
 * whole span at once keeps clause rhythm intact; splitting on every comma
 * would flatten prosody and insert spaces before punctuation.
 */
export async function phonemizeForKokoro(text: string, language = 'en-us'): Promise<string> {
  const phonemes = await phonemize(text, language);
  return phonemes.join(' ').trim();
}

type LoadedEngine = {
  tts: KokoroTTS;
  device: ModelInfo['device'];
  dtype: ModelInfo['dtype'];
  tier: ModelTier;
  cacheHit: boolean;
};

let engine: LoadedEngine | null = null;
let loading: Promise<LoadedEngine> | null = null;

function aggregateProgress(
  reports: Map<string, { loaded: number; total: number }>,
): { loaded: number; total: number; progress: number } {
  let loaded = 0;
  let total = 0;
  for (const report of reports.values()) {
    loaded += report.loaded;
    total += report.total;
  }
  return {
    loaded,
    total,
    progress: total > 0 ? Math.min(0.99, loaded / total) : 0.02,
  };
}

async function loadEngine(
  tier: ModelTier,
  onProgress?: (progress: ModelLoadProgress) => void,
): Promise<LoadedEngine> {
  configureEnvironment();

  const hasWebGpu = await detectWebGpu();
  const plan = modelPlanForTier(tier, hasWebGpu);
  const cacheHit = await modelFileIsCached(plan.dtype);

  // Transformer.js reports progress per file, so raw values can jump back to
  // zero when a second file starts. Keep the ring monotonic.
  let progressFloor = cacheHit ? 0.35 : 0.01;
  const emit = (progress: ModelLoadProgress) => {
    progressFloor =
      progress.stage === 'ready'
        ? 1
        : Math.max(progressFloor, Math.min(0.99, progress.progress));
    onProgress?.({ ...progress, progress: progressFloor });
  };

  emit({
    stage: cacheHit ? 'prepare' : 'checking',
    progress: cacheHit ? 0.35 : 0.01,
    message: cacheHit ? 'Loading the narration model from this device…' : 'Checking narration voices…',
    device: plan.device,
    dtype: plan.dtype,
  });

  const reports = new Map<string, { loaded: number; total: number }>();

  const report = (info: ProgressInfo) => {
    const file = info.file ?? 'model';
    if (info.status === 'initiate' || info.status === 'download') {
      reports.set(file, { loaded: 0, total: 0 });
      emit({
        stage: cacheHit ? 'prepare' : 'download',
        progress: cacheHit ? 0.4 : aggregateProgress(reports).progress,
        message: cacheHit ? 'Starting the speech engine…' : 'Downloading the narration model…',
        device: plan.device,
        dtype: plan.dtype,
      });
      return;
    }

    if (info.status === 'progress') {
      const total = info.total ?? 0;
      const loaded = info.loaded ?? 0;
      reports.set(file, { loaded, total });
      const aggregate = aggregateProgress(reports);
      emit({
        stage: cacheHit ? 'prepare' : 'download',
        progress: cacheHit ? 0.45 : aggregate.progress,
        message: cacheHit ? 'Starting the speech engine…' : 'Downloading the narration model…',
        device: plan.device,
        dtype: plan.dtype,
        loadedBytes: aggregate.loaded,
        totalBytes: aggregate.total,
      });
      return;
    }

    if (info.status === 'ready') {
      emit({
        stage: 'prepare',
        progress: 0.9,
        message: 'Starting the speech engine…',
        device: plan.device,
        dtype: plan.dtype,
      });
    }
  };

  let tts: KokoroTTS;
  try {
    tts = await KokoroTTS.from_pretrained(KOKORO_MODEL_ID, {
      dtype: plan.dtype,
      device: plan.device,
      progress_callback: report,
    });
  } catch (error) {
    if (plan.device === 'webgpu') {
      // Adapters can exist while WebGPU inference is still unavailable; fall
      // back to the quantized WASM model rather than failing the first play.
      onProgress?.({
        stage: 'prepare',
        progress: 0.2,
        message: 'WebGPU was unavailable — switching to the compact model…',
        device: 'wasm',
        dtype: 'q8',
      });
      return loadEngine('balanced', onProgress);
    }
    throw error;
  }

  // Voice files are bundled with the app. Warm the default vector so the
  // first synthesis does not pay the fetch cost mid-sentence.
  await loadVoiceVector('af_heart').catch(() => undefined);

  emit({
    stage: 'ready',
    progress: 1,
    message: 'Narration is ready.',
    device: plan.device,
    dtype: plan.dtype,
  });

  return { tts, device: plan.device, dtype: plan.dtype, tier, cacheHit };
}

export async function ensureModel(
  tier: ModelTier,
  onProgress?: (progress: ModelLoadProgress) => void,
): Promise<ModelInfo> {
  if (engine) {
    return {
      device: engine.device,
      dtype: engine.dtype,
      tier: engine.tier,
      cacheHit: engine.cacheHit,
    };
  }

  if (!loading) {
    loading = loadEngine(tier, onProgress)
      .then((loaded) => {
        engine = loaded;
        return loaded;
      })
      .catch((error: unknown) => {
        // Allow a retry after a failed download or unsupported device.
        loading = null;
        throw error;
      });
  }

  const loaded = await loading;
  return {
    device: loaded.device,
    dtype: loaded.dtype,
    tier: loaded.tier,
    cacheHit: loaded.cacheHit,
  };
}

function requireEngine(): KokoroTTS {
  if (!engine) throw new Error('The narration model is still loading.');
  return engine.tts;
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
  tts: KokoroTTS,
  words: WordToken[],
  sentenceText: string,
  voice: VoiceSelection,
): Promise<Piece> {
  if (words.length === 0) {
    return { audio: new Float32Array(0), timings: [] };
  }

  const text = splitWords(words, sentenceText);
  const language = phonemeLanguageFor(normalizeVoiceSelection(voice).primary);
  const phonemes = await phonemizeForKokoro(text, language);
  if (!phonemes) {
    return { audio: new Float32Array(0), timings: [] };
  }

  const { input_ids } = tts.tokenizer(phonemes, { truncation: true });
  const tokens = Number(input_ids.dims.at(-1) ?? 0);

  // Kokoro's style table tops out at 510 rows. If a long phrase would be
  // truncated, split on a word boundary and keep every word's timing.
  if (tokens > MAX_PHONEME_TOKENS && words.length > 1) {
    const middle = Math.floor(words.length / 2);
    const first = await synthesizeWords(tts, words.slice(0, middle), sentenceText, voice);
    const second = await synthesizeWords(tts, words.slice(middle), sentenceText, voice);
    return mergePieces([first, second]);
  }

  const style = await styleFor(voice, tokens);
  const outputs = await tts.model({
    input_ids,
    style: new Tensor('float32', style, [1, STYLE_WIDTH]),
    speed: new Tensor('float32', [1], [1]),
  });

  const waveform = outputs.waveform.data as Float32Array;
  const audio = new Float32Array(waveform.length);
  audio.set(waveform);
  const duration = audio.length / SAMPLE_RATE;

  return { audio, timings: alignWords(words, duration) };
}

function mergePieces(pieces: Piece[]): Piece {
  const nonEmpty = pieces.filter((piece) => piece.audio.length > 0);
  if (nonEmpty.length === 0) return { audio: new Float32Array(0), timings: [] };

  const gapSamples = Math.round(PIECE_GAP_SECONDS * SAMPLE_RATE);
  const audio = concatPcm(
    nonEmpty.map((piece) => piece.audio),
    gapSamples,
  );

  const timings: WordTiming[] = [];
  let offset = 0;
  nonEmpty.forEach((piece, index) => {
    timings.push(...offsetTimings(piece.timings, offset));
    offset += piece.audio.length / SAMPLE_RATE;
    if (index < nonEmpty.length - 1) offset += PIECE_GAP_SECONDS;
  });

  return { audio, timings };
}

/**
 * Synthesizes a whole sentence by walking its existing TTS chunks. Long
 * phrases are subdivided by word count and, if necessary, token count.
 */
export async function synthesizeSentence(request: {
  sentence: SentenceNode;
  voice: VoiceSelection;
}): Promise<SynthesizedSentence> {
  const tts = requireEngine();
  const sentence = request.sentence;
  const voice = normalizeVoiceSelection(request.voice);
  const byId = new Map(sentence.words.map((word) => [word.id, word]));
  const pieces: Piece[] = [];

  for (const chunk of sentence.chunks) {
    const chunkWords = chunk.wordIds
      .map((id) => byId.get(id))
      .filter((word): word is WordToken => Boolean(word));
    if (chunkWords.length === 0) continue;

    for (let start = 0; start < chunkWords.length; start += MAX_PIECE_WORDS) {
      const group = chunkWords.slice(start, start + MAX_PIECE_WORDS);
      pieces.push(await synthesizeWords(tts, group, sentence.ttsText, voice));
    }
  }

  const merged = mergePieces(pieces);
  return {
    sentenceId: sentence.id,
    sampleRate: SAMPLE_RATE,
    duration: merged.audio.length / SAMPLE_RATE,
    audio: merged.audio,
    timings: merged.timings,
    fromCache: false,
  };
}

export function currentVoiceKey(selection: VoiceSelection): string {
  return voiceKeyFor(selection);
}

export function describeVoice(selection: VoiceSelection): string {
  return getVoice(normalizeVoiceSelection(selection).primary).name;
}
