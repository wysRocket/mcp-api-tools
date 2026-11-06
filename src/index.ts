import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  asErrorResult,
  asTextResult,
  fetchWithLimits,
  HttpToolError,
  truncate,
} from './http.js';

const httpUrl = z
  .string()
  .url()
  .describe('https URL to call');

const jsonUrl = httpUrl.describe('https URL returning JSON');

const server = new McpServer({
  name: 'mcp-api-tools',
  version: '1.0.0',
});

server.registerTool(
  'http_fetch_json',
  {
    title: 'Fetch JSON',
    description:
      'Fetch an https URL and parse the response as JSON. Returns a truncated, shape-stable summary plus the parsed value when it is small enough.',
    inputSchema: {
      url: jsonUrl,
      timeoutMs: z.number().int().min(500).max(30_000).optional().describe('Timeout in milliseconds'),
    },
  },
  async ({ url, timeoutMs }) => {
    try {
      const response = await fetchWithLimits({ url, timeoutMs });
      let parsed: unknown;
      try {
        parsed = JSON.parse(response.body);
      } catch {
        return asErrorResult(
          `Response is not valid JSON (HTTP ${response.status}, content-type "${response.contentType}").`,
        );
      }
      const text = JSON.stringify(parsed, null, 2);
      return asTextResult(
        [
          `HTTP ${response.status}`,
          `content-type: ${response.contentType || 'unknown'}`,
          `final url: ${response.finalUrl}`,
          `bytes: ${response.body.length}`,
          '',
          truncate(text, 8000),
        ].join('\n'),
      );
    } catch (error) {
      return asErrorResult(error instanceof Error ? error.message : String(error));
    }
  },
);

server.registerTool(
  'http_fetch_text',
  {
    title: 'Fetch text',
    description:
      'Fetch an https URL and return the response body as plain text, capped at a fixed size.',
    inputSchema: {
      url: httpUrl,
      timeoutMs: z.number().int().min(500).max(30_000).optional(),
    },
  },
  async ({ url, timeoutMs }) => {
    try {
      const response = await fetchWithLimits({ url, timeoutMs });
      return asTextResult(
        [`HTTP ${response.status}`, `content-type: ${response.contentType || 'unknown'}`, '', truncate(response.body)].join(
          '\n',
        ),
      );
    } catch (error) {
      return asErrorResult(error instanceof Error ? error.message : String(error));
    }
  },
);

server.registerTool(
  'http_status',
  {
    title: 'Check URL status',
    description:
      'Issue a HEAD request and report status, redirects and response headers without downloading the body.',
    inputSchema: {
      url: httpUrl,
      timeoutMs: z.number().int().min(500).max(30_000).optional(),
    },
  },
  async ({ url, timeoutMs }) => {
    try {
      const response = await fetchWithLimits({ url, method: 'HEAD', timeoutMs });
      return asTextResult(
        [`HTTP ${response.status}`, `final url: ${response.finalUrl}`, `content-type: ${response.contentType || 'unknown'}`].join(
          '\n',
        ),
      );
    } catch (error) {
      return asErrorResult(error instanceof Error ? error.message : String(error));
    }
  },
);

server.registerTool(
  'json_to_csv',
  {
    title: 'JSON to CSV',
    description:
      'Convert a JSON array of objects into CSV. Nested values are serialised as JSON strings so no data is silently lost.',
    inputSchema: {
      json: z.string().min(1).describe('JSON array of objects'),
      columns: z.array(z.string()).optional().describe('Optional explicit column order'),
    },
  },
  async ({ json, columns }) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      return asErrorResult(
        `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return asErrorResult('Expected a non-empty JSON array of objects.');
    }
    const rows: Record<string, unknown>[] = parsed.map((item) =>
  item && typeof item === 'object' ? (item as Record<string, unknown>) : { value: item },
);
    const keys = columns ?? [...new Set(rows.flatMap((row) => Object.keys(row)))];

    const escape = (value: unknown): string => {
      if (value === null || value === undefined) return '';
      const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    const lines = [keys.join(',')];
    for (const row of rows) {
      lines.push(keys.map((key) => escape(row[key])).join(','));
    }
    return asTextResult(lines.join('\n'));
  },
);

server.registerTool(
  'url_to_markdown',
  {
    title: 'Web page to markdown',
    description:
      'Fetch an https page and return a compact plain-text rendering of its main content. Uses a lightweight tag strip; it is not a full browser render.',
    inputSchema: {
      url: httpUrl,
      timeoutMs: z.number().int().min(500).max(30_000).optional(),
    },
  },
  async ({ url, timeoutMs }) => {
    try {
      const response = await fetchWithLimits({ url, timeoutMs, maxBytes: 400_000 });
      if (!/html/i.test(response.contentType)) {
        return asErrorResult(`Expected HTML, got content-type "${response.contentType}".`);
      }
      const text = htmlToText(response.body);
      return asTextResult(`HTTP ${response.status}\n\n${truncate(text, 12_000)}`);
    } catch (error) {
      return asErrorResult(error instanceof Error ? error.message : String(error));
    }
  },
);

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write('mcp-api-tools listening on stdio\n');
}

const isDirectRun = process.argv[1] !== undefined && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isDirectRun) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
}

export { HttpToolError };
