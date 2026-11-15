# ShowMe: full build and pitch plan (3 people, Saturday 4 PM to Sunday 1 PM)

**How this file relates to the others:**
- This is the **operational plan**: the flow, gates, hour-by-hour schedule, who does what, fallbacks, cuts, the pitch and Q&A.
- **The API contract lives here (section 5)** and replaces every earlier draft.
- `ARCHITECTURE.md` holds the technical design: the components, where each runs, the sequence and state diagrams, the data model, the deployment and the failure handling.
- `SHOWME.md` still holds the competitors and Chert facts. `CHERT_DOCS_DIGEST.md` holds the full Chert docs.
- When a decision changes, update this file and the status block in `CLAUDE.md`.

**Clock:** the laptop clock read 3:48 PM Saturday when this was first written. This version is from **4:13 PM**. Older "about 5:30 PM" times in other notes were estimates and are wrong.

**Deadlines:** the Devpost draft goes in by **10:30 PM**. The hard submit is **11:59 PM Saturday**, edits close at **10 AM Sunday**, and judging is at **1 PM Sunday**.

**Flow history:**
- First version: the seller texted SHOW to start a check.
- About 4:05 PM: buyer-driven over iMessage.
- **4:13 PM: buyer-driven with a web link (Mahir's version, below). This is the current flow.**

---

## 1. What we are building

**One line:** the buyer creates a verification link and sends it to the seller. The seller FaceTimes ShowMe, and the agent runs the buyer's chosen tests plus random live challenges. Gemini checks each one, and the same link turns into the inspection report.

### The flow
1. **The buyer creates a request.** On the ShowMe website (`/new`), the buyer enters the item, picks a category, and ticks the tests they want from a fixed list (for example power on, launch a game, press every button). They can add one free-text test, which is marked "may be Unverified".
2. **The buyer shares the link.** ShowMe makes a unique link, `/v/<token>`, plus a 4-digit code. The buyer pastes the link into Marketplace, OfferUp or any chat.
3. **The seller starts a FaceTime call.** The seller opens the link and sees instructions, the code in big type, and a tap-to-FaceTime button for our Chert line. The page lists the buyer's tests, but **never the random liveness challenges**.
4. **The agent runs live challenges.**
   - The agent greets the seller and asks them to say the code, which links the call to the request.
   - Then it runs the buyer's tests mixed with 1 or 2 random liveness challenges, for example "hold up 3 fingers next to it". The number changes on every call.
   - Each challenge appears as a card on the agent's own video, and the voice reads it out.
5. **Gemini checks each result** as **Passed**, **Failed** or **Unverified**. Unverified means the camera couldn't show it clearly after 2 tries. We never claim what we couldn't see.
6. **Results save automatically** to MongoDB Atlas. **The link updates live during the call**, so a buyer watching sees each tick appear.
7. **The buyer reviews the report** on the same link: each test's result, a thumbnail, the liveness result and a timestamp. Then they decide whether to buy.

**Optional iMessage extra** (Chert says iMessage is "optional, but encouraged"):
- The link page has a "Text me the result" button that opens a text saying `WATCH 4827` to our line.
- When the call ends, ShowMe sends the verdict and the link to that chat.
- The trial line can't text first, but that's fine here because the person texts us first.

**Why this shape works:**
- The buyer has the problem, so the buyer starts the check.
- The buyer picks the tests that matter to them.
- A link works on any platform, and the buyer can be on Android.
- The seller never handles the proof, so they can't doctor it.
- A seller who refuses to verify has told the buyer what they needed to know.

### Must-have (the demo fails without these)
1. `/new`: the request form with a test picker for each category. It creates the link and code.
2. `/v/<token>` before the call: seller instructions, the code, the tap-to-FaceTime button and the buyer's tests.
3. The call: greet within 10 seconds, the spoken code links the call (fallback: the newest waiting request).
4. Challenge cards on the agent's video plus voice. The buyer's tests are mixed with random liveness challenges that stay secret until the call.
5. A Gemini check for each challenge with three results, and up to 2 retries.
6. Results saved in MongoDB Atlas. `/v/<token>` updates live (polling every 2 seconds).
7. The report on `/v/<token>`: the result of each test, a thumbnail, the liveness result and the time.
8. **The attack:** a recording held up to the camera fails the random liveness challenge.

### Nice-to-have (cut in this order if behind; the cut time is the latest we keep trying)

| # | Feature | Cut at | What the cut costs |
|---|---|---|---|
| 1 | Replay clip of passed checks | 1 AM | Nothing; the thumbnails are enough |
| 2 | The free-text test | 1 AM | Some flexibility; the fixed list stays |
| 3 | Share card (OG image so the link previews nicely in chats) | 3 AM | Some viral polish |
| 4 | iMessage `WATCH` notice | 2 AM | Some Chert iMessage depth |
| 5 | ElevenLabs voice | midnight | **The ElevenLabs track claim** (fall back to the starter's TTS) |
| 6 | Vultr deploy on Rocky Linux | 5 AM | **The Vultr and CIQ claims** (fall back to a laptop plus a tunnel) |

**Integrity rule:** we claim a sponsor prize only if the live demo really calls that product. If a feature is cut, its prize claim goes too. Wan grep-audits the Devpost page against the code at 9 AM.

### Not doing
- Proving who the seller is, that they own the item, or that it isn't stolen.
- Escrow or payments.
- ShowMe calling the seller unprompted.
- FaZe.
- The Odyssey theme. Mahir decided this; it costs one of the three Main Track criteria, so **Chert is the realistic main prize.**

---

## 2. Risks (each with a test, a deadline and a fallback)

### Risk 1: the agent can't see the caller's camera (LOW)
- **Why it's low:** trychert.com/uta lists "Sees the caller's video live" as a core feature, and every Chert template idea needs it.
- **Why we still test it:**
  - The general docs call caller capture a per-line opt-in.
  - The feed may be the FaceTime window rather than the raw camera, which changes the crop work.
  - The starter listens to audio only, so the test proves our video wiring.
- **Test, at 4:30 PM:** a 1-minute FaceTime Video call with the starter, logging every track. **Pass:** a `facetime-remote-video` track arrives from `chert-bridge-<callId>`, and we save 3 frames and look at them.
- **If it fails:** Mahir goes to the Chert table straight away and asks Gary.
- **6:00 PM decision, Plan B (photo challenges):**
  - The call still runs, with the cards and voice.
  - The seller answers each challenge by **uploading a photo on the `/v/<token>` page within 30 seconds**.
  - Gemini checks the photo. The rest of the flow doesn't change.
  - This is weaker on Chert's 2× criterion; say so to Gary.
- **If the feed is the FaceTime window:** crop it in `vision/`, using a fixed crop tuned on the saved test frames.

### Risk 2: the agent can't publish its own video (the challenge cards)
- **The problem:** Chert has no drawing tool. The video must come from the **same participant that speaks**, and a second audio publisher ends the call.
- **Plan:** Mahir builds this **first**, in a plain LiveKit room with no Chert:
  - Render each card with `@napi-rs/canvas` into RGBA frames.
  - Push them into a LiveKit `VideoSource` at about 10 fps.
- **Test, by 6:30 PM:** a browser viewer shows the card change every 3 seconds while the agent speaks.
- **Fallback:** voice-only challenges, with the current card shown on `/v/<token>` instead.

### Risk 3: FaceTime minutes and judging logistics
- **The trial:** 50 minutes in total, 5 minutes per call, one call at a time.
- **Development uses a plain LiveKit room** with a laptop webcam as the caller. It costs no FaceTime minutes.
- **At the table:** our team is the seller and makes the call from Mahir's iPhone. **The judge is the buyer** on their own phone, which can be any phone, because the buyer only uses the link. So judges never FaceTime the trial line, and the question of unverified numbers goes away.

| Use | Minutes |
|---|---|
| 4:30 PM caller-video test | 2 |
| First full FaceTime run (about 9 PM) | 6 |
| Integration debugging, Saturday night | 10 |
| Backup video (6:30 AM) | 4 |
| Sunday rehearsals (2 calls) | 5 |
| **Judging (about 6 judges at 2.5 minutes)** | **15** |
| Reserve | 8 |
| **Total** | **50** |

Track the minutes on the `#minutes` line at the bottom of this file after every real call. Ask Gary once, politely, about extra minutes for judging day.

---

## 3. Hour 0 checklist (4:15 to 4:45 PM, all in parallel)

| Owner | Task | Done when |
|---|---|---|
| Mahir | Chert onboarding on his iPhone: paste `Connect my agent to Chert so I can FaceTime it. Follow https://app.trychert.com/skills.md` into Claude Code. **Mahir signs in and enters the iMessage code himself; Claude doesn't.** | `chert doctor` passes and the line number is known |
| Mahir | Chert video starter: Node 22 or 24, `npm i -g @trychert/facetime@0.1.0-beta.19`, then `chert new agent --video` inside `showme/` | `npm run check` passes |
| Mahir + Claude | Create the `showme/` repo (section 4) with the contract, `shared/tests.json`, `shared/mock_request.json`, `.gitignore`, `.env.example` and `CLAUDE.md`. Push it and add both teammates | Teammates have cloned it |
| Wan | Claim the GoDaddy Registry domain through the MLH code (for example `showmelive.<tld>`), create the Vultr account, start a Rocky Linux instance, and set up Vite + React in `web/` | The domain resolves, and SSH to the box works |
| Youngjun | Get the Gemini key (check its rate limit; turn on billing if the free tier allows under 1 request per second) and create the MongoDB Atlas free cluster | A Python one-liner gets a Gemini reply and writes to Atlas |
| Mahir | ElevenLabs Starter ($1 for the first month), and pick one calm voice. Also get a Gemini key (aistudio.google.com/apikey) for the agent's speech-to-text and voice | Both keys exist |
| Everyone | **Keys are shared by DM only**, each goes into a local `.env`, and nothing is committed | `git grep -i "api_key="` finds only `.env.example` |

**Estimated spend:** ElevenLabs $1, Gemini under $10, Vultr credit and the domain through MLH.

---

## 4. Repo layout and who owns what

```
showme/
  CLAUDE.md                   Architecture, contract summary, run commands, done list. Every teammate's Claude reads it.
  README.md                   Pitch, setup, sponsor receipts table
  shared/contract.md          Section 5 of this file
  shared/tests.json           The test catalog for each category (agreed by all three; Youngjun owns edits)
  shared/mock_request.json    A fake request in every state (awaiting, in call, complete). Everyone builds against it first.
  shared/test_frames/         About 20 labeled photos of the demo item, taken in hour 1
  agent/    Mahir            Node: the Chert starter + LiveKit agent + iMessage WATCH
  vision/   Youngjun       Python: FastAPI + Gemini + MongoDB Atlas
  web/      Wan       React (Vite): /, /new, /v/<token>, deploy
```

**Branches:** `mahir/agent`, `youngjun/vision`, `wan/web`.
- Commit every 30 to 60 minutes and push.
- Mahir merges into `main` at **8 PM, midnight, 4 AM (Youngjun does this one) and 7 AM**. After each merge, everyone merges `main` back into their branch.
- Only the folder's owner edits its `package.json` or `requirements.txt`.

**Roles: Wan = front end (`web/`), Youngjun = Python (`vision/`).** If skills turn out different, **swap the folders, not the tasks**.

**The workload shifted with the web-link flow:** Wan's pages are now the main screen of the demo, so Wan starts on `/v/<token>` first. Mahir's iMessage work shrinks to the optional `WATCH` notice.

---

## 5. API contract v3 (lock it at 4:45 PM; change it only with all three people agreeing)

Vision service base URL: `VISION_URL`. Youngjun owns it.
- **Public routes** are called by the web app.
- **Agent routes** need the header `X-Agent-Key`, so the public can never fetch the hidden liveness challenges.

### Test catalog: `shared/tests.json`

```json
{
  "console": [
    {"id": "power_on",   "label": "Power on",              "prompt": "Turn it on and show the screen or power light", "expect": "device visibly powered on"},
    {"id": "launch_game","label": "Launch a game",         "prompt": "Start a game and show it running on screen",    "expect": "a game running on the display"},
    {"id": "buttons",    "label": "Press every button",    "prompt": "Press each button while the screen shows it responding", "expect": "on-screen response to button presses"},
    {"id": "serial",     "label": "Show the serial label", "prompt": "Show the serial number label up close",          "expect": "a readable serial label"},
    {"id": "all_sides",  "label": "Show all sides",        "prompt": "Turn it slowly to show every side",             "expect": "all sides, no major damage hidden"}
  ],
  "phone":   ["power_on", "about_screen (Settings > About: model and storage)", "battery_health", "imei (*#06#)", "screen_no_cracks", "apple_id_signed_out"],
  "laptop":  ["power_on", "about_screen", "keyboard", "screen_no_dead_pixels", "all_sides"],
  "other":   ["power_on", "serial", "all_sides"]
}
```

(Youngjun writes the full objects for every category. The lists above show what each category contains.)

**Liveness pool, server-side only:**
- "hold up N fingers next to it" (N from 1 to 5, random)
- "turn it upside down"
- "put your flat hand on top"
- "tap it twice"

### Public routes (web)

```
POST /requests
  body: { item_name, category: "console"|"phone"|"laptop"|"other", listing_url?, tests: [test_id], custom_test? }
  →     { request_id, token, code: "4827", link_url: "https://<domain>/v/<token>",
          line_number, status: "awaiting_seller", expires_at }      (the link lasts 24 hours)

GET  /requests/{token}
  →     { status: "awaiting_seller" | "in_call" | "complete" | "expired",
          item_name, category, listing_url, line_number,
          code,                         (only while status is "awaiting_seller")
          tests: [ { id, label } ],     (the buyer's tests only; the liveness challenges are never listed here before the call)
          current_challenge?: { prompt, attempt },     (while in_call: the live-progress view)
          results: [ { prompt, kind: "buyer" | "liveness" | "custom",
                       result: "passed" | "failed" | "unverified",
                       confidence, reason, attempts, thumb_url } ],
          summary?: { passed, failed, unverified, total, liveness: "passed" | "failed" },
          verified_at? }
```

### Agent routes (header `X-Agent-Key`)

```
GET  /agent/requests/by-code/{code}   → { request_id, item_name, status }  or 404
GET  /agent/requests/latest-waiting   → the newest awaiting_seller request (fallback when the spoken code doesn't match)
POST /agent/requests/{id}/start       → { challenges: [ { id, kind, prompt, expect } ] }
                                        (the buyer's tests with 1 or 2 random liveness challenges mixed in; status becomes in_call)
POST /agent/check
  body: { request_id, challenge_id, attempt, frames: [base64 jpeg, 2 to 4 frames from the last 2 seconds] }
  →     { result: "passed" | "failed" | "unverified", confidence: 0-1, reason, best_frame }
POST /agent/requests/{id}/finish      → { summary, link_url, notify_chat_ids: [ ... ] }
POST /agent/requests/watch            body: { code, chat_id }  → { ok }   (from an iMessage "WATCH 4827")
POST /agent/requests/{id}/abort       → { ok }   (the call dropped before finish: status goes back to awaiting_seller, partial results are cleared, the code works again)
```

**Every route is served under `/api`** (for example `/api/requests`, `/api/agent/check`). nginx serves the web app at `/` and proxies `/api` to uvicorn, so the web app calls its own domain and needs no CORS setup. The full design is in `ARCHITECTURE.md`.

### Rules
- **Results:**
  - `passed` needs confidence ≥ 0.7.
  - Each challenge gets up to 2 retries of 15 seconds.
  - After the retries, Gemini's "can't see it" becomes `unverified`, and a visible contradiction becomes `failed`.
  - A **failed liveness challenge** makes the report say **"Live check failed: possible recording"** at the top, whatever the other results.
- **Linking the call:** the agent asks "What's your 4-digit code?" The starter's speech-to-text gets the transcript, and we match it with `by-code`. If that fails, the agent asks once more, then uses `latest-waiting`.
- **Call length:** the target is about 2 minutes. The agent ends the call itself by 4:30.
- **Privacy:**
  - Store one small thumbnail per check, at most 400 px wide, as base64 in the result.
  - Drop every other frame right after its check.
  - The report never shows the seller's phone number.
- **Mock mode:** `MOCK=1` makes `vision/` serve `mock_request.json` and canned results. `MOCK_VISION=1` makes the agent skip HTTP. The whole demo can run without Gemini or the network.

---

## 6. Who does what, step by step

### Mahir (and Mahir's Claude session): `agent/`, the pitch, Devpost, the video

| Step | When | Task | Done when |
|---|---|---|---|
| M1 | 4:15 | Hour 0: Chert onboarding, the starter, the repo, the contract, the mocks | The section 3 table is checked off |
| M2 | 4:45 | Caller-video test call (Risk 1) | 3 caller frames saved, or Mahir is at the Chert table |
| M3 | 5:00 | Plain LiveKit room: the agent publishes rendered challenge cards on its own video (Risk 2) | Cards change in a browser viewer while the agent speaks |
| M4 | 6:00 | Subscribe to the caller's video (handlers registered before joining), sample 2 fps into a ring buffer, and handle mute and track replacement | Fresh frames in the logs; a muted camera gives no frames |
| — | 6:00 | **Gate 2:** Plan A or Plan B (Risk 1) | Decision written into this file |
| M5 | 6:15 | Call state machine:<br>1. Greet.<br>2. Ask for the code (with STT) and link the call (`by-code`, then `latest-waiting`).<br>3. `start`.<br>4. For each challenge: card, voice, wait, `check`, then ✅ ❌ or ❓, with retries.<br>5. `finish` and end the call. | A full run against `MOCK_VISION=1` in a plain room |
| M6 | 8:00 | **Merge 1.** End to end in a plain room: the webcam, the agent, the real `vision/`, and `/v/<token>` updating live | The report fills in live from a webcam run |
| M7 | 9:00 | **First full FaceTime run** (6 minutes of budget) | A real report from a real call |
| M8 | 9:30 | Devpost draft with Wan (section 8) | **Submitted by 10:30 PM** |
| M9 | 10:30 | ElevenLabs voice through the LiveKit TTS plugin, with short lines timed to the cards | Voice is less than 1 second behind each card |
| M10 | 11:15 | iMessage `WATCH`: read `message.received` (SSE stream or dev inbox), parse `WATCH <code>`, call `watch`, and send the verdict and link after `finish` | A text of WATCH 4827 gets the result after a call |
| M11 | midnight | **Merge 2.** The attack test: a recording on a second phone must fail liveness | Fails 5 out of 5 |
| M12 | 1 AM | Hardening: the 4:30 call cap, a 6-second Gemini timeout (retry once, then "let's try that again"), reconnects, the demo-mode flag | 3 clean FaceTime runs in a row |
| — | 3:30–6:30 AM | **Sleep** | |
| M13 | 6:30 | **Backup video:** one clean 60-second run, recording both the screen and the phone | MP4 saved in 2 places |
| M14 | 7:00 | **Code freeze, merge 4.** Edit the 2-minute Devpost video | Uploaded before 10 AM |
| M15 | 10:00 | Rehearse the pitch 5 times and drill the Q&A (section 9) | Under 3:00 every time |

### Youngjun: `vision/` (Gemini + MongoDB)

| Step | When | Task | Done when |
|---|---|---|---|
| Y1 | 4:15 | Gemini key, Atlas cluster, and the FastAPI scaffold copied from `nobody/vision/` | `GET /health` is ok |
| Y2 | 4:45 | Write `shared/tests.json` with all the categories. Stub every contract route from `mock_request.json`, with tests, including the agent-key check | `pytest -q` is green; agent routes return 401 without the key |
| Y3 | 5:15 | Take about 20 labeled test photos with the demo item: 3 fingers, powered on, game running, serial visible, plus 5 failure cases and 3 too-dark or blurry ones (these should come back `unverified`). Commit them to `shared/test_frames/` | Photos committed |
| Y4 | 5:45 | `POST /requests`: unique token and code, status lifecycle, 24-hour expiry. `start` mixes in the random liveness challenges | Liveness never appears in `GET /requests/{token}` before the call (there's a test for it) |
| Y5 | 6:15 | `POST /agent/check`: Gemini gets the frames, the prompt and `expect`, and returns structured JSON with `{result, confidence, reason, best_frame}` and all three results | ≥ 90% right on the test photos; blurry ones come back unverified; median under 3 seconds |
| Y6 | 7:15 | If the frames are the FaceTime window: auto-crop to the camera area | Crop works on the Gate 1 frames |
| Y7 | 7:30 | MongoDB Atlas: requests and results, thumbnails, `current_challenge` for the live view, `finish` with the summary and the "possible recording" rule | Survives a restart; the live view updates while a check runs |
| Y8 | 8:00 | **Merge 1.** Integration with Mahir and Wan | — |
| Y9 | 9:00 | Liveness strength: test a recording on a second phone against the finger count | A recording fails 5 out of 5 |
| Y10 | 10:30 | Deploy `vision/` on Vultr with Youngjun and Wan (systemd + uvicorn behind nginx, HTTPS) | `https://api.<domain>/health` is ok |
| Y11 | midnight | **Only if Gate 2 chose Plan B:** photo-upload checks. Otherwise: speed work (smaller JPEGs, fewer frames, choice of model) | Check time under 2.5 seconds |
| Y12 | 4:00 AM | **Merge 3** | — |
| — | 6:30–9:30 AM | **Sleep** | |

### Wan: `web/`, deploy, Devpost visuals, props

| Step | When | Task | Done when |
|---|---|---|---|
| W1 | 4:15 | GoDaddy domain, the Vultr Rocky Linux box, Vite + React | The domain points at the box |
| W2 | 4:45 | **`/v/<token>` from `mock_request.json`, in all three states:**<br>- **awaiting:** seller instructions, the big code, a `facetime:` button, the buyer's tests.<br>- **in_call:** the current challenge and ticks appearing.<br>- **complete:** the report, with a "possible recording" banner if liveness failed. | All three states look good on a phone |
| W3 | 6:15 | `/new`: item name, category, a test picker driven by `shared/tests.json`, an optional free-text test, then show the link with a copy button and a QR code | Creates a request against the stub |
| W4 | 7:00 | `/`: the landing page for buyers: "Buying used? Make the seller prove it live." How it works in 3 steps, and a "Create a check" button | — |
| W5 | 7:30 | Switch from the mock to the real API. `/v/<token>` polls every 2 seconds while `in_call` | The live view updates during a real webcam run |
| W6 | 7:45 | Buy the demo props (section 7). Find one **sourced** scam statistic from the FTC or the Better Business Bureau, with its link | Props on the table; the stat and link written into this file |
| W7 | 8:00 | **Merge 1.** | — |
| W8 | 9:00 | Devpost draft with Mahir: screenshots and the architecture diagram | Submitted by 10:30 PM |
| W9 | 10:30 | Deploy `web/` and `vision/` on Vultr with Youngjun: nginx, HTTPS, the domain | The live URL works on cellular data |
| W10 | 11:30 | "Text me the result" button on `/v/<token>` (an `sms:` link with `WATCH <code>` filled in) | Tapping it opens Messages with the text ready |
| — | 12:30–3:30 AM | **Sleep** | |
| W11 | 3:30 | Share card (an OG image, so the link previews nicely in chats) | The preview shows in iMessage |
| W12 | 5:00 | Table poster plus a big printed **QR code to `/new`** for judges | Printed, or full screen on a laptop |
| W13 | 9:00 | **Integrity audit:** every sponsor named on Devpost really runs in the live demo | The receipts table matches |

### How Claude works in each session
- Each person runs **their own Claude Code session in their own folder only**.
- **Every task follows the same loop:**
  1. Read `CLAUDE.md` and the contract.
  2. Write the test first: pytest in `vision/`, a smoke script in `agent/`, a render check in `web/`.
  3. Build the minimum.
  4. Run the tests.
  5. Commit.
- **Prompts are one task each, with a "done when" line** (the tables above give one for every step).
- **Commit before every big AI task.**
- **While Claude codes,** the human tests on the real phone, reviews the diff and writes Devpost text.

---

## 7. Demo setup at the table

**Roles:**
- **The judge is the buyer,** on their own phone, which can be any phone.
- **Our team is the seller:**
  - Youngjun holds the item.
  - Mahir holds the seller iPhone and pitches.
  - Wan runs the laptops and the attack phone.

**Props (under $15):**
- **The main item:** an old game console or controller with a visible power light, a screen, and a readable serial label.
- **The attack phone:** a second phone playing a pre-recorded "seller" video of the same item. Record it at the table in advance.
- **A printed QR code to `/new`,** plus a "listing" card: `PS4 controller, works perfectly, $25`.
- A power strip and chargers for 2 phones and 2 laptops.

**Screens:**
- **Laptop 1** faces the judge and mirrors the agent's video, so the challenge cards are large.
- **Laptop 2** shows `/v/<token>` as a backup, in case the judge's phone has no signal.
- **The judge's phone** shows the same link updating live.

**Fallback order if something breaks:**
1. **A live FaceTime call** (the real thing).
2. **A plain LiveKit room with the laptop webcam.** Same agent, same Gemini, no FaceTime minutes. Say: "same agent, FaceTime is the transport."
3. **Mock mode with canned frames,** with no network.
4. **The backup video** from 6:30 AM.
5. If the judge won't scan: use Wan's phone as the buyer, with a request already made.

---

## 8. Devpost (draft by 10:30 PM, final by 10 AM)

- **Title:** ShowMe: make the seller prove it, live.
- **Tagline:** "The buyer picks the tests. The seller proves them live on FaceTime. The link becomes the report."
- **Sections:** Inspiration, What it does (the 7 steps from section 1), How we built it, Challenges, Accomplishments, What we learned, What's next.
- **Media:** 5 screenshots (the request form, the seller page, a challenge card, ticks appearing live, the report), the architecture diagram and the 2-minute video.
- **Tracks to select (only those the live demo calls):**
  - Best Use of FaceTime (Chert)
  - Main Track
  - MLH: Gemini, MongoDB Atlas, Vultr, GoDaddy
  - ElevenLabs (only if the voice ships)
  - CIQ, by mentioning Rocky Linux on Vultr (only if the deploy ships)
- **Ask on Discord** before submitting: does 2026 cap how many tracks one project can enter?
- **README sponsor receipts table:** each sponsor, the file that calls it, and the moment in the demo where it runs.

---

## 9. The presentation (Sunday 1 PM, UH, science-fair style: 3 minutes to present, 2 minutes of Q&A)

### The 3-minute script

| Time | Who | What happens and what's said |
|---|---|---|
| 0:00–0:20 | Mahir | **Hook.** "Who's bought something used online and wondered if it actually works?" Then the sourced stat from A6. "Buyers ask, 'FaceTime me and show me it works.' But that call is with a stranger, and it can be staged." |
| 0:20–0:30 | Mahir | **The idea.** "ShowMe lets the buyer demand proof. You pick the tests, send the seller a link, and the seller has to prove it live to a neutral AI agent on FaceTime. No app for anyone." |
| 0:30–0:50 | Judge | **You're the buyer.** The judge scans the QR code, picks "power on" and "press every button", and gets a link. "Normally you'd paste this into Marketplace. We're the seller." |
| 0:50–1:55 | Youngjun + Mahir | **The seller's call.** Mahir FaceTimes ShowMe and says the code. The cards appear on laptop 1, and Youngjun does each test with the controller. **During the finger challenge, A first holds the attack phone, playing a recording, up to the camera: ❌ "I didn't see 3 fingers."** Then B does it live: ✅. The call ends itself. |
| 1:55–2:20 | Mahir | **The judge's phone.** "Look at your link." The ticks appeared live, and now it's the report: each test, a thumbnail, "Live check: passed". "The recording failed because the challenge was random. The seller never touched this report, so they can't fake it." |
| 2:20–2:45 | Mahir | **How it's built.** "Chert bridges FaceTime into our LiveKit agent. It draws the challenge cards into its own video and samples the seller's camera. Gemini checks each challenge as passed, failed or unverified; it never claims what it couldn't see. Results live in MongoDB Atlas, served from Vultr on Rocky Linux, at our GoDaddy domain." Name only what really ran. |
| 2:45–3:00 | Mahir | **Close.** "Buyers ask, honest sellers prove it in two minutes, and scammers refuse. That refusal is the answer the buyer needed." |

**For Gary (Chert), stress the fresh use of FaceTime video:**
- The agent both **sees** (it checks live challenges on the caller's camera) **and shows** (it draws the challenge cards into its own video).
- The live call is necessary, not decoration: a photo or a recording can't pass.
- **The spin on Chert's "step-by-step verifier" template:** the person being checked isn't the person who asked. A stranger proves it live, the agent is the neutral referee, and the proof goes to someone else.

### Q&A answers (drill these at 10 AM)

| Question | Answer |
|---|---|
| "Why would a seller agree?" | "Because the buyer asked, and a 2-minute call closes the sale. An honest seller says yes. A seller who refuses has told the buyer what they needed to know." |
| "Can't the seller fake the report?" | "It never passes through them. It lives on our server, and the buyer opens it from their own link." |
| "Can't the seller prepare for the tests? They can see them on the link." | "They can see the buyer's tests, and that's fine: they're real tests of the item. The liveness challenges are random and only appear during the call, so a recording can't pass. You just saw that." |
| "What about Android?" | "The buyer can be on anything, because it's just a link. Only the seller needs FaceTime today, and Chert's FaceTime-link joining is the way to reach Android sellers." |
| "What does 'Unverified' mean?" | "The camera couldn't show it clearly after two tries. We'd rather say we couldn't see it than guess." |
| "Couldn't the seller verify a working item and ship a broken one?" | "ShowMe is a timestamped report, not escrow. It proves this item was live and passed these tests at this time. Pairing it with pickup or escrow is the next step." |
| "How is this different from ProofLens or Truepic?" | "They're apps or business tools, and the seller decides what to show. In ShowMe the buyer picks the tests, nobody installs anything, and an agent runs random live challenges." |
| "Couldn't someone fake it with a deepfake?" | "A live deepfake has to follow random physical challenges with a real object in real time. That raises the bar a lot. It isn't impossible, and we say so." |
| "Do you keep the video?" | "No. One small thumbnail per check, and every other frame is dropped right after its check. The report never shows the seller's number." |
| "How does it make money?" | "The buyer pays a dollar or two per check on big-ticket items, like a Carfax report for used goods. Later, marketplaces build it into their listings." |
| "What was hardest?" | The honest answer once we know it; likely drawing the agent's own video, or getting Gemini to say "unverified" instead of guessing. |

**Rehearsal:**
- 5 full runs on Sunday morning, timed, in a plain LiveKit room. Only 2 use real FaceTime minutes.
- One run with each failure: Gemini slow, a call drop, no network (switch to mock mode in under 15 seconds), and the judge refusing to scan.

---

## 10. Hour-by-hour schedule

| Time | Mahir | Youngjun | Wan | Must be true |
|---|---|---|---|---|
| 4:15 PM | Hour 0 (Chert, repo, contract) | Keys, Atlas, scaffold | Domain, Vultr, Vite | — |
| 4:45 | **Caller-video test** | tests.json, stub routes | `/v/<token>` on the mock | **Contract locked** |
| 5:00–6:00 | Agent video cards | Test photos, `/requests` | `/v/<token>` (3 states) | — |
| **6:00** | **Gate 2: Plan A or B** | `/agent/check` with Gemini | `/new` with the picker | Caller video decided |
| 6:15–8:00 | Frames + state machine | Crop, MongoDB, live view | `/`, real API, props, stat | — |
| **8:00** | **Merge 1** | | | End to end in a plain room, link updating live |
| 8:00–8:45 | Dinner (in shifts; one person stays on code) | | | — |
| 9:00 | **First FaceTime run** | Liveness vs. a recording | Devpost screenshots | A real report from a real call |
| 9:30–10:30 | Devpost draft | Vultr deploy | Devpost draft | **Draft submitted by 10:30 PM** |
| 10:30–midnight | ElevenLabs, iMessage WATCH | Deploy, speed | Deploy, "Text me" button | — |
| **Midnight** | **Merge 2**, attack test | | Sleep at 12:30 | The wow demo works on the demo phone |
| 1–3:30 AM | Hardening | Speed, tests | (asleep) | 3 clean runs in a row |
| 3:30–6:30 | (asleep) | **Merge 3 at 4 AM**, polish | Share card, poster, QR | — |
| 6:30 | Backup video | Sleep at 6:30 | Poster | Backup MP4 in 2 places |
| **7:00 AM** | **Code freeze, merge 4** | (asleep) | Devpost final text | Only fixes after this |
| 7–10 | Devpost video, final text | (asleep) | Integrity audit at 9 | — |
| **10:00** | **Devpost locked** | Wakes at 9:30 | | — |
| 10–12:30 | Rehearse ×5, Q&A drill | Rehearse | Rehearse, pack the table | Under 3:00 every time |
| 12:30 | Charge everything, test Wi-Fi and cellular at UH | | | — |
| **1:00 PM** | **Judging** | | | — |

**Rule:** at least two people are awake at all times. Check Discord at every merge.

---

## 11. Things to ask today

**Chert track check (trychert.com/uta, read 3:55 PM):**
- **ShowMe qualifies:** it's built on Chert's FaceTime API, we bring an iPhone, and the agent takes a FaceTime call during the demo. The page says iMessage is "optional, but encouraged" (that's the `WATCH` notice).
- **Risk:** Chert's own template list includes a **"Step-by-step verifier"**. Our spin: the buyer picks the tests, a stranger proves them live, random challenges block recordings, and the report goes to someone other than the person on camera.

**Ask Gary:**
- "Is this a different enough spin from your verifier template?"
- Is the caller feed the raw camera or the FaceTime window?
- Could we get extra minutes for judging day?

**Ask the HackUTA organizers on Discord:**
- Is there a cap on how many tracks one project can enter?
- Where is the ElevenLabs track judged?

---

## Minutes used (update after every real FaceTime call)

`#minutes`: about 2 / 50 used (47 left per `chert doctor` before the call).

- **5:45 PM, call 1 (Gate 1 probe):** caller video arrives as 1280x720 frames from `chert-bridge-<id>`. **Gate 2 = Plan A (live video).** The feed is the Mac's FaceTime **window**, not the raw camera: the picture is a portrait strip at about x 64 to 544, with FaceTime's UI on top, including the **caller's phone number** in the top bar. `vision/` must crop to that strip and cut the top bar before any thumbnail is saved (privacy rule). Gemini STT heard "4827" correctly. Gemini TTS failed: the free tier allows 10 TTS requests per day, so the voice moves to ElevenLabs (M9 pulled forward).
