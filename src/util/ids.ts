import { randomBytes } from 'node:crypto';
import { hashString } from './rng.ts';

export function uid(prefix: string): string {
  const rand = randomBytes(4).toString('hex');
  return `${prefix}_${rand}${(Date.now() % 46656).toString(36)}`;
}

export function findingId(chapter: number, code: string, fingerprint: string): string {
  return `find_c${chapter}_${code}_${hashString(fingerprint).toString(36).slice(0, 8)}`;
}

export function lessonId(category: string, fingerprint: string): string {
  return `les_${category.slice(0, 4)}_${hashString(fingerprint).toString(36).slice(0, 8)}`;
}
