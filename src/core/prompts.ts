import type { Bible, ChapterOutline, Lesson, ProjectConfig, StyleGuide } from './types.ts';

/* ------------------------------------------------------------------ */
/* shared voice instructions                                          */
/* ------------------------------------------------------------------ */

const PROFESSIONAL_AUTHOR = `You are a professional webnovel author shipping a chapter tomorrow.
You write addictive, grounded serial fiction with human rhythm: scenes enter late and leave early,
dialogue carries subtext, and every chapter ends on a reason to keep reading.
You never write like an AI assistant: no meta commentary, no summaries of what you just wrote,
no moralizing, no "as an AI", no listicle energy inside prose, no em-dash stutter in every sentence.`;

const JSON_ONLY = `Answer with exactly one JSON object or array, no prose before or after it.`;

export interface PromptPair {
  system: string;
  user: string;
}

function finalize(system: string, user: string, data: unknown): PromptPair {
  return {
    system,
    user: `${user}\n\n## DATA\n${JSON.stringify(data, null, 2)}\n`,
  };
}

function toMessages(prompt: PromptPair): { role: 'system' | 'user'; content: string }[] {
  return [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user },
  ];
}

export { toMessages };

/* ------------------------------------------------------------------ */
/* idea + premise                                                      */
/* ------------------------------------------------------------------ */

export function buildIdeasPrompt(opts: { count: number; genre?: string; seed: string }): PromptPair {
  const genre = opts.genre?.trim();
  const system = `[task:ideas] You are a serial fiction development editor. ${JSON_ONLY}`;
  const user = [
    `Invent ${opts.count} original webnovel concepts a paying subscriber would click on.`,
    genre ? `Genre: ${genre}.` : 'Pick a genre that sells in serial form (cultivation, progression, mystery, political, romance).',
    `Each idea needs: title (emotive, 2-5 words), genre, hook (the concrete unfair advantage or problem), logline (one sentence with stakes and a clock).`,
    `Avoid names of existing franchises. No purple cliches like "the last of her kind".`,
    `Return {"ideas":[{"title","genre","hook","logline"}]}.`,
  ].join('\n');
  return finalize(system, user, { count: opts.count, genre: genre ?? null, seed: opts.seed });
}

export function buildPremisePrompt(opts: {
  idea: string;
  genre: string;
  language: string;
  targetChapters: number;
  seed: string;
}): PromptPair {
  const system = `[task:premise] You are a story architect for serial fiction. ${JSON_ONLY}`;
  const user = [
    `Turn the rough idea below into a production premise for a ${opts.targetChapters}-chapter webnovel serial.`,
    `It must be extensible for a long serial: a premise that can sustain arcs, not a closed story.`,
    `Give: title, logline (1 sentence), synopsis (120-180 words), theme, tropes (named tropes used), subversions (how each trope is twisted), hookPromise (what episode-to-episode engine keeps readers), targetAudience.`,
    `Write in ${opts.language}.`,
    `Return {"title","logline","synopsis","theme","tropes":[...],"subversions":[...],"hookPromise","targetAudience","genre"}.`,
  ].join('\n');
  return finalize(system, user, {
    idea: opts.idea,
    genre: opts.genre,
    language: opts.language,
    targetChapters: opts.targetChapters,
    seed: opts.seed,
  });
}

/* ------------------------------------------------------------------ */
/* bible                                                               */
/* ------------------------------------------------------------------ */

export function buildWorldPrompt(opts: { premise: string; language: string }): PromptPair {
  const system = `[task:world] You are a worldbuilding lead for a serial novel. ${JSON_ONLY}`;
  const user = [
    `Design the world as CANON: rules that must never be contradicted, not decoration.`,
    `For the premise below, output:`,
    `- world: 5-8 canon facts (category: rule|world|culture|history|prophecy), each a single testable statement.`,
    `- locations: 3-5 places with region + one physical detail each.`,
    `- factions: 2-4 factions with goals and methods.`,
    `Rules must constrain characters (costs, limits, tradeoffs). A rule with no cost is not a rule.`,
    `IDs: rule_1.., loc_1.., fac_1..`,
    `Language: ${opts.language}.`,
    `Return {"world":[{"id","category","statement"}],"locations":[{"id","name","region","description"}],"factions":[{"id","name","goals","description"}]}.`,
  ].join('\n');
  return finalize(system, user, { premise: opts.premise, language: opts.language });
}

export function buildCharactersPrompt(opts: { premise: string; worldSummary: string; language: string }): PromptPair {
  const system = `[task:characters] You are a casting director and character bible author. ${JSON_ONLY}`;
  const user = [
    `Create the ensemble bible for this serial. Include the protagonist, one deuteragonist, one mentor, one antagonist, and one foil.`,
    `Each character must be specific enough to write dialogue for:`,
    `- id (chr_1..), name, aliases (how others refer to them), role, status, age (number), appearance (one line, concrete), personality, motivation, arc (beginning -> end), voice (speech style, verbal habits), secrets (what only they know), firstChapter.`,
    `No two characters may share a first name. Names must be pronounceable and distinct in dialogue.`,
    `Language: ${opts.language}.`,
    `Return {"characters":[...]}.`,
  ].join('\n');
  return finalize(system, user, { premise: opts.premise, world: opts.worldSummary, language: opts.language });
}

/* ------------------------------------------------------------------ */
/* outline                                                             */
/* ------------------------------------------------------------------ */

export function buildOutlinePrompt(opts: {
  config: ProjectConfig;
  premise: string;
  bible: Bible;
  targetChapters: number;
}): PromptPair {
  const system = `[task:outline] You are a serial storybreaker. ${JSON_ONLY}`;
  const povIds = opts.bible.characters.map((c) => c.id);
  const user = [
    `Break ${opts.targetChapters} chapters into arcs and per-chapter outlines.`,
    `POV character id (single protagonist for now): ${povIds[0] ?? 'chr_1'}.`,
    `For EVERY chapter: number, title (short, intriguing, no chapter numbers in the title), povCharacterId, locationIds (from bible), characterIds (involved), canonFactIds (facts from bible the chapter uses), summary (2-3 sentences: what changes), beats (3-5 ordered beats, each one scene-sized), targetWords (${opts.config.wordsPerChapter}).`,
    `Arc structure: roughly one arc per 8-12 chapters, each with objective, climax, resolution. Every arc must close one question and open a larger one.`,
    `Continuity: chapter N+1 must continue from how N+0 ends; escalating costs, no reset of status quo; no character age/status changes without a chapter that shows it.`,
    `Only use IDs listed in DATA.`,
    `Return {"arcs":[{"id","title","fromChapter","toChapter","objective","climax","resolution"}],"chapters":[...]}.`,
  ].join('\n');
  return finalize(system, user, {
    premise: opts.premise,
    targetChapters: opts.targetChapters,
    povId: povIds[0] ?? 'chr_1',
    characterIds: opts.bible.characters.map((c) => c.id),
    locationIds: opts.bible.locations.map((l) => l.id),
    factIds: opts.bible.world.map((f) => f.id),
    title: opts.config.title,
  });
}

/* ------------------------------------------------------------------ */
/* chapter generation                                                  */
/* ------------------------------------------------------------------ */

function styleBlock(style: StyleGuide): string {
  const rules = style.rules.map((r, i) => `${i + 1}. ${r}`).join('\n');
  const banned = style.banned.map((b) => `- ${b.startsWith('re:') ? `never match: ${b.slice(3)}` : b}`).join('\n');
  const samples = style.samples.map((s) => `> ${s}`).join('\n\n');
  return `## STYLE CONTRACT\n${rules}\n\n## BANNED PHRASES (never emit)\n${banned}\n\n## VOICE SAMPLES\n${samples}`;
}

function lessonsBlock(lessons: Lesson[]): string {
  const active = lessons.filter((l) => !l.dismissed).slice(0, 15);
  if (active.length === 0) return '';
  const lines = active.map((l) => `- [${l.severity}] ${l.category}: ${l.note}`);
  return `## MISTAKES TO AVOID (learned from previous chapters — do not repeat)\n${lines.join('\n')}`;
}

function bibleBlock(bible: Bible, chapter: ChapterOutline): string {
  const characters = bible.characters.filter((c) => chapter.characterIds.includes(c.id) || c.id === chapter.povCharacterId);
  const cast = characters.length > 0 ? characters : bible.characters.slice(0, 3);
  const charLines = cast.map((c) =>
    `${c.name} (${c.id}) — ${c.role}, ${c.status}, ${c.age ?? '?'} years. Wants: ${c.motivation}. Voice: ${c.voice}. Never contradicts: ${c.secrets}.`,
  );
  const locLines = bible.locations.map((l) => `${l.name} (${l.id}) — ${l.region}: ${l.description}`);
  const facts = bible.world.filter((f) => chapter.canonFactIds.includes(f.id));
  const factLines = facts.length > 0
    ? facts.map((f) => `${f.id} [${f.category}]: ${f.statement}`)
    : bible.world.slice(0, 6).map((f) => `${f.id} [${f.category}]: ${f.statement}`);
  const timeline = bible.timeline.slice(-5).map((t) => `ch${t.chapter}: ${t.event}`);
  return [
    '## CANON (source of truth — never contradict)',
    ...charLines,
    ...locLines,
    '## WORLD RULES',
    ...factLines,
    ...(timeline.length > 0 ? ['## RECENT EVENTS', ...timeline] : []),
  ].join('\n');
}

export function buildChapterPrompt(opts: {
  config: ProjectConfig;
  style: StyleGuide;
  bible: Bible;
  chapter: ChapterOutline;
  prevTail: string | null;
  lessons: Lesson[];
}): PromptPair {
  const { config, style, bible, chapter, prevTail, lessons } = opts;
  const system = [
    `[task:chapter] ${PROFESSIONAL_AUTHOR}`,
    styleBlock(style),
    '## OUTPUT CONTRACT',
    `Return ONLY the chapter prose in ${config.language}. No title, no heading, no markdown markers, no scene labels, no meta notes.`,
    `POV: ${chapter.povCharacterId ? bible.characters.find((c) => c.id === chapter.povCharacterId)?.name ?? 'third limited' : 'third limited'}, ${config.pov}, ${config.tense} tense.`,
    `Target length: about ${chapter.targetWords} words (±10%). End on a hook.`,
  ].join('\n\n');

  const continuation = prevTail
    ? `Continue directly from this exact tail of the previous chapter (do not re-describe it, do not flash back):\n"${prevTail}"\n`
    : '';

  const user = [
    `Write chapter ${chapter.number}: "${chapter.title}".`,
    `Summary: ${chapter.summary}`,
    `Beats: ${chapter.beats.map((b, i) => `${i + 1}) ${b}`).join('; ')}`,
    continuation,
    bibleBlock(bible, chapter),
    lessonsBlock(lessons),
  ]
    .filter((s) => s.length > 0)
    .join('\n\n');

  return finalize(system, user, {
    chapter: {
      number: chapter.number,
      title: chapter.title,
      summary: chapter.summary,
      beats: chapter.beats,
      targetWords: chapter.targetWords,
      povCharacterId: chapter.povCharacterId,
      characterIds: chapter.characterIds,
      locationIds: chapter.locationIds,
      canonFactIds: chapter.canonFactIds,
    },
    bible: {
      characters: bible.characters,
      locations: bible.locations,
      world: bible.world,
    },
    language: config.language,
    prevTail,
    seed: `${config.name}:c${chapter.number}`,
  });
}

export function buildFixPrompt(opts: {
  config: ProjectConfig;
  style: StyleGuide;
  bible: Bible;
  chapter: ChapterOutline;
  text: string;
  issues: { code: string; message: string; suggestion: string; excerpt: string }[];
  lessons: Lesson[];
}): PromptPair {
  const system = `[task:fix] ${PROFESSIONAL_AUTHOR}\n${styleBlock(opts.style)}`;
  const user = [
    `Rewrite chapter ${opts.chapter.number} ("${opts.chapter.title}") to fix the listed issues, keeping everything that already works.`,
    `Return the COMPLETE rewritten chapter prose only (~${opts.chapter.targetWords} words), same POV and tense.`,
    '## ISSUES',
    ...opts.issues.map((i) => `- ${i.code}: ${i.message} | suggestion: ${i.suggestion} | near: "${i.excerpt}"`),
    opts.lessons.length > 0 ? `\n## MISTAKES TO AVOID\n${opts.lessons.map((l) => `- ${l.note}`).join('\n')}` : '',
  ]
    .filter((s) => s.length > 0)
    .join('\n\n');
  return finalize(system, user, {
    chapterText: opts.text,
    issues: opts.issues,
    bible: { characters: opts.bible.characters, locations: opts.bible.locations, world: opts.bible.world },
    targetWords: opts.chapter.targetWords,
    language: opts.config.language,
    rework: opts.issues.map((i) => i.suggestion),
    seed: `${opts.config.name}:c${opts.chapter.number}:fix`,
  });
}

/* ------------------------------------------------------------------ */
/* self review                                                         */
/* ------------------------------------------------------------------ */

export function buildReviewPrompt(opts: {
  config: ProjectConfig;
  style: StyleGuide;
  bible: Bible;
  chapter: ChapterOutline;
  text: string;
  lessons: Lesson[];
}): PromptPair {
  const cast = opts.bible.characters
    .map((c) => `${c.name} (${c.id}): ${c.age ?? '?'}y, ${c.status}, wants ${c.motivation}`)
    .join('; ');
  const rules = opts.bible.world.map((f) => `${f.id}: ${f.statement}`).join(' | ');
  const system = `[task:review] You are a ruthless fiction editor and continuity checker. ${JSON_ONLY}`;
  const user = [
    `Review chapter ${opts.chapter.number} against the canon below and the style contract.`,
    `Report ONLY problems you can point at, each with a quoted excerpt:`,
    `- continuity: names, ages, statuses, locations, timeline that contradict canon`,
    `- style violations from the contract (banned phrases, AI tells, flat rhythm)`,
    `- pacing: skipped consequences, unearned emotion, missing hook`,
    `Score 0-100 (80+ = publishable). Verdict: publishable | needs-polish | broken.`,
    `Return {"score":n,"verdict":"...","issues":[{"severity":"warn"|"error","code":"continuity|style|pacing|dialogue|structure","message","suggestion","excerpt"}]}.`,
    `If nothing is wrong: empty issues array, score >= 85.`,
    `## CANON\n${cast}\nRules: ${rules}`,
    styleBlock(opts.style),
    ...(opts.lessons.length > 0 ? ['## KNOWN BAD PATTERNS', ...opts.lessons.slice(0, 8).map((l) => `- ${l.note}`)] : []),
    '## CHAPTER TEXT',
    opts.text,
  ].join('\n');
  return finalize(system, user, {
    chapterNumber: opts.chapter.number,
    chapterText: opts.text,
    canon: { characters: opts.bible.characters, world: opts.bible.world },
    language: opts.config.language,
    seed: `${opts.config.name}:c${opts.chapter.number}:review`,
  });
}
