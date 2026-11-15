import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCode, makeCodeListener } from '../code.mjs';
import { renderCard, withPulse, wrapText, WIDTH, HEIGHT, COLUMN } from '../card.mjs';
import { FrameBuffer, toJpegBase64 } from '../frames.mjs';
import { makeMockVision, makeHttpVision, VisionError } from '../vision.mjs';
import { runCall, LIMITS } from '../flow.mjs';

// ---------- code listener (sellers say the code while the greeting is still playing)
test('makeCodeListener: a code heard before listening starts is kept', async () => {
  let t = 1000;
  const l = makeCodeListener({ now: () => t, keepMs: 20000 });
  l.heard('4827');
  t += 5000;
  assert.equal(await l.listen(50), '4827');
});
test('makeCodeListener: an early code is used once, then it waits again', async () => {
  let t = 0;
  const l = makeCodeListener({ now: () => t });
  l.heard('4827');
  assert.equal(await l.listen(50), '4827');
  assert.equal(await l.listen(20), null);
});
test('makeCodeListener: a stale early code is ignored', async () => {
  let t = 0;
  const l = makeCodeListener({ now: () => t, keepMs: 20000 });
  l.heard('4827');
  t += 30000;
  assert.equal(await l.listen(20), null);
});
test('makeCodeListener: a code heard while listening resolves it', async () => {
  const l = makeCodeListener({ now: () => 0 });
  const p = l.listen(1000);
  l.heard('1234');
  assert.equal(await p, '1234');
});

// ---------- parseCode
test('parseCode: digits, words, mixed, split', () => {
  assert.equal(parseCode('my code is 4827'), '4827');
  assert.equal(parseCode('Four eight two seven.'), '4827');
  assert.equal(parseCode('four 8 two 7'), '4827');
  assert.equal(parseCode('48 27'), '4827');
  assert.equal(parseCode('oh one oh nine'), '0109');
});
test('parseCode: rejects wrong lengths and empty input', () => {
  assert.equal(parseCode('123'), null);
  assert.equal(parseCode('12345'), null);
  assert.equal(parseCode(''), null);
  assert.equal(parseCode(undefined), null);
  assert.equal(parseCode('hello there'), null);
});

// ---------- card
test('renderCard returns a full RGBA frame for every status', () => {
  for (const status of ['info', 'waiting', 'checking', 'passed', 'failed', 'unverified']) {
    const px = renderCard({ step: 1, total: 3, title: 'PS4 controller', prompt: 'Hold up 3 fingers next to it', status });
    assert.equal(px.length, WIDTH * HEIGHT * 4);
  }
});
test('cards fit FaceTime both ways: 3:2 frame, text in a phone-shaped center column', () => {
  assert.equal(WIDTH / HEIGHT, 1.5); // FaceTime's video on the Mac is 3:2
  assert.equal(WIDTH % 2, 0); assert.equal(HEIGHT % 2, 0); // even sizes for the video encoder
  // Fill mode on an iPhone (9:19.5) shows only the center column, so it must be phone-shaped and centered.
  assert.ok(Math.abs(COLUMN.width / HEIGHT - 9 / 19.5) < 0.01, `column ${COLUMN.width} is not phone-shaped`);
  assert.equal(COLUMN.x * 2 + COLUMN.width, WIDTH);
});
test('fit mode has no black side bars: the wings are painted', () => {
  const px = renderCard({ prompt: 'x', status: 'waiting' });
  const at = (x, y) => px.slice((y * WIDTH + x) * 4, (y * WIDTH + x) * 4 + 3);
  assert.notDeepEqual([...at(5, 5)], [0, 0, 0]);
  assert.notDeepEqual([...at(WIDTH - 5, HEIGHT - 5)], [0, 0, 0]);
});
test('renderCard survives empty and very long prompts', () => {
  assert.equal(renderCard().length, WIDTH * HEIGHT * 4);
  assert.equal(renderCard({ prompt: 'word '.repeat(400) + '🎮 ünïcødé' }).length, WIDTH * HEIGHT * 4);
});
test('wrapText keeps lines under the width', () => {
  const lines = wrapText('aa bb cc dd', 5, t => t.length);
  assert.deepEqual(lines, ['aa bb', 'cc dd']);
  assert.deepEqual(wrapText('', 10, t => t.length), []);
});
test('withPulse changes only a copy', () => {
  const base = renderCard({ prompt: 'x' });
  const out = withPulse(base, 0);
  assert.notStrictEqual(out, base);
  assert.equal(out.length, base.length);
});

// ---------- FrameBuffer
test('FrameBuffer samples, caps and drops stale frames', () => {
  let t = 0;
  const b = new FrameBuffer({ sampleMs: 500, keep: 3, now: () => t });
  assert.equal(b.offer({ id: 1 }), true);
  t = 100; assert.equal(b.offer({ id: 2 }), false);   // too soon
  for (const id of [3, 4, 5, 6]) { t += 500; b.offer({ id }); }
  assert.deepEqual(b.frames.map(f => f.id), [4, 5, 6]); // capped at 3
  assert.deepEqual(b.recent(1000, 4).map(f => f.id), [4, 5, 6]);
  t += 5000; assert.deepEqual(b.recent(2000), []);     // all stale
  b.clear(); assert.equal(b.frames.length, 0);
});
test('toJpegBase64 encodes and scales an RGBA frame', () => {
  const width = 1280, height = 720, data = new Uint8Array(width * height * 4).fill(200);
  const b64 = toJpegBase64({ data, width, height }, { maxWidth: 400 });
  const bytes = Buffer.from(b64, 'base64');
  assert.equal(bytes[0], 0xff); assert.equal(bytes[1], 0xd8); // JPEG magic
});

// ---------- vision HTTP client
test('http vision: sends the agent key, maps 404 to null, wraps errors', async () => {
  const seen = [];
  const fetchImpl = async (url, opts) => {
    seen.push({ url, key: opts.headers['x-agent-key'] });
    if (url.endsWith('/by-code/0000')) return new Response('', { status: 404 });
    if (url.endsWith('/check')) return new Response('', { status: 500 });
    return Response.json({ ok: true });
  };
  const v = makeHttpVision({ url: 'http://x/api/', key: 'k', fetchImpl });
  assert.equal(await v.byCode('0000'), null);
  assert.deepEqual(await v.abort('r1'), { ok: true });
  await assert.rejects(v.check({}), VisionError);
  assert.equal(seen[0].url, 'http://x/api/agent/requests/by-code/0000');
  assert.ok(seen.every(s => s.key === 'k'));
  assert.throws(() => makeHttpVision({ url: '', key: '' }));
});

// ---------- call flow
function harness({ codes = ['4827'], frames = ['jpg'], results, checkThrows = false, clockStep = 0 } = {}) {
  const said = [], shown = [];
  let t = 0;
  const vision = makeMockVision({ results });
  if (checkThrows) vision.check = async () => { throw new VisionError('timeout'); };
  const deps = {
    say: async text => { said.push(text); t += clockStep; },
    show: card => shown.push(card),
    listenForCode: async () => codes.shift() ?? null,
    grabFrames: () => (typeof frames === 'function' ? frames() : frames),
    vision, sleep: async () => {}, now: () => t,
  };
  return { deps, said, shown, vision };
}

test('flow: happy path checks every challenge and finishes', async () => {
  const h = harness();
  const state = await runCall(h.deps);
  assert.equal(state.finished, true);
  assert.deepEqual(state.results.map(r => r.result), ['passed', 'passed', 'passed']);
  assert.equal(h.vision.calls.filter(c => c.name === 'check').length, 3);
  assert.ok(h.said.at(-1).includes('3 of 3'));
});
test('flow: wrong code twice falls back to latest-waiting', async () => {
  const h = harness({ codes: ['1111', null] });
  const state = await runCall(h.deps);
  assert.ok(h.vision.calls.some(c => c.name === 'latestWaiting'));
  assert.equal(state.finished, true);
});
test('flow: second try of the code works without fallback', async () => {
  const h = harness({ codes: [null, '4827'] });
  await runCall(h.deps);
  assert.ok(!h.vision.calls.some(c => c.name === 'latestWaiting'));
});
test('flow: failed results retry up to 3 attempts, then move on', async () => {
  const h = harness({ results: { buttons: 'failed' } });
  const state = await runCall(h.deps);
  const buttons = state.results.find(r => r.id === 'buttons');
  assert.equal(buttons.result, 'failed');
  assert.equal(buttons.attempts, LIMITS.maxAttempts);
});
test('flow: pass on retry stops retrying', async () => {
  const h = harness({ results: { power_on: ['unverified', 'passed'] } });
  const state = await runCall(h.deps);
  assert.deepEqual(state.results[0], { id: 'power_on', kind: 'buyer', result: 'passed', attempts: 2 });
});
test('flow: vision errors count as unverified attempts, never passed', async () => {
  const h = harness({ checkThrows: true });
  const state = await runCall(h.deps);
  assert.ok(state.results.every(r => r.result === 'unverified' && r.attempts === 3));
});
test('flow: no camera frames never reach vision and end unverified', async () => {
  const h = harness({ frames: [] });
  const state = await runCall(h.deps);
  assert.equal(h.vision.calls.filter(c => c.name === 'check').length, 0);
  assert.ok(state.results.every(r => r.result === 'unverified'));
  assert.ok(h.said.some(s => s.includes("can't see")));
});
test('flow: call budget stops early but still finishes the report', async () => {
  const h = harness({ clockStep: 60_000 }); // each spoken line "takes" a minute
  const state = await runCall(h.deps);
  assert.equal(state.finished, true);
  assert.ok(state.results.length < 3);
});
