#!/usr/bin/env node
/* eslint-disable no-console */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProjectConfig, ProviderName } from './core/types.ts';
import { Store, defaultLLMConfig, defaultSchedule, slugify } from './core/store.ts';
import { createProvider, LLMError, type LLMProvider } from './core/llm.ts';
import { buildPremise, ensureProjectPlan, generateIdeas } from './core/creator.ts';
import { checkWrittenChapter, pendingChapters, writeChapter, writeChapters } from './core/writer.ts';
import { activeLessons, addUserLesson, dismissLesson, lessonStats } from './core/lessons.ts';
import { cronLine, planToday, runSchedule, runTick } from './core/scheduler.ts';
import { exportAll, exportEpub, exportJson, exportMarkdown, exportTxt, publishAll, type ExportFormat, type PublishTarget } from './core/export.ts';
import { checkContinuity } from './core/critic.ts';
import { wordCount } from './util/text.ts';
import { bar, log } from './util/log.ts';

/* ------------------------------------------------------------------ */
/* arg parsing                                                        */
/* ------------------------------------------------------------------ */

interface ParsedArgs {
  flags: Map<string, string | true>;
  positionals: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const eq = key.indexOf('=');
      if (eq !== -1) {
        flags.set(key.slice(0, eq), key.slice(eq + 1));
      } else if (i + 1 < argv.length && !argv[i + 1]!.startsWith('--')) {
        flags.set(key, argv[++i]!);
      } else {
        flags.set(key, true);
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      flags.set(arg.slice(1), true);
    } else {
      positionals.push(arg);
    }
  }
  return { flags, positionals };
}

function flagString(flags: ParsedArgs['flags'], key: string, fallback?: string): string | undefined {
  const value = flags.get(key);
  if (value === true) return fallback;
  return typeof value === 'string' ? value : fallback;
}

function flagNumber(flags: ParsedArgs['flags'], key: string, fallback: number): number {
  const value = flags.get(key);
  if (typeof value !== 'string') return fallback;
  const n = Number(value);
  if (Number.isNaN(n)) throw new Error(`--${key} expects a number, got "${value}"`);
  return n;
}

function flagBool(flags: ParsedArgs['flags'], key: string, fallback: boolean): boolean {
  const value = flags.get(key);
  if (value === undefined) return fallback;
  if (value === 'true' || value === true) return true;
  if (value === 'false') return false;
  return value === '';
}

function flagList(flags: ParsedArgs['flags'], key: string): string[] {
  const value = flags.get(key);
  if (typeof value !== 'string') return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* shared helpers                                                     */
/* ------------------------------------------------------------------ */

function resolveProject(flags: ParsedArgs['flags']): Store {
  const explicit = flagString(flags, 'project');
  if (typeof explicit === 'string') return new Store(resolve(explicit));
  const found = Store.discover();
  if (!found) {
    throw new Error('no novel project found. Run `novel new --idea "..."` first, or pass --project <dir>.');
  }
  return found;
}

function makeProvider(store: Store, flags: ParsedArgs['flags']): LLMProvider {
  const config = store.loadConfig();
  const providerName = (flagString(flags, 'provider') ?? config.llm.provider) as ProviderName;
  return createProvider({ ...config, llm: { ...config.llm, provider: providerName } });
}

function paceBounds(flags: ParsedArgs['flags'], store: Store): { paceMin: number; paceMax: number; burst: number } {
  const schedule = store.loadConfig().schedule;
  const raw = flagString(flags, 'pace');
  if (raw) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(raw.trim());
    if (!m) throw new Error(`--pace must look like 3-5 or 4, got "${raw}"`);
    const min = Number(m[1]);
    const max = m[2] ? Number(m[2]) : min;
    return { paceMin: min, paceMax: Math.max(min, max), burst: flagNumber(flags, 'burst', schedule.burst) };
  }
  return {
    paceMin: flagNumber(flags, 'pace-min', schedule.paceMin),
    paceMax: flagNumber(flags, 'pace-max', schedule.paceMax),
    burst: flagNumber(flags, 'burst', schedule.burst),
  };
}

function planSteps(store: Store): string[] {
  const steps: string[] = [];
  const config = store.loadConfig();
  const premise = store.loadPremise();
  if (!premise.logline || config.title === 'Untitled') steps.push('premise');
  if (store.loadBible().characters.length === 0) steps.push('bible');
  if (store.loadOutline().chapters.length === 0) steps.push('outline');
  return steps;
}

function printFindings(findings: { chapter: number; code: string; severity: string; message: string; suggestion: string }[]): void {
  const order: Record<string, number> = { error: 0, warn: 1, info: 2 };
  const sorted = [...findings].sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3) || a.chapter - b.chapter);
  for (const f of sorted) {
    const marker = f.severity === 'error' ? '✗' : f.severity === 'warn' ? '!' : '·';
    log.warn(`ch${f.chapter} [${f.code}] ${marker} ${f.message}`);
    if (f.suggestion) log.dim(`    → ${f.suggestion}`);
  }
}

/* ------------------------------------------------------------------ */
/* commands                                                           */
/* ------------------------------------------------------------------ */

async function cmdNew(flags: ParsedArgs['flags'], positionals: string[]): Promise<void> {
  const idea = positionals.join(' ');
  const surprise = flagBool(flags, 'surprise', false);
  const name = flagString(flags, 'name') ?? slugify(idea || `novel-${Date.now().toString(36)}`) ?? 'novel';
  const dir = flagString(flags, 'dir') ?? join(process.cwd(), 'novels', name);
  const store = new Store(resolve(dir));
  if (store.exists()) {
    throw new Error(`project already exists at ${store.dir} (use \`novel start\` inside it)`);
  }
  const language = flagString(flags, 'lang') ?? 'id';
  const genre = flagString(flags, 'genre') ?? '';
  const chapters = flagNumber(flags, 'chapters', 30);
  const words = flagNumber(flags, 'words', 2500);

  let chosen = idea;
  const seed = flagString(flags, 'seed') ?? `${name}:${Date.now()}`;

  store.initProject({
    ...emptyStoreConfig(name, language, chapters),
    title: (flagString(flags, 'title') ?? 'Untitled').slice(0, 120),
    author: flagString(flags, 'author') ?? (process.env['NOVEL_AUTHOR'] ?? 'Agent-writer'),
    genre: genre || 'literary',
    targetChapters: chapters,
    wordsPerChapter: words,
  } as ProjectConfig);

  if (!chosen && surprise) {
    const seedBase = flagString(flags, 'seed') ?? String(Date.now());
    const provider = makeProvider(store, flags);
    const ideas = await generateIdeas(store, provider, { count: 1, genre, seed: seedBase });
    chosen = ideas[0]!.logline;
    log.step(`surprise idea: "${ideas[0]!.title}" — ${chosen}`);
  }

  const provider = makeProvider(store, flags);
  log.step('building premise…');
  await buildPremise(store, provider, { idea: chosen || 'a fresh original webnovel', genre: genre || 'literary', targetChapters: chapters, seed });
  log.step('building world bible…');
  log.step('building outline…');
  await ensureProjectPlan(store, provider, { idea: chosen ?? 'a fresh original webnovel', seed });

  const config = store.loadConfig();
  log.ok(`project ready at ${store.dir}`);
  log.title(config.title);
  log.dim(`chapters: ${config.targetChapters} · words/chapter: ${config.wordsPerChapter} · language: ${config.language}`);
  log.dim('next: `novel write --all 30` or `novel schedule run`');
}

function emptyStoreConfig(name: string, language: string, chapters: number) {
  return {
    schema: 'novel.project/1' as const,
    name,
    title: 'Untitled',
    author: 'Agent-writer',
    genre: 'literary',
    language,
    premise: '',
    targetChapters: chapters,
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

async function cmdStart(flags: ParsedArgs['flags'], positionals: string[]): Promise<void> {
  const store = resolveProject(flags);
  const idea = positionals.join(' ') || flagString(flags, 'idea') || '';
  const steps = planSteps(store);
  if (steps.length === 0 && !flagBool(flags, 'force', false)) {
    log.ok('plan already complete; use --force to rebuild');
    return;
  }
  const provider = makeProvider(store, flags);
  const seed = flagString(flags, 'seed') ?? store.loadConfig().name;
  if (steps.includes('premise')) {
    if (!idea) throw new Error('no premise yet: pass --idea "..." or --surprise');
    log.step('building premise…');
    const target = flagNumber(flags, 'chapters', store.loadConfig().targetChapters);
    await buildPremise(store, provider, { idea, genre: flagString(flags, 'genre') ?? store.loadConfig().genre, targetChapters: target, seed });
  }
  log.step('building world, characters and outline (any missing phase)…');
  await ensureProjectPlan(store, provider, { idea: idea || store.loadConfig().premise, seed });
  const outline = store.loadOutline();
  log.ok(`plan complete: ${outline.chapters.length} chapters, ${outline.arcs.length} arcs, ${store.loadBible().characters.length} characters`);
}

async function cmdWrite(flags: ParsedArgs['flags'], positionals: string[]): Promise<void> {
  const store = resolveProject(flags);
  const provider = makeProvider(store, flags);
  const countArg = positionals[0];
  const count = countArg ? Number(countArg) : flagBool(flags, 'all', false) ? pendingChapters(store).length : flagNumber(flags, 'count', 1);
  if (Number.isNaN(count)) throw new Error(`count must be a number, got "${countArg}"`);
  const queue = pendingChapters(store);
  if (queue.length === 0) {
    log.ok('all chapters written');
    return;
  }
  log.step(`writing ${Math.min(count, queue.length)} of ${queue.length} pending chapter(s)…`);
  const results = await writeChapters(store, provider, count, {
    autoFix: flagBool(flags, 'fix', true),
    review: flagBool(flags, 'review', true),
    onProgress: (m) => log.step(m),
  });
  const errors = results.flatMap((r) => r.findings).filter((f) => f.severity === 'error');
  const words = results.reduce((s, r) => s + wordCount(r.text ? r.text : ''), 0);
  log.ok(`wrote ${results.length} chapter(s), ${results.reduce((s, r) => s + r.record.words, 0)} words, ${errors.length} unresolved error(s)`);
  void words;
}

async function cmdCheck(flags: ParsedArgs['flags'], positionals: string[]): Promise<void> {
  const store = resolveProject(flags);
  const index = store.loadChapterIndex().chapters;
  if (index.length === 0) {
    log.warn('no written chapters to check');
    return;
  }
  const target = positionals[0] ? Number(positionals[0]) : undefined;
  const numbers = target ? [target] : index.map((c) => c.number);
  const findings = [];
  for (const number of numbers) {
    const found = checkWrittenChapter(store, number);
    findings.push(...found);
  }
  const stats = lessonStats(store);
  if (findings.length === 0) {
    log.ok(`checked ${numbers.length} chapter(s): clean`);
  } else {
    log.warn(`checked ${numbers.length} chapter(s): ${findings.length} finding(s)`);
    printFindings(findings);
  }
  log.dim(`lesson journal: ${stats.active} active of ${stats.total} total`);
}

async function cmdFix(flags: ParsedArgs['flags'], positionals: string[]): Promise<void> {
  const store = resolveProject(flags);
  const provider = makeProvider(store, flags);
  const number = positionals[0] ? Number(positionals[0]) : undefined;
  if (number === undefined) throw new Error('usage: novel fix <chapter-number>');
  const record = store.chapterRecord(number);
  if (!record) throw new Error(`chapter ${number} not written yet`);
  const result = await writeChapter(store, provider, store.loadOutline().chapters.find((c) => c.number === number)!, {
    autoFix: true,
    review: flagBool(flags, 'review', true),
    onProgress: (m) => log.step(m),
  });
  log.ok(`chapter ${number} re-drafted: ${result.record.words} words, status ${result.record.status}`);
}

async function cmdLearn(flags: ParsedArgs['flags'], positionals: string[]): Promise<void> {
  const store = resolveProject(flags);
  const sub = positionals[0] ?? 'list';
  if (sub === 'add') {
    const note = positionals.slice(1).join(' ');
    if (!note) throw new Error('usage: novel learn add "<note the agent should remember>"');
    const lesson = addUserLesson(store, note, (flagString(flags, 'category') ?? 'user-feedback') as never);
    log.ok(`lesson ${lesson.id} added — it will be injected into future chapter prompts`);
    return;
  }
  if (sub === 'dismiss') {
    const id = positionals[1];
    if (!id || !dismissLesson(store, id)) throw new Error(`lesson ${id ?? ''} not found`);
    log.ok(`lesson ${id} dismissed (it will no longer be injected)`);
    return;
  }
  const stats = lessonStats(store);
  const lessons = activeLessons(store, 50);
  log.title(`Lesson journal — ${stats.active} active / ${stats.total} total`);
  for (const l of lessons) {
    log.dim(`[${l.severity}] ${l.id} (${l.category}, ×${l.hits}, from ${l.source}): ${l.note}`);
  }
}

async function cmdStatus(flags: ParsedArgs['flags']): Promise<void> {
  const store = resolveProject(flags);
  const config = store.loadConfig();
  const index = store.loadChapterIndex().chapters;
  const outline = store.loadOutline();
  const state = store.loadScheduleState();
  const lessons = lessonStats(store);
  const words = index.reduce((s, c) => s + c.words, 0);
  const done = index.length;
  const total = outline.chapters.length || config.targetChapters;
  log.title(`${config.title} — ${config.author}`);
  log.info(`chapters: ${done}/${total} ${bar(total > 0 ? done / total : 0)} · words: ${words.toLocaleString()}`);
  log.info(`genres: ${config.genre} · language: ${config.language} · words/chapter: ${config.wordsPerChapter}`);
  const plan = planToday(store);
  const remaining = outline.chapters.filter((c) => !index.some((r) => r.number === c.number)).length;
  log.info(`pending: ${remaining} · today's plan: ${plan.quota} chapter(s) [${plan.phase}]`);
  log.info(`schedule: ${state.status} ${state.phase} · runs: ${state.history.length} · last: ${state.lastRunAt ?? '—'}`);
  log.info(`lessons: ${lessons.active} active / ${lessons.total} total`);
  const trend = index.slice(-20).map((c) => c.findingIds.length);
  if (trend.length > 0) {
    const max = Math.max(1, ...trend);
    log.dim(`findings per recent chapter: ${trend.map((n) => (max > 8 ? '▁▃▅▇'[Math.min(3, Math.floor((n / max) * 4))] : '·').repeat(1)).join('')} (${trend.join(', ')})`);
  }
  const first = index[0];
  const last = index[index.length - 1];
  if (first && last && first.findingIds.length > 0) {
    const improvement = last.findingIds.length < first.findingIds.length;
    log.dim(`self-learning: ${improvement ? 'improving' : 'flat/worse'} — ch1: ${first.findingIds.length} findings, latest: ${last.findingIds.length}`);
  }
}

async function cmdOutline(flags: ParsedArgs['flags']): Promise<void> {
  const store = resolveProject(flags);
  const outline = store.loadOutline();
  log.title(`Outline — ${outline.arcs.length} arc(s), ${outline.chapters.length} chapter(s)`);
  for (const arc of outline.arcs) {
    log.info(`Arc ${arc.id}: "${arc.title}" (ch ${arc.fromChapter}–${arc.toChapter})`);
    log.dim(`  objective: ${arc.objective}`);
  }
  const pending = pendingChapters(store).map((c) => c.number);
  log.dim(`pending: ${pending.length > 0 ? pending.slice(0, 20).join(', ') + (pending.length > 20 ? '…' : '') : 'none'}`);
}

async function cmdCanon(flags: ParsedArgs['flags']): Promise<void> {
  const store = resolveProject(flags);
  const bible = store.loadBible();
  log.title(`Bible — ${bible.characters.length} characters, ${bible.locations.length} locations, ${bible.factions.length} factions, ${bible.world.length} canon rules`);
  for (const c of bible.characters) {
    log.info(`${c.name} (${c.id}) ${c.role}, ${c.status}, ${c.age ?? '?'}y`);
    log.dim(`  wants: ${c.motivation} · voice: ${c.voice}`);
  }
  for (const l of bible.locations) log.info(`· ${l.name} (${l.region}) — ${l.description}`);
  for (const f of bible.world) log.info(`# ${f.id} [${f.category}] ${f.statement}`);
}

async function cmdSchedule(flags: ParsedArgs['flags'], positionals: string[]): Promise<void> {
  const store = resolveProject(flags);
  const sub = positionals[0] ?? 'run';
  if (sub === 'cron') {
    const nodePath = process.execPath;
    const cliPath = process.argv[1] ? resolve(process.argv[1]) : fileURLToPath(import.meta.url);
    log.info('add this to your crontab (crontab -e) to run one production day per day:');
    console.log(cronLine(store, cliPath, nodePath));
    return;
  }
  if (sub === 'status') {
    await cmdStatus(flags);
    return;
  }
  const provider = makeProvider(store, flags);
  const pace = paceBounds(flags, store);
  if (sub === 'run') {
    const maxDays = flags.has('max-days') ? flagNumber(flags, 'max-days', 9999) : undefined;
    const noExport = flagBool(flags, 'no-export', false);
    const abort = new AbortController();
    const onSigint = (): void => {
      log.warn('SIGINT received — finishing the running chapter then stopping');
      abort.abort();
    };
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigint);
    try {
      const state = await runSchedule(store, provider, {
        ...pace,
        maxDays,
        autoFix: !flagBool(flags, 'no-fix', false),
        review: !flagBool(flags, 'no-review', false),
        signal: abort.signal,
        log: (m) => log.step(m),
        onComplete: noExport
          ? undefined
          : async (s) => {
              log.step('exporting + packaging for publication…');
              const files = exportAll(s, ['md', 'txt', 'json', 'epub']);
              const dirs = publishAll(s, ['royalroad', 'wattpad', 'web']);
              log.ok(`exported: ${files.join(', ')}`);
              log.ok(`publish packages: ${dirs.join(', ')}`);
            },
      });
      log.ok(`schedule ${state.status}: ${store.loadChapterIndex().chapters.length} chapter(s) written`);
    } finally {
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigint);
    }
    return;
  }
  if (sub === 'tick') {
    const state = await runTick(store, provider, {
      autoFix: !flagBool(flags, 'no-fix', false),
      review: !flagBool(flags, 'no-review', false),
      log: (m) => log.step(m),
    });
    log.ok(`tick done: ${store.loadChapterIndex().chapters.length} chapter(s) written, status ${state.status}`);
    return;
  }
  throw new Error(`unknown schedule subcommand "${sub}" (run | tick | cron | status)`);
}

async function cmdExport(flags: ParsedArgs['flags'], positionals: string[]): Promise<void> {
  const store = resolveProject(flags);
  const requested = positionals.length > 0 ? positionals : flagList(flags, 'format');
  if (requested.length === 0) {
    const files = exportAll(store, ['md', 'txt', 'json', 'epub']);
    log.ok(`exported all: ${files.join(', ')}`);
    return;
  }
  const written: string[] = [];
  for (const format of requested) {
    switch (format) {
      case 'md':
        written.push(exportMarkdown(store));
        break;
      case 'txt':
        written.push(exportTxt(store));
        break;
      case 'json':
        written.push(exportJson(store));
        break;
      case 'epub':
        written.push(exportEpub(store));
        break;
      default:
        throw new Error(`unknown format "${format}" (md | txt | json | epub)`);
    }
  }
  log.ok(`exported: ${written.join(', ')}`);
}

async function cmdPublish(flags: ParsedArgs['flags'], positionals: string[]): Promise<void> {
  const store = resolveProject(flags);
  const requested = positionals.length > 0 ? positionals : flagList(flags, 'targets');
  const targets: PublishTarget[] = requested.length > 0 ? (requested as PublishTarget[]) : ['royalroad', 'wattpad', 'web'];
  for (const t of targets) {
    if (!['royalroad', 'wattpad', 'web'].includes(t)) throw new Error(`unknown publish target "${t}" (royalroad | wattpad | web)`);
  }
  const dirs = publishAll(store, targets);
  log.ok(`publish packages: ${dirs.join(', ')}`);
}

async function cmdIdea(flags: ParsedArgs['flags'], positionals: string[]): Promise<void> {
  const store = resolveProject(flags);
  const provider = makeProvider(store, flags);
  const guideline = positionals.join(' ');
  const surprise = flagBool(flags, 'surprise', false);
  const count = flagNumber(flags, 'count', 5);
  const seed = flagString(flags, 'seed') ?? store.loadConfig().name;
  const ideaText = surprise ? `${guideline} ${seed}` : guideline || seed;
  const ideas = await generateIdeas(store, provider, { count, genre: flagString(flags, 'genre'), seed: ideaText });
  log.title(`${ideas.length} idea(s):`);
  ideas.forEach((idea, i) => {
    log.info(`${i + 1}. ${idea.title} [${idea.genre}]`);
    log.dim(`   ${idea.logline}`);
  });
}

async function cmdCheckAll(flags: ParsedArgs['flags']): Promise<void> {
  await cmdCheck(flags, []);
}

/* ------------------------------------------------------------------ */
/* help + main                                                        */
/* ------------------------------------------------------------------ */

const HELP = `novel — production webnovel writing agent

USAGE
  novel <command> [args] [--flags]

COMMANDS
  new      --idea "..." | --surprise   create a full project: premise, bible, outline
  start    --idea "..."                build/repair the plan of an existing project
  idea     [--surprise] [--count 5]    brainstorm loglines (needs a project)
  write    [n] [--all] [--no-fix]      write chapters (default: next 1, auto check+fix)
  check    [n]                         continuity + style check of written chapters
  fix      <n>                         re-draft one chapter with the fix loop
  learn    add "..." | list | dismiss <id>
                                       self-learning journal (injected into prompts)
  status                               progress dashboard
  outline                              arcs + chapter queue
  canon                               worldbuilding bible dump
  schedule run|cron|status|tick        burst + daily-pace production loop
  export   [md|txt|json|epub ...]      manuscript export
  publish  [royalroad|wattpad|web ...] publish-ready packages
  help

FLAGS
  --project <dir>   use another project directory (default: auto-discover)
  --chapters <n>    target chapters (new/start)         default 30
  --words <n>       words per chapter                   default 2500
  --lang <code>     prose language (default id)
  --genre <g>       genre hint
  --seed <s>        deterministic seed (mock provider / ideas)
  --provider <p>    mock | anthropic | openai-compatible (env NOVEL_LLM_PROVIDER)
  --burst <n>       chapters on day 1 (default 30)
  --pace <a-b>      chapters/day afterwards (default 3-5)
  --max-days <n>    production-day cap for schedule run

ENV
  NOVEL_LLM_PROVIDER, NOVEL_LLM_MODEL, NOVEL_LLM_API_KEY, NOVEL_LLM_BASE_URL
  NOVEL_AUTHOR      author name used in exports

EXAMPLES
  novel new --idea "..." --chapters 30
  novel write --all --provider anthropic
  novel schedule run --burst 30 --pace 3-5 --hour 8
  novel schedule cron                      # print crontab line for "schedule tick"
  novel export md,txt,epub
`;

export async function main(argv: string[]): Promise<number> {
  const { flags, positionals } = parseArgs(argv);
  const command = positionals.shift() ?? 'help';

  if (flagBool(flags, 'help', false) || flagBool(flags, 'h', false) || command === 'help') {
    console.log(HELP);
    return 0;
  }

  try {
    switch (command) {
      case 'new':
      case 'init':
        await cmdNew(flags, positionals);
        break;
      case 'start':
      case 'plan':
        await cmdStart(flags, positionals);
        break;
      case 'idea':
      case 'ideas':
        await cmdIdea(flags, positionals);
        break;
      case 'write':
        await cmdWrite(flags, positionals);
        break;
      case 'check':
        await cmdCheck(flags, positionals);
        break;
      case 'checkall':
        await cmdCheckAll(flags);
        break;
      case 'fix':
        await cmdFix(flags, positionals);
        break;
      case 'learn':
        await cmdLearn(flags, positionals);
        break;
      case 'status':
        await cmdStatus(flags);
        break;
      case 'outline':
        await cmdOutline(flags);
        break;
      case 'canon':
      case 'bible':
        await cmdCanon(flags);
        break;
      case 'schedule':
        await cmdSchedule(flags, positionals);
        break;
      case 'export':
        await cmdExport(flags, positionals);
        break;
      case 'publish':
        await cmdPublish(flags, positionals);
        break;
      default:
        log.error(`unknown command "${command}"\n`);
        console.log(HELP);
        return 1;
    }
    return 0;
  } catch (err) {
    if (err instanceof LLMError && err.message.includes('API key')) {
      log.error(err.message);
      log.dim('Tip: set NOVEL_LLM_API_KEY, or run offline with --provider mock.');
    } else {
      log.error(err instanceof Error ? err.message : String(err));
    }
    if (process.env['NOVEL_DEBUG']) console.error(err);
    return 1;
  }
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isMain) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
