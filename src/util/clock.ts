// Clock abstraction so tests can fast-forward time and the scheduler
// can be tested without real sleeping.

export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const t = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = (): void => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    }),
};

export function nowIso(): string {
  return new Date().toISOString();
}

/** Local (not UTC) date key, e.g. 2026-10-15. */
export function localDate(d = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Next occurrence of local hour:minute (default: start of given hour), in ms epoch. */
export function nextLocalTime(hour: number, minute = 0, from = new Date()): number {
  const d = new Date(from);
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export function startOfLocalDay(from = new Date()): Date {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  return d;
}
