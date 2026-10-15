// Shared domain types for the novel-writing agent.
// All persisted structures are plain JSON so they can be diffed, merged, and hand-edited.

export type ID = string;

/* ------------------------------------------------------------------ */
/* Project configuration                                               */
/* ------------------------------------------------------------------ */

export type ProviderName = 'mock' | 'anthropic' | 'openai-compatible';

export interface LLMConfig {
  provider: ProviderName;
  model: string;
  temperature: number;
  /** Max completion tokens per call. */
  maxTokens: number;
  /** Base URL for openai-compatible providers (OpenAI, Ollama, vLLM, LM Studio). */
  baseUrl?: string;
  /** Env var names are resolved at provider construction time, never stored. */
  apiKeyEnv?: string;
}

export interface ScheduleConfig {
  /** Chapters written immediately when the plan starts (e.g. 30 on day 1). */
  burst: number;
  /** Chapters per day after the burst. */
  paceMin: number;
  paceMax: number;
  /** Hour of day (0-23, local time) when the daily run starts. */
  hour: number;
}

export interface ProjectConfig {
  schema: 'novel.project/1';
  name: string;
  title: string;
  author: string;
  genre: string;
  language: string;
  premise: string;
  targetChapters: number;
  wordsPerChapter: number;
  /** Point of view style, e.g. "third-limited-past". */
  pov: string;
  tense: string;
  tone: string;
  createdAt: string;
  updatedAt: string;
  llm: LLMConfig;
  schedule: ScheduleConfig;
}

/* ------------------------------------------------------------------ */
/* Bible (worldbuilding source of truth)                               */
/* ------------------------------------------------------------------ */

export type FactCategory = 'lore' | 'rule' | 'world' | 'history' | 'culture' | 'prophecy';

export interface CanonFact {
  id: string;
  category: FactCategory;
  statement: string;
  /** Chapter numbers where this fact was established, newest last. */
  establishedIn: number[];
  confidence: 'canon' | 'draft';
}

export interface Location {
  id: string;
  name: string;
  region: string;
  description: string;
}

export interface Faction {
  id: string;
  name: string;
  goals: string;
  description: string;
}

export type CharacterRole =
  | 'protagonist'
  | 'deuteragonist'
  | 'antagonist'
  | 'mentor'
  | 'ally'
  | 'foil'
  | 'supporting';

export type CharacterStatus = 'alive' | 'dead' | 'missing' | 'unknown';

export interface Character {
  id: string;
  name: string;
  aliases: string[];
  role: CharacterRole;
  status: CharacterStatus;
  age?: number;
  appearance: string;
  personality: string;
  motivation: string;
  /** Long-term character arc, written as beginning -> end. */
  arc: string;
  /** How this character speaks (diction, rhythm, verbal tics). */
  voice: string;
  secrets: string;
  firstChapter: number;
}

export interface TimelineEvent {
  id: string;
  /** In-story chronological label, e.g. "Year 412, month of Frost". */
  when: string;
  chapter: number;
  event: string;
  characterIds: ID[];
}

export interface Bible {
  schema: 'novel.bible/1';
  world: CanonFact[];
  locations: Location[];
  factions: Faction[];
  characters: Character[];
  timeline: TimelineEvent[];
  /** Free-form prose notes (genre tropes, subversion notes, inspirations). */
  notes: string[];
}

/* ------------------------------------------------------------------ */
/* Outline                                                             */
/* ------------------------------------------------------------------ */

export interface Premise {
  schema: 'novel.premise/1';
  logline: string;
  synopsis: string;
  theme: string;
  tropes: string[];
  subversions: string[];
  /** Who the reader is expected to follow and why. */
  hookPromise: string;
  targetAudience: string;
}

export interface Arc {
  id: string;
  title: string;
  fromChapter: number;
  toChapter: number;
  objective: string;
  climax: string;
  resolution: string;
}

export interface ChapterOutline {
  number: number;
  title: string;
  povCharacterId: ID;
  locationIds: ID[];
  characterIds: ID[];
  /** Canon fact ids the chapter is allowed / expected to use. */
  canonFactIds: ID[];
  summary: string;
  /** Ordered story beats, each roughly one scene. */
  beats: string[];
  targetWords: number;
}

export interface Outline {
  schema: 'novel.outline/1';
  arcs: Arc[];
  chapters: ChapterOutline[];
}

/* ------------------------------------------------------------------ */
/* Style guide                                                         */
/* ------------------------------------------------------------------ */

export interface StyleGuide {
  schema: 'novel.style/1';
  /** Prose principles in the author's own words. */
  rules: string[];
  /** Phrases / constructions the agent must never emit (AI tells, cliches). */
  banned: string[];
  /** Sample paragraphs establishing the target voice. */
  samples: string[];
}

/* ------------------------------------------------------------------ */
/* Lessons (self-learning journal)                                     */
/* ------------------------------------------------------------------ */

export type LessonCategory =
  | 'continuity'
  | 'style'
  | 'pacing'
  | 'dialogue'
  | 'worldbuilding'
  | 'structure'
  | 'user-feedback';

export interface Lesson {
  id: string;
  category: LessonCategory;
  note: string;
  /** Where it came from: "check", "review", or the user. */
  source: string;
  severity: 'warn' | 'error';
  /** How many times the same mistake has occurred. */
  hits: number;
  createdAt: string;
  lastHitAt: string;
  dismissed: boolean;
}

/* ------------------------------------------------------------------ */
/* Findings (critic output)                                            */
/* ------------------------------------------------------------------ */

export type FindingCode =
  | 'unknown-character'
  | 'unknown-location'
  | 'age-contradiction'
  | 'dead-character'
  | 'word-count'
  | 'banned-phrase'
  | 'dialogue-ratio'
  | 'pov-missing'
  | 'canon-contradiction'
  | 'repetition'
  | 'meta-language'
  | 'weak-hook';

export type Severity = 'info' | 'warn' | 'error';

export interface Finding {
  id: string;
  chapter: number;
  code: FindingCode;
  severity: Severity;
  message: string;
  excerpt: string;
  suggestion: string;
}

/* ------------------------------------------------------------------ */
/* Chapters                                                            */
/* ------------------------------------------------------------------ */

export type ChapterStatus = 'draft' | 'reviewed' | 'final';

export interface ChapterRecord {
  number: number;
  title: string;
  status: ChapterStatus;
  words: number;
  path: string;
  findingIds: ID[];
  createdBy: 'manual' | 'auto';
  createdAt: string;
  updatedAt: string;
}

export interface ChapterIndex {
  schema: 'novel.chapters/1';
  chapters: ChapterRecord[];
}

/* ------------------------------------------------------------------ */
/* Scheduler state                                                     */
/* ------------------------------------------------------------------ */

export interface DayEntry {
  date: string;
  phase: 'burst' | 'daily';
  quota: number;
  chapters: number[];
  completedAt: string;
}

export interface ScheduleState {
  schema: 'novel.schedule/1';
  status: 'idle' | 'running' | 'done' | 'failed';
  phase: 'pending' | 'burst' | 'daily' | 'complete';
  startedAt: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  totalWritten: number;
  history: DayEntry[];
  lastError: string | null;
}

export interface ProjectStats {
  chaptersWritten: number;
  targetChapters: number;
  wordsWritten: number;
  lessonsActive: number;
  lessonsTotal: number;
  findingsLastChapter: number;
  findingsFirstChapter: number;
  /** Findings per chapter, oldest first. */
  findingsTrend: number[];
}
