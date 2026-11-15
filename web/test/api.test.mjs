import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Exercise the real TS API client through Vite's transform; no HTTP listener.
const server = await createServer({ configFile: false, root: fileURLToPath(new URL('../', import.meta.url)),
  server: { middlewareMode: true, hmr: false, ws: false },
  define: { 'import.meta.env.VITE_MOCK': JSON.stringify('0') },
  optimizeDeps: { noDiscovery: true },
});
after(() => server.close());
const { createRequest, ApiError } = await server.ssrLoadModule('/src/api.ts');
const specs = [0, 1, 2].map(i => ({ id: `test_${i}`, label: `Test ${i}`, prompt: `Show part ${i}.`, expect: `part ${i} visible` }));

test('API client rejects fewer than two or duplicate selections without sending a request', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({}); };
  try {
    for (const tests of [[], specs.slice(0, 1), [specs[0], specs[0], specs[1]]]) {
      await assert.rejects(createRequest({ item_name: 'Item', category: 'other', tests, custom_test: 'Show the cable.' }), e => e instanceof ApiError && e.status === 422);
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('API client preserves suggested objects and never substitutes standard tests on 422', async () => {
  const original = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (path, options) => { sent.push({ path, body: JSON.parse(options.body) }); return Response.json({ detail: 'Invalid selection' }, { status: 422 }); };
  try {
    const body = { item_name: 'Item', category: 'other', tests: specs };
    await assert.rejects(createRequest(body), e => e.status === 422);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0], { path: '/api/requests', body });
  } finally { globalThis.fetch = original; }
});
