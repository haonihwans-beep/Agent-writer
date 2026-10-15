import { join } from 'node:path';
import type { ChapterRecord } from './types.ts';
import type { Store } from './store.ts';
import { createZip } from './zip.ts';
import { stringifyFrontmatter } from '../util/text.ts';

export type ExportFormat = 'md' | 'txt' | 'json' | 'epub';
export type PublishTarget = 'royalroad' | 'wattpad' | 'web';

export interface ChapterText {
  record: ChapterRecord;
  body: string;
}

export function loadChapters(store: Store): ChapterText[] {
  const index = store.loadChapterIndex().chapters;
  return index
    .map((record) => ({
      record,
      body: store
        .readChapter(record)
        .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
        .replace(/^#+[^\n]*(\r?\n)+/, '')
        .trim(),
    }))
    .filter((c) => c.body.length > 0)
    .sort((a, b) => a.record.number - b.record.number);
}

function titlePage(store: Store): { heading: string; meta: string } {
  const config = store.loadConfig();
  const premise = store.loadPremise();
  const index = store.loadChapterIndex().chapters;
  const words = index.reduce((s, c) => s + c.words, 0);
  return {
    heading: `# ${config.title}`,
    meta: [
      `by ${config.author || 'Agent-writer'}`,
      `Genre: ${config.genre}`,
      `${index.length} chapters · ${words.toLocaleString()} words`,
      '',
      '## Synopsis',
      premise.synopsis || config.premise || '',
      '',
      '## Logline',
      premise.logline || '',
      '',
      '---',
      '',
    ].join('\n'),
  };
}

function chapterHeading(record: ChapterRecord): string {
  return `# Chapter ${record.number} — ${record.title}`;
}

/* ------------------------------------------------------------------ */
/* markdown                                                            */
/* ------------------------------------------------------------------ */

export function exportMarkdown(store: Store, outDir = 'exports'): string {
  const root = store.path(outDir, 'markdown');
  const { heading, meta } = titlePage(store);
  const parts = [heading, meta];
  for (const { record, body } of loadChapters(store)) {
    parts.push(chapterHeading(record));
    parts.push(body);
    store.writeText(join(root, `chapter-${String(record.number).padStart(3, '0')}.md`), stringifyFrontmatter(
      {
        chapter: String(record.number),
        title: record.title,
        words: String(record.words),
      },
      `${chapterHeading(record)}\n\n${body}\n`,
    ));
  }
  const consolidated = `${parts.join('\n\n')}\n`;
  const file = join(root, 'manuscript.md');
  store.writeText(file, consolidated);
  return file;
}

/* ------------------------------------------------------------------ */
/* plain text                                                          */
/* ------------------------------------------------------------------ */

export function exportTxt(store: Store, outDir = 'exports'): string {
  const root = store.path(outDir, 'txt');
  const config = store.loadConfig();
  const { heading, meta } = titlePage(store);
  const strip = (s: string): string =>
    s
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/`/g, '')
      .replace(/^\s*---\s*$/gm, '');
  const lines = [strip(heading).toUpperCase(), ...strip(meta).split('\n').filter((l) => l.trim() !== '' && l !== '---')];
  for (const { record, body } of loadChapters(store)) {
    lines.push('', strip(chapterHeading(record)).toUpperCase(), '', strip(body));
  }
  const file = join(root, `${config.name}.txt`);
  store.writeText(file, `${lines.join('\n')}\n`);
  return file;
}

/* ------------------------------------------------------------------ */
/* structured JSON                                                     */
/* ------------------------------------------------------------------ */

export function exportJson(store: Store, outDir = 'exports'): string {
  const config = store.loadConfig();
  const premise = store.loadPremise();
  const bible = store.loadBible();
  const outline = store.loadOutline();
  const chapters = loadChapters(store);
  const bundle = {
    schema: 'novel.bundle/1',
    exportedAt: new Date().toISOString(),
    project: {
      name: config.name,
      title: config.title,
      author: config.author,
      genre: config.genre,
      language: config.language,
      targetChapters: config.targetChapters,
      wordsPerChapter: config.wordsPerChapter,
    },
    premise,
    bible,
    arcs: outline.arcs,
    chapters: chapters.map(({ record, body }) => ({
      number: record.number,
      title: record.title,
      status: record.status,
      words: record.words,
      text: body,
    })),
  };
  const file = 'exports/bundle.json';
  store.saveJSON(file, bundle);
  return store.path(file);
}

/* ------------------------------------------------------------------ */
/* epub                                                                */
/* ------------------------------------------------------------------ */

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function textToXhtml(paragraphs: string[]): string {
  const body = paragraphs.map((p) => `<p>${escapeXml(p)}</p>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><meta charset="utf-8"/><title></title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body}
</body>
</html>
`;
}

const UUID_HEX = '0123456789abcdef';
function uuidWord(seed: number): string {
  let n = seed >>> 0;
  let out = '';
  for (let i = 0; i < 8; i++) {
    out = UUID_HEX[n & 0xf]! + out;
    n = Math.floor(n / 16);
  }
  return out;
}

function hashUuid(input: string): string {
  const a = (input.length * 2654435761) >>> 0;
  const b = (input.split('').reduce((s, ch) => (s * 31 + ch.charCodeAt(0)) >>> 0, 7)) >>> 0;
  return `${uuidWord(a)}-${uuidWord(b)}-4000-8000-${uuidWord(a ^ b)}${uuidWord(b >>> 16)}`;
}

export function exportEpub(store: Store, outDir = 'exports'): string {
  const config = store.loadConfig();
  const premise = store.loadPremise();
  const chapters = loadChapters(store);
  const id = `urn:uuid:${hashUuid(config.name + config.title)}`;

  const files: { name: string; data: string | Buffer; store?: boolean }[] = [];
  files.push({ name: 'mimetype', data: 'application/epub+zip', store: true });
  files.push({
    name: 'META-INF/container.xml',
    data: `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`,
  });

  const manifest: string[] = [];
  const spine: string[] = [];
  for (const [i, { record, body }] of chapters.entries()) {
    const name = `chapter-${String(i + 1).padStart(3, '0')}.xhtml`;
    const paragraphs = [`${escapeXml(record.title)}`, ...body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)];
    files.push({ name: `OEBPS/${name}`, data: textToXhtml(paragraphs) });
    manifest.push(`<item id="ch${i + 1}" href="${name}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="ch${i + 1}"/>`);
  }

  files.push({
    name: 'OEBPS/style.css',
    data: 'body { font-family: Georgia, serif; line-height: 1.55; margin: 1em; } h1 { font-size: 1.4em; } p { text-indent: 1.2em; margin: 0; } p:first-of-type { text-indent: 0; }',
  });
  files.push({
    name: 'OEBPS/nav.xhtml',
    data: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><meta charset="utf-8"/><title>Contents</title></head>
<body>
<nav epub:type="toc" id="toc"><h1>${escapeXml(config.title)}</h1><ol>
${chapters.map((c, i) => `<li><a href="chapter-${String(i + 1).padStart(3, '0')}.xhtml">${escapeXml(c.record.title)}</a></li>`).join('\n')}
</ol></nav>
</body>
</html>
`,
  });
  files.push({
    name: 'OEBPS/content.opf',
    data: `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${id}</dc:identifier>
    <dc:title>${escapeXml(config.title)}</dc:title>
    <dc:creator>${escapeXml(config.author || 'Agent-writer')}</dc:creator>
    <dc:language>${escapeXml(config.language)}</dc:language>
    <dc:description>${escapeXml(premise.logline || premise.synopsis || '')}</dc:description>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
${manifest.join('\n')}
  </manifest>
  <spine>
${spine.join('\n')}
  </spine>
</package>
`,
  });

  const file = join(outDir, `${config.name}.epub`);
  store.writeText(file, createZip(files));
  return file;
}

/* ------------------------------------------------------------------ */
/* publish adapters                                                    */
/* ------------------------------------------------------------------ */

export function publishRoyalRoad(store: Store, outDir = 'publish'): string {
  const config = store.loadConfig();
  const premise = store.loadPremise();
  const root = store.path(outDir, 'royalroad');
  store.writeText(join(root, '000-frontmatter.md'), stringifyFrontmatter(
    { platform: 'royalroad' },
    [
      `# ${config.title}`,
      '',
      '## Synopsis',
      premise.synopsis || premise.logline || config.premise,
      '',
      '## Tags',
      [config.genre, ...premise.tropes].join(', '),
      '',
      '## Author note',
      'Thanks for reading. New chapters are produced on a schedule; each one ends with a hook.',
    ].join('\n'),
  ));
  for (const { record, body } of loadChapters(store)) {
    store.writeText(join(root, `${String(record.number).padStart(3, '0')} - ${record.title}.md`), stringifyFrontmatter({ chapter: String(record.number) }, `${record.title}\n\n${body}\n`));
  }
  return root;
}

export function publishWattpad(store: Store, outDir = 'publish'): string {
  const config = store.loadConfig();
  const premise = store.loadPremise();
  const root = store.path(outDir, 'wattpad');
  store.writeText(join(root, '000-story.md'), stringifyFrontmatter(
    { platform: 'wattpad' },
    [`# ${config.title}`, '', premise.synopsis || premise.logline || ''].join('\n'),
  ));
  for (const { record, body } of loadChapters(store)) {
    const plain = body.replace(/^#{1,6}\s+/gm, '');
    store.writeText(join(root, `${String(record.number).padStart(3, '0')} - ${record.title}.md`), stringifyFrontmatter({ chapter: String(record.number) }, `${record.title}\n\n${plain}\n`));
  }
  return root;
}

export function publishWeb(store: Store, outDir = 'publish'): string {
  const config = store.loadConfig();
  const premise = store.loadPremise();
  const root = store.path(outDir, 'web');
  const chapters = loadChapters(store);
  const html = `<!doctype html>
<html lang="${escapeXml(config.language)}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeXml(config.title)} — ${escapeXml(config.author)}</title>
<meta name="description" content="${escapeXml(premise.logline || '')}">
<style>
body { max-width: 38em; margin: 3em auto; font-family: Georgia, serif; line-height: 1.6; padding: 0 1em; }
header h1 { font-size: 2em; margin-bottom: .2em; }
.meta { color: #666; font-size: .9em; }
section { margin: 3em 0; }
h2 { border-bottom: 1px solid #ddd; padding-bottom: .3em; }
p { margin: 0 0 1em; }
</style>
</head>
<body>
<header>
<h1>${escapeXml(config.title)}</h1>
<p class="meta">by ${escapeXml(config.author || 'Agent-writer')} · ${escapeXml(config.genre)} · ${chapters.length} chapters</p>
<p>${escapeXml(premise.synopsis || premise.logline || '')}</p>
</header>
${chapters
    .map(
      (c, i) => `<section id="ch${c.record.number}">
<h2>${i + 1}. ${escapeXml(c.record.title)}</h2>
${c.body
  .split(/\n\s*\n/)
  .map((p) => `<p>${escapeXml(p.trim())}</p>`)
  .join('\n')}
</section>`,
    )
    .join('\n')}
<footer><p class="meta">Generated with agent-writer.</p></footer>
</body>
</html>
`;
  store.writeText(join(root, 'index.html'), html);
  return root;
}

export function exportAll(store: Store, formats: ExportFormat[] = ['md', 'txt', 'json', 'epub']): string[] {
  const out: string[] = [];
  for (const format of formats) {
    try {
      switch (format) {
        case 'md':
          out.push(exportMarkdown(store));
          break;
        case 'txt':
          out.push(exportTxt(store));
          break;
        case 'json':
          out.push(exportJson(store));
          break;
        case 'epub':
          out.push(exportEpub(store));
          break;
      }
    } catch (err) {
      out.push(`${format}: FAILED (${(err as Error).message})`);
    }
  }
  return out;
}

export function publishAll(store: Store, targets: PublishTarget[] = ['royalroad', 'wattpad', 'web']): string[] {
  const out: string[] = [];
  for (const target of targets) {
    switch (target) {
      case 'royalroad':
        out.push(publishRoyalRoad(store));
        break;
      case 'wattpad':
        out.push(publishWattpad(store));
        break;
      case 'web':
        out.push(publishWeb(store));
        break;
    }
  }
  return out;
}
