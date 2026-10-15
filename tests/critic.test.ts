import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkContinuity, hasBlockingErrors, maxSeverity } from '../src/core/critic.ts';
import type { Bible, ChapterOutline } from '../src/core/types.ts';
import { defaultStyleGuide } from '../src/core/style-default.ts';

const bible: Bible = {
  schema: 'novel.bible/1',
  world: [
    { id: 'rule_1', category: 'rule', statement: 'Debts are recorded in the hollow ledger and cannot be unwritten.', establishedIn: [], confidence: 'canon' },
  ],
  locations: [{ id: 'loc_1', name: 'Ashen Reach', region: 'north', description: 'rain-black flagstones' }],
  factions: [{ id: 'fac_1', name: 'The Weighers', goals: 'honest credit', description: 'inspectors' }],
  characters: [
    { id: 'chr_1', name: 'Anya Vell', aliases: ['Anya'], role: 'protagonist', status: 'alive', age: 24, appearance: '', personality: '', motivation: 'prove it', arc: '', voice: '', secrets: '', firstChapter: 1 },
    { id: 'chr_2', name: 'Miren', aliases: [], role: 'deuteragonist', status: 'alive', age: 31, appearance: '', personality: '', motivation: '', arc: '', voice: '', secrets: '', firstChapter: 1 },
    { id: 'chr_3', name: 'Hesk', aliases: [], role: 'antagonist', status: 'dead', age: 41, appearance: '', personality: '', motivation: '', arc: '', voice: '', secrets: '', firstChapter: 2 },
  ],
  timeline: [],
  notes: [],
};

const chapter: ChapterOutline = {
  number: 1,
  title: 'Cold Opening',
  povCharacterId: 'chr_1',
  locationIds: ['loc_1'],
  characterIds: ['chr_1'],
  canonFactIds: ['rule_1'],
  summary: 'Anya arrives at Ashen Reach to check the ledger.',
  beats: ['the weigh-in'],
  targetWords: 600,
};

function check(text: string): ReturnType<typeof checkContinuity> {
  return checkContinuity({ chapter, text, bible, style: defaultStyleGuide() });
}

function codes(findings: { code: string }[]): string[] {
  return findings.map((f) => f.code);
}

function cleanText(): string {
  return [
    'Anya Vell crossed Ashen Reach without hurry, counting doors the way she counted everything.',
    '"You came," the porter said, though nobody had knocked.',
    '"The scale is honest," Anya answered. "The men aren\'t."',
    'The ledger lay open under a glass dome, one line short again, and the smell of lamp wax followed her two streets further than it should have.',
    'Outside, rain turned the flagstones black and the harbor horns argued with each other.',
    'She had learned to read a room before entering, and this one said wait.',
    'The clerk had left a fresh seal on the counter, red wax still soft at the edges.',
    'Miren would call this a bargaining position. Anya called it a bad bargain.',
    'Whatever came next came fast and cheap, and did not wait for permission.',
    'Then the gate opened from the outside, and the honor guard stopped at the threshold with their hands off their weapons.',
    '"You are late," the older guard said, and something in the way he said it meant she had been expected for hours.',
    'She counted the exits again, because counting beat praying and cost the same.',
    'The witness name on the page was her own, written in her father\'s hand.',
    'Her hands stayed steady while she folded the page away, which surprised them both.',
    'Memory is a poor steward: it keeps what hurts and mislabels the rest.',
    'The hall remembered older business tonight, and smelled of salt, ink, and ground pepper.',
    '"Say the rest of it," the porter said quietly.',
    '"Then we do it the ugly way," Miren answered from the doorway, as though the conversation had already paid her.',
    'The rain moved east across the harbor and took the last of the light with it.',
    'By morning the ledger would have one more line, and Anya would have one less excuse.',
    'She drank the cold tea anyway, watching the gate through the steam.',
    'The work started the way hard jobs always do: with paperwork.',
    'Nothing in the guard\'s face promised mercy, which was fair, because none had been requested.',
    'The bell rang twice, for a death that had not happened yet.',
    'Nobody in the hall looked up, which was always the tell.',
    'The task itself was simple enough: read one page aloud. Simplicity was the trap; simple things failed loudly.',
    'Steam, old ink, the iron smell of rain that had not fallen yet.',
    'All of it rested on the same old truth: a debt recorded cannot be unwritten.',
  ].join('\n\n');
}

test('clean prose produces only info-level findings', () => {
  const findings = check(cleanText());
  assert.deepEqual(codes(findings).filter((c) => c !== 'weak-hook'), []);
});

test('banned phrases and regex bans are errors', () => {
  const findings = check('It was a testament to her patience, and she began to delve into the record.');
  assert.ok(codes(findings).includes('banned-phrase'));
  assert.equal(findings.find((f) => f.code === 'banned-phrase')!.severity, 'error');
  const regexFindings = check('As if the ledger itself were laughing at her, she began to delve.');
  assert.ok(codes(regexFindings).includes('banned-phrase'));
});

test('age contradictions are detected in digits and words', () => {
  const digits = check('Anya, now 26 years old, finished the reading.');
  assert.ok(codes(digits).includes('age-contradiction'));
  const words = check('Anya Vell, aged twenty-eight, finished the reading.');
  assert.ok(codes(words).includes('age-contradiction'));
  const correct = check('Anya Vell, aged twenty-four, finished the reading.');
  assert.ok(!codes(correct).includes('age-contradiction'));
});

test('dead characters cannot act on-page', () => {
  const findings = check('Hesk stood in the doorway and named the seal.');
  assert.ok(codes(findings).includes('dead-character'));
  assert.equal(findings.find((f) => f.code === 'dead-character')!.severity, 'error');
});

test('unknown proper nouns warn without flagging the bible', () => {
  const findings = check('Captain Brandt of the Ash Ward met Anya Vell at Ashen Reach.');
  const unknown = codes(findings).includes('unknown-character');
  assert.equal(unknown, true);
  assert.equal(codes(check('Anya Vell met the Weighers at Ashen Reach.')).includes('unknown-character'), false);
});

test('word count and meta language are flagged', () => {
  const short = check('Too short.');
  assert.ok(codes(short).includes('word-count'));
  const meta = check('In this chapter we follow Anya Vell through Ashen Reach again and again until the ledger finally gives up its secrets to her.');
  assert.ok(codes(meta).includes('meta-language'));
});

test('missing location and pov are warnings', () => {
  const noLoc = check('Anya Vell walked the cold hall without hurry, and the witness name on the page was her own. She read it twice, then folded it away and walked on toward the gate where the guard pretended not to watch her go.');
  assert.ok(codes(noLoc).includes('unknown-location'));
  const noPov = check('The porter waited at Ashen Reach with the ledger under his arm. He read the witness name twice, then folded the page away and walked toward the gate while the rain turned the flagstones black around his boots.');
  assert.ok(codes(noPov).includes('pov-missing'));
  assert.equal(codes(noPov).includes('unknown-location'), false);
});

test('hasBlockingErrors needs two errors; maxSeverity ranks', () => {
  const findings = check('Hesk began to delve into the testament.');
  assert.ok(hasBlockingErrors(findings));
  const withOneError = findings.filter((f) => f.severity === 'error').slice(0, 1);
  assert.equal(hasBlockingErrors(withOneError), false);
  assert.equal(maxSeverity([]), 'info');
  assert.equal(maxSeverity([{ severity: 'warn' }, { severity: 'error' }] as never), 'error');
});

test('findings have stable ids for identical input', () => {
  const a = check('Hesk stood and she began to delve.');
  const b = check('Hesk stood and she began to delve.');
  assert.deepEqual(a.map((f) => f.id), b.map((f) => f.id));
});
