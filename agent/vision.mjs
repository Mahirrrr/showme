// Client for Youngjun's vision service (shared/contract.md, agent routes). MOCK_VISION=1 returns canned data.

export class VisionError extends Error {}

const MOCK_REQUEST = { request_id: 'req_demo_001', item_name: 'PS4 controller', status: 'awaiting_seller' };
const MOCK_CHALLENGES = [
  { id: 'power_on', kind: 'buyer', prompt: 'Turn it on and show the screen or power light', expect: 'device visibly powered on' },
  { id: 'live_fingers', kind: 'liveness', prompt: 'Hold up 3 fingers next to it', expect: 'exactly 3 fingers beside the item' },
  { id: 'buttons', kind: 'buyer', prompt: 'Press each button while the screen shows it responding', expect: 'on-screen response to button presses' },
];

export function makeMockVision({ results = {} } = {}) {
  const calls = [];
  const rec = (name, args) => { calls.push({ name, args }); };
  return {
    calls,
    async byCode(code) { rec('byCode', code); return code === '4827' ? { ...MOCK_REQUEST } : null; },
    async latestWaiting() { rec('latestWaiting'); return { ...MOCK_REQUEST }; },
    async start(id) { rec('start', id); return { challenges: MOCK_CHALLENGES.map(c => ({ ...c })) }; },
    async check(body) {
      rec('check', { ...body, frames: body.frames.length });
      const r = results[body.challenge_id] ?? 'passed';
      const result = Array.isArray(r) ? r[Math.min(body.attempt - 1, r.length - 1)] : r;
      return { result, confidence: result === 'passed' ? 0.9 : 0.5, reason: `mock ${result}`, best_frame: 0 };
    },
    async finish(id) { rec('finish', id); return { summary: { passed: 3, failed: 0, unverified: 0, total: 3, liveness: 'passed' }, link_url: 'http://localhost:5173/v/k3v9xq', notify_chat_ids: [] }; },
    async abort(id) { rec('abort', id); return { ok: true }; },
  };
}

export function makeHttpVision({ url, key, fetchImpl = fetch, timeoutMs = 6000 }) {
  if (!url || !key) throw new Error('VISION_URL and AGENT_KEY are required unless MOCK_VISION=1');
  const base = url.replace(/\/$/, '');
  const call = async (method, path, body, { allow404 = false } = {}) => {
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        headers: { 'x-agent-key': key, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) { throw new VisionError(`${method} ${path}: ${error.name === 'TimeoutError' ? 'timeout' : error.message}`); }
    if (allow404 && response.status === 404) return null;
    if (!response.ok) throw new VisionError(`${method} ${path}: HTTP ${response.status}`);
    return response.json();
  };
  return {
    byCode: code => call('GET', `/agent/requests/by-code/${encodeURIComponent(code)}`, undefined, { allow404: true }),
    latestWaiting: () => call('GET', '/agent/requests/latest-waiting', undefined, { allow404: true }),
    start: id => call('POST', `/agent/requests/${id}/start`),
    check: body => call('POST', '/agent/check', body),
    finish: id => call('POST', `/agent/requests/${id}/finish`),
    abort: id => call('POST', `/agent/requests/${id}/abort`),
  };
}

export function makeVision(env = process.env) {
  return env.MOCK_VISION === '1' ? makeMockVision() : makeHttpVision({ url: env.VISION_URL, key: env.AGENT_KEY });
}
