// The call, step by step (docs/ARCHITECTURE.md, "The agent's call"). Every side effect is injected,
// so the whole flow runs in tests without LiveKit, FaceTime or the network.
//
// deps: say(text) → Promise (resolves after playout); show(card); listenForCode(ms) → Promise<string|null>;
//       grabFrames() → base64 JPEG[]; vision (see vision.mjs); sleep(ms); now() → ms; log(msg)

export const LIMITS = {
  maxAttempts: 3,        // 1 try + 2 retries
  settleMs: 4000,        // time to do the action after the prompt
  noFrameWaits: 2,       // "I can't see you" prompts that don't use up an attempt
  callBudgetMs: 270_000, // stop at 4:30, under the 5-minute FaceTime cap
  codeListenMs: 12_000,
};

const say1 = (text) => text.replace(/\s+/g, ' ').trim();

export async function runCall(deps, limits = LIMITS) {
  const { say, show, listenForCode, grabFrames, vision, sleep, now, log = () => {} } = deps;
  const startedAt = now();
  const outOfTime = () => now() - startedAt > limits.callBudgetMs;
  const state = { request: null, results: [], finished: false };

  // 1. Greet and link the call to a request.
  show({ prompt: 'Flip to your back camera, then say the 4-digit code from the link', status: 'info' });
  await say("Hi, I'm ShowMe, an AI that runs a live check for the buyer. Please flip to your back camera. What's the 4-digit code on your link?");
  let code = await listenForCode(limits.codeListenMs);
  let request = code ? await vision.byCode(code) : null;
  if (!request) {
    show({ prompt: 'Say the 4 digits one more time.', status: 'info' });
    await say('Sorry, I missed that. Please say the four digits one more time.');
    code = await listenForCode(limits.codeListenMs);
    request = code ? await vision.byCode(code) : null;
  }
  if (!request) {
    log('[flow] code not matched twice, using latest-waiting');
    request = await vision.latestWaiting();
  }
  if (!request) {
    show({ prompt: 'No check is waiting. Ask the buyer for a new link.', status: 'failed', note: 'No check found' });
    await say("I can't find a check waiting for you. Please ask the buyer for a new link. Goodbye.");
    return state;
  }
  state.request = request;

  // 2. Start: the buyer's tests plus the secret liveness challenges.
  const { challenges } = await vision.start(request.request_id);
  await say(`Thanks. This is a live check for the ${request.item_name}. I'll ask for ${challenges.length} quick things. Keep the item in view.`);

  // 3. Each challenge: card + voice, wait, check, retry up to the limit.
  for (let i = 0; i < challenges.length; i++) {
    if (outOfTime()) { log('[flow] call budget reached'); break; }
    const ch = challenges[i];
    const card = { step: i + 1, total: challenges.length, title: request.item_name, prompt: ch.prompt };
    let attempt = 0, noFrame = 0, last = null;
    while (attempt < limits.maxAttempts && !outOfTime()) {
      show({ ...card, status: 'waiting' });
      await say(attempt === 0 ? ch.prompt : `Let's try that again. ${ch.prompt}`);
      await sleep(limits.settleMs);
      const frames = grabFrames();
      if (frames.length === 0 && noFrame < limits.noFrameWaits) {
        noFrame++;
        show({ ...card, status: 'waiting', note: "I can't see you" });
        await say("I can't see anything. Point the camera at the item.");
        continue;
      }
      attempt++;
      show({ ...card, status: 'checking' });
      if (frames.length === 0) {
        last = { result: 'unverified', confidence: 0, reason: 'no camera frames' };
      } else {
        try {
          last = await vision.check({ request_id: request.request_id, challenge_id: ch.id, attempt, frames });
        } catch (error) {
          log(`[flow] check failed: ${error.message}`);
          last = { result: 'unverified', confidence: 0, reason: 'check timed out' };
        }
      }
      show({ ...card, status: last.result });
      if (last.result === 'passed') { await say('Got it.'); break; }
      if (attempt >= limits.maxAttempts) {
        await say(last.result === 'failed' ? "That didn't pass. Moving on." : "I couldn't see it clearly. I'll mark it unverified.");
      }
    }
    state.results.push({ id: ch.id, kind: ch.kind, result: last?.result ?? 'unverified', attempts: attempt });
  }

  // 4. Finish: the report goes to the buyer's link.
  const done = await vision.finish(request.request_id);
  state.finished = true;
  const s = done.summary;
  const headline = s.liveness === 'failed' ? 'Live check failed' : s.failed === 0 && s.unverified === 0 ? 'Verified live' : 'Check complete';
  show({ prompt: `${headline}. The report is on the buyer's link.`, status: s.liveness === 'failed' ? 'failed' : s.failed || s.unverified ? 'unverified' : 'passed', note: `${s.passed} passed · ${s.failed} failed · ${s.unverified} unverified` });
  await say(say1(`All done. ${s.passed} of ${s.total} checks passed. The buyer can see the report on their link now. Thanks, goodbye.`));
  return state;
}
