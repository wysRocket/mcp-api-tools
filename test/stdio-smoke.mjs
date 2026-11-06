// Smoke test: drive the built server over stdio with a real MCP handshake.
import { spawn } from 'node:child_process';

const child = spawn('node', ['dist/index.js'], { stdio: ['pipe', 'pipe', 'pipe'] });
let buffer = '';
const pending = new Map();
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  for (;;) {
    const newline = buffer.indexOf('\n');
    if (newline === -1) break;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    const resolve = pending.get(message.id);
    if (resolve) {
      pending.delete(message.id);
      resolve(message);
    }
  }
});
child.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));

let nextId = 1;
function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`timeout waiting for ${method}`));
      }
    }, 15000);
  });
}

const init = await request('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'smoke', version: '1.0.0' },
});
console.log('server:', JSON.stringify(init.result.serverInfo));

const tools = await request('tools/list', {});
console.log('tools:', tools.result.tools.map((t) => t.name).join(', '));

const csv = await request('tools/call', {
  name: 'json_to_csv',
  arguments: { json: '[{"a":1,"b":"x"},{"a":2,"b":"y,z"}]' },
});
console.log('json_to_csv:', JSON.stringify(csv.result.content[0].text));

const status = await request('tools/call', { name: 'http_status', arguments: { url: 'https://example.com' } });
console.log('http_status:', status.result.content[0].text.split('\n')[0]);

const bad = await request('tools/call', { name: 'http_status', arguments: { url: 'http://example.com' } });
console.log('http_status (http scheme):', bad.result.content[0].text, 'isError:', bad.result.isError === true);

child.stdin.end();
child.kill();
