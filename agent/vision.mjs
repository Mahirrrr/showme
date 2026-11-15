// Client for Youngjun's vision service (shared/contract.md, agent routes). MOCK_VISION=1 returns canned data.

export class VisionError extends Error {}

const MOCK_REQUEST = { request_id: 'req_demo_001', item_name: 'PS4 controller', status: 'awaiting_seller' };
const MOCK_CHALLENGES = [
  { id: 'power_on', kind: 'buyer', prompt: 'Turn it on and show the screen or power light', expect: 'device visibly powered on' },
  { id: 'serial', kind: 'buyer', prompt: 'Show the serial label up close.', expect: 'a readable serial label' },
  { id: 'buttons', kind: 'buyer', prompt: 'Press each button while the screen shows it responding', expect: 'on-screen response to button presses' },
];

export function makeMockVision({ results = {} } = {}) {
  const calls = [];
  const latest = new Map();
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
      const verdict = { result, confidence: result === 'passed' ? 0.9 : 0.5, reason: `mock ${result}`, best_frame: 0 };
      latest.set(body.challenge_id, verdict);
      return verdict;
    },
    async finish(id) { rec('finish', id); const outcomes = MOCK_CHALLENGES.map(c => latest.get(c.id)?.result ?? 'unverified'); return { summary: { ...Object.fromEntries(['passed', 'failed', 'unverified'].map(r => [r, outcomes.filter(x => x === r).length])), total: MOCK_CHALLENGES.length, liveness: 'not_run' }, link_url: 'http://localhost:5173/v/k3v9xq', notify_chat_ids: [] }; },
    async abort(id) { rec('abort', id); return { ok: true }; },
  };
}

// Vision's Gemini check can take up to 20 s (Youngjun's CHECK_TIMEOUT_SECONDS), so /agent/check waits 30 s.
export function makeHttpVision({ url, key, fetchImpl = fetch, timeoutMs = 6000, checkTimeoutMs = 30000, signalFor = ms => AbortSignal.timeout(ms) }) {
  if (!url || !key) throw new Error('VISION_URL and AGENT_KEY are required unless MOCK_VISION=1');
  const base = url.replace(/\/$/, '');
  const call = async (method, path, body, { allow404 = false, wait = timeoutMs } = {}) => {
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, {
        method,
        headers: { 'x-agent-key': key, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: signalFor(wait),
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
    check: body => call('POST', '/agent/check', body, { wait: checkTimeoutMs }),
    finish: id => call('POST', `/agent/requests/${id}/finish`),
    abort: id => call('POST', `/agent/requests/${id}/abort`),
  };
}

export function makeVision(env = process.env) {
  return env.MOCK_VISION === '1' ? makeMockVision() : makeHttpVision({ url: env.VISION_URL, key: env.AGENT_KEY });
}
