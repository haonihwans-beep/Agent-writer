import type { ScheduleConfig, ScheduleState } from './types.ts';
import type { Store } from './store.ts';
import type { LLMProvider } from './llm.ts';
import { writeChapters } from './writer.ts';
import { exportAll, publishAll } from './export.ts';
import { createRng } from '../util/rng.ts';
import { localDate, nextLocalTime, nowIso } from '../util/clock.ts';

export type Logger = (message: string) => void;

export interface ScheduleOptions {
  burst?: number;
  paceMin?: number;
  paceMax?: number;
  /** Run at most this many production days (safety stop; default unlimited). */
  maxDays?: number;
  autoFix?: boolean;
  review?: boolean;
  onComplete?: (store: Store) => void | Promise<void>;
  log?: Logger;
  /** Injectable clock for tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
}

export interface DayPlan {
  phase: 'burst' | 'daily';
  quota: number;
  chapters: number[];
  alreadyWrittenToday: boolean;
}

const noopLog: Logger = () => undefined;

function effectiveConfig(store: Store, opts: ScheduleOptions): ScheduleConfig {
  const base = store.loadConfig().schedule;
  const paceMin = opts.paceMin ?? base.paceMin;
  const paceMax = opts.paceMax ?? base.paceMax;
  return {
    burst: opts.burst ?? base.burst,
    paceMin: Math.max(0, paceMin),
    paceMax: Math.max(paceMin, paceMax),
    hour: base.hour,
  };
}

function persistSchedule(store: Store, config: ScheduleConfig): void {
  const current = store.loadConfig();
  store.saveConfig({ ...current, schedule: config, updatedAt: nowIso() });
}

/** Deterministic per-date quota so a restart mid-day produces the same plan. */
export function quotaForDate(store: Store, config: ScheduleConfig, date: string): number {
  const rng = createRng(`${store.loadConfig().name}|${date}|quota`);
  const spread = config.paceMax - config.paceMin;
  return config.paceMin + (spread > 0 ? rng.int(spread + 1) : 0);
}

/** What should be produced today? */
export function planToday(store: Store, opts: ScheduleOptions = {}): DayPlan {
  const config = effectiveConfig(store, opts);
  const state = store.loadScheduleState();
  const outline = store.loadOutline().chapters;
  const written = new Set(store.loadChapterIndex().chapters.map((c) => c.number));
  const pending = outline.filter((c) => !written.has(c.number)).map((c) => c.number).sort((a, b) => a - b);
  const today = localDate();
  const wroteToday = state.history.some((h) => h.date === today);

  if (pending.length === 0) {
    return { phase: 'daily', quota: 0, chapters: [], alreadyWrittenToday: wroteToday };
  }

  const burstDue = state.history.filter((h) => h.phase === 'burst').length === 0 && written.size < config.burst;
  if (burstDue) {
    const quota = Math.max(0, config.burst - written.size);
    return { phase: 'burst', quota, chapters: pending.slice(0, quota), alreadyWrittenToday: wroteToday };
  }
  const quota = Math.min(pending.length, quotaForDate(store, config, today));
  return { phase: 'daily', quota, chapters: pending.slice(0, quota), alreadyWrittenToday: wroteToday };
}

function freshState(): ScheduleState {
  return {
    schema: 'novel.schedule/1',
    status: 'idle',
    phase: 'pending',
    startedAt: null,
    lastRunAt: null,
    nextRunAt: null,
    totalWritten: 0,
    history: [],
    lastError: null,
  };
}

/**
 * Daemon loop: burst on the first day, then the configured daily pace until
 * the outline is finished. Safe to kill at any moment: the next run resumes
 * from the on-disk state.
 */
export async function runSchedule(store: Store, provider: LLMProvider, opts: ScheduleOptions = {}): Promise<ScheduleState> {
  const log = opts.log ?? noopLog;
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const config = effectiveConfig(store, opts);
  persistSchedule(store, config);

  let state = store.loadScheduleState();
  if (store.loadChapterIndex().chapters.length === 0 && state.status === 'idle' && state.history.length === 0) {
    state = { ...freshState(), startedAt: nowIso() };
  }
  state.status = 'running';
  store.saveScheduleState(state);

  const maxDays = opts.maxDays;
  let finished = false;

  try {
    for (;;) {
      if (opts.signal?.aborted) break;
      const plan = planToday(store, opts);
      if (plan.chapters.length === 0) {
        finished = true;
        break;
      }

      log(`day ${state.history.length + 1} [${plan.phase}]: writing ${plan.chapters.length} chapter(s)`);
      const results = await writeChapters(store, provider, plan.chapters.length, {
        autoFix: opts.autoFix ?? true,
        review: opts.review,
        onProgress: log,
      });
      const writtenNow = results.map((r) => r.record.number);
      state = store.loadScheduleState();
      state.history.push({
        date: localDate(new Date(now())),
        phase: plan.phase,
        quota: plan.quota,
        chapters: writtenNow,
        completedAt: nowIso(),
      });
      state.totalWritten = (state.totalWritten ?? 0) + results.length;
      state.lastRunAt = nowIso();
      store.saveScheduleState(state);

      const remaining = store.loadOutline().chapters.length - store.loadChapterIndex().chapters.length;
      if (remaining <= 0) {
        finished = true;
        break;
      }
      if (maxDays !== undefined && state.history.length >= maxDays) {
        log(`max days (${maxDays}) reached; ${remaining} chapter(s) pending`);
        break;
      }

      const next = nextLocalTime(config.hour, 0, new Date(now()));
      state = store.loadScheduleState();
      state.nextRunAt = new Date(next).toISOString();
      store.saveScheduleState(state);
      const wait = Math.max(0, next - now());
      log(`next run: ${new Date(next).toLocaleString()} (sleeping ${Math.round(wait / 60000)} min)`);
      await sleep(wait);
    }

    if (finished) {
      state = store.loadScheduleState();
      state.status = 'done';
      state.phase = 'complete';
      state.nextRunAt = null;
      state.lastRunAt = nowIso();
      store.saveScheduleState(state);
      const total = store.loadChapterIndex().chapters.length;
      log(`outline complete: ${total} chapter(s) written`);
      if (opts.onComplete) await opts.onComplete(store);
    } else {
      state = store.loadScheduleState();
      if (state.status === 'running') state.status = 'idle';
      store.saveScheduleState(state);
    }
    return store.loadScheduleState();
  } catch (err) {
    state = store.loadScheduleState();
    state.status = 'failed';
    state.lastError = (err as Error).message;
    store.saveScheduleState(state);
    throw err;
  }
}

/**
 * Cron mode: run at most one production day per invocation, idempotent for
 * the current date (a second call the same day is a no-op).
 */
export async function runTick(store: Store, provider: LLMProvider, opts: { autoFix?: boolean; review?: boolean; onComplete?: (store: Store) => void | Promise<void>; log?: Logger } = {}): Promise<ScheduleState> {
  const log = opts.log ?? noopLog;
  const plan = planToday(store, opts);
  if (plan.chapters.length === 0) {
    const state = store.loadScheduleState();
    log(state.history.length === 0 ? 'nothing to do: outline is empty' : 'outline complete; nothing to write today');
    return state;
  }
  if (plan.alreadyWrittenToday) {
    log(`already wrote today's quota (${plan.quota}); skipping`);
    return store.loadScheduleState();
  }
  const state = store.loadScheduleState();
  if (state.startedAt === null) {
    store.saveScheduleState({ ...state, startedAt: nowIso(), status: 'running' });
  }
  log(`tick [${plan.phase}]: writing ${plan.chapters.length} chapter(s)`);
  const results = await writeChapters(store, provider, plan.chapters.length, {
    autoFix: opts.autoFix ?? true,
    review: opts.review,
    onProgress: log,
  });
  const next = store.loadScheduleState();
  next.status = 'running';
  next.history.push({
    date: localDate(),
    phase: plan.phase,
    quota: plan.quota,
    chapters: results.map((r) => r.record.number),
    completedAt: nowIso(),
  });
  next.totalWritten = (next.totalWritten ?? 0) + results.length;
  next.lastRunAt = nowIso();
  const remaining = store.loadOutline().chapters.length - store.loadChapterIndex().chapters.length;
  if (remaining <= 0) {
    next.status = 'done';
    next.phase = 'complete';
    if (opts.onComplete) await opts.onComplete(store);
  }
  store.saveScheduleState(next);
  return next;
}

/** Suggested crontab line for `schedule tick` on systems without a daemon. */
export function cronLine(store: Store, cliPath: string, nodePath: string): string {
  const { hour } = store.loadConfig().schedule;
  return `0 ${hour} * * * cd "${store.dir}" && ${nodePath} "${cliPath}" schedule tick >> "${store.dir}/.schedule.log" 2>&1`;
}

/** Default completion action: export everything + web publication package. */
export function defaultOnComplete(
  formats: ('md' | 'txt' | 'json' | 'epub')[] = ['md', 'txt', 'json', 'epub'],
  publish: ('royalroad' | 'wattpad' | 'web')[] = ['royalroad', 'wattpad', 'web'],
): (store: Store) => Promise<void> {
  return async (store: Store) => {
    exportAll(store, formats);
    publishAll(store, publish);
  };
}
