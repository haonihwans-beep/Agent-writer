import type { Bible, ChapterOutline, Finding, Lesson, ProjectConfig, StyleGuide } from './types.ts';
import { dialogueRatio, makeExcerpt, wordCount, wordsToNumbers } from '../util/text.ts';
import { findingId } from '../util/ids.ts';
import { requestJSON, type LLMProvider } from './llm.ts';
import { buildReviewPrompt, type PromptPair } from './prompts.ts';

export interface CheckInput {
  chapter: ChapterOutline;
  text: string;
  bible: Bible;
  style: StyleGuide;
}

const PROPER_STOPLIST = new Set([
  'the', 'a', 'an', 'and', 'but', 'or', 'so', 'if', 'when', 'then', 'she', 'he', 'they', 'it', 'we', 'you', 'i',
  'no', 'yes', 'not', 'now', 'let', 'there', 'here', 'what', 'why', 'how', 'who', 'his', 'her', 'their', 'its',
  'one', 'two', 'three', 'some', 'any', 'all', 'each', 'every', 'chapter', 'end', 'epilogue',
]);

function finding(chapter: number, code: Finding['code'], severity: Finding['severity'], message: string, excerpt: string, suggestion: string, fingerprint: string): Finding {
  return {
    id: findingId(chapter, code, fingerprint),
    chapter,
    code,
    severity,
    message,
    excerpt,
    suggestion,
  };
}

/* ------------------------------------------------------------------ */
/* deterministic checks                                                */
/* ------------------------------------------------------------------ */

export function checkContinuity(input: CheckInput): Finding[] {
  const { chapter, text, bible, style } = input;
  const out: Finding[] = [];
  const lower = text.toLowerCase();

  /* banned phrases / AI tells */
  for (const entry of style.banned) {
    if (entry.startsWith('re:')) {
      const re = new RegExp(entry.slice(3), 'i');
      const m = re.exec(text);
      if (m) {
        out.push(finding(chapter.number, 'banned-phrase', 'error', `Banned construction matched /${entry.slice(3)}/`, makeExcerpt(m[0], 80), 'Rewrite without the cliched construction.', `banned:${entry}:${m.index}`));
      }
    } else {
      const idx = lower.indexOf(entry.toLowerCase());
      if (idx !== -1) {
        out.push(finding(chapter.number, 'banned-phrase', 'error', `Banned phrase: "${entry}"`, makeExcerpt(text.slice(Math.max(0, idx - 30), idx + entry.length + 30), 90), 'Replace with plain, concrete language.', `banned:${entry}:${idx}`));
      }
    }
  }

  /* unknown proper nouns (people/places the bible does not know) */
  const known = new Set<string>();
  for (const c of bible.characters) {
    known.add(c.name.toLowerCase());
    for (const a of c.aliases) known.add(a.toLowerCase());
    for (const token of c.name.split(/\s+/)) known.add(token.toLowerCase());
  }
  for (const l of bible.locations) {
    known.add(l.name.toLowerCase());
    for (const token of l.name.split(/\s+/)) known.add(token.toLowerCase());
  }
  for (const f of bible.factions) {
    known.add(f.name.toLowerCase());
    for (const token of f.name.split(/\s+/)) known.add(token.toLowerCase());
  }

  const properRe = /\b((?:[A-Z][a-z]+)(?:\s+[A-Z][a-z]+)?)\b/g;
  const seenUnknown = new Map<string, Finding>();
  let m: RegExpExecArray | null;
  while ((m = properRe.exec(text))) {
    const raw = m[1]!;
    if (raw.split(' ').some((w) => PROPER_STOPLIST.has(w.toLowerCase()))) continue;
    if (raw.length < 3) continue;
    if (known.has(raw.toLowerCase())) continue;
    // ignore words that appear in the chapter outline (title/summary/beats are prose)
    const outlineText = `${chapter.title} ${chapter.summary} ${chapter.beats.join(' ')}`;
    if (outlineText.toLowerCase().includes(raw.toLowerCase())) continue;
    // a single capitalized word at the start of a paragraph/sentence is
    // ambiguous (could be a common word like "Rain"); only multi-word
    // capitals or mid-sentence capitals are treated as registered names
    const before = text.slice(Math.max(0, m.index - 4), m.index);
    const sentenceStart = m.index === 0 || /[.!?]\s+$/.test(before) || /\n\s*$/.test(before) || /["'“‘]\s*$/.test(before);
    if (sentenceStart && !raw.includes(' ')) continue;
    seenUnknown.set(
      raw,
      finding(chapter.number, 'unknown-character', 'warn', `Unregistered proper noun "${raw}" used in prose`, makeExcerpt(text.slice(Math.max(0, m.index - 30), m.index + raw.length + 30), 90), 'Add the character/place to the bible or fix the name.', `unknown:${raw.toLowerCase()}`),
    );
  }
  out.push(...seenUnknown.values());

  /* dead characters referenced */
  for (const c of bible.characters) {
    if (c.status !== 'dead') continue;
    for (const alias of [c.name, ...c.aliases]) {
      const idx = lower.indexOf(alias.toLowerCase());
      if (idx !== -1) {
        out.push(finding(chapter.number, 'dead-character', 'error', `${c.name} is canon-dead but appears in chapter text`, makeExcerpt(text.slice(Math.max(0, idx - 40), idx + alias.length + 40), 100), 'Remove or reframe the reference (memories are fine; presence is not).', `dead:${c.id}`));
        break;
      }
    }
  }

  /* age contradictions ("she is twenty-seven", "aged 24", "27 years old") */
  for (const c of bible.characters) {
    if (c.age === undefined || c.age === null) continue;
    for (const name of [c.name, ...c.aliases]) {
      const re = new RegExp(`${escapeRe(name)}[^.;]{0,120}`, 'i');
      const mm = re.exec(text);
      if (!mm) continue;
      const window = mm[0];
      const digit = /(?:age[ds]?\s+(?:of\s+)?)(\d{1,2})\b|(\d{1,2})\s*years?\s*old/i.exec(window);
      const wordHit = wordsToNumbers(window).find((w) => {
        const before = window.slice(Math.max(0, w.index - 20), w.index);
        const after = window.slice(w.index, w.index + w.length + 15);
        return /age[ds]?\s+$/i.test(before) || /^\s*,?\s*years?\s*old/i.test(after);
      });
      const value = digit ? Number(digit[1] ?? digit[2]) : wordHit?.value;
      if (value !== undefined && value !== c.age) {
        out.push(finding(chapter.number, 'age-contradiction', 'error', `${c.name} is canon age ${c.age} but text implies ${value}`, makeExcerpt(window, 100), `Use age ${c.age}, or update the bible if the character genuinely ages on-page.`, `age:${c.id}`));
        break;
      }
    }
  }

  /* location presence */
  if (chapter.locationIds.length > 0) {
    const locs = chapter.locationIds.map((id) => bible.locations.find((l) => l.id === id)).filter((l) => Boolean(l));
    if (locs.length > 0) {
      const named = locs.some((l) => text.includes(l!.name));
      if (!named) {
        out.push(finding(chapter.number, 'unknown-location', 'warn', `Planned location never appears in prose`, makeExcerpt(chapter.summary, 90), 'Name the place so readers track the geography.', `loc:${chapter.number}`));
      }
    }
  }

  /* pov presence */
  if (chapter.povCharacterId) {
    const pov = bible.characters.find((c) => c.id === chapter.povCharacterId);
    if (pov && !text.includes(pov.name) && !pov.aliases.some((a) => text.includes(a))) {
      out.push(finding(chapter.number, 'pov-missing', 'warn', `POV character ${pov.name} never appears`, makeExcerpt(chapter.summary, 80), 'Anchor the scene to its POV character.', `pov:${chapter.number}`));
    }
  }

  /* length */
  const words = wordCount(text);
  const target = chapter.targetWords || 2000;
  if (words < target * 0.6) {
    out.push(finding(chapter.number, 'word-count', 'warn', `Chapter is ${words} words, ${Math.round(((target - words) / target) * 100)}% under target ${target}`, makeExcerpt(text, 60), 'Add the missing beats with consequence.', `words:low:${chapter.number}`));
  } else if (words > target * 1.5) {
    out.push(finding(chapter.number, 'word-count', 'warn', `Chapter is ${words} words, ${Math.round(((words - target) / target) * 100)}% over target ${target}`, makeExcerpt(text, 60), 'Compress; serial chapters earn their length.', `words:high:${chapter.number}`));
  }

  /* dialogue ratio */
  const ratio = dialogueRatio(text);
  if (ratio < 0.06) {
    out.push(finding(chapter.number, 'dialogue-ratio', 'info', `Only ${(ratio * 100).toFixed(0)}% of lines carry dialogue`, makeExcerpt(text, 60), 'Serial readers track scene momentum through talk.', `dialog:${chapter.number}`));
  }

  /* meta language */
  const metaRe = /\b(as an ai|in this chapter|the author|this story follows|dear reader|sure[,!]?\s+i can)\b/i;
  const meta = metaRe.exec(text);
  if (meta) {
    out.push(finding(chapter.number, 'meta-language', 'error', 'Meta/author voice leaked into prose', makeExcerpt(text.slice(Math.max(0, meta.index - 30), meta.index + 60), 90), 'Delete the sentence entirely.', `meta:${meta[0].toLowerCase()}`));
  }

  /* repetition: repeated sentence openings */
  const openings = text.split(/\n\s*\n/).map((p) => p.trim().split(/\s+/).slice(0, 3).join(' ').toLowerCase()).filter(Boolean);
  const counts = new Map<string, number>();
  for (const o of openings) counts.set(o, (counts.get(o) ?? 0) + 1);
  for (const [opening, n] of counts) {
    if (n >= 3 && opening.length > 4) {
      out.push(finding(chapter.number, 'repetition', 'warn', `Paragraphs open with the same words ${n} times ("${opening}")`, opening, 'Vary paragraph openings.', `rep:${opening}`));
    }
  }

  /* weak hook: very short final line */
  const paragraphs = text.trim().split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const last = paragraphs.length > 0 ? paragraphs[paragraphs.length - 1]!.trim() : '';
  if (last.length > 0 && last.length < 28) {
    out.push(finding(chapter.number, 'weak-hook', 'info', 'Final line is very short and flat', last, 'End with a turn: new information, a cost, or a decision.', `hook:short:${chapter.number}`));
  }

  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function maxSeverity(findings: Finding[]): Finding['severity'] {
  if (findings.some((f) => f.severity === 'error')) return 'error';
  if (findings.some((f) => f.severity === 'warn')) return 'warn';
  return 'info';
}

export function hasBlockingErrors(findings: Finding[], threshold = 2): boolean {
  return findings.filter((f) => f.severity === 'error').length >= threshold;
}

/* ------------------------------------------------------------------ */
/* LLM self-review                                                     */
/* ------------------------------------------------------------------ */

interface ReviewIssue {
  severity?: string;
  code?: string;
  message?: string;
  suggestion?: string;
  excerpt?: string;
}

interface ReviewResult {
  score?: number;
  verdict?: string;
  issues?: ReviewIssue[];
}

const CODE_MAP: Record<string, Finding['code']> = {
  continuity: 'canon-contradiction',
  style: 'banned-phrase',
  dialogue: 'dialogue-ratio',
  pacing: 'weak-hook',
  structure: 'weak-hook',
};

export interface ReviewOutcome {
  score: number;
  verdict: string;
  findings: Finding[];
  raw: ReviewResult;
}

export async function reviewChapter(
  provider: LLMProvider,
  config: ProjectConfig,
  opts: CheckInput & { lessons: Lesson[] },
): Promise<ReviewOutcome> {
  const prompt: PromptPair = buildReviewPrompt({
    config,
    style: opts.style,
    bible: opts.bible,
    chapter: opts.chapter,
    text: opts.text,
    lessons: opts.lessons,
  });
  const result = await requestJSON<ReviewResult>(provider, {
    task: 'review',
    messages: [
      { role: 'system', content: prompt.system },
      { role: 'user', content: prompt.user },
    ],
  });
  const findings: Finding[] = [];
  const issues = result.issues ?? [];
  for (const [i, issue] of issues.entries()) {
    const code = CODE_MAP[issue.code ?? ''] ?? 'canon-contradiction';
    findings.push(
      finding(
        opts.chapter.number,
        code,
        issue.severity === 'error' ? 'error' : 'warn',
        issue.message ?? 'Editor flagged this passage',
        makeExcerpt(issue.excerpt ?? '', 100),
        issue.suggestion ?? 'Revise per the style contract.',
        `llm:${i}:${(issue.excerpt ?? issue.message ?? '').slice(0, 40)}`,
      ),
    );
  }
  return {
    score: typeof result.score === 'number' ? result.score : findings.length === 0 ? 85 : 70,
    verdict: result.verdict ?? 'needs-polish',
    findings,
    raw: result,
  };
}
