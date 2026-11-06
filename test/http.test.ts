import { describe, expect, it } from 'vitest';
import { fetchWithLimits, HttpToolError, truncate } from '../src/http.js';

const JSON_URL = 'https://jsonplaceholder.typicode.com/todos/1';

describe('parseUrl policy', () => {
  it('rejects non-https schemes', async () => {
    await expect(fetchWithLimits({ url: 'http://example.com' })).rejects.toBeInstanceOf(HttpToolError);
  });

  it('rejects loopback hosts', async () => {
    await expect(fetchWithLimits({ url: 'https://localhost:8080/' })).rejects.toBeInstanceOf(HttpToolError);
    await expect(fetchWithLimits({ url: 'https://127.0.0.1/' })).rejects.toBeInstanceOf(HttpToolError);
  });

  it('rejects malformed URLs', async () => {
    await expect(fetchWithLimits({ url: 'not a url' })).rejects.toBeInstanceOf(HttpToolError);
  });
});

describe('fetchWithLimits', () => {
  it('fetches a real https endpoint', async () => {
    const response = await fetchWithLimits({ url: JSON_URL });
    expect(response.status).toBe(200);
    expect(response.contentType).toMatch(/json/);
    expect(JSON.parse(response.body)).toMatchObject({ id: 1 });
  }, 20_000);

  it('enforces the byte cap', async () => {
    await expect(fetchWithLimits({ url: JSON_URL, maxBytes: 1 })).rejects.toThrow(/cap/);
  });

  it('reports the final url after redirects', async () => {
    const response = await fetchWithLimits({ url: 'https://httpbin.org/redirect-to?url=https%3A%2F%2Fexample.com' });
    expect(response.finalUrl).toContain('example.com');
  }, 20_000);
});

describe('truncate', () => {
  it('leaves short text alone', () => {
    expect(truncate('abc', 10)).toBe('abc');
  });

  it('marks truncation', () => {
    const out = truncate('a'.repeat(50), 10);
    expect(out).toContain('truncated at 10');
    expect(out.length).toBeLessThan(50);
  });
});
