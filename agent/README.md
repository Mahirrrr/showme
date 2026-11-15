# agent/ (Mahir)

The ShowMe FaceTime agent, built on Chert's video starter (`CHERT_STARTER.md`, `AGENTS.md`). Design: `docs/ARCHITECTURE.md`, section 4.

| File | What it does |
|---|---|
| `agent.mjs` | Entry: joins the call, publishes the card video, runs speech-to-text and text-to-speech, wires everything to `flow.mjs` |
| `flow.mjs` | The call step by step: greet, hear the code, start, each challenge with retries, finish. All side effects injected, fully unit-tested |
| `card.mjs` | Renders challenge cards (960x540 RGBA) for the agent's own video |
| `frames.mjs` | Subscribes to the caller's video, keeps recent frames (2 per second), encodes JPEG for `vision/` |
| `vision.mjs` | Client for the agent routes in `shared/contract.md`; `MOCK_VISION=1` gives canned results |
| `code.mjs` | "four eight two seven" → `4827` |
| `chert-rooms.mjs`, `greet.mjs` | From Chert's starter, unchanged |

## Run
```bash
npm install && npm test
```
Two terminals, from this folder:
```bash
npm start                # or: npm run start:probe  (saves 3 caller frames to probe/ for Gate 1)
```
```bash
npx --yes @trychert/facetime@0.1.0-beta.21 dev
```
Then FaceTime the line (Video). `.env.local` needs the LiveKit keys, `GOOGLE_API_KEY` (Gemini speech-to-text) and `ELEVENLABS_API_KEY` (voice); `MOCK_VISION=1` until `vision/` is up.

Plain LiveKit room without FaceTime minutes: `npm run start:room`, then join the room from the LiveKit Agents Playground with a webcam.


## Coordinated verification UX (Contract v5)

New requests require at least three selected tests, including suggested objects or standard IDs. The optional custom-text test is additional. Only selected buyer/custom tests run; there are no surprise challenges. New summaries use `liveness: "not_run"`; Contract v5.1 reports display the authoritative overall score described below. Completed historical reports are preserved, including older liveness banners.

Each test has an initial attempt plus up to two retries. Cards show "Try N of 3" and retries are spoken. Sellers receive 12 seconds to act each time; the agent checks the remaining 4:30 budget before evaluations and reserves 15 seconds for finish. Slow calls may end before every retry; unperformed tests are unverified. The backend keeps ordered, image-free `attempt_history`, and uses the last saved result for the final verdict and totals. Failed → passed counts as one passed test.

Authentication, camera-mode preprocessing, sanitized ≤400 px thumbnails, the 20-second Gemini deadline and 30-second agent check HTTP timeout are unchanged. Restart all components together for the new summary value and minimum selection rule. Do not reuse obsolete local test scripts that create fewer than three tests.


## Overall scoring (Contract v5.1)

The backend now supplies an authoritative overall verdict: at least **60%** of selected buyer tests must pass. Configure `PASSING_THRESHOLD_PERCENT` in the backend (default 60, valid range >0 to 100). Scores count final outcomes once after retries; failed, unverified and unperformed tests remain not passed. With three selected tests, two passes (66.7%) meet the default threshold; with five selections, three passes (60%) meet it exactly.

New summaries add `overall_verdict`, `pass_percentage`, `passed_tests`, `total_selected_tests` and `passing_threshold_percent` inside the existing MongoDB summary. Optional custom-text checks and historical liveness checks stay visible but are excluded from selected-test scoring. Existing aggregate counts are unchanged. The threshold is saved at finish so future configuration changes do not alter that completed score. Legacy documents without score fields are enriched on read under the current threshold without modifying stored records.

The report and agent use the backend verdict. Passing overall never changes an individual Failed/Unverified row. Show a warning whenever overall passes with individual issues, and preserve historical liveness warnings. The UI rounds percentages for display only; the decision uses the exact ratio. Restart components together; the API routes, three-test minimum, authentication, camera-mode/privacy processing, Gemini and Atlas adapters, and existing timeouts are unchanged.


## Combined agent integration

Voice commands are preserved with Contract v5.1: say **ready** to check sooner, **again** to hear the task again without using an attempt, or **skip** to move on. Retry hints remain the main card text, with the task below and the attempt counter displayed separately. Skipping keeps any saved outcome; an untested selection remains unverified and still counts toward the overall score. New challenges clear stale commands, and commands during evaluation are processed at the next pause. The 12-second default action opportunity, three-attempt maximum, transport-idempotent retries, 30-second check HTTP timeout and overall call-budget reserve remain enforced together.

Mahir's background voice cancellation, transcription/command listener wiring, and faster ElevenLabs voice settings are preserved unchanged. Noise cancellation defaults on and retains the existing `NOISE_CANCEL=0` opt-out. Acoustic performance still needs a real FaceTime rehearsal; loading its SDK alone does not establish that performance.
