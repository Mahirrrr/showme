import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canSubmitSelection, selectionMessage } from '../src/lib/selection.ts';
import { bannerFor, summarize } from '../src/lib/report.ts';

test('minimum selection applies equally to suggested and standard tests', () => {
  for (const count of [0, 1, 2, 21]) assert.equal(canSubmitSelection(count), false);
  for (const count of [3, 6, 20]) assert.equal(canSubmitSelection(count), true);
  assert.equal(selectionMessage(2), '2 selected · 3 tests minimum');
});
const passed = { prompt: 'Show it on.', kind: 'buyer', result: 'passed', attempts: 2, confidence: .9, reason: 'Visible.', attempt_history: [
  { attempt: 1, result: 'failed', confidence: .9, reason: 'Off.' },
  { attempt: 2, result: 'passed', confidence: .9, reason: 'On.' },
] };
test('retry history never changes a later passed verdict or creates a liveness claim', () => {
  const view = { results: [passed] };
  assert.deepEqual(summarize(view), { passed: 1, failed: 0, unverified: 0, total: 1, liveness: 'not_run' });
  assert.equal(bannerFor(view).title, 'All checks passed');
  assert.equal(bannerFor(view).tone, 'pass');
});
test('new not_run summaries and unfinished checks render without a recording warning', () => {
  const view = { results: [], summary: { passed: 2, failed: 0, unverified: 1, total: 3, liveness: 'not_run' } };
  assert.equal(bannerFor(view).tone, 'unv');
  assert.equal(bannerFor(view).title, '2 passed · 0 failed · 1 unverified');
});
test('historical completed reports preserve liveness banners', () => {
  const legacy = { results: [{ ...passed, kind: 'liveness', result: 'failed' }], summary: { passed: 2, failed: 1, unverified: 0, total: 3, liveness: 'failed' } };
  assert.equal(bannerFor(legacy).title, 'Live check failed: possible recording');
  assert.equal(bannerFor({ results: [passed], summary: { passed: 1, failed: 0, unverified: 0, total: 1, liveness: 'passed' } }).title, 'Verified live');
});

// A score is supplied by the backend; the UI must not hardcode the threshold.
import { reportWarning } from '../src/lib/report.ts';
const scored = (extra = {}) => ({ results: [], summary: {
  passed: 3, failed: 1, unverified: 0, total: 4, liveness: 'not_run',
  passed_tests: 3, total_selected_tests: 4, pass_percentage: 75,
  passing_threshold_percent: 75, overall_verdict: 'passed', ...extra,
} });
test('exactly 75% is overall PASSED with a clear individual-failure warning', () => {
  const view = scored();
  assert.equal(bannerFor(view).title, 'Overall PASSED');
  assert.match(bannerFor(view).detail, /3 \/ 4.*75%/);
  assert.match(reportWarning(view), /1 check\(s\) failed/);
});
test('unverified outcomes remain visible even when overall passes', () => {
  const view = scored({ failed: 0, unverified: 1 });
  assert.equal(bannerFor(view).tone, 'pass');
  assert.match(reportWarning(view), /1 were unverified/);
});
test('below 75% fails; a configured 80% threshold is authoritative at 75%', () => {
  assert.equal(bannerFor(scored({ pass_percentage: 50, passed_tests: 2, overall_verdict: 'failed' })).title, 'Overall FAILED');
  assert.equal(bannerFor(scored({ passing_threshold_percent: 80, overall_verdict: 'failed' })).tone, 'fail');
});
test('historical liveness warning is preserved alongside the selected-test score', () => {
  const view = scored({ liveness: 'failed' });
  assert.equal(bannerFor(view).title, 'Overall PASSED');
  assert.match(reportWarning(view), /possible recording/);
});
test('all-passed score has no warning; retries do not change individual test rows', () => {
  const view = { ...scored({ passed: 4, failed: 0, passed_tests: 4, pass_percentage: 100 }), results: [passed] };
  assert.equal(reportWarning(view), null);
  assert.equal(view.results[0].result, 'passed');
  assert.equal(view.results[0].attempt_history[0].result, 'failed');
});
