# API contract v5

Approved coordinated UX update: new inspections run only the buyer's selected tests, require at least three selections, and preserve retry history. v4 full-object tests and v3 catalog IDs remain supported subject to the new minimum. Completed historical reports remain readable and are never rewritten.

This contract is also included in `docs/SHOWME_PLAN.md`, section 5. All routes are served under `/api`. Vision service base URL: `VISION_URL`.

## Test selection and instructions

`shared/tests.json` contains category arrays (`console`, `phone`, `laptop`, `other`) of `{ id, label, prompt, expect }`.

- New requests require **3–20 distinct selected tests**. An optional `custom_test` is additional and does not replace the three selections.
- A selected test may be a category catalog ID or a full `{ id, label, prompt, expect }` object. Mixed arrays are accepted; IDs must remain unique after normalization.
- Prompts use short everyday English and one clear instruction at a time. `expect` preserves the evidence needed for evaluation.
- There are **no random surprise/liveness challenges** in new inspections.

## Public routes

```
POST /tests/suggest
  body: { item_name, category?, keep?: [{id,label,prompt,expect}], exclude?: [label], count? }
  → { category, tests: [{id,label,prompt,expect}], source: "gemini" | "catalog" }
  Returns only new suggestions; keep/exclude are respected. Default count is 6 - keep.length.

POST /requests
  body: { item_name, category: "console"|"phone"|"laptop"|"other", listing_url?,
          tests: [test_id | {id,label,prompt,expect}], custom_test? }
  → { request_id, token, code, link_url, line_number, status: "awaiting_seller", expires_at }
  Fewer than three selected tests or duplicate IDs → HTTP 422. Link lifetime: 24 hours.

GET /requests/{token}
  → { status: "awaiting_seller"|"in_call"|"complete"|"expired",
      item_name, category, listing_url, line_number,
      code?,                            (only while awaiting_seller)
      tests: [{id,label}],
      current_challenge?: {prompt,attempt},
      results: [{prompt, kind: "buyer"|"custom"|"liveness",
                 result: "passed"|"failed"|"unverified",
                 confidence, reason, attempts, thumb_url,
                 attempt_history?: [{attempt,result,confidence,reason}]}],
      summary?: {passed,failed,unverified,total,liveness: "not_run"|"passed"|"failed"},
      verified_at? }
```

`kind: "liveness"` and `summary.liveness: "passed"|"failed"` are retained only for historical reports or already-running legacy inspections. New inspections return `liveness: "not_run"`, and contain buyer/custom results only. A new all-pass report says **All checks passed**, without claiming a separate liveness check occurred. Historical recording warnings continue to render.

`attempts` is the final saved attempt number (1–3; 0 for unperformed checks). Optional `attempt_history` is ordered by attempt, contains no images, and is absent on older reports. The result, reason, confidence, and single thumbnail on the result row represent its **last saved attempt**. A failed initial attempt followed by a pass counts as one **passed** test, not a failed test. Summary totals count tests, never attempts.

## Agent routes

Every route below requires `X-Agent-Key`; missing or invalid keys return HTTP 401.

```
GET /agent/requests/by-code/{code} → {request_id,item_name,status} or 404
GET /agent/requests/latest-waiting → newest awaiting_seller request, or 404
POST /agent/requests/{id}/start → {challenges:[{id,kind,prompt,expect}]}
  New inspections: only buyer-selected tests and optional custom test. No surprise checks.
  Status becomes in_call; retrying start returns the same challenges.

POST /agent/check
  body: {request_id,challenge_id,attempt,frames:[base64 JPEG]}
  → {result:"passed"|"failed"|"unverified",confidence,reason,best_frame}
  Frames: 2–4 fresh frames from the last two seconds. best_frame is zero-based.

POST /agent/requests/{id}/finish → {summary,link_url,notify_chat_ids:[...]}
POST /agent/requests/watch   body:{code,chat_id} → {ok}
POST /agent/requests/{id}/abort → {ok}
  Aborting clears partial results/history and restores awaiting_seller until expiry.
```

## Retries, timing, security and privacy

- One initial evaluation plus **up to two retries**, using sequential attempt numbers 1–3. Stop on a pass. Repeating an already-saved attempt returns the same verdict without duplicating history or re-evaluating.
- Sellers hear clear retry instructions and see **Try N of 3**. Allow 12 seconds to act after each instruction; do not compress all attempts into the previous 30-second challenge window.
- Evaluation deadline: configured by `CHECK_TIMEOUT_SECONDS`, default **20 seconds**. Agent HTTP timeout for `/agent/check`: **30 seconds**.
- The agent checks the remaining overall **4:30 call budget** before each evaluation, reserving 15 seconds for finish/goodbye. The budget can prevent another attempt; unperformed checks become unverified on finish. Do not imply every slow check is guaranteed three attempts.
- HTTP transport retries reuse an uncertain attempt number; they must not skip directly to the next evaluation attempt.
- A pass requires confidence ≥0.7. Inadequate or missing evidence is unverified; a visible contradiction is failed. Provider failures never become mock passes.
- Agent-cropped camera mode remains the default. Metadata removal, optional explicit FaceTime screenshot sanitization, image bounds, and ≤400 px thumbnails remain enforced before model submission/storage.
- Keep at most one sanitized thumbnail per test; replace it on retry. No source frames or historical thumbnails in attempt history. Never expose seller phone numbers, Mongo IDs, watcher IDs, or internal challenge criteria in public reports.
- `MOCK=1` retains the in-memory backend and explicit canned verdicts. Authentication is required in mock mode too. Historical mock fixtures are labeled as legacy.
