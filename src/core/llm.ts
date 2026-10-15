import type { ProjectConfig } from './types.ts';
import { parseJSONLoose } from '../util/json.ts';
import {
  mockCharacters,
  mockClaims,
  mockGenerateIdeas,
  mockOutline,
  mockPremise,
  mockReview,
  mockWriteChapter,
  mockWorld,
} from './mock-provider.ts';

/* ------------------------------------------------------------------ */
/* Interface                                                           */
/* ------------------------------------------------------------------ */

export type TaskKind =
  | 'ideas'
  | 'premise'
  | 'world'
  | 'characters'
  | 'outline'
  | 'chapter'
  | 'review'
  | 'claims'
  | 'fix';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMRequest {
  task: TaskKind;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Deterministic seed for the mock provider. */
  seed?: string;
}

export interface LLMProvider {
  readonly name: string;
  readonly kind: ProjectConfig['llm']['provider'];
  complete(req: LLMRequest): Promise<string>;
}

export class LLMError extends Error {
  readonly provider: string;

  constructor(message: string, provider: string) {
    super(`[${provider}] ${message}`);
    this.name = 'LLMError';
    this.provider = provider;
  }
}

/* ------------------------------------------------------------------ */
/* Mock (offline)                                                      */
/* ------------------------------------------------------------------ */

export class MockProvider implements LLMProvider {
  readonly name = 'mock';
  readonly kind = 'mock' as const;

  async complete(req: LLMRequest): Promise<string> {
    const data = extractData(req.messages) as Record<string, unknown>;
    const seed = String(req.seed ?? (data['seed'] as string) ?? 'seed');
    switch (req.task) {
      case 'ideas':
        return mockGenerateIdeas(seed, Number(data['count'] ?? 3));
      case 'premise':
        return mockPremise(seed, String(data['idea'] ?? ''), String(data['genre'] ?? 'literary'));
      case 'world':
        return mockWorld(seed, String(data['premise'] ?? ''));
      case 'characters':
        return mockCharacters(seed, String(data['premise'] ?? ''));
      case 'outline':
        return mockOutline({
          seed,
          targetChapters: Number(data['targetChapters'] ?? 20),
          title: String(data['title'] ?? ''),
          povId: String(data['povId'] ?? ''),
          characterIds: Array.isArray(data['characterIds']) ? (data['characterIds'] as string[]) : [],
          locationIds: Array.isArray(data['locationIds']) ? (data['locationIds'] as string[]) : [],
          factIds: Array.isArray(data['factIds']) ? (data['factIds'] as string[]) : [],
        });
      case 'chapter':
      case 'fix': {
        const chapter = data['chapter'] as MockChapterLike | undefined;
        const bible = data['bible'] as MockBibleLike | undefined;
        if (!chapter || !bible) {
          return mockFallbackChapter(seed);
        }
        return mockWriteChapter({
          chapter: chapter as never,
          bible: bible as never,
          language: String(data['language'] ?? 'en'),
          seedSalt: req.task === 'fix' ? `fix:${seed}` : undefined,
          rework: Array.isArray(data['rework']) ? (data['rework'] as string[]) : undefined,
        });
      }
      case 'review':
        return mockReview(seed, Number(data['chapterNumber'] ?? 0));
      case 'claims':
        return mockClaims(String(data['chapterText'] ?? ''));
      default:
        throw new LLMError(`unknown task ${String(req.task)}`, this.name);
    }
  }
}

interface MockChapterLike {
  number: number;
  title: string;
  summary: string;
  beats: string[];
  targetWords: number;
  povCharacterId: string;
  characterIds: string[];
  locationIds: string[];
  canonFactIds: string[];
}

interface MockBibleLike {
  characters: unknown[];
  locations: unknown[];
  world: unknown[];
}

function mockFallbackChapter(seed: string): string {
  const ch = {
    number: 1,
    title: seed || 'Untitled',
    summary: 'the work of the day',
    beats: ['the work of the day'],
    targetWords: 800,
    povCharacterId: '',
    characterIds: [],
    locationIds: [],
    canonFactIds: [],
  };
  const bible = { characters: [], locations: [], world: [] };
  return mockWriteChapter({ chapter: ch as never, bible: bible as never, language: 'en', seedSalt: seed });
}

/* ------------------------------------------------------------------ */
/* Anthropic (Claude)                                                  */
/* ------------------------------------------------------------------ */

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '<no body>';
  }
}

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  readonly kind = 'anthropic' as const;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: ProjectConfig['llm'], apiKey: string) {
    this.apiKey = apiKey;
    this.model = config.model;
  }

  async complete(req: LLMRequest): Promise<string> {
    const systemMsg = req.messages.find((m) => m.role === 'system');
    const messages = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));
    const body = {
      model: this.model,
      max_tokens: req.maxTokens ?? 8192,
      temperature: req.temperature ?? 0.9,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages,
    };
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!res.ok) {
      throw new LLMError(`API ${res.status}: ${await safeText(res)}`, this.name);
    }
    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = (json.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('\n');
    if (!text) throw new LLMError('empty response content', this.name);
    return text;
  }
}

/* ------------------------------------------------------------------ */
/* OpenAI-compatible (OpenAI, Ollama, vLLM, LM Studio, OpenRouter)     */
/* ------------------------------------------------------------------ */

export class OpenAICompatProvider implements LLMProvider {
  readonly name = 'openai-compatible';
  readonly kind = 'openai-compatible' as const;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(config: ProjectConfig['llm'], apiKey: string) {
    this.apiKey = apiKey;
    this.baseUrl = (config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
    this.model = config.model;
  }

  async complete(req: LLMRequest): Promise<string> {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        temperature: req.temperature ?? 0.9,
        max_tokens: req.maxTokens,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      }),
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!res.ok) {
      throw new LLMError(`API ${res.status}: ${await safeText(res)}`, this.name);
    }
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = json.choices?.[0]?.message?.content ?? '';
    if (!text) throw new LLMError('empty response content', this.name);
    return text;
  }
}

/* ------------------------------------------------------------------ */
/* Factory                                                             */
/* ------------------------------------------------------------------ */

export function createProvider(
  config: ProjectConfig,
  env: NodeJS.ProcessEnv = process.env,
): LLMProvider {
  const kind = (env['NOVEL_LLM_PROVIDER'] as ProjectConfig['llm']['provider'] | undefined) ?? config.llm.provider;
  const apiKey = env['NOVEL_LLM_API_KEY'] ?? '';
  if (kind === 'mock') return new MockProvider();
  if (!apiKey) {
    throw new LLMError(
      `provider "${kind}" requires an API key: export NOVEL_LLM_API_KEY (or run offline with --provider mock)`,
      kind,
    );
  }
  const cfg: ProjectConfig['llm'] = {
    ...config.llm,
    provider: kind,
    model: env['NOVEL_LLM_MODEL'] ?? config.llm.model,
    baseUrl: env['NOVEL_LLM_BASE_URL'] ?? config.llm.baseUrl,
  };
  if (kind === 'anthropic') return new AnthropicProvider(cfg, apiKey);
  return new OpenAICompatProvider(cfg, apiKey);
}

/** Fetch a completion and parse it as JSON. */
export async function requestJSON<T>(provider: LLMProvider, req: LLMRequest): Promise<T> {
  return parseJSONLoose<T>(await provider.complete(req));
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function extractData(messages: ChatMessage[]): unknown {
  for (const message of messages) {
    const idx = message.content.indexOf('## DATA');
    if (idx === -1) continue;
    const tail = message.content.slice(idx + 8);
    return parseJSONLoose<unknown>(tail);
  }
  return {};
}
