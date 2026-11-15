import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import react from '@vitejs/plugin-react';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, root: fileURLToPath(new URL('../', import.meta.url)), plugins: [react()], server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true } });
after(() => server.close());
const { Report } = await server.ssrLoadModule('/src/pages/Verify.tsx');
function view(outcome = 'failed') {
  return { status: 'complete', item_name: 'Controller', category: 'console', line_number: '', tests: [], results: [
    ...Array.from({ length: 3 }, (_, i) => ({ prompt: `Test ${i}`, kind: 'buyer', result: 'passed', confidence: .9, reason: 'Visible.', attempts: 1 })),
    { prompt: 'Final individual check', kind: 'buyer', result: outcome, confidence: .9, reason: 'Still not verified.', attempts: 1 },
  ], summary: { passed: 3, failed: outcome === 'failed' ? 1 : 0, unverified: outcome === 'unverified' ? 1 : 0, total: 4, liveness: 'not_run', passed_tests: 3, total_selected_tests: 4, pass_percentage: 75, passing_threshold_percent: 75, overall_verdict: 'passed' } };
}

test('report renders authoritative 75% PASSED, counts, warning, and individual Failed badge', () => {
  const html = renderToStaticMarkup(React.createElement(Report, { view: view() }));
  for (const value of ['Overall PASSED', '75%', '3 / 4', 'role="alert"', 'individual checks did not pass', '>Failed<', 'Final individual check']) assert.ok(html.includes(value), value);
});
test('overall pass never hides an individual Unverified result', () => {
  const html = renderToStaticMarkup(React.createElement(Report, { view: view('unverified') }));
  assert.ok(html.includes('Overall PASSED') && html.includes('>Unverified<') && html.includes('role="alert"'));
});
test('historical summary without score fields still renders', () => {
  const legacy = view();
  legacy.summary = { passed: 3, failed: 1, unverified: 0, total: 4, liveness: 'failed' };
  const html = renderToStaticMarkup(React.createElement(Report, { view: legacy }));
  assert.ok(html.includes('Live check failed: possible recording') && html.includes('Final individual check'));
});
