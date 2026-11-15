# ShowMe vision backend

Python **3.11+**, FastAPI, Gemini, and MongoDB Atlas. Implements Contract v3 without changing `shared/contract.md`. All HTTP routes are under `/api`.

## Start offline

From the repository root (use `python3.13` if that is your installed Python):

```sh
python3.11 -m venv vision/.venv
vision/.venv/bin/pip install -r vision/requirements-dev.txt
cp vision/.env.example vision/.env
```

Set `AGENT_KEY` in `vision/.env` to a randomly generated secret, and keep `MOCK=1`. Generate a key locally with `python3.11 -c 'import secrets; print(secrets.token_urlsafe(32))'`. Give Mahir that key privately. No external credentials are required in mock mode, but agent authentication is always required.

```sh
vision/.venv/bin/uvicorn vision.main:app --reload --port 8000
vision/.venv/bin/python -m pytest -q vision/tests
```

The alternative documented command `cd vision && MOCK=1 .venv/bin/uvicorn main:app --reload --port 8000` also works. `/api/health` returns `{"ok":true,"mode":"mock"}`. Interactive API docs are at `/docs`.

Environment variables take priority over dotenv files. The root `.env` is loaded before `vision/.env`, so root file values take priority too. No secrets, frames, or provider exception details are logged by application code.

Mock mode seeds the shared fixtures at these tokens:

- `mock-awaiting_seller` (code `4827`)
- `mock-in_call`
- `mock-complete`
- `mock-complete_recording`
- `mock-expired`

For example: `GET /api/requests/mock-complete_recording`. These are demo fixtures, not real inspections. New mock requests use the full lifecycle with canned checker output. Reasons explicitly say `MOCK`. Set `MOCK_RESULT=failed` or `unverified` to exercise those paths. Restarting mock mode resets memory and fixtures.

## Wan: React integration

Use relative `/api` URLs. Configure Vite's `/api` proxy to `http://localhost:8000`; nginx serves the same origin in production. No permissive CORS configuration is added.

Create a request:

```http
POST /api/requests
Content-Type: application/json

{"item_name":"PS4 controller","category":"console","tests":["power_on","buttons"],"custom_test":"Show the charging cable"}
```

The response contains exactly `request_id`, `token`, `code`, `link_url`, `line_number`, `status`, and `expires_at`. Read the catalog directly from `shared/tests.json`; no extra catalog route has been invented.

Poll `GET /api/requests/{token}` every two seconds while waiting/in-call, and stop at `complete` or `expired`. The endpoint returns buyer tests, live `current_challenge`, result rows and (when finished) the summary and verification time. The code disappears after leaving `awaiting_seller`. Handle 404, 409 and 503; respect `Cache-Control: no-store`.

Each result's `thumb_url` is a data URL, so render it directly as an image. Unperformed checks have an empty thumbnail and `attempts: 0`; show a placeholder. If `summary.liveness == "failed"`, show **Live check failed: possible recording**. An unverified or missing liveness check also conservatively maps to `failed`, since Contract v3 has no third summary-liveness value. `status` remains `complete`; `complete_recording` is a fixture name, not a status.

## Mahir: agent integration

Set `VISION_URL=http://localhost:8000/api` and the same `AGENT_KEY`. Send `X-Agent-Key` on **every** agent request, including watch and lookups.

1. `GET /api/agent/requests/by-code/{code}`; after the spoken-code retries, use `GET /api/agent/requests/latest-waiting`.
2. `POST /api/agent/requests/{request_id}/start` returns `{challenges:[{id,kind,prompt,expect}]}`. Retrying start during the same call returns the same challenges.
3. Present each returned challenge, wait for evidence, then `POST /api/agent/check` with `{request_id,challenge_id,attempt,frames}`. Frames must be **2–4 raw base64 JPEG strings**, not data URLs, from the last two seconds. The backend cannot verify capture time because the contract supplies no timestamps; the agent must clear stale/muted-camera buffers.
4. `attempt` starts at 1 and increments through 3 (initial attempt plus two retries). The agent owns the 15-second retry timing and 4:30 call cap. A persisted duplicate attempt returns the original verdict. Do not retry a passed check. Do not advance the attempt number when a 409 says an update raced; reload/retry the current operation.
5. `POST /api/agent/requests/{request_id}/finish` returns `{summary,link_url,notify_chat_ids}`. It is safe to retry. Untested checks become `unverified`. The last evaluated attempt determines each result.
6. On a dropped call, `POST /api/agent/requests/{request_id}/abort`. Partial results and challenges are cleared; the original code works again until expiry. A new start generates new challenge IDs, and evaluations from the old call are rejected.
7. For `WATCH`, `POST /api/agent/requests/watch` with `{code,chat_id}`. Duplicate registrations are deduplicated. The backend returns recipients at finish; Mahir's agent sends the messages.

`best_frame` is a **zero-based index** into the submitted frame order. Checks persist progress before awaiting Gemini. The public current prompt becomes available at start/check submission; Contract v3 has no separate endpoint for the instant the agent displays a new prompt. Result ticks appear as checks finish.

Status failures: 401 invalid/missing key; 404 unknown request/challenge/waiting code; 409 invalid state/attempt/concurrent update; 413 oversized body; 422 invalid input/images; 503 unavailable database or exhausted code allocation. Provider errors/timeouts become persisted `unverified` verdicts, never mock passes. A database outage does not silently switch stores.

## Real Gemini and Atlas setup

Configure locally, without committing secrets:

- `MOCK=0`
- `GEMINI_API_KEY`: a Gemini API project key with access to the configured model. Check quota and billing for the desired request rate.
- `GEMINI_MODEL`: defaults to `gemini-3.1-flash-lite`; choose a model available to your project and benchmark it. Synthetic image probes succeeded; real-item accuracy and production latency still require validation.
- `MONGODB_URI`: Atlas SRV connection string for a database user authorized to read/write and create indexes in the configured database. URL-escape password characters. Add your development/deployment IP to Atlas Network Access and ensure DNS/TLS connectivity.
- `MONGODB_DATABASE`: defaults to `showme`; collection is `requests`.
- `AGENT_KEY`: a strong shared secret agreed privately with Mahir.
- `PUBLIC_BASE_URL`: the frontend's public origin, with no `/api` suffix.
- `LINE_NUMBER`: the Chert service number displayed to sellers (never the seller's number).

Live mode fails startup if required credentials are missing or Atlas cannot connect. `/api/health` identifies the mode; it is a process check, not a continuous external-service readiness probe. Atlas writes are acknowledged before successful responses. Unique token/request-ID indexes and a partial unique active-code index prevent allocation races. Codes remain reserved during calls so abort restores the original code. Optimistic revisions prevent lost cross-worker updates. Expiry is enforced on reads/lookups/create/abort; there is no TTL deletion of completed reports.

Only a selected JPEG thumbnail (at most 400 pixels wide) is persisted per evaluated challenge; retries replace that thumbnail. Source frames are held only during processing. Requests have a 12 MB body limit, 2 MB encoded-frame limit (approximately), 16-million-pixel decode limit, and 2–4-frame bound. Images are normalized to at most 640×640 at JPEG quality 70 before evaluation. Gemini uses schema-constrained output, a five-second default deadline, and no SDK retry expansion. The agent manages retries. Passes below 0.7 confidence are downgraded to `unverified`.

Plan A FaceTime privacy filtering is enabled by default when loading environment settings. Calibration on two locally supplied agent-captured samples found **640×360** screenshots with centered portrait caller video at approximately x=200..440, not the earlier approximate 1280×720 layout. The local `.env`, `.env.example`, and sanitizer defaults now use:

```dotenv
VISION_FRAME_MODE=facetime
VISION_FRAME_SIZE=640,360
VISION_CROP_BOX=204,28,436,352
VISION_MASK_BOXES=204,288,304,352
```

All boxes are `left,top,right,bottom` in **original source pixels**, with exclusive right/bottom edges. Multiple masks are separated by semicolons. The crop retains a 232×324 caller region, excludes the black side margins, removes the top overlay (including a safety buffer), and trims the bottom rounded edge. A single buffered 100×64 source-pixel mask removes the bottom-left self-view tile. The lower-right caller evidence stays visible: the previous full-width bottom mask has been removed. No FaceTime controls remain inside this crop in either calibration sample.

Masks are applied before cropping and before any resize. No automatic scaling is applied: an unexpected frame size is unusable rather than risking a shifted UI. In particular, a future 1280×720 capture will be rejected until its layout is inspected and configured; it must not be assumed to match the previous approximation or a simple scale of this portrait layout.

To tune, keep `VISION_FRAME_SIZE` aligned with Mahir's capture, set the crop to caller video, and use masks to cover every overlay left inside it, with a safety margin. Restart Uvicorn after dotenv changes. Custom settings replace defaults, so visually validate sanitized local previews after changing capture dimensions, window layout, or overlay positions. A fixed crop does not detect moving/new UI. The originals in `vision/local_samples/` are used only for local calibration and are ignored by Git; sanitized previews (`sanitized1.jpg`, `sanitized2.jpg`) and thumbnails (`thumb1.jpg`, `thumb2.jpg`) are also local and ignored. No original images were submitted to Gemini during calibration.

Only sanitized, metadata-free JPEGs reach Gemini and the thumbnail generator. A batch containing an unexpected size, invalid crop/mask, or less than 10%/1,024 pixels of visible evidence is not sent to the checker: the attempt is persisted as `unverified` with an empty thumbnail. There is no fallback to an uncropped frame. Invalid JPEG/base64 payloads remain HTTP 422 input errors. Original frames are neither written nor logged. Black masking does not prove that the remaining item evidence is usable; Gemini still returns `unverified` when it cannot see the requirement.

For **raw camera frames only**, explicitly use `VISION_FRAME_MODE=camera`, clear `VISION_CROP_BOX` and `VISION_MASK_BOXES`, and send no FaceTime UI. This opt-out is for webcam/raw-camera integration; it must not be used for window screenshots. Mock mode uses the same privacy processing as the real checker. The standalone labeled-image evaluator also applies these settings; use explicit camera mode for raw-item sample datasets.

## Validation and outstanding physical checks

The default suite uses in-memory storage, a MongoDB test double, SDK doubles, and generated image fixtures. It verifies contract/security/lifecycle behavior, durable-adapter reconstruction, timeout/error policies, live progress, stale-call protection and cropping. **It does not prove Gemini accuracy, Atlas connectivity, or real disk persistence.**

Explicit real-service probes (use a dedicated test database) make real network calls and may incur Gemini charges:

```sh
SHOWME_LIVE_TESTS=1 vision/.venv/bin/python -m pytest -q vision/tests/test_live.py
```

The Atlas probe creates one uniquely named probe document, reconstructs the adapter, reads it and deletes only that probe. The Gemini probe submits a synthetic blank image and requires a real parsed model response; provider errors fail the test.

For real accuracy and speed measurements, put labeled photos under ignored `vision/local_samples/` and create `manifest.json`:

```json
[
  {"prompt":"Turn it on and show the screen or power light","expect":"device visibly powered on","result":"passed","frames":["on-1.jpg","on-2.jpg"]},
  {"prompt":"Show the serial label","expect":"a readable serial label","result":"unverified","frames":["dark-1.jpg","dark-2.jpg"]}
]
```

```sh
vision/.venv/bin/python -m vision.evaluate vision/local_samples/manifest.json
```

The evaluator prints per-sample predictions, accuracy and median latency; provider errors raise instead of inflating accuracy through fallback results. Gather about 20 labeled real cases including failures and at least three dark/blurry cases. Targets: ≥90% accuracy, initially median <3 seconds and ultimately <2.5 seconds. Run the second-phone recording attack five times with random finger challenges, and perform webcam/FaceTime integration with Wan and Mahir. None of these physical validations has been completed by automated tests.

No photo-upload route is added: Plan B has not been selected and Contract v3 defines none. It requires a team-approved contract update if needed. Changes to `shared/test_frames/` are outside the authorized file scope; use the ignored local sample directory for validation now.

For an approved deployment, run `uvicorn vision.main:app --host 127.0.0.1 --port 8000` from the repo root using the virtual environment, let systemd supply the environment, and preserve `/api` when proxying through nginx. TLS, Vultr access and the frontend deployment remain team integration tasks.

SDK references used for implementation: [Google Gen AI SDK](https://googleapis.github.io/python-genai/) and [PyMongo indexes](https://www.mongodb.com/docs/languages/python/pymongo-driver/current/indexes/).
