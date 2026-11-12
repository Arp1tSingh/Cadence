import type { CoverPalette } from '@/types/domain';
import { FALLBACK_PALETTES } from './constants';

type Rgb = { r: number; g: number; b: number };
type Hsl = { h: number; s: number; l: number };

type HueBucket = {
  hueSin: number;
  hueCos: number;
  saturation: number;
  lightness: number;
  weight: number;
};

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

function hslToCss(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  return `hsl(${Math.round(hue)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}

export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Picks a deterministic curated palette for books without a usable cover. */
export function selectFallbackPalette(seed: string): [string, string, string] {
  const palette = FALLBACK_PALETTES[hashSeed(seed) % FALLBACK_PALETTES.length];
  return [...palette] as [string, string, string];
}

/**
 * Extracts the three most characteristic cover colors. Colors are bucketed by
 * hue and weighted toward saturated mid-tones, which keeps mesh gradients
 * vivid without turning near-white or near-black covers into mud.
 */
export function extractPaletteFromPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): [string, string, string] | null {
  if (width <= 0 || height <= 0) return null;

  const buckets = new Map<number, HueBucket>();
  let totalWeight = 0;

  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    if (alpha < 160) continue;

    const { h, s, l } = rgbToHsl({
      r: pixels[index],
      g: pixels[index + 1],
      b: pixels[index + 2],
    });

    if (l < 0.05 || l > 0.96) continue;

    const bucket = Math.floor(h / 30) % 12;
    const weight = 0.12 + s * s * (1 - Math.abs(l - 0.55));
    if (weight <= 0.05) continue;

    const entry = buckets.get(bucket) ?? {
      hueSin: 0,
      hueCos: 0,
      saturation: 0,
      lightness: 0,
      weight: 0,
    };
    const radians = (h * Math.PI) / 180;
    entry.hueSin += Math.sin(radians) * weight;
    entry.hueCos += Math.cos(radians) * weight;
    entry.saturation += s * weight;
    entry.lightness += l * weight;
    entry.weight += weight;
    buckets.set(bucket, entry);
    totalWeight += weight;
  }

  if (totalWeight === 0 || buckets.size === 0) return null;

  const ranked = [...buckets.entries()]
    .filter(([, bucket]) => bucket.weight >= totalWeight * 0.06)
    .sort((a, b) => b[1].weight - a[1].weight);

  if (ranked.length < 2) return null;

  const chosen: Hsl[] = [];
  for (const [, bucket] of ranked) {
    const hue = ((Math.atan2(bucket.hueSin, bucket.hueCos) * 180) / Math.PI + 360) % 360;
    const saturation = bucket.saturation / bucket.weight;
    const lightness = bucket.lightness / bucket.weight;

    const tooClose = chosen.some((color) => {
      const distance = Math.abs(((color.h + 180) % 360) - ((hue + 180) % 360));
      return distance < 24;
    });
    if (tooClose) continue;

    chosen.push({
      h: hue,
      s: clamp(saturation, 0.48, 0.88),
      l: clamp(lightness, 0.34, 0.6),
    });
    if (chosen.length === 3) break;
  }

  if (chosen.length < 3) {
    // Fill missing slots by rotating existing hues so the mesh always has three
    // distinct orbs even for nearly monochrome covers.
    const base = chosen[0] ?? { h: 8, s: 0.7, l: 0.5 };
    while (chosen.length < 3) {
      const offset = 52 * (chosen.length + 1);
      chosen.push({
        h: base.h + offset,
        s: clamp(base.s - 0.06 * chosen.length, 0.42, 0.86),
        l: clamp(base.l + (chosen.length === 1 ? 0.06 : -0.05), 0.3, 0.64),
      });
    }
  }

  return chosen.map((color) => hslToCss(color.h, color.s, color.l)) as [
    string,
    string,
    string,
  ];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Reads a cover image through OffscreenCanvas. Returns null when unavailable. */
export async function extractCoverPalette(
  bytes: Uint8Array,
  mimeType: string,
): Promise<[string, string, string] | null> {
  if (typeof createImageBitmap === 'undefined' || typeof OffscreenCanvas === 'undefined') {
    return null;
  }

  try {
    const blob = new Blob([bytes.slice()], { type: mimeType });
    const bitmap = await createImageBitmap(blob);
    const size = 48;
    const canvas = new OffscreenCanvas(size, size);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      bitmap.close();
      return null;
    }

    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const drawWidth = bitmap.width * scale;
    const drawHeight = bitmap.height * scale;
    context.drawImage(bitmap, (size - drawWidth) / 2, (size - drawHeight) / 2, drawWidth, drawHeight);
    bitmap.close();

    const { data } = context.getImageData(0, 0, size, size);
    return extractPaletteFromPixels(data, size, size);
  } catch {
    return null;
  }
}

export async function resolvePalette(
  cover: { bytes: Uint8Array; mimeType: string } | undefined,
  seed: string,
): Promise<CoverPalette> {
  if (cover) {
    const extracted = await extractCoverPalette(cover.bytes, cover.mimeType);
    if (extracted) return { colors: extracted, isFallback: false };
  }
  return { colors: selectFallbackPalette(seed), isFallback: true };
}
