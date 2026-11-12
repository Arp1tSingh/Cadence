import { describe, expect, it } from 'vitest';
import {
  extractPaletteFromPixels,
  hashSeed,
  selectFallbackPalette,
} from './palette';

function pixelsWithBands(colors: Array<[number, number, number]>): Uint8ClampedArray {
  const width = 48;
  const height = 48;
  const data = new Uint8ClampedArray(width * height * 4);
  const band = Math.floor(height / colors.length);

  for (let y = 0; y < height; y += 1) {
    const [r, g, b] = colors[Math.min(colors.length - 1, Math.floor(y / band))];
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      data[index] = r;
      data[index + 1] = g;
      data[index + 2] = b;
      data[index + 3] = 255;
    }
  }
  return data;
}

describe('hashSeed', () => {
  it('is deterministic and unsigned', () => {
    expect(hashSeed('The Glass Horizon')).toBe(hashSeed('The Glass Horizon'));
    expect(hashSeed('The Glass Horizon')).not.toBe(hashSeed('North of the Quiet Sea'));
    expect(hashSeed('anything')).toBeGreaterThanOrEqual(0);
  });
});

describe('selectFallbackPalette', () => {
  it('returns a stable three-color palette', () => {
    const first = selectFallbackPalette('The Glass Horizon');
    const second = selectFallbackPalette('The Glass Horizon');
    expect(first).toEqual(second);
    expect(first).toHaveLength(3);
    for (const color of first) expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('extractPaletteFromPixels', () => {
  it('picks three distinct hues from a colorful cover', () => {
    const palette = extractPaletteFromPixels(
      pixelsWithBands([
        [200, 30, 40],
        [40, 80, 200],
        [240, 190, 60],
      ]),
      48,
      48,
    );

    expect(palette).not.toBeNull();
    expect(palette).toHaveLength(3);
    for (const color of palette ?? []) {
      expect(color).toMatch(/^hsl\(\d+ \d+% \d+%\)$/);
    }
    expect(new Set(palette).size).toBe(3);
  });

  it('returns null for a flat grayscale image', () => {
    const data = pixelsWithBands([
      [128, 128, 128],
      [130, 130, 130],
      [126, 126, 126],
    ]);
    expect(extractPaletteFromPixels(data, 48, 48)).toBeNull();
  });

  it('ignores transparent pixels', () => {
    const data = new Uint8ClampedArray(48 * 48 * 4);
    expect(extractPaletteFromPixels(data, 48, 48)).toBeNull();
  });
});
