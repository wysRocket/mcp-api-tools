/**
 * HTTP helpers for the MCP API tools server.
 *
 * Every fetch goes through here so that one policy (scheme, redirects, size,
 * timeout, content type) applies to every tool instead of each tool inventing
 * its own.
 */

export const MAX_BYTES = 1_000_000;
export const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 5;

export class HttpToolError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'HttpToolError';
    this.status = status;
  }
}

const BLOCKED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

export interface FetchOptions {
  url: string;
  method?: 'GET' | 'HEAD';
  headers?: Record<string, string> | undefined;
  timeoutMs?: number | undefined;
  maxBytes?: number | undefined;
}

function parseUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new HttpToolError(`Not a valid URL: ${raw}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new HttpToolError('Only https URLs are allowed.');
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new HttpToolError('Loopback addresses are not allowed.');
  }
  return parsed;
}

/**
 * Fetch a URL with a hard byte cap. Response bodies are read manually so a
 * server cannot hand back an unbounded payload once the declared size is
 * passed.
 */
export async function fetchWithLimits(options: FetchOptions): Promise<{
  status: number;
  finalUrl: string;
  contentType: string;
  body: string;
}> {
  const url = parseUrl(options.url);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = Math.min(options.maxBytes ?? MAX_BYTES, MAX_BYTES);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: { accept: '*/*', ...options.headers },
      redirect: 'follow',
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new HttpToolError(`Request timed out after ${timeoutMs}ms.`, 504);
    }
    throw new HttpToolError(`Request failed: ${error instanceof Error ? error.message : String(error)}`, 502);
  } finally {
    clearTimeout(timer);
  }

  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new HttpToolError(`Content-Length ${declared} exceeds the ${maxBytes} byte cap.`, 413);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return {
      status: response.status,
      finalUrl: response.url,
      contentType: response.headers.get('content-type') ?? '',
      body: '',
    };
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new HttpToolError(`Response exceeded the ${maxBytes} byte cap.`, 413);
    }
    chunks.push(value);
  }

  const body = new TextDecoder('utf-8', { fatal: false }).decode(
    chunks.length === 1 ? (chunks[0] as Uint8Array) : concat(chunks),
  );
  return {
    status: response.status,
    finalUrl: response.url,
    contentType: response.headers.get('content-type') ?? '',
    body,
  };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((sum, c) => sum + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export function truncate(text: string, limit = 20_000): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…[truncated at ${limit} characters]`;
}

export function asTextResult(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

export function asErrorResult(message: string) {
  return { content: [{ type: 'text' as const, text: `Error: ${message}` }], isError: true };
}
