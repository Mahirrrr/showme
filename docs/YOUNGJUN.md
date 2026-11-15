# Youngjun: start here (`vision/`: FastAPI + Gemini + MongoDB Atlas)

> **Current v5 update:** The approved coordinated UX removes surprise checks, requires three selected tests, returns `liveness: "not_run"` for new reports, and retains metadata-only retry history. Historical liveness task descriptions below are superseded by `shared/contract.md`.

You own the brain: requests, buyer-selected challenges, Gemini checks and the database. Wan's pages and Mahir's agent both call your routes, so keep the shapes in `shared/contract.md` exact.

## Your tasks
The step-by-step list, with times and "done when" checks, is `docs/SHOWME_PLAN.md`, section 6, steps **Y1 to Y12**. The internals (Mongo document, `public_view()`, Gemini prompt) are in `docs/ARCHITECTURE.md`, section 5. In short:
1. **Y1 (now):** Gemini key (check the rate limit, turn on billing if needed), the MongoDB Atlas free cluster, and a FastAPI app with `GET /api/health`. `vision/requirements.txt` already lists the packages.
2. **Y2:** check `shared/tests.json` (you own it) and stub every contract route, returning data shaped like `shared/mock_request.json`. Agent routes return 401 without the `X-Agent-Key` header. Add `pytest` tests.
3. **Y3:** take about 20 labeled photos of the demo item into `shared/test_frames/`: 3 fingers, powered on, game running, serial visible, plus 5 failures and 3 too-dark or blurry shots (those must come back `unverified`).
4. **Y4:** `POST /api/requests` with a unique token and code, the status lifecycle and a 24-hour expiry. `start` mixes in 1 or 2 random liveness challenges. Test that they never appear in `GET /api/requests/{token}` before the call.
5. **Y5:** `POST /api/agent/check`: Gemini gets the frames, the prompt and `expect`, and returns structured JSON `{result, confidence, reason, best_frame}`. Aim for ≥ 90% right on the test photos.
6. Then auto-crop if the frames are the FaceTime window, MongoDB persistence, the recording attack test, the Vultr deploy with Wan, and speed work (check time under 2.5 seconds).

## Rules that live in your code
- `passed` needs confidence ≥ 0.7. Can't see it after the retries means `unverified`; a visible contradiction means `failed`.
- A failed liveness challenge sets `summary.liveness = "failed"`. The web shows the red "possible recording" banner from that.
- `code` is shown only while `awaiting_seller`. Public routes never return `challenges`, `watch_chat_ids` or `_id`: build them all through one `public_view(doc)` function.
- Store one thumbnail per check (≤ 400 px wide, base64). Drop all other frames after the check.
- `MOCK=1`: in-memory store and canned results, so Wan and Mahir can work with no keys.
- Serve everything under `/api`.

## Run
```bash
cd vision && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
```
```bash
MOCK=1 uvicorn main:app --reload --port 8000
```

## Useful Claude Code skills (install gstack: see `docs/WAN.md`)
- `/investigate` when a bug won't die.
- `/review` before each merge.
- `/cso` for a quick security pass on the agent-key check before deploy.
