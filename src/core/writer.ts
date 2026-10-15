import type { ChapterOutline, ChapterRecord, Finding } from './types.ts';
import type { Store } from './store.ts';
import type { LLMProvider } from './llm.ts';
import { buildChapterPrompt, buildFixPrompt } from './prompts.ts';
import { checkContinuity, hasBlockingErrors, maxSeverity, reviewChapter } from './critic.ts';
import { activeLessons, learnFromFindings } from './lessons.ts';
import { wordCount, stringifyFrontmatter } from '../util/text.ts';
import { nowIso } from '../util/clock.ts';

export interface WriteOptions {
  autoFix?: boolean;
  review?: boolean;
  learn?: boolean;
  maxAttempts?: number;
  onProgress?: (message: string) => void;
}

export interface WriteChapterResult {
  record: ChapterRecord;
  text: string;
  findings: Finding[];
  attempts: number;
  newLessons: number;
  verdict: string;
}

/** Chapters that have an outline and are not yet written to disk. */
export function pendingChapters(store: Store): ChapterOutline[] {
  const outline = store.loadOutline();
  const index = store.loadChapterIndex().chapters;
  const written = new Set(index.map((c) => c.number));
  return outline.chapters.filter((c) => !written.has(c.number)).sort((a, b) => a.number - b.number);
}

function previousTail(store: Store, chapter: ChapterOutline, words = 150): string | null {
  if (chapter.number <= 1) return null;
  const prev = store.chapterRecord(chapter.number - 1);
  if (!prev) return null;
  const raw = store.readChapter(prev);
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  const paragraphs = body.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0);
  const tail = paragraphs.slice(-2).join(' ');
  if (!tail) return null;
  const parts = tail.split(/\s+/);
  if (parts.length <= words) return tail;
  return parts.slice(-words).join(' ');
}

/** Remove scaffolding an LLM sometimes adds back to prose. */
export function cleanProse(text: string): string {
  let out = text.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim();
  // drop a leading markdown heading (the manuscript builder adds its own)
  out = out.replace(/^#{1,6}\s+.*\r?\n+/, () => '');
  // drop leading "Chapter N" lines and bracketed scene labels
  const lines = out.split('\n');
  while (lines.length > 0 && /^\s*(\[.+\]|\*{0,2}chapter\s+\d+.*)$/i.test(lines[0]!.trim()) && lines[0]!.trim().length < 80) {
    lines.shift();
  }
  out = lines.join('\n');
  // strip stray separators
  out = out.replace(/^\s*(---|\*\s*\*\s*\*)\s*$/gm, '');
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  if (out.length === 0) out = 'The chapter did not produce usable prose. Rewrite this beat with concrete action and dialogue.';
  return out;
}

function buildMarkdown(record: ChapterRecord, text: string): string {
  const heading = `# Chapter ${record.number} — ${record.title}\n\n`;
  return stringifyFrontmatter(
    {
      chapter: String(record.number),
      title: record.title,
      status: record.status,
      words: String(record.words),
      findings: String(record.findingIds.length),
      created: record.createdAt,
      updated: record.updatedAt,
    },
    heading + text + '\n',
  );
}

function toMessages(prompt: { system: string; user: string }): { role: 'system' | 'user'; content: string }[] {
  return [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user },
  ];
}

export async function writeChapter(
  store: Store,
  provider: LLMProvider,
  outline: ChapterOutline,
  options: WriteOptions = {},
): Promise<WriteChapterResult> {
  const config = store.loadConfig();
  const bible = store.loadBible();
  const style = store.loadStyle();
  const lessons = activeLessons(store);
  const log = options.onProgress ?? (() => undefined);
  const maxAttempts = Math.max(1, options.maxAttempts ?? (options.autoFix === false ? 1 : 2));

  let attempts = 0;
  let text = '';
  let findings: Finding[] = [];
  let verdict = 'draft';

  while (attempts < maxAttempts) {
    attempts++;
    if (attempts === 1) {
      log(`ch${outline.number}: drafting "${outline.title}"`);
      const prompt = buildChapterPrompt({
        config,
        style,
        bible,
        chapter: outline,
        prevTail: previousTail(store, outline),
        lessons: activeLessons(store),
      });
      text = cleanProse(await provider.complete({ task: 'chapter', messages: toMessages(prompt) }));
    } else {
      log(`ch${outline.number}: rewriting to fix ${findings.filter((f) => f.severity === 'error').length} blocking issue(s)`);
      const prompt = buildFixPrompt({
        config,
        style,
        bible,
        chapter: outline,
        text,
        issues: findings
          .filter((f) => f.severity !== 'info')
          .slice(0, 12)
          .map((f) => ({ code: f.code, message: f.message, suggestion: f.suggestion, excerpt: f.excerpt })),
        lessons,
      });
      text = cleanProse(await provider.complete({ task: 'fix', messages: toMessages(prompt) }));
    }

    findings = checkContinuity({ chapter: outline, text, bible, style });

    if (options.review !== false) {
      try {
        const review = await reviewChapter(provider, config, { chapter: outline, text, bible, style, lessons });
        findings = [...findings, ...review.findings];
        verdict = review.verdict;
      } catch (err) {
        log(`ch${outline.number}: self-review skipped (${(err as Error).message})`);
      }
    }

    if (options.learn !== false) {
      learnFromFindings(store, findings, attempts === 1 ? 'check' : 'fix');
    }

    if (!hasBlockingErrors(findings) || !options.autoFix) break;
  }

  const words = wordCount(text);
  const severity = maxSeverity(findings);
  const status: ChapterRecord['status'] =
    severity === 'error' ? 'draft' : findings.length === 0 ? 'final' : 'reviewed';
  const record: ChapterRecord = {
    number: outline.number,
    title: outline.title,
    status,
    words,
    path: store.chapterRelPath(outline.number, outline.title),
    findingIds: findings.map((f) => f.id),
    createdBy: 'auto',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  store.upsertChapter(record, buildMarkdown(record, text));
  log(`ch${outline.number}: ${words} words, ${findings.length} finding(s) [${severity}] -> ${status}`);

  return { record, text, findings, attempts, newLessons: findings.filter((f) => f.severity !== 'info').length, verdict };
}

export async function writeChapters(
  store: Store,
  provider: LLMProvider,
  count: number,
  options: WriteOptions = {},
): Promise<WriteChapterResult[]> {
  const queue = pendingChapters(store).slice(0, Math.max(0, count));
  const results: WriteChapterResult[] = [];
  for (const outline of queue) {
    results.push(await writeChapter(store, provider, outline, options));
  }
  return results;
}

/** Check an existing chapter without rewriting it, learning any new findings. */
export function checkWrittenChapter(store: Store, number: number): Finding[] {
  const outline = store.loadOutline().chapters.find((c) => c.number === number);
  const record = store.chapterRecord(number);
  if (!outline || !record) throw new Error(`chapter ${number} not found`);
  const text = store
    .readChapter(record)
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
    .replace(/^#+[^\n]*(\r?\n)+/, '')
    .trimStart();
  const findings = checkContinuity({ chapter: outline, text, bible: store.loadBible(), style: store.loadStyle() });
  learnNewFindings(store, findings);
  return findings;
}

/** Persist findings that have not been recorded before. */
export function learnNewFindings(store: Store, findings: Finding[]): void {
  const known = new Set(store.loadChapterIndex().chapters.flatMap((c) => c.findingIds));
  for (const f of findings) {
    if (!known.has(f.id) && f.severity !== 'info') {
      learnFromFindings(store, [f], 'check');
      known.add(f.id);
    }
  }
}

export function projectStats(store: Store): { pending: number; written: number } {
  return { pending: pendingChapters(store).length, written: store.loadChapterIndex().chapters.length };
}
