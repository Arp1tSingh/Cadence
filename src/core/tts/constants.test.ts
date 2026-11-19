import { describe, expect, it } from 'vitest';
import { MODEL_FILE_SIZES, engineForTier, modelPlanForTier } from './constants';

describe('modelPlanForTier', () => {
  it('keeps the balanced tier on quantized WASM', () => {
    expect(modelPlanForTier('balanced', false)).toEqual({ device: 'wasm', dtype: 'q8' });
    expect(modelPlanForTier('balanced', true)).toEqual({ device: 'wasm', dtype: 'q8' });
  });

  it('uses WebGPU full precision for quality when an adapter exists', () => {
    expect(modelPlanForTier('quality', true)).toEqual({ device: 'webgpu', dtype: 'fp32' });
  });

  it('falls back to quantized WASM without an adapter', () => {
    expect(modelPlanForTier('quality', false)).toEqual({ device: 'wasm', dtype: 'q8' });
  });

  it('routes the flash tier to Piper instead of a Kokoro plan', () => {
    expect(engineForTier('flash')).toBe('piper');
    expect(engineForTier('balanced')).toBe('kokoro');
    expect(engineForTier('quality')).toBe('kokoro');
  });

  it('documents the expected download sizes', () => {
    expect(MODEL_FILE_SIZES.q8).toBeGreaterThan(MODEL_FILE_SIZES.fp32 / 4);
    expect(MODEL_FILE_SIZES.fp32).toBeGreaterThan(MODEL_FILE_SIZES.q8 * 3);
  });
});
