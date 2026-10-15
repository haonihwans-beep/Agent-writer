// Minimal console logger with colors, respecting NO_COLOR.

const useColor = !process.env.NO_COLOR && process.stderr.isTTY !== false;

const c = (code: string, s: string): string => (useColor ? `\u001b[${code}m${s}\u001b[0m` : s);

export const log = {
  info: (msg: string): void => console.log(msg),
  step: (msg: string): void => console.log(c('36', `▸ ${msg}`)),
  ok: (msg: string): void => console.log(c('32', `✓ ${msg}`)),
  warn: (msg: string): void => console.error(c('33', `! ${msg}`)),
  error: (msg: string): void => console.error(c('31', `✗ ${msg}`)),
  dim: (msg: string): void => console.log(c('2', msg)),
  title: (msg: string): void => console.log(c('1', msg)),
};

export function padEnd(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

export function padStart(s: string, n: number): string {
  return s.length >= n ? s : ' '.repeat(n - s.length) + s;
}

/** Simple textual progress bar, e.g. [████░░░░░░] 40%. */
export function bar(fraction: number, width = 10): string {
  const f = Math.max(0, Math.min(1, fraction));
  const filled = Math.round(f * width);
  return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}] ${(f * 100).toFixed(0)}%`;
}
