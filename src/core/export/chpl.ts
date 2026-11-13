/**
 * Nero `chpl` chapter atom support for M4B files.
 *
 * Mediabunny writes standard MP4 metadata but has no notion of chapter lists,
 * so the exporter finalizes a normal MP4 (`fastStart: false`, moov at the end)
 * and then patches a `chpl` box into `moov/udta`. Because the moov is the last
 * top-level box and no offsets point into it from the media data, growing it in
 * place is safe and never requires buffering the media data.
 */

export type ChapterMarker = {
  title: string;
  /** Chapter start in seconds from the beginning of the file. */
  startSeconds: number;
};

type BoxHeader = { type: string; size: number; headerSize: number };
type BoxLocation = BoxHeader & { start: number };

const ATOM_HEADER = 8;
const LARGE_ATOM_HEADER = 16;
const FULL_BOX_HEADER = 4;
const CHPL_RESERVED = 4;
const CHPL_COUNT = 1;
const MAX_CHAPTERS = 255;
const MAX_TITLE_BYTES = 255;
const MAX_ATOM_SIZE = 0xffff_ffff;

function atomType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset + 4],
    bytes[offset + 5],
    bytes[offset + 6],
    bytes[offset + 7],
  );
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Reads the box header at `offset`, supporting both the 32-bit and 64-bit
 * (size == 1) forms. `end` bounds a size of zero, which means "to the end".
 */
function readBoxHeader(bytes: Uint8Array, offset: number, end: number): BoxHeader | null {
  if (offset + ATOM_HEADER > end) return null;
  const headerView = view(bytes);
  let size = headerView.getUint32(offset);
  let headerSize = ATOM_HEADER;

  if (size === 1) {
    if (offset + LARGE_ATOM_HEADER > end) return null;
    const large = headerView.getBigUint64(offset + 8);
    if (large > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(large);
    headerSize = LARGE_ATOM_HEADER;
  } else if (size === 0) {
    size = end - offset;
  }

  if (size < headerSize || offset + size > end) return null;
  return { type: atomType(bytes, offset), size, headerSize };
}

/** Writes a box size in whichever form the box header already uses. */
function writeBoxSize(bytes: Uint8Array, size: number): void {
  const headerView = view(bytes);
  if (headerView.getUint32(0) === 1) {
    headerView.setBigUint64(8, BigInt(size));
    return;
  }
  if (size > MAX_ATOM_SIZE) {
    throw new Error('Chapter metadata box exceeds the 32-bit size limit.');
  }
  headerView.setUint32(0, size);
}

function findAtom(
  bytes: Uint8Array,
  start: number,
  end: number,
  type: string,
): BoxLocation | null {
  let offset = start;
  while (offset + ATOM_HEADER <= end) {
    const header = readBoxHeader(bytes, offset, end);
    if (!header) return null;
    if (header.type === type) return { ...header, start: offset };
    offset += header.size;
  }
  return null;
}

/** Limits a title to 255 UTF-8 bytes without splitting a code point. */
function titleBytes(title: string): Uint8Array {
  const encoder = new TextEncoder();
  let candidate = title;
  let bytes = encoder.encode(candidate);
  if (bytes.length <= MAX_TITLE_BYTES) return bytes;

  // Trim by code point until the encoded form fits. Chapter titles are short,
  // so this loop runs at most a handful of times.
  const characters = Array.from(title);
  while (characters.length > 0 && bytes.length > MAX_TITLE_BYTES) {
    characters.pop();
    candidate = characters.join('');
    bytes = encoder.encode(candidate);
  }
  return bytes;
}

/**
 * Builds a Nero chapter list:
 * `[size]['chpl'][version=1][flags=0][reserved=0][count][(start, len, title)...]`.
 * Start times use 100-nanosecond units, as required by the atom.
 */
export function buildChplAtom(chapters: ChapterMarker[]): Uint8Array {
  const selected = chapters.slice(0, MAX_CHAPTERS).map((chapter) => ({
    title: titleBytes(chapter.title.trim() || 'Chapter'),
    start: Math.max(0, Math.round(chapter.startSeconds * 10_000_000)),
  }));

  let size = ATOM_HEADER + FULL_BOX_HEADER + CHPL_RESERVED + CHPL_COUNT;
  for (const chapter of selected) size += 8 + 1 + chapter.title.length;
  if (size > MAX_ATOM_SIZE) throw new Error('Chapter list is too large.');

  const bytes = new Uint8Array(size);
  const headerView = view(bytes);
  headerView.setUint32(0, size);
  bytes.set([0x63, 0x68, 0x70, 0x6c], 4); // 'chpl'
  bytes[8] = 1; // version 1
  bytes[9] = 0;
  bytes[10] = 0;
  bytes[11] = 0; // flags
  headerView.setUint32(12, 0); // reserved
  bytes[16] = selected.length;

  let offset = ATOM_HEADER + FULL_BOX_HEADER + CHPL_RESERVED + CHPL_COUNT;
  for (const chapter of selected) {
    headerView.setBigUint64(offset, BigInt(chapter.start));
    offset += 8;
    bytes[offset] = chapter.title.length;
    offset += 1;
    bytes.set(chapter.title, offset);
    offset += chapter.title.length;
  }
  return bytes;
}

function replaceChild(parent: Uint8Array, child: BoxLocation, replacement: Uint8Array): Uint8Array {
  const size = parent.length - child.size + replacement.length;
  const output = new Uint8Array(size);
  output.set(parent.subarray(0, child.start), 0);
  output.set(replacement, child.start);
  output.set(parent.subarray(child.start + child.size), child.start + replacement.length);
  writeBoxSize(output, size);
  return output;
}

/**
 * Inserts (or replaces) a `chpl` atom inside `moov/udta`, updating every
 * enclosing box size. Returns a new buffer; the input is not mutated.
 */
export function patchMoovWithChpl(moov: Uint8Array, chapters: ChapterMarker[]): Uint8Array {
  const header = readBoxHeader(moov, 0, moov.length);
  if (!header || header.type !== 'moov') throw new Error('Expected a moov box.');

  const chpl = buildChplAtom(chapters);
  const udta = findAtom(moov, header.headerSize, moov.length, 'udta');

  if (!udta) {
    const wrapper = new Uint8Array(ATOM_HEADER + chpl.length);
    view(wrapper).setUint32(0, wrapper.length);
    wrapper.set([0x75, 0x64, 0x74, 0x61], 4); // 'udta'
    wrapper.set(chpl, ATOM_HEADER);

    const output = new Uint8Array(moov.length + wrapper.length);
    output.set(moov, 0);
    output.set(wrapper, moov.length);
    writeBoxSize(output, output.length);
    return output;
  }

  // Re-patching a finalized file must not duplicate chapter lists.
  const existing = findAtom(moov, udta.start + udta.headerSize, udta.start + udta.size, 'chpl');
  if (existing) {
    const udtaBytes = moov.slice(udta.start, udta.start + udta.size);
    const relative: BoxLocation = {
      ...existing,
      start: existing.start - udta.start,
    };
    const patched = replaceChild(udtaBytes, relative, chpl);
    return replaceChild(moov, udta, patched);
  }

  const grown = new Uint8Array(udta.size + chpl.length);
  grown.set(moov.subarray(udta.start, udta.start + udta.size), 0);
  grown.set(chpl, udta.size);
  writeBoxSize(grown, grown.length);
  return replaceChild(moov, udta, grown);
}

/** Test/QA helper: decodes the chapter entries from a `chpl` atom. */
export function parseChplAtom(bytes: Uint8Array): ChapterMarker[] {
  if (bytes.length < 17 || atomType(bytes, 0) !== 'chpl') return [];
  const bytesView = view(bytes);
  const count = bytes[16];
  const chapters: ChapterMarker[] = [];
  let offset = 17;
  for (let index = 0; index < count; index += 1) {
    if (offset + 9 > bytes.length) break;
    const start = Number(bytesView.getBigUint64(offset)) / 10_000_000;
    offset += 8;
    const length = bytes[offset];
    offset += 1;
    if (offset + length > bytes.length) break;
    const title = new TextDecoder().decode(bytes.subarray(offset, offset + length));
    offset += length;
    chapters.push({ title, startSeconds: start });
  }
  return chapters;
}

/** Finds a `chpl` atom directly in a box or inside its `udta` child (QA helper). */
export function findChplAtom(bytes: Uint8Array): Uint8Array | null {
  const header = readBoxHeader(bytes, 0, bytes.length);
  if (!header) return null;
  const start = header.headerSize;

  const direct = findAtom(bytes, start, bytes.length, 'chpl');
  if (direct) return bytes.subarray(direct.start, direct.start + direct.size);

  const udta = findAtom(bytes, start, bytes.length, 'udta');
  if (!udta) return null;
  const nested = findAtom(bytes, udta.start + udta.headerSize, udta.start + udta.size, 'chpl');
  return nested ? bytes.subarray(nested.start, nested.start + nested.size) : null;
}

/** Reads a top-level box header by iterating 32/64-bit sizes in a file. */
export function readTopLevelBoxHeader(bytes: Uint8Array): BoxHeader | null {
  return readBoxHeader(bytes, 0, bytes.length);
}
