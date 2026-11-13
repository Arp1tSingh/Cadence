import { describe, expect, it } from 'vitest';
import {
  buildChplAtom,
  findChplAtom,
  parseChplAtom,
  patchMoovWithChpl,
  readTopLevelBoxHeader,
} from './chpl';

const encoder = new TextEncoder();

function box(type: string, ...children: Uint8Array[]): Uint8Array {
  const size = 8 + children.reduce((total, child) => total + child.length, 0);
  const bytes = new Uint8Array(size);
  new DataView(bytes.buffer).setUint32(0, size);
  bytes.set(encoder.encode(type), 4);
  let offset = 8;
  for (const child of children) {
    bytes.set(child, offset);
    offset += child.length;
  }
  return bytes;
}

function largeBox(type: string, ...children: Uint8Array[]): Uint8Array {
  const size = 16 + children.reduce((total, child) => total + child.length, 0);
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 1);
  view.setBigUint64(8, BigInt(size));
  bytes.set(encoder.encode(type), 4);
  let offset = 16;
  for (const child of children) {
    bytes.set(child, offset);
    offset += child.length;
  }
  return bytes;
}

function fill(length: number, value: number): Uint8Array {
  return new Uint8Array(length).fill(value);
}

function findSequence(bytes: Uint8Array, text: string): number {
  const needle = encoder.encode(text);
  outer: for (let index = 0; index + needle.length <= bytes.length; index += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (bytes[index + offset] !== needle[offset]) continue outer;
    }
    return index;
  }
  return -1;
}

/** Size of one chapter entry: 8-byte start, 1-byte length, title bytes. */
function entrySize(title: string): number {
  return 9 + encoder.encode(title).length;
}

describe('buildChplAtom', () => {
  it('writes a version 1 FullBox with Nero chapter entries', () => {
    const atom = buildChplAtom([
      { title: 'Chapter 1', startSeconds: 0 },
      { title: 'Chapter 2', startSeconds: 61.5 },
    ]);
    const view = new DataView(atom.buffer);

    expect(atom.length).toBe(17 + entrySize('Chapter 1') + entrySize('Chapter 2'));
    expect(view.getUint32(0)).toBe(atom.length);
    expect(String.fromCharCode(...atom.subarray(4, 8))).toBe('chpl');
    expect(atom[8]).toBe(1); // version
    expect([atom[9], atom[10], atom[11]]).toEqual([0, 0, 0]); // flags
    expect(view.getUint32(12)).toBe(0); // reserved
    expect(atom[16]).toBe(2); // chapter count

    let offset = 17;
    expect(view.getBigUint64(offset)).toBe(0n);
    expect(atom[offset + 8]).toBe(9);
    expect(new TextDecoder().decode(atom.subarray(offset + 9, offset + 18))).toBe('Chapter 1');

    offset += entrySize('Chapter 1');
    // 61.5 s = 615,000,000 units of 100 ns.
    expect(view.getBigUint64(offset)).toBe(615_000_000n);
  });

  it('round-trips through the parser', () => {
    const chapters = [
      { title: 'Opening', startSeconds: 0 },
      { title: 'The Letter', startSeconds: 12.3456789 },
      { title: 'Epilogue', startSeconds: 3599.5 },
    ];
    expect(parseChplAtom(buildChplAtom(chapters))).toEqual(chapters);
  });

  it('caps the list at the one-byte chapter count', () => {
    const chapters = Array.from({ length: 300 }, (_, index) => ({
      title: `Chapter ${index + 1}`,
      startSeconds: index * 60,
    }));
    const atom = buildChplAtom(chapters);
    expect(atom[16]).toBe(255);
    expect(parseChplAtom(atom)).toHaveLength(255);
    expect(parseChplAtom(atom)[254].title).toBe('Chapter 255');
  });

  it('falls back to a default title when a heading is blank', () => {
    const parsed = parseChplAtom(buildChplAtom([{ title: '   ', startSeconds: 0 }]));
    expect(parsed[0].title).toBe('Chapter');
  });

  it('clamps negative start times and truncates titles to 255 UTF-8 bytes', () => {
    const euro = '€'.repeat(100); // 300 UTF-8 bytes
    const atom = buildChplAtom([{ title: euro, startSeconds: -4 }]);
    expect(new DataView(atom.buffer).getBigUint64(17)).toBe(0n);

    const parsed = parseChplAtom(atom);
    expect(parsed[0].title).toBe('€'.repeat(85));
    expect(encoder.encode(parsed[0].title)).toHaveLength(255);
  });

  it('keeps multi-byte code points intact when trimming', () => {
    const title = `${'a'.repeat(254)}€`;
    const parsed = parseChplAtom(buildChplAtom([{ title, startSeconds: 0 }]));
    expect(parsed[0].title).toBe('a'.repeat(254));
  });
});

describe('patchMoovWithChpl', () => {
  const chapter = [{ title: 'Chapter 1', startSeconds: 0 }];

  it('appends a udta box when the moov has none', () => {
    const moov = box('moov', box('mvhd', fill(8, 1)));
    const patched = patchMoovWithChpl(moov, chapter);
    const header = readTopLevelBoxHeader(patched);

    expect(header).toEqual({ type: 'moov', size: patched.length, headerSize: 8 });
    expect(patched.length).toBe(moov.length + 8 + buildChplAtom(chapter).length);

    const chpl = findChplAtom(patched);
    expect(chpl).not.toBeNull();
    expect(parseChplAtom(chpl!)).toEqual(chapter);

    // The existing mvhd child is preserved before the new udta.
    expect(String.fromCharCode(...patched.subarray(12, 16))).toBe('mvhd');
    expect(String.fromCharCode(...patched.subarray(moov.length + 4, moov.length + 8))).toBe(
      'udta',
    );
  });

  it('appends chpl inside an existing udta and updates every enclosing size', () => {
    const moov = box('moov', box('mvhd', fill(8, 1)), box('udta', box('meta', fill(4, 7))));
    const patched = patchMoovWithChpl(moov, chapter);

    expect(readTopLevelBoxHeader(patched)?.size).toBe(patched.length);
    expect(patched.length).toBe(moov.length + buildChplAtom(chapter).length);
    expect(findChplAtom(patched)).not.toBeNull();
    expect(parseChplAtom(findChplAtom(patched)!)).toEqual(chapter);

    // The existing udta child survives.
    const meta = findSequence(patched, 'meta');
    expect(meta).toBeGreaterThan(0);
    expect(new Uint8Array(patched.buffer, meta + 4, 4)).toEqual(fill(4, 7));
  });

  it('replaces an existing chpl instead of duplicating it', () => {
    const moov = box('moov', box('mvhd', fill(8, 1)));
    const first = patchMoovWithChpl(moov, chapter);
    const second = patchMoovWithChpl(first, [
      { title: 'One', startSeconds: 0 },
      { title: 'Two', startSeconds: 90 },
    ]);

    expect(second.length).toBe(
      moov.length + 8 + buildChplAtom([
        { title: 'One', startSeconds: 0 },
        { title: 'Two', startSeconds: 90 },
      ]).length,
    );
    expect(parseChplAtom(findChplAtom(second)!)).toEqual([
      { title: 'One', startSeconds: 0 },
      { title: 'Two', startSeconds: 90 },
    ]);
  });

  it('supports a moov written with a 64-bit largesize header', () => {
    const moov = largeBox('moov', box('mvhd', fill(8, 1)));
    const patched = patchMoovWithChpl(moov, chapter);
    const view = new DataView(patched.buffer);

    expect(view.getUint32(0)).toBe(1);
    expect(view.getBigUint64(8)).toBe(BigInt(patched.length));
    expect(readTopLevelBoxHeader(patched)).toEqual({
      type: 'moov',
      size: patched.length,
      headerSize: 16,
    });
    expect(parseChplAtom(findChplAtom(patched)!)).toEqual(chapter);
  });

  it('rejects a box that is not a moov', () => {
    expect(() => patchMoovWithChpl(box('mdat', fill(8, 0)), chapter)).toThrow('Expected a moov box.');
    expect(() => patchMoovWithChpl(new Uint8Array(4), chapter)).toThrow('Expected a moov box.');
  });
});

describe('readTopLevelBoxHeader', () => {
  it('reads a 32-bit size and type', () => {
    expect(readTopLevelBoxHeader(box('ftyp', fill(16, 0)))).toEqual({
      type: 'ftyp',
      size: 24,
      headerSize: 8,
    });
  });

  it('reads a 64-bit largesize header', () => {
    expect(readTopLevelBoxHeader(largeBox('mdat', fill(100, 0)))).toEqual({
      type: 'mdat',
      size: 116,
      headerSize: 16,
    });
  });

  it('treats size zero as extending to the end of the buffer', () => {
    const bytes = box('mdat', fill(32, 0));
    new DataView(bytes.buffer).setUint32(0, 0);
    expect(readTopLevelBoxHeader(bytes)).toEqual({ type: 'mdat', size: 40, headerSize: 8 });
  });

  it('rejects truncated and inconsistent boxes', () => {
    expect(readTopLevelBoxHeader(new Uint8Array(4))).toBeNull();

    const truncated = box('moov', fill(8, 0)).subarray(0, 12);
    expect(readTopLevelBoxHeader(truncated)).toBeNull();

    const oversized = box('moov', fill(8, 0));
    new DataView(oversized.buffer).setUint32(0, 4096);
    expect(readTopLevelBoxHeader(oversized)).toBeNull();
  });
});
