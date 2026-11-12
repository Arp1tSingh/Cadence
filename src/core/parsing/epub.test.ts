import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { dirname, EpubParseError, parseEpub, resolveZipPath } from './epub';

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=';

async function makeEpub(): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip');
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0"?>
    <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
      <rootfiles>
        <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
      </rootfiles>
    </container>`,
  );
  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="utf-8"?>
    <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:identifier id="book-id">urn:uuid:test-book</dc:identifier>
        <dc:title>Test Book</dc:title>
        <dc:creator>Arpit Singh</dc:creator>
        <dc:language>en</dc:language>
        <meta name="cover" content="cover-image"/>
      </metadata>
      <manifest>
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
        <item id="ch1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
        <item id="ch2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
        <item id="cover-image" href="images/cover.png" media-type="image/png" properties="cover-image"/>
      </manifest>
      <spine>
        <itemref idref="ch1"/>
        <itemref idref="ch2"/>
      </spine>
    </package>`,
  );
  zip.file(
    'OEBPS/nav.xhtml',
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
      <body>
        <nav epub:type="toc">
          <ol>
            <li><a href="text/ch1.xhtml">The Glass Horizon</a></li>
            <li><a href="text/ch2.xhtml">North of the Quiet Sea</a></li>
          </ol>
        </nav>
      </body>
    </html>`,
  );
  zip.file(
    'OEBPS/text/ch1.xhtml',
    `<html><body>
      <h1>The Glass Horizon</h1>
      <p>The rain had stopped. Elena stepped onto the balcony.</p>
      <blockquote><p>“The cipher is hidden,” she whispered.</p></blockquote>
    </body></html>`,
  );
  zip.file(
    'OEBPS/text/ch2.xhtml',
    `<html><body>
      <h1>North of the Quiet Sea</h1>
      <p>Morning came slowly. The harbor bell rang twice.</p>
    </body></html>`,
  );
  zip.file('OEBPS/images/cover.png', TINY_PNG, { base64: true });
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('resolveZipPath', () => {
  it('resolves and cleans relative EPUB paths', () => {
    expect(resolveZipPath('OEBPS', 'text/ch1.xhtml#top')).toBe('OEBPS/text/ch1.xhtml');
    expect(resolveZipPath('OEBPS', '../Text/ch%201.xhtml')).toBe('Text/ch 1.xhtml');
    expect(resolveZipPath('', '/root.xhtml')).toBe('root.xhtml');
  });

  it('finds the parent directory', () => {
    expect(dirname('OEBPS/content.opf')).toBe('OEBPS');
    expect(dirname('content.opf')).toBe('');
  });
});

describe('parseEpub', () => {
  it('extracts metadata, chapters, sentences, quotes, and a cover', async () => {
    const result = await parseEpub(await makeEpub(), 'test.epub');

    expect(result.metadata.title).toBe('Test Book');
    expect(result.metadata.author).toBe('Arpit Singh');
    expect(result.metadata.language).toBe('en');
    expect(result.chapters).toHaveLength(2);

    expect(result.chapters[0].title).toBe('The Glass Horizon');
    expect(result.chapters[0].paragraphs[0].kind).toBe('heading');
    expect(result.chapters[0].paragraphs[1].sentences).toHaveLength(2);
    expect(result.chapters[0].paragraphs[2].kind).toBe('quote');
    expect(result.chapters[0].paragraphs[2].sentences[0].displayText).toContain(
      'The cipher is hidden',
    );

    expect(result.chapters[1].title).toBe('North of the Quiet Sea');
    expect(result.chapters[0].startSentenceId).toBe('ch01_p01_s01');
    expect(result.chapters[0].wordCount).toBeGreaterThan(5);

    expect(result.cover?.mimeType).toBe('image/png');
    expect(result.cover?.extension).toBe('png');
    expect(result.cover?.bytes.byteLength).toBeGreaterThan(10);
  });

  it('rejects DRM-protected EPUBs with a clear error', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip');
    zip.file('META-INF/rights.xml', '<rights/>');
    zip.file('META-INF/container.xml', '<container/>');
    const bytes = await zip.generateAsync({ type: 'arraybuffer' });

    await expect(parseEpub(bytes, 'locked.epub')).rejects.toMatchObject({
      name: 'EpubParseError',
      code: 'drm',
    });

    try {
      await parseEpub(bytes, 'locked.epub');
    } catch (error) {
      expect(error).toBeInstanceOf(EpubParseError);
    }
  });
});
