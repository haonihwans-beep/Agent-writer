import type { Finding, Lesson, LessonCategory } from './types.ts';
import type { Store } from './store.ts';
import { lessonId } from '../util/ids.ts';
import { nowIso } from '../util/clock.ts';

export interface LessonStore {
  schema: 'novel.lessons/1';
  lessons: Lesson[];
}

export function loadLessons(store: Store): Lesson[] {
  return store.readJSON<LessonStore>('bible/lessons.json', { schema: 'novel.lessons/1', lessons: [] }).lessons;
}

export function saveLessons(store: Store, lessons: Lesson[]): void {
  store.saveJSON('bible/lessons.json', { schema: 'novel.lessons/1', lessons } satisfies LessonStore);
}

/** Strip numbers and quoted excerpts so the same mistake collapses to one lesson. */
export function normalizeMessage(message: string): string {
  return message
    .replace(/"[^"]{0,40}"/g, '"…"')
    .replace(/\b\d+\b/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function categoryFor(code: Finding['code']): LessonCategory {
  switch (code) {
    case 'banned-phrase':
      return 'style';
    case 'meta-language':
      return 'style';
    case 'word-count':
      return 'pacing';
    case 'weak-hook':
    case 'dialogue-ratio':
    case 'repetition':
      return 'pacing';
    case 'age-contradiction':
    case 'dead-character':
    case 'canon-contradiction':
    case 'unknown-character':
      return 'continuity';
    case 'unknown-location':
    case 'pov-missing':
      return 'worldbuilding';
    default:
      return 'continuity';
  }
}

export function lessonFor(finding: Finding, source: string): Lesson {
  const category = categoryFor(finding.code);
  const fingerprint = `${finding.code}|${normalizeMessage(finding.message)}`;
  return {
    id: lessonId(category, fingerprint),
    category,
    note: finding.suggestion ? `${finding.message} — ${finding.suggestion}` : finding.message,
    source,
    severity: finding.severity === 'error' ? 'error' : 'warn',
    hits: 1,
    createdAt: nowIso(),
    lastHitAt: nowIso(),
    dismissed: false,
  };
}

/** Record one finding; repeats raise the hit count and escalate severity. */
export function learnFromFinding(store: Store, finding: Finding, source = 'check'): Lesson {
  const candidate = lessonFor(finding, source);
  const lessons = loadLessons(store);
  const existing = lessons.find((l) => l.id === candidate.id);
  if (existing) {
    existing.hits += 1;
    existing.lastHitAt = candidate.lastHitAt;
    if (candidate.severity === 'error' && existing.severity !== 'error') existing.severity = 'error';
    saveLessons(store, lessons);
    return existing;
  }
  lessons.push(candidate);
  saveLessons(store, lessons);
  return candidate;
}

export function learnFromFindings(store: Store, findings: Finding[], source = 'check'): Lesson[] {
  const out: Lesson[] = [];
  for (const f of findings) {
    if (f.severity === 'info') continue;
    out.push(learnFromFinding(store, f, source));
  }
  return out;
}

export function addUserLesson(store: Store, note: string, category: LessonCategory = 'user-feedback'): Lesson {
  const lesson: Lesson = {
    id: lessonId(category, note),
    category,
    note,
    source: 'user',
    severity: 'warn',
    hits: 1,
    createdAt: nowIso(),
    lastHitAt: nowIso(),
    dismissed: false,
  };
  const lessons = loadLessons(store);
  const existing = lessons.find((l) => l.id === lesson.id);
  if (existing) {
    existing.hits += 1;
    existing.dismissed = false;
    existing.lastHitAt = nowIso();
    saveLessons(store, lessons);
    return existing;
  }
  lessons.push(lesson);
  saveLessons(store, lessons);
  return lesson;
}

export function dismissLesson(store: Store, id: string): boolean {
  const lessons = loadLessons(store);
  const lesson = lessons.find((l) => l.id === id);
  if (!lesson) return false;
  lesson.dismissed = true;
  saveLessons(store, lessons);
  return true;
}

/** Lessons injected into future prompts: errors first, then most repeated. */
export function activeLessons(store: Store, limit = 15): Lesson[] {
  return loadLessons(store)
    .filter((l) => !l.dismissed)
    .sort((a, b) => {
      const rank = (l: Lesson): number => (l.severity === 'error' ? 0 : 1);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      if (b.hits !== a.hits) return b.hits - a.hits;
      return b.lastHitAt.localeCompare(a.lastHitAt);
    })
    .slice(0, limit);
}

export function lessonStats(store: Store): { active: number; total: number; byCategory: Record<string, number> } {
  const lessons = loadLessons(store);
  const byCategory: Record<string, number> = {};
  for (const l of lessons) byCategory[l.category] = (byCategory[l.category] ?? 0) + 1;
  return { active: lessons.filter((l) => !l.dismissed).length, total: lessons.length, byCategory };
}
