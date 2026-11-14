# API contract v3

Copied from `docs/SHOWME_PLAN.md`, section 5. Change it only when Mahir, Wan and Youngjun all agree, and update both files in the same commit.

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

