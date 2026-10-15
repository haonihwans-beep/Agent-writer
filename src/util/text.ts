import { createHash } from 'node:crypto';

export function wordCount(text: string): number {
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

export function normalizeSpace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Short stable id suffix from a string, used for finding fingerprints. */
export function shortHash(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 10);
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export interface Frontmatter {
  data: Record<string, string>;
  body: string;
}

export function parseFrontmatter(raw: string): Frontmatter {
  const m = FRONTMATTER_RE.exec(raw);
  if (!m || !m[1]) return { data: {}, body: raw };
  const data: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^"|"$/g, '');
    if (key) data[key] = value;
  }
  return { data, body: raw.slice(m[0].length) };
}

export function stringifyFrontmatter(data: Record<string, string>, body: string): string {
  const lines = ['---'];
  for (const [k, v] of Object.entries(data)) {
    const safe = String(v).replace(/"/g, "'");
    lines.push(`${k}: "${safe}"`);
  }
  lines.push('---', '');
  return lines.join('\n') + body;
}

/** First snippet of text around the first sentence, for finding excerpts. */
export function makeExcerpt(text: string, max = 90): string {
  const clean = normalizeSpace(text);
  if (clean.length <= max) return clean;
  return clean.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

/** Split into sentences keeping the delimiters (works for id/en prose). */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  for (const ch of text) {
    buf += ch;
    if (ch === '.' || ch === '!' || ch === '?' || ch === '"' || ch === '”') {
      if (buf.trim().length > 0) {
        out.push(buf.trim());
        buf = '';
      }
    }
  }
  if (buf.trim().length > 0) out.push(buf.trim());
  return out;
}

/** Number words like "nineteen" to digits (1..999), for age checks. */
const SMALL: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};

export function wordsToNumbers(text: string): { value: number; index: number; length: number }[] {
  const out: { value: number; index: number; length: number }[] = [];
  const lower = text.toLowerCase();
  const re = /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)(?:[-\s](one|two|three|four|five|six|seven|eight|nine))?\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lower))) {
    const tens = TENS[m[1] as string];
    const unit = m[2] ? SMALL[m[2]] ?? 0 : 0;
    const value = tens !== undefined ? tens + unit : (SMALL[m[1] as string] ?? 0);
    out.push({ value, index: m.index, length: m[0].length });
  }
  return out;
}

export function digitsToWords(n: number): string {
  const small = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  if (n < 20) return small[n] ?? String(n);
  const tens: Record<number, string> = { 2: 'twenty', 3: 'thirty', 4: 'forty', 5: 'fifty', 6: 'sixty', 7: 'seventy', 8: 'eighty', 9: 'ninety' };
  const tensWord = tens[Math.floor(n / 10)];
  const unit = n % 10;
  return unit === 0 ? tensWord! : `${tensWord!}-${small[unit]}`;
}

/** Rough percentage of dialogue lines in prose. */
export function dialogueRatio(text: string): number {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return 0;
  const dialogLines = lines.filter((l) => (l.match(/["“”«»]/g)?.length ?? 0) >= 2);
  return dialogLines.length / lines.length;
}
