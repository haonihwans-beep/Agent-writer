import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store, defaultSchedule } from '../src/core/store.ts';
import { activeLessons, addUserLesson, dismissLesson, learnFromFinding, learnFromFindings, lessonStats, loadLessons, normalizeMessage } from '../src/core/lessons.ts';
import type { Finding, ProjectConfig } from '../src/core/types.ts';

function tmpProject(): Store {
  const dir = mkdtempSync(join(tmpdir(), 'novel-lessons-'));
  const store = new Store(dir);
  const config: ProjectConfig = {
    schema: 'novel.project/1',
    name: 'les',
    title: 'Lessons',
    author: 'Tester',
    genre: 'mystery',
    language: 'id',
    premise: '',
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
  store.initProject(config);
  return store;
}

function finding(code: Finding['code'], message: string, severity: Finding['severity'] = 'warn'): Finding {
  return { id: `find_x_${code}_${Math.random().toString(36).slice(2, 6)}`, chapter: 1, code, severity, message, excerpt: '...', suggestion: 'fix it' };
}

test('normalizeMessage collapses numbers and excerpts', () => {
  assert.equal(normalizeMessage('Chapter is 200 words under target 2500'), normalizeMessage('chapter is 900 words under target 1500'));
  assert.notEqual(normalizeMessage('Chapter is short'), normalizeMessage('Banned phrase: delve'));
});

test('the same mistake becomes one lesson with rising hits', () => {
  const store = tmpProject();
  learnFromFinding(store, finding('banned-phrase', 'Banned phrase: "delve"'));
  learnFromFinding(store, finding('banned-phrase', 'Banned phrase: "tapestry"'));
  const lessons = loadLessons(store);
  assert.equal(lessons.length, 1);
  assert.equal(lessons[0]!.hits, 2);
});

test('errors escalate severity', () => {
  const store = tmpProject();
  learnFromFinding(store, finding('age-contradiction', 'Anya is canon age 24 but text implies 30', 'error'));
  learnFromFinding(store, finding('age-contradiction', 'Anya is canon age 24 but text implies 31', 'error'), 'fix');
  const lesson = loadLessons(store)[0]!;
  assert.equal(lesson.severity, 'error');
  assert.equal(lesson.hits, 2);
});

test('info findings are not learned', () => {
  const store = tmpProject();
  const learned = learnFromFindings(store, [finding('dialogue-ratio', 'too little talk', 'info')]);
  assert.equal(learned.length, 0);
});

test('active lessons sort errors first then by hits', () => {
  const store = tmpProject();
  learnFromFinding(store, finding('weak-hook', 'weak hook here', 'warn'));
  learnFromFinding(store, finding('weak-hook', 'weak hook here', 'warn'));
  learnFromFinding(store, finding('dead-character', 'Hesk is dead', 'error'));
  const active = activeLessons(store);
  assert.equal(active.length, 2, 'repeated warnings collapse into one lesson');
  assert.equal(active[0]!.severity, 'error');
  assert.equal(active[0]!.category, 'continuity');
});

test('user lessons can be added and dismissed', () => {
  const store = tmpProject();
  const lesson = addUserLesson(store, 'Jangan gunakan kata "sang" di dialog');
  assert.equal(activeLessons(store).length, 1);
  assert.equal(dismissLesson(store, lesson.id), true);
  assert.equal(activeLessons(store).length, 0);
  assert.equal(lessonStats(store).total, 1);
  assert.equal(dismissLesson(store, 'les_nope_1234'), false);
});

test('readding a user lesson un-dismisses it', () => {
  const store = tmpProject();
  const first = addUserLesson(store, 'hindari bingkai cerita');
  dismissLesson(store, first.id);
  const again = addUserLesson(store, 'hindari bingkai cerita');
  assert.equal(again.dismissed, false);
  assert.equal(again.hits, 2);
});
