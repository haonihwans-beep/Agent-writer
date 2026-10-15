import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import type {
  Bible,
  ChapterIndex,
  ChapterRecord,
  LLMConfig,
  Outline,
  Premise,
  ProjectConfig,
  ProjectStats,
  ScheduleState,
  ScheduleConfig,
  StyleGuide,
} from './types.ts';
import { defaultStyleGuide } from './style-default.ts';

export function slugify(text: string): string {
  return stripDiacritics(text.toLowerCase())
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function stripDiacritics(text: string): string {
  try {
    return text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  } catch {
    return text;
  }
}

/**
 * Project layout:
 *
 *   <project>/
 *     novel.json            project config
 *     style.json            style guide + banned phrases
 *     state.json            scheduler + run state
 *     bible/world.json      canon facts, locations, factions
 *     bible/characters.json
 *     bible/timeline.json
 *     bible/lessons.json    self-learning journal
 *     outline/premise.json
 *     outline/arcs.json
 *     outline/chapters.json
 *     chapters/001-slug.md + index.json
 *     exports/  publish/
 *
 * Every JSON write is atomic (tmp file + rename), so a killed scheduler
 * daemon always leaves a consistent project behind.
 */
export class Store {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  path(...parts: string[]): string {
    return join(this.dir, ...parts);
  }

  exists(): boolean {
    return existsSync(this.path('novel.json'));
  }

  /** Walk up from startDir to find a project root (dir containing novel.json). */
  static discover(startDir = process.cwd()): Store | null {
    let dir = startDir;
    for (let i = 0; i < 20; i++) {
      const s = new Store(dir);
      if (s.exists()) return s;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return null;
  }

  /* ---------------- low-level io ---------------- */

  readText(path: string): string | null {
    try {
      return readFileSync(this.abs(path), 'utf8');
    } catch {
      return null;
    }
  }

  readJSON<T>(relPath: string, fallback: T): T {
    const raw = this.readText(this.abs(relPath));
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  /** Atomic write: tmp file + rename. Accepts absolute or project-relative paths. */
  saveJSON(relPath: string, data: unknown): void {
    const abs = this.abs(relPath);
    mkdirSync(dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    renameSync(tmp, abs);
  }

  writeText(relPath: string, text: string | Buffer): void {
    const abs = this.abs(relPath);
    mkdirSync(dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp`;
    if (Buffer.isBuffer(text)) {
      writeFileSync(tmp, text);
    } else {
      writeFileSync(tmp, text, 'utf8');
    }
    renameSync(tmp, abs);
  }

  /** Resolve a project-relative path, tolerating already-absolute paths. */
  abs(relPath: string): string {
    return isAbsolute(relPath) ? relPath : this.path(relPath);
  }

  /* ---------------- project config ---------------- */

  loadConfig(): ProjectConfig {
    return this.readJSON<ProjectConfig>('novel.json', emptyConfig(this.dir));
  }

  saveConfig(config: ProjectConfig): void {
    this.saveJSON('novel.json', config);
  }

  /* ---------------- bible ---------------- */

  loadBible(): Bible {
    return this.readJSON<Bible>('bible/world.json', {
      schema: 'novel.bible/1',
      world: [],
      locations: [],
      factions: [],
      characters: [],
      timeline: [],
      notes: [],
    });
  }

  saveBible(bible: Bible): void {
    this.saveJSON('bible/world.json', bible);
  }

  /* ---------------- outline ---------------- */

  loadPremise(): Premise {
    return this.readJSON<Premise>('outline/premise.json', {
      schema: 'novel.premise/1',
      logline: '',
      synopsis: '',
      theme: '',
      tropes: [],
      subversions: [],
      hookPromise: '',
      targetAudience: '',
    });
  }

  savePremise(premise: Premise): void {
    this.saveJSON('outline/premise.json', premise);
  }

  loadOutline(): Outline {
    return this.readJSON<Outline>('outline/outline.json', { schema: 'novel.outline/1', arcs: [], chapters: [] });
  }

  saveOutline(outline: Outline): void {
    this.saveJSON('outline/outline.json', outline);
  }

  /* ---------------- style ---------------- */

  loadStyle(): StyleGuide {
    return this.readJSON<StyleGuide>('style.json', defaultStyleGuide());
  }

  saveStyle(style: StyleGuide): void {
    this.saveJSON('style.json', style);
  }

  /* ---------------- chapters ---------------- */

  loadChapterIndex(): ChapterIndex {
    return this.readJSON<ChapterIndex>('chapters/index.json', { schema: 'novel.chapters/1', chapters: [] });
  }

  saveChapterIndex(index: ChapterIndex): void {
    this.saveJSON('chapters/index.json', index);
  }

  chapterRelPath(number: number, title: string): string {
    return `chapters/${String(number).padStart(3, '0')}-${slugify(title)}.md`;
  }

  chapterPath(record: ChapterRecord): string {
    return this.path(record.path);
  }

  readChapter(record: ChapterRecord): string {
    return this.readText(this.path(record.path)) ?? '';
  }

  /** Body of chapter N (without frontmatter/heading), or null if not written. */
  readChapterBody(number: number): string | null {
    const rec = this.chapterRecord(number);
    if (!rec) return null;
    const raw = this.readChapter(rec);
    const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').replace(/^#.*\r?\n/, '');
    return body;
  }

  chapterRecord(number: number): ChapterRecord | null {
    const index = this.loadChapterIndex();
    return index.chapters.find((c) => c.number === number) ?? null;
  }

  upsertChapter(record: ChapterRecord, markdown: string): void {
    this.writeText(record.path, markdown);
    const index = this.loadChapterIndex();
    const i = index.chapters.findIndex((c) => c.number === record.number);
    if (i >= 0) index.chapters[i] = record;
    else index.chapters.push(record);
    index.chapters.sort((a, b) => a.number - b.number);
    this.saveChapterIndex(index);
  }

  /* ---------------- scheduler state ---------------- */

  loadScheduleState(): ScheduleState {
    return this.readJSON<ScheduleState>('state.json', {
      schema: 'novel.schedule/1',
      status: 'idle',
      phase: 'pending',
      startedAt: null,
      lastRunAt: null,
      nextRunAt: null,
      totalWritten: 0,
      history: [],
      lastError: null,
    });
  }

  saveScheduleState(state: ScheduleState): void {
    this.saveJSON('state.json', state);
  }

  /* ---------------- scaffolds ---------------- */

  initProject(config: ProjectConfig): void {
    mkdirSync(this.path('bible'), { recursive: true });
    mkdirSync(this.path('outline'), { recursive: true });
    mkdirSync(this.path('chapters'), { recursive: true });
    mkdirSync(this.path('exports'), { recursive: true });
    mkdirSync(this.path('publish'), { recursive: true });
    this.saveConfig(config);
    if (!existsSync(this.path('bible/world.json'))) {
      this.saveBible({
        schema: 'novel.bible/1',
        world: [],
        locations: [],
        factions: [],
        characters: [],
        timeline: [],
        notes: [],
      });
    }
    if (!existsSync(this.path('style.json'))) this.saveStyle(defaultStyleGuide());
    if (!existsSync(this.path('chapters/index.json'))) {
      this.saveChapterIndex({ schema: 'novel.chapters/1', chapters: [] });
    }
    if (!existsSync(this.path('state.json'))) this.saveScheduleState(this.loadScheduleState());
  }

  stats(): ProjectStats {
    const index = this.loadChapterIndex();
    const config = this.loadConfig();
    const lessons = this.readJSON<{ lessons: { dismissed: boolean; createdAt: string }[] }>('bible/lessons.json', { lessons: [] });
    const written = index.chapters;
    const findingsTrend = written.map((c) => c.findingIds.length);
    return {
      chaptersWritten: written.length,
      targetChapters: config.targetChapters,
      wordsWritten: written.reduce((s, c) => s + c.words, 0),
      lessonsActive: lessons.lessons.filter((l) => !l.dismissed).length,
      lessonsTotal: lessons.lessons.length,
      findingsLastChapter: findingsTrend.length > 0 ? (findingsTrend[findingsTrend.length - 1] ?? 0) : 0,
      findingsFirstChapter: findingsTrend.length > 0 ? (findingsTrend[0] ?? 0) : 0,
      findingsTrend,
    };
  }
}

function emptyConfig(name: string): ProjectConfig {
  return {
    schema: 'novel.project/1',
    name,
    title: 'Untitled',
    author: 'Agent-writer',
    genre: 'literary',
    language: 'id',
    premise: '',
    targetChapters: 30,
    wordsPerChapter: 2500,
    pov: 'third-limited-past',
    tense: 'past',
    tone: 'immersive',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    llm: defaultLLMConfig(),
    schedule: defaultSchedule(),
  };
}

export function defaultLLMConfig(): LLMConfig {
  return {
    provider: 'mock',
    model: 'mock-draft-v1',
    temperature: 0.85,
    maxTokens: 8192,
  };
}

export function defaultSchedule(): ScheduleConfig {
  return { burst: 30, paceMin: 3, paceMax: 5, hour: 9 };
}
