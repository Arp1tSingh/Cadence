import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import { parseHTML } from 'linkedom/worker';
import type { BookMetadata, ParagraphKind } from '@/types/domain';
import { buildChapter, type RawBlock } from './sentences';
import { normalizeBlockText, normalizeWhitespace } from './text';
import type { ChapterNode } from '@/types/domain';

export class EpubParseError extends Error {
  readonly code: 'drm' | 'invalid';

  constructor(code: 'drm' | 'invalid', message: string) {
    super(message);
    this.name = 'EpubParseError';
    this.code = code;
  }
}

export type EpubCover = {
  bytes: Uint8Array;
  mimeType: string;
  extension: string;
};

export type EpubParseResult = {
  metadata: BookMetadata;
  chapters: ChapterNode[];
  cover?: EpubCover;
  tocSize: number;
};

type XmlValue = unknown;

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
});

const SKIP_TAGS = new Set([
  'script',
  'style',
  'nav',
  'svg',
  'noscript',
  'template',
  'header',
  'footer',
  'aside',
  'form',
  'button',
  'input',
  'select',
]);

const CONTAINER_TAGS = new Set([
  'div',
  'section',
  'article',
  'main',
  'body',
  'figure',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
  'dl',
  'dd',
  'dt',
]);

type AnyElement = {
  tagName?: string;
  textContent?: string | null;
  children?: ArrayLike<AnyElement>;
  getAttribute?: (name: string) => string | null;
  querySelectorAll?: (selector: string) => ArrayLike<AnyElement>;
};

type AnyDocument = {
  body?: AnyElement | null;
  querySelectorAll?: (selector: string) => ArrayLike<AnyElement>;
};

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(value: XmlValue): string {
  if (value == null) return '';
  if (typeof value === 'string') return normalizeWhitespace(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return textOf(value[0]);
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record['#text'] === 'string') return normalizeWhitespace(record['#text']);
  }
  return '';
}

function joinText(value: XmlValue): string {
  return toArray(value)
    .map((item) => textOf(item))
    .filter(Boolean)
    .join(', ');
}

function attr(value: XmlValue, key: string): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const found = record[key];
  return typeof found === 'string' ? found : '';
}

function recordOf(value: XmlValue): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index >= 0 ? path.slice(0, index) : '';
}

export function resolveZipPath(baseDir: string, href: string): string {
  let decoded = href;
  try {
    decoded = decodeURIComponent(href);
  } catch {
    // Keep the original when the href has malformed escapes.
  }

  const isAbsolute = decoded.startsWith('/');
  const clean = decoded.split('#')[0].replace(/^\/+/, '');
  const base = baseDir ? `${baseDir.replace(/\/+$/, '')}/` : '';
  const combined = isAbsolute ? clean : `${base}${clean}`;
  const parts: string[] = [];

  for (const part of combined.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }

  return parts.join('/');
}

function findZipEntry(zip: JSZip, path: string) {
  const direct = zip.file(path);
  if (direct) return direct;

  try {
    const decoded = decodeURIComponent(path);
    if (decoded !== path) return zip.file(decoded);
  } catch {
    // Ignore malformed escapes.
  }

  return zip.file(path.replaceAll('%20', ' '));
}

function normalizeHtml(raw: string): string {
  return raw
    .replace(/<rt\b[^>]*>[\s\S]*?<\/rt>/gi, '')
    .replace(/<rp\b[^>]*>[\s\S]*?<\/rp>/gi, '')
    .replace(/<br\b[^>]*\/?>/gi, ' ');
}

function blockKindFor(tag: string, context: ParagraphKind): ParagraphKind {
  if (context === 'quote') return 'quote';
  if (context === 'list') return 'list';
  if (tag === 'li') return 'list';
  if (tag === 'pre') return 'pre';
  if (tag === 'figcaption') return 'caption';
  return 'paragraph';
}

function extractBlocks(document: AnyDocument): RawBlock[] {
  const blocks: RawBlock[] = [];
  const body = document.body;
  if (!body) return blocks;

  const pushText = (text: string | null | undefined, kind: ParagraphKind, level?: number) => {
    const clean = normalizeBlockText(text ?? '');
    if (clean) blocks.push({ kind, text: clean, ...(level ? { level } : {}) });
  };

  const visit = (element: AnyElement, context: ParagraphKind = 'paragraph') => {
    const children = Array.from(element.children ?? []);

    for (const child of children) {
      const tag = (child.tagName ?? '').toLowerCase();
      if (!tag || SKIP_TAGS.has(tag)) continue;

      if (/^h[1-6]$/.test(tag)) {
        pushText(child.textContent ?? '', 'heading', Number(tag[1]));
        continue;
      }

      if (tag === 'p') {
        pushText(child.textContent ?? '', blockKindFor(tag, context));
        continue;
      }

      if (tag === 'blockquote') {
        const before = blocks.length;
        visit(child, 'quote');
        if (blocks.length === before) pushText(child.textContent ?? '', 'quote');
        continue;
      }

      if (tag === 'li') {
        const directParagraphs = Array.from(child.children ?? []).filter(
          (node) => (node.tagName ?? '').toLowerCase() === 'p',
        );
        if (directParagraphs.length > 0) {
          visit(child, 'list');
        } else {
          pushText(child.textContent ?? '', 'list');
        }
        const nestedLists = Array.from(child.children ?? []).filter((node) =>
          ['ul', 'ol'].includes((node.tagName ?? '').toLowerCase()),
        );
        for (const list of nestedLists) visit(list, 'list');
        continue;
      }

      if (tag === 'pre') {
        pushText(child.textContent ?? '', 'pre');
        continue;
      }

      if (tag === 'figcaption') {
        pushText(child.textContent ?? '', 'caption');
        continue;
      }

      if (tag === 'ul' || tag === 'ol') {
        visit(child, 'list');
        continue;
      }

      if (CONTAINER_TAGS.has(tag)) {
        const hasBlockChild = Array.from(child.children ?? []).some((node) => {
          const childTag = (node.tagName ?? '').toLowerCase();
          return (
            /^h[1-6]$/.test(childTag) ||
            ['p', 'blockquote', 'li', 'pre', 'figcaption', 'ul', 'ol', 'table'].includes(childTag)
          );
        });

        if (hasBlockChild) {
          visit(child, context);
        } else {
          pushText(child.textContent ?? '', blockKindFor(tag, context));
        }
      }
    }
  };

  visit(body);

  if (blocks.length === 0) pushText(body.textContent ?? '', 'paragraph');
  return blocks;
}

type ChapterSection = {
  title: string;
  blocks: RawBlock[];
};

function chooseSplitLevel(blocks: RawBlock[]): number | null {
  const counts = new Map<number, number>();
  for (const block of blocks) {
    if (block.kind !== 'heading' || !block.level) continue;
    counts.set(block.level, (counts.get(block.level) ?? 0) + 1);
  }

  // Prefer the most important heading level that repeats: h1 chapter titles in
  // one book, h2 chapter titles in another (Gutenberg packs several per file).
  for (let level = 1; level <= 6; level += 1) {
    if ((counts.get(level) ?? 0) >= 2) return level;
  }
  return null;
}

function splitSpineItem(blocks: RawBlock[], tocTitle: string, href: string): ChapterSection[] {
  const splitLevel = chooseSplitLevel(blocks);
  const headingIndices =
    splitLevel == null
      ? []
      : blocks
          .map((block, index) =>
            block.kind === 'heading' && block.level === splitLevel ? index : -1,
          )
          .filter((index) => index >= 0);

  if (headingIndices.length < 2) {
    const firstHeading = blocks.find((block) => block.kind === 'heading');
    return [{ title: firstHeading?.text || tocTitle || '', blocks }];
  }

  const sections: ChapterSection[] = [];
  const leading = blocks.slice(0, headingIndices[0]);
  if (leading.some((block) => block.text.length > 80)) {
    const leadingHeading = leading.find((block) => block.kind === 'heading');
    sections.push({
      title: leadingHeading?.text || tocTitle || 'Opening',
      blocks: leading,
    });
  }

  headingIndices.forEach((start, index) => {
    const end = headingIndices[index + 1] ?? blocks.length;
    const sectionBlocks = blocks.slice(start, end);
    const heading = sectionBlocks.find((block) => block.kind === 'heading');
    sections.push({
      title: heading?.text || tocTitle || `Chapter ${index + 1}`,
      blocks: sectionBlocks,
    });
  });

  return sections.length > 0 ? sections : [{ title: tocTitle || href, blocks }];
}

function parseNav(html: string, navPath: string): Map<string, string> {
  const map = new Map<string, string>();
  const { document } = parseHTML(normalizeHtml(html)) as unknown as { document: AnyDocument };
  const navs = Array.from(document.querySelectorAll?.('nav') ?? []);
  const toc =
    navs.find((nav) => {
      const type = `${nav.getAttribute?.('epub:type') ?? ''} ${nav.getAttribute?.('type') ?? ''}`;
      return type.split(/\s+/).includes('toc');
    }) ?? navs[0];

  if (!toc) return map;

  const anchors = Array.from(toc.querySelectorAll?.('a[href]') ?? []);
  for (const anchor of anchors) {
    const href = anchor.getAttribute?.('href') ?? '';
    const title = normalizeWhitespace(anchor.textContent ?? '');
    if (!href || !title) continue;
    const path = resolveZipPath(dirname(navPath), href);
    if (!map.has(path)) map.set(path, title);
  }

  return map;
}

function parseNcx(xml: XmlValue, ncxPath: string): Map<string, string> {
  const map = new Map<string, string>();
  const navMap = recordOf(recordOf(xml).ncx).navMap;

  const walk = (points: XmlValue) => {
    for (const point of toArray(points)) {
      const record = recordOf(point);
      const title = textOf(recordOf(record.navLabel).text);
      const src = attr(record.content, '@_src');
      if (src && title) {
        const path = resolveZipPath(dirname(ncxPath), src);
        if (!map.has(path)) map.set(path, title);
      }
      walk(record.navPoint);
    }
  };

  walk(recordOf(navMap).navPoint);
  return map;
}

function coverExtension(mimeType: string, href: string): string {
  const byMime: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
  };
  if (byMime[mimeType]) return byMime[mimeType];

  const extension = href.split('.').pop()?.toLowerCase();
  if (extension && /^[a-z0-9]{2,5}$/.test(extension)) return extension;
  return 'bin';
}

async function detectDrm(zip: JSZip): Promise<void> {
  if (zip.file('META-INF/rights.xml')) {
    throw new EpubParseError('drm', 'This EPUB is DRM-protected. Cadence can only open DRM-free books.');
  }

  const encryption = findZipEntry(zip, 'META-INF/encryption.xml');
  if (!encryption) return;

  const text = await encryption.async('text');
  const allowed = new Set([
    'http://www.idpf.org/2008/embedding',
    'http://ns.adobe.com/pdf/enc#RC',
  ]);
  const algorithms = Array.from(text.matchAll(/Algorithm="([^"]+)"/gi), (match) => match[1]);
  if (algorithms.some((algorithm) => !allowed.has(algorithm))) {
    throw new EpubParseError('drm', 'This EPUB is DRM-protected. Cadence can only open DRM-free books.');
  }
}

export async function parseEpub(
  bytes: ArrayBuffer,
  fileName: string,
  onChapterProgress?: (chapter: number, total: number) => void,
): Promise<EpubParseResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch {
    throw new EpubParseError('invalid', 'This file is not a readable EPUB archive.');
  }

  await detectDrm(zip);

  const containerEntry = findZipEntry(zip, 'META-INF/container.xml');
  if (!containerEntry) {
    throw new EpubParseError('invalid', 'The EPUB is missing META-INF/container.xml.');
  }

  const containerXml = xmlParser.parse(await containerEntry.async('text'));
  const containerNode = recordOf(recordOf(containerXml).container);
  const rootfiles = recordOf(containerNode.rootfiles);
  const rootfile = toArray(rootfiles.rootfile)[0];
  const opfPath = attr(rootfile, '@_full-path');
  if (!opfPath) throw new EpubParseError('invalid', 'The EPUB package document could not be located.');

  const opfEntry = findZipEntry(zip, opfPath);
  if (!opfEntry) throw new EpubParseError('invalid', 'The EPUB package document is missing.');

  const opfXml = xmlParser.parse(await opfEntry.async('text'));
  const pkg = recordOf(recordOf(opfXml).package);
  const metadataNode = recordOf(pkg.metadata);
  const manifestItems = toArray(recordOf(pkg.manifest).item).map(recordOf);
  const spineItems = toArray(recordOf(pkg.spine).itemref).map(recordOf);
  const opfDir = dirname(opfPath);

  const rawTitle = textOf(metadataNode.title);
  const title = rawTitle || fileName.replace(/\.epub$/i, '') || 'Untitled book';
  const metadata: BookMetadata = {
    title,
    ...(joinText(metadataNode.creator) ? { author: joinText(metadataNode.creator) } : {}),
    ...(textOf(metadataNode.language) ? { language: textOf(metadataNode.language) } : {}),
    ...(textOf(metadataNode.publisher) ? { publisher: textOf(metadataNode.publisher) } : {}),
    ...(textOf(metadataNode.date) ? { publishedAt: textOf(metadataNode.date) } : {}),
    ...(textOf(metadataNode.description)
      ? {
          description: normalizeWhitespace(textOf(metadataNode.description).replace(/<[^>]+>/g, ' ')),
        }
      : {}),
    ...(textOf(metadataNode.identifier) ? { identifier: textOf(metadataNode.identifier) } : {}),
    ...(textOf(metadataNode.rights) ? { rights: textOf(metadataNode.rights) } : {}),
  };

  // TOC: prefer the EPUB 3 nav document, then the EPUB 2 NCX.
  const tocMap = new Map<string, string>();
  const navItem = manifestItems.find((item) =>
    attr(item, '@_properties').split(/\s+/).includes('nav'),
  );
  if (navItem) {
    const navPath = resolveZipPath(opfDir, attr(navItem, '@_href'));
    const navEntry = findZipEntry(zip, navPath);
    if (navEntry) {
      for (const [path, navTitle] of parseNav(await navEntry.async('text'), navPath)) {
        tocMap.set(path, navTitle);
      }
    }
  }

  if (tocMap.size === 0) {
    const ncxItem = manifestItems.find(
      (item) => attr(item, '@_media-type') === 'application/x-dtbncx+xml',
    );
    if (ncxItem) {
      const ncxPath = resolveZipPath(opfDir, attr(ncxItem, '@_href'));
      const ncxEntry = findZipEntry(zip, ncxPath);
      if (ncxEntry) {
        const ncxXml = xmlParser.parse(await ncxEntry.async('text'));
        for (const [path, ncxTitle] of parseNcx(ncxXml, ncxPath)) {
          tocMap.set(path, ncxTitle);
        }
      }
    }
  }

  // Cover image.
  const coverId = toArray(metadataNode.meta)
    .map(recordOf)
    .find((meta) => attr(meta, '@_name') === 'cover')
    ?.['@_content'];
  const imageItems = manifestItems.filter((item) =>
    attr(item, '@_media-type').startsWith('image/'),
  );
  const coverItem =
    imageItems.find((item) => attr(item, '@_id') === coverId) ??
    imageItems.find((item) => attr(item, '@_properties').split(/\s+/).includes('cover-image')) ??
    imageItems.find((item) => /cover/i.test(attr(item, '@_href')));

  let cover: EpubCover | undefined;
  if (coverItem) {
    const coverPath = resolveZipPath(opfDir, attr(coverItem, '@_href'));
    const coverEntry = findZipEntry(zip, coverPath);
    if (coverEntry) {
      cover = {
        bytes: await coverEntry.async('uint8array'),
        mimeType: attr(coverItem, '@_media-type') || 'application/octet-stream',
        extension: coverExtension(attr(coverItem, '@_media-type'), coverPath),
      };
    }
  }

  const spine = spineItems
    .filter((itemref) => attr(itemref, '@_linear') !== 'no')
    .map((itemref) => manifestItems.find((item) => attr(item, '@_id') === attr(itemref, '@_idref')))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .filter((item) => {
      const mediaType = attr(item, '@_media-type');
      return mediaType === 'application/xhtml+xml' || mediaType === 'text/html';
    });

  const chapters: ChapterNode[] = [];
  const total = spine.length;

  for (const item of spine) {
    const href = attr(item, '@_href');
    const path = resolveZipPath(opfDir, href);
    const entry = findZipEntry(zip, path);
    if (!entry) continue;

    const html = await entry.async('text');
    const { document } = parseHTML(normalizeHtml(html)) as unknown as { document: AnyDocument };
    const blocks = extractBlocks(document);
    if (blocks.length === 0) {
      onChapterProgress?.(chapters.length + 1, total);
      continue;
    }

    const tocTitle = tocMap.get(path) ?? tocMap.get(resolveZipPath(opfDir, href.split('#')[0])) ?? '';
    const sections = splitSpineItem(blocks, tocTitle, path);

    for (const section of sections) {
      const chapter = buildChapter({
        index: chapters.length,
        title: section.title,
        href: path,
        blocks: section.blocks,
      });
      if (chapter) chapters.push(chapter);
    }

    onChapterProgress?.(chapters.length, total);
  }

  if (chapters.length === 0) {
    throw new EpubParseError('invalid', 'No readable text was found in this EPUB.');
  }

  return { metadata, chapters, ...(cover ? { cover } : {}), tocSize: tocMap.size };
}
