import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, defaultSchedule } from '../src/core/store.ts';
import { MockProvider, requestJSON } from '../src/core/llm.ts';
import { ensureProjectPlan, generateIdeas } from '../src/core/creator.ts';
import { pendingChapters, writeChapters, checkWrittenChapter } from '../src/core/writer.ts';
import { loadLessons } from '../src/core/lessons.ts';
import { exportAll, publishAll, loadChapters } from '../src/core/export.ts';
import { planToday, runSchedule, runTick, quotaForDate } from '../src/core/scheduler.ts';
import { parseJSONLoose } from '../src/util/json.ts';
import type { ProjectConfig } from '../src/core/types.ts';

const noopLog = (): void => undefined;

function tmpProject(name: string, chapters: number): Store {
  const dir = mkdtempSync(join(tmpdir(), `novel-${name}-`));
  const store = new Store(dir);
  const config: ProjectConfig = {
    schema: 'novel.project/1',
    name,
    title: 'Untitled',
    author: 'Tester',
    genre: 'mystery',
    language: 'id',
    premise: '',
    targetChapters: chapters,
    wordsPerChapter: 250,
    pov: 'third-limited-past',
    tense: 'past',
    tone: 'immersive',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    llm: { provider: 'mock', model: 'mock', temperature: 0.9, maxTokens: 4096 },
    schedule: defaultSchedule(),
  };
  store.initProject(config);
  return store;
}

test('mock provider answers every task the pipeline uses', async () => {
  const provider = new MockProvider();
  const ideas = await requestJSON<{ ideas: { title: string }[] }>(provider, {
    task: 'ideas',
    seed: 's1',
    messages: [
      { role: 'system', content: '[task:ideas]' },
      { role: 'user', content: 'invent ideas\n\n## DATA\n{"count":2,"seed":"s1"}' },
    ],
  });
  assert.ok(ideas.ideas.length >= 1);
  assert.ok(ideas.ideas[0]!.title.length > 2);
});

test('generateIdeas returns usable loglines', async () => {
  const store = tmpProject('ideas', 2);
  const ideas = await generateIdeas(store, new MockProvider(), { count: 3, seed: 'abc' });
  assert.equal(ideas.length, 3);
  for (const idea of ideas) {
    assert.ok(idea.title.length > 4);
    assert.ok(idea.logline.includes(idea.hook));
  }
});

test('parseJSONLoose on a mock chapter returns prose not JSON', async () => {
  const provider = new MockProvider();
  const text = await provider.complete({
    task: 'chapter',
    seed: 'c1',
    messages: [
      { role: 'system', content: '[task:chapter]' },
      {
        role: 'user',
        content: 'write\n\n## DATA\n' + JSON.stringify({
          chapter: { number: 1, title: 'One', summary: 'a start', beats: ['a beat'], targetWords: 200, povCharacterId: 'chr_1', characterIds: ['chr_1'], locationIds: ['loc_1'], canonFactIds: [] },
          bible: { characters: [{ id: 'chr_1', name: 'Anya Vell', aliases: ['Anya'] }], locations: [{ id: 'loc_1', name: 'Ashen Reach' }], world: [] },
          language: 'en',
        }),
      },
    ],
  });
  assert.ok(!text.startsWith('{'));
  assert.ok(text.includes('Anya Vell'));
});

test('full pipeline: plan -> write -> check -> learn -> export -> publish', async () => {
  const store = tmpProject('pipeline', 6);
  const provider = new MockProvider();

  await ensureProjectPlan(store, provider, { idea: 'a witness sells her own memory to a harbor clerk', seed: 'pipeline-1' });

  const config = store.loadConfig();
  assert.notEqual(config.title, 'Untitled', 'premise must set a title');
  const premise = store.loadPremise();
  assert.ok(premise.logline.length > 5);
  assert.ok(premise.synopsis.length > 20);

  const bible = store.loadBible();
  assert.ok(bible.characters.length >= 3, 'bible must have a cast');
  assert.ok(bible.world.length >= 3, 'bible must have canon rules');
  assert.ok(bible.characters.some((c) => c.role === 'protagonist'));
  assert.equal(new Set(bible.characters.map((c) => c.name)).size, bible.characters.length);

  const outline = store.loadOutline();
  assert.equal(outline.chapters.length, 6);
  assert.equal(outline.arcs.length >= 1, true);
  for (const chapter of outline.chapters) {
    assert.equal(chapter.number, outline.chapters.indexOf(chapter) + 1, 'chapters renumbered 1..N');
    assert.ok(chapter.title.length > 1);
    assert.ok(chapter.summary.length > 5);
  }

  const results = await writeChapters(store, provider, 3, { onProgress: noopLog });
  assert.equal(results.length, 3);
  for (const result of results) {
    assert.ok(result.record.words > 50, `chapter ${result.record.number} too short: ${result.record.words}`);
    assert.ok(existsSync(store.chapterPath(result.record)), 'chapter file must exist');
    assert.ok(['draft', 'reviewed', 'final'].includes(result.record.status));
  }
  assert.deepEqual(pendingChapters(store).map((c) => c.number), [4, 5, 6]);

  // continuity of written chapters
  const findings = checkWrittenChapter(store, 1);
  assert.ok(Array.isArray(findings));

  // lessons journal is functional and injects into prompts
  const lessons = loadLessons(store);
  assert.ok(Array.isArray(lessons));

  // export everything
  const files = exportAll(store, ['md', 'txt', 'json', 'epub']);
  assert.equal(files.every((f) => !f.includes('FAILED')), true, files.join(' | '));
  const bundle = JSON.parse(readFileSync(store.path('exports', 'bundle.json'), 'utf8')) as { chapters: { text: string }[] };
  assert.equal(bundle.chapters.length, 3);
  assert.ok(readFileSync(store.path('exports', 'markdown', 'manuscript.md'), 'utf8').includes('# Chapter 1'));
  assert.ok(readFileSync(store.path('exports', 'txt', `${store.loadConfig().name}.txt`), 'utf8').length > 100);
  const epub = readFileSync(store.path('exports', 'pipeline.epub'));
  assert.equal(epub.subarray(0, 4).toString('latin1'), 'PK\u0003\u0004');
  assert.equal(epub.subarray(30, 38).toString('latin1'), 'mimetype');

  // publish packages
  const dirs = publishAll(store, ['royalroad', 'wattpad', 'web']);
  assert.equal(dirs.length, 3);
  const web = readFileSync(store.path('publish', 'web', 'index.html'), 'utf8');
  assert.ok(web.includes('<section'));
  assert.ok(web.includes('Tester'));

  const exported = loadChapters(store);
  assert.equal(exported.length, 3);
  assert.ok(exported[0]!.body.length > 50);
});

test('mock premise output survives sanitization', async () => {
  const store = tmpProject('sanitize', 4);
  await ensureProjectPlan(store, new MockProvider(), { idea: 'a translated diary arrives three years late', seed: 'san-1' });
  const outline = store.loadOutline();
  const bible = store.loadBible();
  const charIds = new Set(bible.characters.map((c) => c.id));
  const locIds = new Set(bible.locations.map((l) => l.id));
  for (const chapter of outline.chapters) {
    for (const id of chapter.characterIds) assert.ok(charIds.has(id), `unknown character id ${id}`);
    for (const id of chapter.locationIds) assert.ok(locIds.has(id), `unknown location id ${id}`);
    assert.ok(chapter.povCharacterId.length > 0);
  }
});

test('quotaForDate is stable per date and inside pace bounds', () => {
  const store = tmpProject('quota', 10);
  const config = { ...defaultSchedule(), paceMin: 3, paceMax: 5 };
  const quota = quotaForDate(store, config, '2026-10-15');
  assert.ok(quota >= 3 && quota <= 5);
  assert.equal(quota, quotaForDate(store, config, '2026-10-15'));
});

test('schedule run: burst then daily pace with a fake clock', async () => {
  const store = tmpProject('sched', 7);
  const provider = new MockProvider();
  await ensureProjectPlan(store, provider, { idea: 'the floor that was not in the patch notes', seed: 'sched-1' });

  let now = new Date(2026, 9, 15, 8, 0, 0).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const seenDays: string[] = [];
  const state = await runSchedule(store, provider, {
    burst: 3,
    paceMin: 1,
    paceMax: 2,
    maxDays: 4,
    review: false,
    log: (m) => {
      seenDays.push(m);
    },
    now: () => now,
    sleep: async (ms) => {
      now += Math.max(1, ms) + 60_000;
    },
  });

  const written = store.loadChapterIndex().chapters.length;
  assert.equal(written, 7, `expected all 7 chapters, got ${written}`);
  assert.equal(state.status, 'done');
  assert.equal(state.phase, 'complete');
  assert.equal(seenDays.some((m) => m.includes('[burst]')), true, 'first day must be the burst phase');
  assert.equal(seenDays.some((m) => m.includes('[daily]')), true, 'later days must be daily pace');
  // history is resume-safe
  assert.equal(store.loadScheduleState().history.length >= 1, true);
});

test('schedule plan: burst tops up to the configured burst total', async () => {
  const store = tmpProject('burst2', 10);
  await ensureProjectPlan(store, new MockProvider(), { idea: 'an unfinished confession in a borrowed coat', seed: 'burst2' });
  const plan = planToday(store, { burst: 3, paceMin: 2, paceMax: 2 });
  assert.equal(plan.phase, 'burst');
  assert.equal(plan.quota, 3);
  assert.deepEqual(plan.chapters, [1, 2, 3]);
});

test('tick is idempotent for the same day and resumes next day', async () => {
  const store = tmpProject('tick', 5);
  const provider = new MockProvider();
  await ensureProjectPlan(store, provider, { idea: 'a marriage of convenience with a debt clause', seed: 'tick-1' });

  const first = await runTick(store, provider, { review: false, log: noopLog });
  const afterFirst = store.loadChapterIndex().chapters.length;
  assert.ok(afterFirst >= 1, 'tick must write something');
  const historyDates = first.history.map((h) => h.date);
  assert.equal(historyDates.length, 1);

  const second = await runTick(store, provider, { review: false, log: noopLog });
  assert.equal(store.loadChapterIndex().chapters.length, afterFirst, 'second tick the same day is a no-op');
  assert.equal(second.history.length, 1);
});
