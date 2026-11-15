// The call, step by step (docs/ARCHITECTURE.md, "The agent's call"). Every side effect is injected,
// so the whole flow runs in tests without LiveKit, FaceTime or the network.
//
// deps: say(text) → Promise (resolves after playout); show(card); listenForCode(ms) → Promise<string|null>;
//       grabFrames() → base64 JPEG[]; vision (see vision.mjs); sleep(ms); now() → ms; log(msg)

export const LIMITS = {
  maxAttempts: 3,          // vision accepts attempts 1 to 3
  checkRequestMs: 30_000, // matches vision HTTP timeout
  finishReserveMs: 15_000, // leave time for finish + goodbye
  noFrameWindowMs: 12_000, // camera recovery does not consume an evaluation
  actMs: 12_000,            // time to act after the first spoken instruction
  retryGapMs: 12_000,       // time to act after each spoken retry
  noFrameRetryMs: 2_000,   // look again this soon when the camera shows nothing
  shotMs: 12_000,          // guided shots: time to line up each side before it is taken anyway
  callBudgetMs: 270_000,   // overall call budget, including report completion
  codeListenMs: 12_000,
};

const say1 = (text) => text.replace(/\s+/g, ' ').trim();
/** Normalize spacing and a leading "Please" consistently for speech and cards. */
const spoken = (prompt) => { const t = say1(prompt).replace(/^please,?\s+/i, ''); return t.charAt(0).toUpperCase() + t.slice(1); };

// Rough stage of a test from its wording, for tests Gemini wrote (not in the catalog):
// 0 = turn it on, 1 = on-screen info (Settings, About, battery, IMEI…), 2 = physical (ports, sides, scratches).
const STAGES = [
  /\b(turn (it )?on|power(ed)? on|turned on|wake|lock screen|boot|start(s)? up)\b/i,
  /settings|about|battery|imei|\*#06#|serial|model|storage|account|apple id|signed (in|out)|launch|game|menu|screen shows/i,
];
const stageOf = prompt => { const i = STAGES.findIndex(re => re.test(prompt)); return i < 0 ? STAGES.length : i; };

// Guided shots. Gemini judges still frames, so a task that needs movement (rotate, pan, front and back) gets
// one steady shot per side: the seller lines up each side and says "ready". All shots go in one Gemini try.
const SHOT_PLANS = [
  [/\bfront (and|&) back\b|\bboth sides\b/i, ['Front', 'Back']],
  [/\btop (and|&) bottom\b/i, ['Top', 'Bottom']],
  [/\brotate\b|\bspin\b|\b360\b|\bturn (it|the \w+) around\b|\ball (four |4 )?sides\b|\bevery side\b|\ball around\b|\ball angles\b/i, ['Front', 'Right side', 'Back', 'Left side']],
  [/\bpan\b|\bsweep\b/i, ['Start', 'Middle', 'End']],
];
/** The shots a task needs (2 to 4 labels), or null for a task one look can judge. */
export function shotPlan(prompt) {
  const hit = SHOT_PLANS.find(([re]) => re.test(prompt ?? ''));
  return hit ? hit[1] : null;
}

/**
 * Logical order: the buyer's tests go power on, then on-screen info, then physical checks (catalog order
 * breaks ties, since shared/tests.json lists them so each step leads into the next), then a custom test,
 * legacy surprise challenges are ignored. Stable otherwise.
 */
export function orderChallenges(challenges, catalog = {}) {
  const rankOf = new Map();
  for (const tests of Object.values(catalog)) tests.forEach((t, i) => { if (!rankOf.has(t.prompt)) rankOf.set(t.prompt, i); });
  const group = c => (c.kind === 'liveness' ? 2 : c.kind === 'custom' ? 1 : 0);
  return challenges
    .filter(c => c.kind !== 'liveness') // older API responses must not add surprise checks
    .map((c, i) => ({ c: { ...c, prompt: spoken(c.prompt) }, i }))
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

/** Use the API's score snapshot; keep old server summaries readable. */
export function completionFor(s) {
  if ((s.overall_verdict === 'passed' || s.overall_verdict === 'failed') && typeof s.pass_percentage === 'number') {
    const percentage = `${Number(s.pass_percentage.toFixed(2))}%`;
    const warning = s.overall_verdict === 'passed' && (s.failed > 0 || s.unverified > 0) ? ' Some checks did not pass. Read the report.' : '';
    return {
      headline: `Overall ${s.overall_verdict.toUpperCase()}`,
      status: s.overall_verdict,
      note: `${s.passed_tests} / ${s.total_selected_tests} selected tests passed · ${percentage}.${warning}`,
      spoken: `Overall verification ${s.overall_verdict}. ${s.passed_tests} of ${s.total_selected_tests} selected tests passed.${warning}`,
    };
  }
  const headline = s.liveness === 'failed' ? 'Live check failed' : s.failed === 0 && s.unverified === 0 ? (s.liveness === 'not_run' ? 'All checks passed' : 'Verified live') : 'Check complete';
  return { headline, status: s.liveness === 'failed' ? 'failed' : s.failed || s.unverified ? 'unverified' : 'passed', note: `${s.passed} passed · ${s.failed} failed · ${s.unverified} unverified`, spoken: `${s.passed} of ${s.total} passed.` };
}

export async function runCall(deps, limits = LIMITS) {
  const { say, show, listenForCode, grabFrames, vision, sleep, now, log = () => {}, catalog } = deps;
  const pause = async ms => deps.waitForCommand ? deps.waitForCommand(ms) : (await sleep(ms), null);
  const startedAt = now();
  const timeLeft = () => limits.callBudgetMs - (now() - startedAt);
  const state = { request: null, results: [], finished: false };

  // 1. Greet and link the call to a request.
  show({ prompt: 'Say the four-digit code from the link.', status: 'info' });
  await say("Hi, I'm ShowMe. Say the four-digit code from the link.");
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

  // 2. Start: only buyer-selected tests, in a useful order.
  const { challenges: raw } = await vision.start(request.request_id);
  const challenges = orderChallenges(raw, catalog);
  show({ prompt: 'Use your back camera.', status: 'info' });
  await say('Use your back camera.');
  await say(`Thanks. ${challenges.length} checks. Keep the item in view. Say ready, again, or skip.`);

  // Each evaluation gets time to act. Never start one that cannot fit the call budget.
  const canAttempt = actionMs => timeLeft() >= actionMs + limits.checkRequestMs + limits.finishReserveMs;
  let nudged = false;
  // One steady shot per side; "again" retakes the current shot, "skip" ends the task. Returns { skipped, frames }.
  const takeShots = async (shots, attemptCard) => {
    const frames = [];
    for (let k = 0; k < shots.length; k++) {
      const note = `Shot ${k + 1} of ${shots.length}: ${shots[k]}. Say READY.`;
      show({ ...attemptCard, status: 'waiting', note });
      await say(`${shots[k]}.`);
      let command = await pause(limits.shotMs);
      while (command === 'again') { show({ ...attemptCard, status: 'waiting', note }); await say(`${shots[k]}.`); command = await pause(limits.shotMs); }
      if (command === 'skip') return { skipped: true, frames };
      let got = grabFrames();
      const until = now() + limits.noFrameWindowMs;
      while (got.length === 0 && now() < until) {
        show({ ...attemptCard, status: 'waiting', note: 'Point the camera at the item.' });
        if ((await pause(limits.noFrameRetryMs)) === 'skip') return { skipped: true, frames };
        got = grabFrames();
      }
      if (got.length) frames.push(got.at(-1)); // the newest frame: what the seller was showing at "ready"
      log(`[shot] ${k + 1}/${shots.length} ${shots[k]}: ${command ?? 'timeout'}${got.length ? '' : ', no frame'}`);
    }
    return { skipped: false, frames };
  };
  for (let i = 0; i < challenges.length; i++) {
    if (!canAttempt(limits.actMs)) { log('[flow] call budget reached'); break; }
    const ch = challenges[i];
    const card = { step: i + 1, total: challenges.length, title: request.item_name, prompt: ch.prompt };
    const shownAt = now();
    deps.clearCommands?.(); // Commands from an earlier task must not affect this one.
    let attempt = 0, last = null, transportFailures = 0, skipped = false;
    const shots = shotPlan(ch.prompt);
    while (attempt < limits.maxAttempts) {
      const actionMs = shots ? shots.length * limits.shotMs : attempt === 0 && transportFailures === 0 ? limits.actMs : limits.retryGapMs;
      if (!canAttempt(actionMs)) break;
      const nextAttempt = attempt + 1;
      const retry = nextAttempt > 1 || transportFailures > 0;
      const attemptCard = { ...card, attempt: nextAttempt, maxAttempts: limits.maxAttempts };
      // The instruction is primary initially; after a failure, the hint is primary.
      show({ ...attemptCard, status: 'waiting', note: last ? hintFor(last) : '' });
      await say(retry ? `Let's try again. ${ch.prompt}` : ch.prompt);
      if (!canAttempt(actionMs)) break;
      let grabbed;
      if (shots) {
        const taken = await takeShots(shots, attemptCard);
        if (taken.skipped) { skipped = true; break; }
        if (taken.frames.length < 2) { last ??= { result: 'unverified', reason: 'No clear camera view.' }; break; }
        grabbed = taken.frames;
      } else {
      let command = await pause(actionMs);
      while (command === 'again' && canAttempt(actionMs)) {
        show({ ...attemptCard, status: 'waiting', note: '' });
        await say(ch.prompt);
        if (!canAttempt(actionMs)) break;
        command = await pause(actionMs);
      }
      if (command === 'skip') { skipped = true; break; }
      if (command === 'again' || !canAttempt(0)) break;
      // "ready" ends the action pause immediately; only fresh 2–4 frame evidence is used.
      grabbed = grabFrames();
      const cameraDeadline = now() + Math.min(limits.noFrameWindowMs, Math.max(0, timeLeft() - limits.checkRequestMs - limits.finishReserveMs));
      let repeatRequested = false;
      while (grabbed.length < 2 && now() < cameraDeadline) {
        show({ ...attemptCard, status: 'waiting', note: 'Point the camera at the item.' });
        if (!nudged) { nudged = true; await say('Point the camera at the item.'); }
        command = await pause(Math.min(limits.noFrameRetryMs, Math.max(0, cameraDeadline - now())));
        if (command === 'skip') { skipped = true; break; }
        if (command === 'again') { repeatRequested = true; break; }
        grabbed = grabFrames();
      }
      if (skipped) break;
      if (repeatRequested) continue;
      if (grabbed.length < 2) {
        last ??= { result: 'unverified', reason: 'No clear camera view.' };
        break;
      }
      }
      if (!canAttempt(0)) break;
      show({ ...attemptCard, status: 'checking', note: '' });
      const askedAt = now();
      try {
        last = await vision.check({ request_id: request.request_id, challenge_id: ch.id, attempt: nextAttempt, frames: grabbed });
        attempt = nextAttempt;
        log(`[timing] check ${i + 1}.${attempt}: ${last.result} in ${now() - askedAt} ms (${now() - shownAt} ms into this check)`);
        transportFailures = 0;
      } catch (error) {
        log(`[flow] check failed: ${error.message}`);
        last = { result: 'unverified', confidence: 0, reason: 'Connection interrupted. Hold the item in view.' };
        // A lost HTTP response may already be saved; reuse this attempt number.
        if (++transportFailures >= 2) break;
        continue;
      }
      if (last.result === 'passed') break;
    }
    if (skipped) log(`[flow] check ${i + 1} skipped by the seller`);
    const result = last?.result ?? 'unverified';
    show({ ...card, status: result, note: result === 'passed' ? '' : skipped ? (last ? `Skipped. ${hintFor(last)}` : 'Skipped. Not verified.') : last ? hintFor(last) : 'Call time limit reached' });
    if (result === 'passed' && timeLeft() > limits.finishReserveMs + 2000) await say('Got it.');
    log(`[timing] check ${i + 1} done: ${result} after ${now() - shownAt} ms, ${attempt} attempt(s)`);
    state.results.push({ id: ch.id, kind: ch.kind, result, attempts: attempt });
  }

  // 4. Finish: the report goes to the buyer's link.
  const done = await vision.finish(request.request_id);
  state.finished = true;
  const s = done.summary;
  const completion = completionFor(s);
  show({ prompt: `${completion.headline}. The report is on the buyer's link.`, status: completion.status, note: completion.note });
  await say(say1(`All done. ${completion.spoken} The report is on the buyer's link. Goodbye.`));
  return state;
}
