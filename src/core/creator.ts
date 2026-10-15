import type { Bible, ChapterOutline, Character, Outline, Premise, ProjectConfig } from './types.ts';
import type { LLMProvider } from './llm.ts';
import {
  buildCharactersPrompt,
  buildIdeasPrompt,
  buildOutlinePrompt,
  buildPremisePrompt,
  buildWorldPrompt,
} from './prompts.ts';
import { requestJSON, type LLMRequest } from './llm.ts';
import type { Store } from './store.ts';

/* ------------------------------------------------------------------ */
/* ideas + premise                                                     */
/* ------------------------------------------------------------------ */

export interface Idea {
  title: string;
  genre: string;
  hook: string;
  logline: string;
}

function toMessages(prompt: { system: string; user: string }): LLMRequest['messages'] {
  return [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user },
  ];
}

export async function generateIdeas(store: Store, provider: LLMProvider, opts: { count?: number; genre?: string; seed: string }): Promise<Idea[]> {
  const prompt = buildIdeasPrompt({ count: opts.count ?? 5, genre: opts.genre, seed: opts.seed });
  const result = await requestJSON<{ ideas?: Idea[] }>(provider, { task: 'ideas', messages: toMessages(prompt), seed: opts.seed });
  const ideas = (result.ideas ?? []).filter((i) => Boolean(i?.title && i?.logline));
  if (ideas.length === 0) throw new Error('idea generation returned no usable ideas');
  return ideas.map((i) => ({ title: i.title, genre: i.genre || opts.genre || 'literary', hook: i.hook ?? '', logline: i.logline }));
}

export async function buildPremise(store: Store, provider: LLMProvider, opts: { idea: string; genre: string; targetChapters: number; seed: string }): Promise<Premise> {
  const config = store.loadConfig();
  const prompt = buildPremisePrompt({ idea: opts.idea, genre: opts.genre, language: config.language, targetChapters: opts.targetChapters, seed: opts.seed });
  const res = await requestJSON<Record<string, unknown>>(provider, { task: 'premise', messages: toMessages(prompt), seed: opts.seed });
  const premise: Premise = {
    schema: 'novel.premise/1',
    logline: String(res['logline'] ?? opts.idea),
    synopsis: String(res['synopsis'] ?? opts.idea),
    theme: String(res['theme'] ?? ''),
    tropes: strArray(res['tropes']),
    subversions: strArray(res['subversions']),
    hookPromise: String(res['hookPromise'] ?? ''),
    targetAudience: String(res['targetAudience'] ?? 'serial webnovel readers'),
  };
  store.savePremise(premise);
  const title = typeof res['title'] === 'string' && res['title'].trim().length > 1 ? res['title'].trim() : config.title;
  const genre = typeof res['genre'] === 'string' && res['genre'].trim().length > 1 ? res['genre'].trim() : opts.genre;
  const updated: ProjectConfig = { ...config, title, genre, premise: premise.synopsis, targetChapters: opts.targetChapters, updatedAt: new Date().toISOString() };
  store.saveConfig(updated);
  return premise;
}

/* ------------------------------------------------------------------ */
/* bible                                                               */
/* ------------------------------------------------------------------ */

export async function buildBible(store: Store, provider: LLMProvider, opts: { premise: string; seed: string }): Promise<Bible> {
  const config = store.loadConfig();
  const premise = store.loadPremise();
  const worldPrompt = buildWorldPrompt({ premise: opts.premise || premise.synopsis, language: config.language });
  const worldRes = await requestJSON<Record<string, unknown>>(provider, { task: 'world', messages: toMessages(worldPrompt), seed: `${opts.seed}:world` });

  const worldLines = summarizeWorld(worldRes);
  const charPrompt = buildCharactersPrompt({ premise: opts.premise || premise.synopsis, worldSummary: worldLines, language: config.language });
  const charRes = await requestJSON<{ characters?: unknown[] }>(provider, { task: 'characters', messages: toMessages(charPrompt), seed: `${opts.seed}:chars` });

  const bible: Bible = {
    schema: 'novel.bible/1',
    world: toFacts(worldRes['world']),
    locations: toLocations(worldRes['locations']),
    factions: toFactions(worldRes['factions']),
    characters: toCharacters(charRes.characters ?? charRes),
    timeline: [],
    notes: [`Generated from: ${opts.premise}`],
  };
  sanitizeBible(bible);
  bible.timeline.push({
    id: 'ev_1',
    when: 'start',
    chapter: 1,
    event: premise.logline || opts.premise,
    characterIds: bible.characters.slice(0, 2).map((c) => c.id),
  });
  store.saveBible(bible);
  return bible;
}

/* ------------------------------------------------------------------ */
/* outline                                                             */
/* ------------------------------------------------------------------ */

export async function buildOutline(store: Store, provider: LLMProvider, opts: { seed: string }): Promise<Outline> {
  const config = store.loadConfig();
  const premise = store.loadPremise();
  const bible = store.loadBible();
  const prompt = buildOutlinePrompt({ config, premise: premise.synopsis || config.premise, bible, targetChapters: config.targetChapters });
  const res = await requestJSON<{ arcs?: unknown[]; chapters?: unknown[] }>(provider, { task: 'outline', messages: toMessages(prompt), seed: opts.seed });
  const outline = sanitizeOutline(res, bible, config);
  if (outline.chapters.length < config.targetChapters * 0.8) {
    throw new Error(`outline too short: ${outline.chapters.length} of ${config.targetChapters} chapters`);
  }
  store.saveOutline(outline);
  return outline;
}

/* ------------------------------------------------------------------ */
/* sanitizers                                                          */
/* ------------------------------------------------------------------ */

export function sanitizeBible(bible: Bible): void {
  const seen = new Set<string>();
  for (const c of bible.characters) {
    if (seen.has(c.id)) c.id = `${c.id}_${bible.characters.indexOf(c)}`;
    seen.add(c.id);
  }
  const names = new Set<string>();
  for (const c of bible.characters) {
    if (names.has(c.name.toLowerCase())) c.name = `${c.name} Jr.`;
    names.add(c.name.toLowerCase());
  }
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)).filter((s) => s.length > 0) : [];
}

function toFacts(value: unknown): Bible['world'] {
  if (!Array.isArray(value)) return [];
  const out: Bible['world'] = [];
  let n = 1;
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const statement = String(r['statement'] ?? '').trim();
    if (!statement) continue;
    out.push({
      id: r['id'] ? String(r['id']) : `rule_${n}`,
      category: isFactCategory(r['category']) ? r['category'] : 'world',
      statement,
      establishedIn: [],
      confidence: 'canon',
    });
    n++;
  }
  return out;
}

function isFactCategory(v: unknown): v is Bible['world'][number]['category'] {
  return typeof v === 'string' && ['lore', 'rule', 'world', 'history', 'culture', 'prophecy'].includes(v);
}

function toLocations(value: unknown): Bible['locations'] {
  if (!Array.isArray(value)) return [];
  const out: Bible['locations'] = [];
  let n = 1;
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const name = String(r['name'] ?? '').trim();
    if (!name) continue;
    out.push({ id: r['id'] ? String(r['id']) : `loc_${n}`, name, region: String(r['region'] ?? ''), description: String(r['description'] ?? '') });
    n++;
  }
  return out;
}

function toFactions(value: unknown): Bible['factions'] {
  if (!Array.isArray(value)) return [];
  const out: Bible['factions'] = [];
  let n = 1;
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const name = String(r['name'] ?? '').trim();
    if (!name) continue;
    out.push({ id: r['id'] ? String(r['id']) : `fac_${n}`, name, goals: String(r['goals'] ?? ''), description: String(r['description'] ?? '') });
    n++;
  }
  return out;
}

function toCharacters(value: unknown): Character[] {
  const list = Array.isArray(value) ? value : [];
  const out: Character[] = [];
  let n = 1;
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const name = String(r['name'] ?? '').trim();
    if (!name) continue;
    out.push({
      id: r['id'] ? String(r['id']) : `chr_${n}`,
      name,
      aliases: strArray(r['aliases']),
      role: isRole(r['role']) ? r['role'] : 'supporting',
      status: isStatus(r['status']) ? r['status'] : 'alive',
      age: typeof r['age'] === 'number' ? r['age'] : undefined,
      appearance: String(r['appearance'] ?? ''),
      personality: String(r['personality'] ?? ''),
      motivation: String(r['motivation'] ?? ''),
      arc: String(r['arc'] ?? ''),
      voice: String(r['voice'] ?? ''),
      secrets: String(r['secrets'] ?? ''),
      firstChapter: typeof r['firstChapter'] === 'number' ? r['firstChapter'] : 1,
    });
    n++;
  }
  return out;
}

function isRole(v: unknown): v is Character['role'] {
  return typeof v === 'string' && ['protagonist', 'deuteragonist', 'antagonist', 'mentor', 'ally', 'foil', 'supporting'].includes(v);
}

function isStatus(v: unknown): v is Character['status'] {
  return typeof v === 'string' && ['alive', 'dead', 'missing', 'unknown'].includes(v);
}

function summarizeWorld(res: Record<string, unknown>): string {
  const facts = toFacts(res['world']).map((f) => `[${f.id}] ${f.statement}`).join('\n');
  const locs = toLocations(res['locations']).map((l) => `[${l.id}] ${l.name} (${l.region})`).join('\n');
  const facs = toFactions(res['factions']).map((f) => `[${f.id}] ${f.name}: ${f.goals}`).join('\n');
  return [facts, locs, facs].filter(Boolean).join('\n');
}

/** Fix ids, drop unknown references, renumber chapters, ensure arcs. */
export function sanitizeOutline(res: { arcs?: unknown[]; chapters?: unknown[] }, bible: Bible, config: ProjectConfig): Outline {
  const charIds = new Set(bible.characters.map((c) => c.id));
  const locIds = new Set(bible.locations.map((l) => l.id));
  const factIds = new Set(bible.world.map((f) => f.id));
  const protagonist = bible.characters.find((c) => c.role === 'protagonist') ?? bible.characters[0];

  const rawChapters = Array.isArray(res.chapters) ? res.chapters : [];
  const chapters: ChapterOutline[] = [];
  for (const [i, raw] of rawChapters.entries()) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const num = typeof r['number'] === 'number' ? r['number'] : i + 1;
    const citations = (key: string, allowed: Set<string>): string[] => {
      const value = r[key];
      if (!Array.isArray(value)) return [];
      return value.filter((v): v is string => typeof v === 'string' && allowed.has(v));
    };
    const povId = citations('povCharacterId', charIds);
    const characterIds = citations('characterIds', charIds);
    chapters.push({
      number: num,
      title: String(r['title'] ?? `Chapter ${num}`).trim() || `Chapter ${num}`,
      povCharacterId: povId[0] ?? protagonist?.id ?? '',
      locationIds: citations('locationIds', locIds),
      characterIds: protagonist?.id && !characterIds.includes(protagonist.id) ? [protagonist.id, ...characterIds] : characterIds,
      canonFactIds: citations('canonFactIds', factIds),
      summary: String(r['summary'] ?? ''),
      beats: strArray(r['beats']),
      targetWords: config.wordsPerChapter,
    });
  }
  chapters.sort((a, b) => a.number - b.number);
  chapters.forEach((c, i) => {
    c.number = i + 1;
  });

  let arcs: Outline['arcs'] = [];
  if (Array.isArray(res.arcs)) {
    arcs = res.arcs
      .filter((a): a is Record<string, unknown> => Boolean(a && typeof a === 'object'))
      .map((a, i) => ({
        id: String(a['id'] ?? `arc_${i + 1}`),
        title: String(a['title'] ?? `Arc ${i + 1}`),
        fromChapter: Number(a['fromChapter'] ?? i * 10 + 1),
        toChapter: Number(a['toChapter'] ?? Math.min(chapters.length, (i + 1) * 10)),
        objective: String(a['objective'] ?? ''),
        climax: String(a['climax'] ?? ''),
        resolution: String(a['resolution'] ?? ''),
      }));
  }
  if (arcs.length === 0 && chapters.length > 0) {
    const per = Math.max(4, Math.ceil(chapters.length / Math.ceil(chapters.length / 10)));
    for (let i = 0; i < chapters.length; i += per) {
      arcs.push({
        id: `arc_${arcs.length + 1}`,
        title: `Arc ${arcs.length + 1}`,
        fromChapter: i + 1,
        toChapter: Math.min(chapters.length, i + per),
        objective: chapters[i]!.summary,
        climax: chapters[Math.min(chapters.length - 1, i + per - 1)]!.summary,
        resolution: '',
      });
    }
  }
  return { schema: 'novel.outline/1', arcs, chapters };
}

/** Fill in an empty or partially built project without regenerating what exists. */
export async function ensureProjectPlan(store: Store, provider: LLMProvider, opts: { idea: string; seed: string }): Promise<void> {
  const config = store.loadConfig();
  const premise = store.loadPremise();
  if (!premise.logline || store.loadConfig().title === 'Untitled') {
    await buildPremise(store, provider, { idea: opts.idea, genre: config.genre, targetChapters: config.targetChapters, seed: opts.seed });
  }
  const bible = store.loadBible();
  if (bible.characters.length === 0) {
    await buildBible(store, provider, { premise: store.loadPremise().synopsis || config.premise, seed: opts.seed });
  }
  const outline = store.loadOutline();
  if (outline.chapters.length === 0) {
    await buildOutline(store, provider, { seed: opts.seed });
  }
}
