/** Tolerant JSON extraction for LLM responses wrapped in prose or code fences. */
export function stripCodeFences(text: string): string {
  const fence = /```(?:json|JSON)?\s*\n?([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text))) {
    const inner = m[1];
    if (inner) return inner.trim();
  }
  return text.trim();
}

/** Find the first balanced JSON object/array in text (string-aware). */
function extractBalanced(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start === -1) return null;
  const open = text[start]!;
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function parseJSONLoose<T>(text: string): T {
  const candidates: string[] = [];
  const clean = stripCodeFences(text);
  if (clean.length > 0) candidates.push(clean);
  const balanced = extractBalanced(clean);
  if (balanced) candidates.push(balanced);
  const raw = text.trim();
  if (raw.length > 0) candidates.push(raw);

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch (err) {
      lastError = err;
    }
  }
  const snippet = text.length > 200 ? `${text.slice(0, 200)}…` : text;
  throw new Error(`Could not parse JSON from LLM response: ${String(lastError)}\nResponse starts: ${snippet}`);
}
