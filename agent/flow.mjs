// The call, step by step (docs/ARCHITECTURE.md, "The agent's call"). Every side effect is injected,
// so the whole flow runs in tests without LiveKit, FaceTime or the network.
//
// deps: say(text) → Promise (resolves after playout); show(card); listenForCode(ms) → Promise<string|null>;
//       grabFrames() → base64 JPEG[]; vision (see vision.mjs); sleep(ms); now() → ms; log(msg)

export const LIMITS = {
  maxAttempts: 3,          // vision accepts attempts 1 to 3
  checkWindowMs: 30_000,   // each check gets up to 30 s; it ends early on a pass
  actMs: 2_500,            // after the prompt is spoken, time to do the action before the first look
  retryGapMs: 3_000,       // pause between silent retries (the hint is on screen meanwhile)
  noFrameRetryMs: 2_000,   // look again this soon when the camera shows nothing
  callBudgetMs: 270_000,   // never start a check that can't end by 4:30 (5-minute FaceTime cap)
  codeListenMs: 12_000,
};

const say1 = (text) => text.replace(/\s+/g, ' ').trim();
/** What the agent says for a prompt: the card keeps the buyer's words, the voice skips a leading "Please". */
const spoken = (prompt) => { const t = say1(prompt).replace(/^please,?\s+/i, ''); return t.charAt(0).toUpperCase() + t.slice(1); };

// Rough stage of a test from its wording, for tests Gemini wrote (not in the catalog):
// 0 = turn it on, 1 = on-screen info (Settings, About, battery, IMEI…), 2 = physical (ports, sides, scratches).
const STAGES = [
  /\b(turn (it )?on|power(ed)? on|wake|lock screen|boot|start(s)? up)\b/i,
  /settings|about|battery|imei|\*#06#|serial|model|storage|account|apple id|signed (in|out)|launch|game|menu|screen shows/i,
];
const stageOf = prompt => { const i = STAGES.findIndex(re => re.test(prompt)); return i < 0 ? STAGES.length : i; };

/**
 * Logical order: the buyer's tests go power on, then on-screen info, then physical checks (catalog order
 * breaks ties, since shared/tests.json lists them so each step leads into the next), then a custom test,
 * then the secret liveness challenges. Vision returns them shuffled. Stable otherwise.
 */
export function orderChallenges(challenges, catalog = {}) {
  const rankOf = new Map();
  for (const tests of Object.values(catalog)) tests.forEach((t, i) => { if (!rankOf.has(t.prompt)) rankOf.set(t.prompt, i); });
  const group = c => (c.kind === 'liveness' ? 2 : c.kind === 'custom' ? 1 : 0);
  return challenges
    .map((c, i) => ({ c, i }))
    .sort((a, b) => group(a.c) - group(b.c)
      || stageOf(a.c.prompt) - stageOf(b.c.prompt)
      || (rankOf.get(a.c.prompt) ?? 99) - (rankOf.get(b.c.prompt) ?? 99)
      || a.i - b.i)
    .map(x => x.c);
}

/** On-screen guidance after a check that didn't pass: vision's reason, short enough for the card. */
export function hintFor(verdict, max = 100) {
  const lead = verdict.result === 'failed' ? 'Not yet' : 'Not clear yet';
  // Gemini writes about "the images"; the seller is looking through a camera, so say what the agent sees.
  const reason = say1(verdict.reason ?? '').replace(/^the (images?|frames?|video|photos?|pictures?) (show|shows|depict|depicts)\s+/i, 'I see ');
  if (!reason) return `${lead}. Hold it steady, closer to the camera.`;
  const text = `${lead}: ${reason}`;
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : cut.length)}…`;
}

export async function runCall(deps, limits = LIMITS) {
  const { say, show, listenForCode, grabFrames, vision, sleep, now, log = () => {}, catalog } = deps;
  // A pause the seller can cut short by voice: resolves with "skip" | "again" | "ready", or null after ms.
  const pause = async ms => (deps.waitForCommand ? deps.waitForCommand(ms) : (await sleep(ms), null));
  const startedAt = now();
  const timeLeft = () => limits.callBudgetMs - (now() - startedAt);
  const state = { request: null, results: [], finished: false };

  // 1. Greet and link the call to a request.
  show({ prompt: 'Flip to your back camera, then say the 4-digit code from the link', status: 'info' });
  await say("Hi, I'm ShowMe. Flip to your back camera and say the 4-digit code from the link.");
  let code = await listenForCode(limits.codeListenMs);
  let request = code ? await vision.byCode(code) : null;
  if (!request) {
    show({ prompt: 'Say the 4 digits one more time.', status: 'info' });
    await say('Sorry, say the four digits again.');
    code = await listenForCode(limits.codeListenMs);
    request = code ? await vision.byCode(code) : null;
  }
  if (!request) {
    log('[flow] code not matched twice, using latest-waiting');
    request = await vision.latestWaiting();
  }
  if (!request) {
    show({ prompt: 'No check is waiting. Ask the buyer for a new link.', status: 'failed', note: 'No check found' });
    await say("I can't find a check for you. Ask the buyer for a new link. Goodbye.");
    return state;
  }
  state.request = request;

  // 2. Start: the buyer's tests plus the secret liveness challenges, in an order that makes sense.
  const { challenges: raw } = await vision.start(request.request_id);
  const challenges = orderChallenges(raw, catalog);
  await say(`Thanks. ${challenges.length} quick checks. Keep the ${request.item_name} in view. Say skip or again anytime.`);

  // 3. Each challenge: say it once, then look for up to 30 s. Retries are silent; the card says what's wrong.
  let nudged = false;
  for (let i = 0; i < challenges.length; i++) {
    if (timeLeft() < limits.checkWindowMs) { log('[flow] call budget reached'); break; }
    const ch = challenges[i];
    const card = { step: i + 1, total: challenges.length, title: request.item_name, prompt: ch.prompt };
    show({ ...card, status: 'waiting' });
    const shownAt = now(), deadline = shownAt + limits.checkWindowMs; // the window opens with the card, not after the speech
    deps.clearCommands?.(); // nothing said before this task counts for it
    await say(spoken(ch.prompt));
    let command = await pause(limits.actMs);
    let attempt = 0, last = null;
    while (attempt < limits.maxAttempts && now() < deadline) {
      if (command === 'skip') { log(`[flow] check ${i + 1} skipped by the seller`); break; }
      if (command === 'again') { await say(spoken(ch.prompt)); command = await pause(limits.actMs); continue; }
      command = null; // "ready" (or nothing): look now
      // The contract wants 2 to 4 frames; fewer counts as no frames (vision would reject it with a 422).
      const grabbed = grabFrames();
      if (grabbed.length < 2) {
        show({ ...card, status: 'waiting', note: "I can't see it. Point the camera at the item." });
        if (!nudged) { nudged = true; await say("I can't see anything. Point the camera at the item."); }
        command = await pause(limits.noFrameRetryMs);
        continue;
      }
      attempt++;
      show({ ...card, status: 'checking' });
      const askedAt = now();
      try {
        last = await vision.check({ request_id: request.request_id, challenge_id: ch.id, attempt, frames: grabbed });
        log(`[timing] check ${i + 1}.${attempt}: ${last.result} in ${now() - askedAt} ms (${now() - shownAt} ms into this check)`);
      } catch (error) {
        log(`[flow] check failed: ${error.message}`);
        last = { result: 'unverified', confidence: 0, reason: 'The check timed out.' };
      }
      if (last.result === 'passed') break;
      if (attempt < limits.maxAttempts && now() < deadline) {
        show({ ...card, status: 'waiting', note: hintFor(last) });
        command = await pause(limits.retryGapMs);
      }
    }
    const result = last?.result ?? 'unverified';
    show({ ...card, status: result, note: result === 'passed' ? '' : last ? hintFor(last) : 'No camera view' });
    log(`[timing] check ${i + 1} done: ${result} after ${now() - shownAt} ms, ${attempt} attempt(s)`);
    if (result === 'passed') await say('Got it.');
    state.results.push({ id: ch.id, kind: ch.kind, result, attempts: attempt });
  }

  // 4. Finish: the report goes to the buyer's link.
  const done = await vision.finish(request.request_id);
  state.finished = true;
  const s = done.summary;
  const headline = s.liveness === 'failed' ? 'Live check failed' : s.failed === 0 && s.unverified === 0 ? 'Verified live' : 'Check complete';
  show({ prompt: `${headline}. The report is on the buyer's link.`, status: s.liveness === 'failed' ? 'failed' : s.failed || s.unverified ? 'unverified' : 'passed', note: `${s.passed} passed · ${s.failed} failed · ${s.unverified} unverified` });
  await say(say1(`All done. ${s.passed} of ${s.total} passed. The report is on the buyer's link. Goodbye.`));
  return state;
}
