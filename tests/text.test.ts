import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng, hashString } from '../src/util/rng.ts';
import { dialogueRatio, makeExcerpt, parseFrontmatter, stringifyFrontmatter, wordCount, digitsToWords, wordsToNumbers } from '../src/util/text.ts';
import { parseJSONLoose } from '../src/util/json.ts';
import { findingId, lessonId } from '../src/util/ids.ts';
import { localDate, nextLocalTime } from '../src/util/clock.ts';

test('createRng is deterministic for the same seed', () => {
  const a = createRng('seed-1');
  const b = createRng('seed-1');
  const seqA = Array.from({ length: 5 }, () => a.next());
  const seqB = Array.from({ length: 5 }, () => b.next());
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, Array.from({ length: 5 }, () => createRng('other').next()));
});

test('createRng helpers stay in range', () => {
  const rng = createRng('range');
  for (let i = 0; i < 100; i++) {
    const v = rng.intBetween(3, 5);
    assert.ok(v >= 3 && v <= 5);
  }
  assert.throws(() => rng.pick([]));
});

test('hashString is stable', () => {
  assert.equal(hashString('abc'), hashString('abc'));
  assert.notEqual(hashString('abc'), hashString('abd'));
});

test('wordCount counts whitespace tokens', () => {
  assert.equal(wordCount(' one two  three \n four '), 4);
  assert.equal(wordCount('   '), 0);
});

test('frontmatter round-trips', () => {
  const data = { chapter: '7', title: 'A "quoted" title', words: '2500' };
  const text = stringifyFrontmatter(data, 'Body here.\n');
  const parsed = parseFrontmatter(text);
  assert.equal(parsed.data['chapter'], '7');
  assert.equal(parsed.data['title'], "A 'quoted' title");
  assert.equal(parsed.body, 'Body here.\n');
  assert.equal(parseFrontmatter('no frontmatter').data['chapter'], undefined);
});

test('makeExcerpt truncates on word boundaries', () => {
  const long = 'word '.repeat(80);
  const out = makeExcerpt(long, 40);
  assert.ok(out.length <= 41, `excerpt too long: ${out.length}`);
  assert.equal(out.endsWith('…'), true);
});

test('wordsToNumbers converts number-words', () => {
  const hits = wordsToNumbers('she was twenty-seven years old that year');
  assert.equal(hits.some((h) => h.value === 27), true);
  assert.equal(digitsToWords(24), 'twenty-four');
  assert.equal(digitsToWords(19), 'nineteen');
});

test('dialogueRatio ignores plain narration', () => {
  const ratio = dialogueRatio('He walked.\n\n"You came," she said.\n\nHe walked on.');
  assert.ok(ratio > 0.3 && ratio < 0.4, `ratio was ${ratio}`);
  assert.equal(dialogueRatio('all narration here\nno quotes'), 0);
});

test('parseJSONLoose handles fences and surrounding prose', () => {
  assert.deepEqual(parseJSONLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJSONLoose('Sure! Here: [{"a":2}] hope this helps'), [{ a: 2 }]);
  assert.throws(() => parseJSONLoose('no json at all'));
});

test('ids are prefixed and stable', () => {
  const id = findingId(3, 'banned-phrase', 'same');
  assert.equal(id, findingId(3, 'banned-phrase', 'same'));
  assert.ok(id.startsWith('find_c3_banned-phrase_'));
  assert.ok(lessonId('style', 'x').startsWith('les_styl_'));
});

test('localDate formats y-m-d and nextLocalTime moves forward', () => {
  const d = new Date(2026, 4, 9, 12, 0, 0);
  assert.equal(localDate(d), '2026-05-09');
  const from = new Date(2026, 4, 9, 12, 0, 0);
  const next = nextLocalTime(9, 0, from);
  assert.equal(new Date(next).getHours(), 9);
  assert.ok(next > from.getTime());
});
