# mcp-api-tools

A small, honest example of an MCP server in TypeScript: five tools over stdio, with input validation, a hard response-size cap, HTTPS-only fetching and tests that hit the real network.

Built as a portfolio piece for [Upwork proposals](https://www.upwork.com/freelancers/~01c932929f946eaabe) — it demonstrates the shape of work I offer (MCP server builds, Chrome extensions, API integration) rather than being a product.

## Tools

| Tool | What it does |
|---|---|
| `http_fetch_json` | Fetch an https URL, parse the body as JSON, return a truncated summary |
| `http_fetch_text` | Fetch an https URL and return the body as text |
| `http_status` | HEAD request; reports status, redirects and content type without downloading the body |
| `json_to_csv` | Convert a JSON array of objects to CSV; nested values become JSON strings |
| `url_to_markdown` | Fetch an HTML page and return a compact plain-text rendering |

## Guardrails

- HTTPS only. `http:` is refused before any request is made.
- Loopback hosts (`localhost`, `127.0.0.1`, `0.0.0.0`, `::1`) are refused, so the server cannot be pointed at local services.
- Response bodies are streamed with a 1 MB cap; a response that declares or exceeds the cap is aborted rather than buffered.
- Per-request timeout (default 10 s, capped at 30 s).
- All tool errors come back as `isError` results with a message, not as protocol-level failures.

## Install

```bash
npm install
npm run build
```

## Wire it into a client

Claude Desktop / Cursor / any MCP client that speaks stdio:

```json
{
  "mcpServers": {
    "api-tools": {
      "command": "node",
      "args": ["/Users/wysmyfree/mcp-api-tools/dist/index.js"]
    }
  }
}
```

## Verify it yourself

```bash
npm test            # 8 vitest cases, including live https requests
node test/stdio-smoke.mjs   # full MCP handshake: initialize, tools/list, tools/call
```

The smoke test has been run against the built server and confirms `tools/list` returns all five tools, `json_to_csv` escapes embedded commas and quotes, `http_status` returns `HTTP 200` for a real site, and an `http://` URL is rejected with `isError: true`.

## Layout

```
src/http.ts    fetch policy: scheme, host, timeout, byte cap
src/index.ts   tool registration and the stdio entry point
test/          vitest unit tests + stdio smoke test
```

## Limits, stated plainly

- `url_to_markdown` strips tags; it is not a browser render and will not run JavaScript.
- No authentication, cookies or session handling. Tools that need a login are out of scope.
- No caching. Repeated calls re-fetch.
- The server fetches arbitrary https URLs on request. Run it only where you would allow outbound requests from your own tools.
