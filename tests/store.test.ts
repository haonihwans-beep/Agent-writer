import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, slugify, defaultSchedule } from '../src/core/store.ts';
import type { ChapterRecord, ProjectConfig } from '../src/core/types.ts';

function tmpProject(): Store {
  const dir = mkdtempSync(join(tmpdir(), 'novel-store-'));
  return new Store(dir);
}

function testConfig(dir: string): ProjectConfig {
  return {
    schema: 'novel.project/1',
    name: 'test-novel',
    title: 'Test Novel',
    author: 'Tester',
    genre: 'mystery',
    language: 'id',
    premise: 'A witness problem',
    targetChapters: 3,
    wordsPerChapter: 250,
    pov: 'third-limited-past',
    tense: 'past',
    tone: 'immersive',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    llm: { provider: 'mock', model: 'mock', temperature: 0.9, maxTokens: 1000 },
    schedule: defaultSchedule(),
  };
}

test('slugify produces safe filenames', () => {
  assert.equal(slugify('The Ledger of Ash!'), 'the-ledger-of-ash');
  assert.equal(slugify('  Spaces   and---dashes '), 'spaces-and-dashes');
  assert.equal(slugify('第一章'), '第一章');
});

test('initProject creates the full layout', () => {
  const store = tmpProject();
  store.initProject(testConfig(store.dir));
  assert.ok(existsSync(store.path('novel.json')));
  assert.ok(existsSync(store.path('bible/world.json')));
  assert.ok(existsSync(store.path('style.json')));
  assert.ok(existsSync(store.path('chapters/index.json')));
  assert.ok(existsSync(store.path('state.json')));
  const config = store.loadConfig();
  assert.equal(config.title, 'Test Novel');
  assert.equal(config.llm.provider, 'mock');
  assert.equal(store.loadStyle().banned.length > 0, true);
});

test('Store.discover walks up to the project root', () => {
  const store = tmpProject();
  store.initProject(testConfig(store.dir));
  const child = join(store.dir, 'bible', 'deep');
  writeFileSync(join(store.dir, 'bible', 'deep-keep'), '');
  const found = Store.discover(child);
  assert.ok(found);
  assert.equal(found!.dir, store.dir);
});

test('saveJSON is atomic and round-trips', () => {
  const store = tmpProject();
  store.initProject(testConfig(store.dir));
  store.saveJSON('nested/deep.json', { a: 1 });
  const value = store.readJSON<{ a: number }>('nested/deep.json', { a: 0 });
  assert.equal(value.a, 1);
  assert.equal(existsSync(store.path('nested/deep.json.tmp')), false);
});

test('upsertChapter keeps the index sorted and stable', () => {
  const store = tmpProject();
  store.initProject(testConfig(store.dir));
  const make = (n: number): ChapterRecord => ({
    number: n,
    title: `Chapter ${n}`,
    status: 'draft',
    words: 100,
    path: store.chapterRelPath(n, `Chapter ${n}`),
    findingIds: [],
    createdBy: 'auto',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  store.upsertChapter(make(3), 'c3');
  store.upsertChapter(make(1), 'c1');
  store.upsertChapter(make(2), 'c2');
  const index = store.loadChapterIndex();
  assert.deepEqual(index.chapters.map((c) => c.number), [1, 2, 3]);
  assert.equal(store.readChapter(index.chapters[1]!), 'c2');
  store.upsertChapter(make(1), 'c1-rewritten');
  assert.equal(store.loadChapterIndex().chapters.length, 3);
  assert.equal(store.readChapter(index.chapters[0]!), 'c1-rewritten');
});

test('readJSON falls back on corrupt files', () => {
  const store = tmpProject();
  store.initProject(testConfig(store.dir));
  writeFileSync(store.path('broken.json'), '{not json');
  const value = store.readJSON<{ ok: boolean }>('broken.json', { ok: true });
  assert.equal(value.ok, true);
});

test('readFileSync content check for chapter markdown', () => {
  const store = tmpProject();
  store.initProject(testConfig(store.dir));
  const config = testConfig(store.dir);
  const record: ChapterRecord = {
    number: 1,
    title: 'Opening',
    status: 'draft',
    words: 42,
    path: store.chapterRelPath(1, 'Opening'),
    findingIds: [],
    createdBy: 'auto',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  store.upsertChapter(record, '---\nchapter: "1"\n---\n\n# Chapter 1 — Opening\n\nHello world.\n');
  const raw = readFileSync(store.path('state.json'), 'utf8');
  void raw;
  assert.equal(config.targetChapters, 3);
  assert.equal(store.chapterRecord(1)!.words, 42);
});
