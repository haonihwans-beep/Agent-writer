import { createRng, type Rng } from '../util/rng.ts';
import type { Bible, ChapterOutline, Character, Location } from './types.ts';

/**
 * Offline, deterministic generator set. Produces structurally valid prose and
 * review JSON so the whole pipeline is testable and demo-able without any API
 * key. Quality is deliberately "outline-grade" — swap in `anthropic` or
 * `openai-compatible` for production manuscripts.
 */

export interface MockChapterInput {
  chapter: ChapterOutline;
  bible: Bible;
  language: string;
  rework?: string[];
  seedSalt?: string;
}

const ADJ = ['quiet', 'crimson', 'shattered', 'patient', 'hollow', 'gilded', 'restless', 'salt-stained', 'forgotten', 'iron'];
const NOUN = ['lantern', 'threshold', 'ledger', 'crown', 'orchard', 'tide', 'spire', 'choir', 'garden', 'border'];
const PLACE = ['Ashen Reach', 'the Hollow Vales', 'Meridian', 'the Nine Harbor', 'Karsa Deep', 'the Still Provinces'];

const GENRE_RECIPES: { genre: string; hooks: string[] }[] = [
  { genre: 'cultivation', hooks: ['a discarded outer disciple', 'a broken sword manual', 'the hundred-year deadline'] },
  { genre: 'progression fantasy', hooks: ['a system that counts every life', 'the guild that sells sleep', 'one debt unpaid'] },
  { genre: 'mystery', hooks: ['a town with one extra grave', 'a witness who never lies twice', 'the last train west'] },
  { genre: 'political intrigue', hooks: ['three heirs and one will', 'the map that cannot be redrawn', 'a minister who vanished'] },
  { genre: 'romance', hooks: ['a marriage of convenience', 'the best friend clause', 'two letters, one wrong address'] },
  { genre: 'litrpg', hooks: ['a tutorial that repeats monday', 'the floor that was not in the patch notes', 'a level ninety-nine commoner'] },
  { genre: 'literary', hooks: ['an unfinished confession', 'a translated diary', 'the season before the flood'] },
];

function clean(t: string): string {
  return t.replace(/\s+/g, ' ').trim();
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0]!.toUpperCase() + s.slice(1) : s;
}

function nameOf(c: Character | undefined): string {
  return c?.name ?? 'the stranger';
}

/* ---------------- chapter prose ---------------- */

function openLine(rng: Rng, pov: Character | undefined, other: Character | undefined): string {
  return rng.pick([
    'The work started the way hard jobs always do — with paperwork.',
    `${nameOf(pov)} arrived early and found the room already cold.`,
    `Nothing in ${nameOf(other)}'s face promised mercy, which was fair, because none had been requested.`,
    'The hall remembered older business, and smelled of lamp wax and ground pepper.',
  ]);
}

function actionParagraph(rng: Rng, beat: string, pov: Character | undefined, other: Character | undefined, place: Location | undefined): string {
  const where = place ? place.name : 'the courtyard';
  return rng.pick([
    `${nameOf(pov)} crossed ${where} without hurry, because hurry drew eyes. The stone remembered every step; so did the two guards at the gate.`,
    'The argument had burned itself out before midnight. What remained was arithmetic: three days of grain, one signed order, and no way to prove the order was a lie.',
    `${nameOf(pov)} set the cup down harder than intended. The sound carried, flat and honest, through the empty room.`,
    `${nameOf(other)} answered the door before the knock, which meant the hallway had been watched the whole time.`,
    `The task itself was simple enough: ${clean(beat)}. Simplicity was the trap; simple things failed loudly.`,
    'Rain came in off the harbor and turned the flagstones black. ${nameOf(pov)} kept to the wall, counting doors.'.replace('${nameOf(pov)}', nameOf(pov)),
  ]);
}

function innerParagraph(rng: Rng, pov: Character | undefined): string {
  return rng.pick([
    'She had rehearsed this part a dozen times. None of the rehearsals had included the part where her hands shook.',
    `${nameOf(pov)} did not believe in omens. He believed in ledgers, and every line of this one ended in red.`,
    'There was a version of this night where it went well. She had stopped keeping count of the other version.',
    'Memory was a poor steward: it kept what hurt and mislabeled the rest.',
    'Fear was a ledger entry, settled later with interest. For now, the only honest number was the one at her back.',
  ]);
}

function dialogueExchange(rng: Rng, a: Character | undefined, b: Character | undefined, beat: string): string {
  const lines = [
    rng.pick([
      `"You are late," ${nameOf(b)} said.`,
      `"Say the rest of it," ${nameOf(a)} said.`,
      '"That was not the agreement."',
      '"You could have told me first."',
    ]),
    `"Then we do it the ugly way," ${nameOf(b)} said.`,
    `The demand was plain: ${capitalize(clean(beat))}.`,
    rng.pick([
      '"And if it costs us the name we have left?"',
      '"And when they ask who signed?"',
      '"And who pays for the silence?"',
    ]),
    rng.pick([
      '"Then everything we did was for nothing."',
      '"Then we stop counting what we deserve."',
      '"Then it was never about the money."',
    ]),
  ];
  return lines.join('\n\n');
}

function beatLine(rng: Rng, beat: string, pov: Character | undefined, other: Character | undefined, place: Location | undefined, canon: string[]): string {
  const where = place ? place.name : 'the hall';
  const options = [
    `The business of the hour was ${clean(beat)}.`,
    `${nameOf(pov)} had learned to read a room before entering it, and this one said wait.`,
    `Nobody in ${where} looked up, which was always the tell.`,
    `${nameOf(other)} kept the near wall, the way a man keeps an exit.`,
    'Steam, old ink, the iron smell of rain that had not fallen yet.',
    'Whatever came next came fast and cheap, and did not wait for permission.',
    `The rule had been simple for two hundred years: ${clean(beat)}. It had cost a village a year, on average, and nobody had ever improved on it.`,
    `${nameOf(pov)} counted the exits again, because counting was cheaper than praying.`,
  ];
  if (canon.length > 0) options.push(`All of it rested on the same old truth: ${clean(rng.pick(canon)).toLowerCase().replace(/\.$/, '')}.`);
  return rng.pick(options);
}

const HOOKS = [
  'Then the gate opened from the outside.',
  'The witness name on the page was his own.',
  'And the bell rang twice, for a death that had not happened yet.',
  'Somewhere below the floor, a second set of footsteps answered.',
  'The letter had been signed three years before she was born.',
  'By morning the honor guard would be standing at his door, and he would have to decide what to tell them.',
];

function wordTotal(text: string): number {
  return text.trim().split(/\s+/).length;
}

export function mockWriteChapter(input: MockChapterInput): string {
  const { chapter, bible, rework, seedSalt } = input;
  const notes = Array.isArray(bible.notes) ? bible.notes.join('|') : '';
  const rng = createRng([chapter.number, chapter.title, seedSalt ?? notes, chapter.summary].join('|'));
  const pov = chapter.povCharacterId ? bible.characters.find((c) => c.id === chapter.povCharacterId) : undefined;
  const others = chapter.characterIds
    .filter((id) => id !== chapter.povCharacterId)
    .map((id) => bible.characters.find((c) => c.id === id))
    .filter((c): c is Character => Boolean(c));
  const place = chapter.locationIds
    .map((id) => bible.locations.find((l) => l.id === id))
    .find((l): l is Location => Boolean(l));
  const canon = chapter.canonFactIds
    .map((id) => bible.world.find((f) => f.id === id))
    .filter((f) => Boolean(f))
    .map((f) => f!.statement);
  if (rework && rework.length > 0) {
    rng.int(rework.length); // mix rework notes into the stream
  }

  const beats = chapter.beats.length > 0 ? chapter.beats : [chapter.summary || 'the work of the day'];
  const paragraphs: string[] = [];
  paragraphs.push(openLine(rng, pov, others[0]));
  paragraphs.push(innerParagraph(rng, pov));

  for (const [i, beat] of beats.entries()) {
    paragraphs.push(beatLine(rng, beat, pov, others[i % Math.max(1, others.length)], place, canon));
    if (i % 2 === 0 && others.length > 0) {
      paragraphs.push(dialogueExchange(rng, pov ?? others[0], others[i % others.length], beat));
    } else {
      paragraphs.push(actionParagraph(rng, beat, pov, others[0], place));
    }
    if (i % 3 === 2) paragraphs.push(innerParagraph(rng, pov));
  }

  paragraphs.push(rng.pick(HOOKS));

  const target = Math.max(200, chapter.targetWords || 1200);
  let guard = 0;
  while (wordTotal(paragraphs.join('\n\n')) < target * 0.9 && guard < 80) {
    paragraphs.push(actionParagraph(rng, rng.pick(beats), pov, others[0], place));
    if (paragraphs.length % 4 === 0) paragraphs.push(innerParagraph(rng, pov));
    if (paragraphs.length % 9 === 0) paragraphs.push(dialogueExchange(rng, pov ?? others[0], others[0], rng.pick(beats)));
    guard++;
  }
  return paragraphs.join('\n\n');
}

/* ---------------- structured generation ---------------- */

export function mockGenerateIdeas(seed: string, count: number): string {
  const rng = createRng(`ideas|${seed}`);
  const ideas = [];
  for (let i = 0; i < count; i++) {
    const recipe = rng.pick(GENRE_RECIPES);
    const hook = rng.pick(recipe.hooks);
    const place = rng.pick(PLACE);
    const title = `The ${capitalize(rng.pick(ADJ))} ${capitalize(rng.pick(NOUN))} of ${capitalize(place)}`;
    ideas.push({
      title,
      genre: recipe.genre,
      logline: `At ${place}, ${hook}, and one season to pay for it.`,
      hook,
    });
  }
  return JSON.stringify({ ideas }, null, 2);
}

export function mockPremise(seed: string, idea: string, genre: string): string {
  const rng = createRng(`premise|${seed}|${idea}|${genre}`);
  const recipe = GENRE_RECIPES.find((g) => g.genre === genre.toLowerCase()) ?? rng.pick(GENRE_RECIPES);
  const hook = rng.pick(recipe.hooks);
  const title = `The ${capitalize(rng.pick(ADJ))} ${capitalize(rng.pick(NOUN))} of ${capitalize(rng.pick(PLACE))}`;
  return JSON.stringify(
    {
      title,
      genre: recipe.genre,
      logline: `${capitalize(clean(idea))} — ${hook}.`,
      synopsis: `${clean(idea)} begins at ${rng.pick(PLACE)}, where ${hook} stops being a gift and becomes a liability. The first arc proves the rules: what is owed must be paid, and the only currency that counts is proof. The middle arcs push the cost upward until the protagonist's advantage has to be traded for the one thing money cannot buy back. The ending settles every open debt, including the small ones nobody remembers writing down.`,
      theme: 'the price of proof, and what a person spends to keep a promise they no longer believe in',
      tropes: recipe.hooks,
      subversions: ['the mentor is wrong about the decisive turn', 'the promised reward is a debt instrument'],
      hookPromise: 'Each arc closes one debt and opens a larger one, with a cost the reader can count.',
      targetAudience: 'daily serial readers who finish chapters',
    },
    null,
    2,
  );
}

export function mockWorld(seed: string, premise: string): string {
  const rng = createRng(`world|${seed}|${premise}`);
  const facts = [
    { category: 'rule', statement: 'Every debt is recorded in the hollow ledger, and a ledger entry cannot be unwritten.' },
    { category: 'world', statement: 'The harbor cities trade in proof rather than coin: a witness, a seal, a weighed mark.' },
    { category: 'culture', statement: 'Children take the second name only after their first sworn promise.' },
    { category: 'history', statement: 'The War of Nine Winters ended when the Great Ledger was burned, but the ash kept working.' },
  ].map((f, i) => ({ id: `rule_${i + 1}`, ...f, establishedIn: [], confidence: 'canon' }));
  const locations = [
    { id: 'loc_1', name: rng.pick(PLACE), region: 'north coast', description: 'Rain-black flagstones, salt-market noise, and the hollow ledger hall.' },
    { id: 'loc_2', name: rng.pick(PLACE), region: 'inland reach', description: 'Dry terraces and grain stores; a proof-house on every third corner.' },
  ];
  const factions = [
    { id: 'fac_1', name: 'The Weighers', goals: 'Keep proof cheap and credit honest', description: 'Inspectors who can void any debt by re-weighing it in public.' },
    { id: 'fac_2', name: 'The Ash Clerks', goals: 'Reconstruct the burned ledger', description: 'A monastic order paid in memories, one page per year.' },
  ];
  return JSON.stringify({ world: facts, locations, factions }, null, 2);
}

export function mockCharacters(seed: string, premise: string): string {
  const rng = createRng(`characters|${seed}|${premise}`);
  const characters = [
    {
      id: `chr_${rng.int(9000) + 1000}`,
      name: 'Anya Vell',
      aliases: ['Anya', 'the ledger keeper’s daughter'],
      role: 'protagonist',
      status: 'alive',
      age: 24,
      appearance: 'narrow face, ink-stained fingers, a coat two seasons too warm',
      personality: 'careful, dry humor, will not apologize first',
      motivation: 'prove her father never sold the seal',
      arc: 'believes the record → learns the record was her own doing',
      voice: 'short declaratives; answers questions with questions when cornered',
      secrets: 'she remembers burning one page herself',
      firstChapter: 1,
    },
    {
      id: `chr_${rng.int(9000) + 1000}`,
      name: 'Miren',
      aliases: ['the witness'],
      role: 'deuteragonist',
      status: 'alive',
      age: 31,
      appearance: 'cropped hair, cheap cloak, excellent shoes',
      personality: 'charming, evasive, precise when it matters',
      motivation: 'buy back her own ledgers before the Clerks finish reading them',
      arc: 'seller of truths → owner of one truth',
      voice: 'warm, misdirecting sentences; compliment before bad news',
      secrets: 'she already knows what the protagonist did',
      firstChapter: 1,
    },
    {
      id: `chr_${rng.int(9000) + 1000}`,
      name: 'Otto Kale',
      aliases: [],
      role: 'mentor',
      status: 'alive',
      age: 58,
      appearance: 'thin, gray braid, ledger-hook at the belt',
      personality: 'kind, stubborn, smug about small wins',
      motivation: 'keep the Ash Clerks from finishing their page',
      arc: 'teacher → final lesson',
      voice: 'proverbs first, reasons later',
      secrets: 'he has begun forgetting what he is paying with',
      firstChapter: 1,
    },
    {
      id: `chr_${rng.int(9000) + 1000}`,
      name: 'Hesk',
      aliases: ['the Weigher'],
      role: 'antagonist',
      status: 'alive',
      age: 41,
      appearance: 'broad, immaculate, always slightly damp from the harbor',
      personality: 'patient, transactional, never lies',
      motivation: 'be the only witness left standing',
      arc: 'the debt collector → the last creditor',
      voice: 'full sentences, no adjectives wasted',
      secrets: 'he never learned to read',
      firstChapter: 2,
    },
  ];
  return JSON.stringify({ characters }, null, 2);
}

export function mockClaims(chapterText: string): string {
  void chapterText;
  const claims = [
    { statement: 'the protagonist kept a signed order', subjectNames: [] },
    { statement: 'the hollow ledger cannot be unwritten', subjectNames: [] },
  ];
  return JSON.stringify({ claims }, null, 2);
}

export interface MockOutlineInput {
  seed: string;
  targetChapters: number;
  title: string;
  povId: string;
  characterIds: string[];
  locationIds: string[];
  factIds: string[];
}

const BEATS_POOL = [
  'the farewell that reads like a negotiation',
  'the first proof shown in public',
  'the missing page costs the household its credit',
  'the mentor hides the reason for the warning',
  'the antagonist buys the wrong witness',
  'the ledger answers a question nobody asked',
  'the harbor oath is tested by fire',
  'the price of silence doubles overnight',
  'the confession that arrives too late to matter',
  'the final weighing, with the ashes present',
];

const TITLES_POOL = [
  'Ink and Harbor', 'The Missing Page', 'Cheap Proof', 'Salt Witness', 'The Ash Clerks',
  'A Short Counting', 'Two Winters Late', 'The Last Ledger', 'Oath of Nine', 'What the Fire Kept',
];

export function mockOutline(input: MockOutlineInput): string {
  const { targetChapters, povId, characterIds, locationIds, factIds } = input;
  const rng = createRng(`outline|${input.seed}|${input.title}|${targetChapters}`);
  const heroIds = characterIds.filter((id) => id !== povId);
  const chapters = [];
  for (let n = 1; n <= targetChapters; n++) {
    const cast = [povId, ...heroIds.slice(0, Math.max(0, (n - 1) % Math.max(1, heroIds.length)))].filter((v, i, a) => a.indexOf(v) === i);
    chapters.push({
      number: n,
      title: rng.pick(TITLES_POOL),
      povCharacterId: povId,
      locationIds: [locationIds.length > 0 ? locationIds[n % locationIds.length]! : ''],
      characterIds: cast.length > 1 ? cast : [povId],
      canonFactIds: factIds.length > 0 ? [factIds[(n - 1) % factIds.length]!] : [],
      summary: `${rng.pick(BEATS_POOL)} — chapter ${n} moves the ledger one line closer to settled.`,
      beats: [rng.pick(BEATS_POOL), rng.pick(BEATS_POOL), rng.pick(BEATS_POOL)],
      targetWords: 2000,
    });
  }
  const arcs = [];
  const per = Math.max(4, Math.ceil(targetChapters / Math.ceil(targetChapters / 10)));
  for (let i = 0; i < targetChapters; i += per) {
    arcs.push({
      id: `arc_${arcs.length + 1}`,
      title: `${input.title} — Arc ${arcs.length + 1}`,
      fromChapter: i + 1,
      toChapter: Math.min(targetChapters, i + per),
      objective: rng.pick(BEATS_POOL),
      climax: rng.pick(BEATS_POOL),
      resolution: rng.pick(BEATS_POOL),
    });
  }
  return JSON.stringify({ arcs, chapters }, null, 2);
}

export function mockReview(seed: string, chapterNumber: number): string {
  const rng = createRng(`review|${seed}|${chapterNumber}`);
  const issues = [];
  if (rng.bool(0.5)) {
    issues.push({
      severity: 'warn',
      code: 'style',
      message: 'Two consecutive paragraphs open with the same construction.',
      suggestion: 'Vary the opening rhythm.',
    });
  }
  if (rng.bool(0.3)) {
    issues.push({
      severity: 'warn',
      code: 'pacing',
      message: 'The middle beat compresses the turn too fast.',
      suggestion: 'Give the turn one scene of consequence.',
    });
  }
  return JSON.stringify(
    {
      score: issues.length === 0 ? 82 : 71,
      verdict: issues.length === 0 ? 'publishable' : 'needs-polish',
      issues,
    },
    null,
    2,
  );
}
