# Chert docs digest — build-focused (for "Nobody")

Read for a Node.js LiveKit agent on a Chert FaceTime line that needs: caller-camera capture, agent video publish, outbound FaceTime calls, and iMessage location cards / voice notes / grouped images / edits / tapbacks. Pages not in `/llms.txt` were found by extracting sidebar `href` links from the FaceTime, FaceTime CLI, and API overview pages. Facts not explicitly in a page are marked "(inferred)".

## FaceTime

### https://docs.trychert.com/facetime/introduction
Chert connects a provisioned FaceTime line to your agent via **Bring Your Own Room (BYOR)**: your backend creates a LiveKit room and gives Chert's bridge a token.

### https://docs.trychert.com/facetime/quickstart
End-to-end inbound/outbound setup. Project API key needs `facetime:write` (create/end) and `facetime:read` (status/events). Env: `CHERT_API_KEY`, `PROJECT_ID`, `BASE=https://facetime.trychert.com/api`. List lines: `GET $BASE/v1/lines`. Inbound: set line to `customer_decides`, no default Assistant, configure webhook; respond to `call.incoming` within 5s with `{action:"accept", livekit_url, participant_token, remote_participant_identity}`. Verify by subscribing to bridge's `facetime-remote-audio` and (if enabled) `facetime-remote-video`. End call: `POST $BASE/v1/calls/{id}/end` with `Idempotency-Key` (8–200 chars).

### https://docs.trychert.com/facetime/bring-your-own-room
BYOR contract. Track names: caller audio → agent = **`facetime-remote-audio`**; caller video → agent = **`facetime-remote-video`** (needs separate capture enablement). Bridge JWT requirements: `wss://` URL, no embedded creds/fragment, default/443 port; integer `nbf`/`exp`, `exp - nbf ≤ 7200s`; `video.roomJoin`/`canPublish`/`canSubscribe` scoped to one room; nonempty `remote_participant_identity` distinct from bridge identity (worker actually just picks the sole eligible audio publisher, doesn't enforce exact match). Use a fresh bridge token per call — single-use refers to Chert's handoff, not the JWT itself. Inbound flow: `call.incoming` (signed if enabled) → respond 2xx within decision deadline (default 5s) with accept/decline → Chert joins with bridge token → your agent must publish usable audio for the "audio-ready gate".

### https://docs.trychert.com/facetime/outbound
`POST https://facetime.trychert.com/api/v1/calls` with headers `Authorization: Bearer <project API key>`, `X-Chert-Project-Id`, `Idempotency-Key` (8–200 chars). Body: `direction:"outbound"`, `mode:"customer_managed"`, `line_id`, `destination`+`destination_type` (`"phone"` E.164 or `"email"`), `media:{audio,video}`, `livekit_url`, `participant_token`, `remote_participant_identity`. Video needs an **outbound-video-enabled** line with fresh video readiness — audio readiness alone is not enough. HTTP 201 = allocated, not dialed/answered. **Wait for `bridge_ready` (or `call.started` webhook) before greeting** — do not greet on room-join or HTTP 201. Bridge token needs >90s remaining at allocation, issued lifetime ≤ 2h. End: `POST .../calls/{id}/end` with a separate idempotency key, HTTP 202 = acknowledged only. Groups: use `recipients` instead of `destination`/`destination_type`. FaceTime-link join: `destination_type:"facetime_link"` (separate capability). Busy shared line: `when_busy:"queue"` → 202 is a waiting receipt, not an allocated call.

### https://docs.trychert.com/facetime/calls-api
Base URL `https://facetime.trychert.com/api`. Endpoints: `POST /v1/calls`, `GET /v1/calls`, `GET /v1/calls/{id}`, `GET /v1/calls/{id}/events`, `POST /v1/calls/{id}/end`.

### https://docs.trychert.com/facetime/capabilities
Capability table: Inbound BYOR audio/video (webhook or CLI), Outbound audio/video (ready line, greet only after `bridge_ready`), Group calls (rolling out to Free/Shared/Dedicated), FaceTime-link joining (experimental, separate opt-in), **Caller vision** (independent opt-in; you supply the vision model), Multiple lines (1 active call/line), Managed Assistants, Chert-hosted agent (`chert agent`, eligible shared projects only), Chert-provided LiveKit (eligible paid Shared projects).

### https://docs.trychert.com/facetime/group-calls
One group = one call ID, one line slot, one bridge — no iMessage group chat needed. Plans: Free/Shared need every recipient phone-verified; Dedicated follows line policy. Each distinct recipient counts toward the **100-contact limit**. Duration counted once per group. `recipients[]` accepts 1–31 distinct handles (`phone_number` E.164 or `email`, only where policy allows) — input limit, not a tested capacity guarantee. Agent gets ONE mixed `facetime-remote-audio` track for everyone — no per-person tracks, no speaker identity (diarization is on you). No participant-count API. No per-person add/remove/mute/moderation API. Group video needs separate per-line confirmation.

### https://docs.trychert.com/facetime/audio-video
Video = both-direction audio+video; Audio = audio only. Agent video and caller capture are **independently enabled** — turning on video does not turn on caller capture. For BYOR, subscribe to bridge's `facetime-remote-audio` and `facetime-remote-video`. Caller capture may include FaceTime window chrome/names/self-preview depending on configured profile — "not always a raw camera feed." Camera mute/lost track must not be treated as a current frame.

### https://docs.trychert.com/facetime/dashboard
Sign in (Google/GitHub/email). Developer tab: create/revoke project API keys; **new secrets are shown for up to 10 minutes only** then hidden. Overview/Lines/Calls/Messages tabs. Keep BYOR line on `customer_decides` with no default Assistant (assigning a published Assistant routes to the managed path instead).

### https://docs.trychert.com/facetime/limits
1 active call per line; N ready lines = up to N simultaneous calls. Decision deadline 5s default. Bridge token `exp - nbf ≤ 7200s`. Outbound idempotency key 8–200 chars. `GET /api/v1/shared-waitlist` = allocation position (not an assigned line). Busy queue: `when_busy:"queue"` waits up to 2 minutes, turn lasts 20s, poll `GET /api/v1/calls/queue/{id}`, cancel with `DELETE`. Group: up to 31 remote handles (input limit, not tested capacity), 100-contact limit for Free/Shared.

### https://docs.trychert.com/facetime/core-concepts
Resource model: Line (1 concurrent call), Worker, Assistant/Assistant version (immutable published snapshot), Call, Session (BYOR call↔LiveKit room link — use a separate room per concurrent call), Answer policy (`auto_answer` or `customer_decides`).

### https://docs.trychert.com/facetime/authentication
Base URL `https://facetime.trychert.com/api`. `ftk_…` = project API keys (bearer, shown once, hashed at rest, revocable); need both `Authorization: Bearer ftk_...` and `X-Chert-Project-Id` headers; scopes `facetime:read`/`facetime:write`. `ftw_…` = internal worker creds, never issued to customers. Webhook signing secrets are separate from API keys.

### https://docs.trychert.com/facetime/errors
Error shape: `{error:{code, message}, request_id}`. Codes: `invalid_json`, `invalid_request`, `idempotency_key_required`, `invalid_livekit_url`, `invalid_token_grants`, `invalid_participant_identity`, `session_expired`, `not_found`, `invalid_state`. Gotcha: a successful API request does not guarantee a completed call — check status/terminal reason/events before retrying with a new idempotency key.

### https://docs.trychert.com/facetime/faq
**Highest-value page — answers in accordions, extracted via JS.**
- Caller camera: **Yes**, on FaceTime Video with **caller capture enabled on the line's worker**. Bridge publishes `facetime-remote-video` alongside `facetime-remote-audio`; subscribe to both. Works with CLI or webhook. **The CLI's video starter does NOT consume caller video by default** — you must register track handlers yourself. Audio-only calls never include caller video.
- Video via CLI: both `chert dev` and `chert byor` support inbound Audio+Video with **no webhook**. Only `chert create-room` is audio-only.
- Concurrency: 1 call per provisioned line; N lines = N simultaneous calls (subject to agent/LiveKit capacity).
- `chert dev --agent NAME` handles room prep + tokens automatically, no webhook.
- Any iPhone/iPad/Mac with FaceTime works for the caller — nothing to install.
- Can't mix BYOR custom voice/LLM with Chert's managed avatar — it's one or the other.
- Group call: `recipients` array on Calls API; one mixed `facetime-remote-audio`, no per-person tracks, no speaker ID.
- SDK supports outbound: `ChertControlPlane.createCall/getCall/getCallEvents/endCall`.

### https://docs.trychert.com/facetime/security
API keys shown once, hashed at rest. Webhook signing optional, **defaults to unsigned** for new integrations. BYOR: keep LiveKit key/secret on your backend, give Chert only a fresh room-scoped token. `from_handle_hash` in incoming webhook **may be null** — not proof of caller identity. Call records/events may persist after room credentials are removed — confirm retention policy with Chert before collecting sensitive conversation data.

### https://docs.trychert.com/facetime/webhooks
Configure in Workers & Lines → Integration. **New integrations default to unsigned delivery.** Events: `call.incoming` (respond within 5s), `call.started`, `call.ended` (includes `duration`, `terminal_reason`), `call.failed` (named reason). Signature: `X-Chert-Signature: sha256=<hex>` = HMAC-SHA256 of raw body. Delivery is at-least-once — dedupe on `event_id`. `call.incoming` does not retry past its deadline and fails closed.

### https://docs.trychert.com/facetime/assistants (not in llms.txt)
Managed Assistants = Chert-run persona (dashboard-configured), distinct from BYOR (your own agent). `chert agent` is a separate restricted-access **audio-only** Chert-hosted voice agent for eligible shared projects — inspect with `chert agent --help`.

### https://docs.trychert.com/facetime-cli/video — see FaceTime CLI section below (listed there since it's a CLI-section page, just not in llms.txt).

### https://docs.trychert.com/facetime/hosted-sessions (not in llms.txt)
**"Hosted Sessions" is a proposed model, not a verified production API** — do not build against any such endpoints. Use BYOR instead.

## FaceTime CLI (npm, beta)

Install: `npm install -g @trychert/facetime@0.1.0-beta.19`. Current published beta is **0.1.0-beta.19**; untagged `latest` is still **beta.15** — pin the exact version. Node 22.12+ (22.x)/24.x/26.x for the CLI; the JS starter needs 22.23.2 or 24.x specifically. macOS/Linux only — **no native Windows support**. SDK: `@trychert/sdk@0.3.0`.

### https://docs.trychert.com/facetime-cli/overview
How LiveKit projects, named agents, rooms, and Chert lines fit together.

### https://docs.trychert.com/facetime-cli/build-agent
Full JS voice-agent example using `@livekit/agents` 1.8.0 + `@livekit/agents-plugin-openai` 1.8.0. `.env.local`: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `OPENAI_API_KEY`, `AGENT_NAME`. `chmod 600 .env.local`; never commit or `source` it. Start script: `node --env-file=.env.local agent.mjs start`.

### https://docs.trychert.com/facetime-cli/quickstart ("Connect and test")
`chert login` (browser sign-in, lasts 30 days), `chert whoami`, `chert doctor` (reads `.env.local`/`.env` from cwd — reports which file). Two terminals: agent (`npm run check && npm start`) + `chert dev --agent <dispatch-name>`. `doctor --agent` runs a real temp-room job — may incur provider usage. Credential precedence: shell env > `--env-file` > `chert setup`-saved path > `.env.local`/`.env` in cwd (first readable file wins, no merging). `chert setup --clear` resets to folder loading.

### https://docs.trychert.com/facetime-cli/connect ("Projects and lines")
Need a Chert project (FaceTime) AND a separate LiveKit project (media) — names/IDs need not match. Organizer needs owner/admin role (**member role can't claim a line**). Dashboard line config: `customer_decides`, no default Assistant. `chert setup --env-file /path --project PROJECT_UUID` to run from another folder.

### https://docs.trychert.com/facetime-cli/workshop ("Hackathon organizer guide")
Org provides: Chert project with owner/admin, exactly one eligible line + its FaceTime address, reserved test slot. Team provides: own LiveKit Cloud project, funded model API account (starter uses OpenAI Realtime), Node 22.23.2/24.x, unique dispatch name (e.g. `team-otter-agent`). **Do not hand out production API keys or let students reuse a hosted demo agent's name.**

### https://docs.trychert.com/facetime-cli/commands ("CLI commands")
Key commands: `chert login`, `chert new my-agent [--video]`, `chert guide video`, `chert setup`, `chert doctor [--agent NAME]`, `chert dev --agent NAME`, `chert whoami`, `chert logout`, `chert onboard`, `chert plan`, `chert agent on "description"` / `status` / `off`, `chert livekit`, `chert context`. `--help --all` shows advanced commands.

### https://docs.trychert.com/facetime-cli/video ("Audio, video, and caller vision") — not in llms.txt, found via sidebar extraction
**Most build-critical CLI page.** No `chert dev --video` flag — same command for audio or video, caller picks the call type. `--video` belongs to `chert new` (selects starter code) and does **not** enable video on a line. `--muse` is unrelated (separate Muse agent integration). Starter: `chert new my-video-agent --video` → `npm install -g @trychert/facetime@0.1.0-beta.19` first. **The published video starter does NOT consume the caller's camera by default** — it uses `AutoSubscribe.AUDIO_ONLY` and `videoEnabled:false`. To get caller vision: use FaceTime Video + confirm caller capture enabled on the line, **register track handlers before joining the room**, enable video subscriptions. Bridge participant identity for generic `chert dev` = `chert-bridge-<call ID>` (custom BYOR uses your own token's bridge identity). Consume `facetime-remote-video` + `facetime-remote-audio` from that participant. Handle mute/track-removal/replacement — don't reuse a stale frame. **No built-in object detection or drawing/annotation tool** — any on-screen annotation must be rendered into your own published video track yourself.

### https://docs.trychert.com/facetime-cli/byor ("Custom BYOR callbacks", Advanced connectors)
For apps that own session lifecycle themselves (skip this if using `chert dev`). `npx chert init --non-interactive --mode byor --config ... --state-dir ...` generates `chert.json` + `chert-handler.ts`. Callbacks: `health()`, `prepare(call, context)`, `lifecycle(call, event, context)`, `recover(call, context)`. `call.media.audio`/`call.media.video` booleans tell you what was requested. Accept response shape: `{action:"accept", ready:true, session_ref, session_expires_at, livekit_url, participant_token, remote_participant_identity}`.

### https://docs.trychert.com/facetime-cli/create-room ("Custom create-room adapter", Advanced connectors)
Private-preview, **audio-only**, requires a qualified `chert-adapter-v1` health/cancellation hook on `127.0.0.1`. Max 60s resource lifetime, one active call at a time. Not relevant to a plain `chert dev` agent.

### https://docs.trychert.com/facetime-cli/manual-enrollment ("Manual connector enrollment", Advanced connectors)
Only for custom `byor`/`create-room` configs (ordinary `chert dev` handles this automatically). Needs `CHERT_USER_ACCESS_TOKEN` (a **user access token**, not a project API key) for `chert enroll`/`chert activate`.

### https://docs.trychert.com/facetime-cli/advanced-commands ("Advanced connector commands")
`chert check`, `chert status`, `chert drain`, `chert revoke`. `chert check` currently **exits 3 for partial diagnostics** — a gotcha, don't treat nonzero as full failure without reading the JSON. `chert run` is legacy v1 only.

### https://docs.trychert.com/facetime-cli/personal-agent ("Give a personal agent a Chert identity")
As of 2026-11-11: CLI beta is `@trychert/facetime@0.1.0-beta.19`, SDK `@trychert/sdk@0.3.0`, CLI's untagged `latest` is still beta.15 — **always pin the exact version**. `chert-sdk` CLI exposes only a subset of SDK methods (context, iMessage text send, FaceTime identity/line/worker reads) — library methods like `ChertControlPlane.createCall` are richer than the shell.

## Build with BYOR / Messaging API (console.trychert.com)

Messaging base: `https://console.trychert.com/api/v1/*`. FaceTime base: `https://facetime.trychert.com/api` (separate host/auth from Messaging).

### https://docs.trychert.com/api/overview
API model, stable capabilities, caveats (see Stable public API caveats below).

### https://docs.trychert.com/api/authentication
HMAC-SHA256 signing (recommended) or bearer (simpler, same strength over TLS). Headers: `x-chert-tenant` (your `tenant_slug`; required with multi-tenant accounts or whenever signing is used), `x-chert-signature: v1,<unix_seconds>,<hex>`, or `authorization: Bearer <signing_secret>`. If both present, signature checked first. HMAC input = literal `<unix_seconds>.<raw_body>` — **do not re-serialize/reformat the body after computing the signature**; server reads raw bytes. GET requests sign the empty string (input ends in a trailing dot). **Replay window: 5 minutes**, violation → 401 code `2013 AUTH_TIMESTAMP_SKEW` (distinct from bad-signature code `2004`).

### https://docs.trychert.com/api/sending
`POST /api/v1/send` — shortest path to a 1:1 text or voice-note send. Fields: `phone` (E.164 or Apple ID email), `body`, `idempotency_key`, `name`, `external_id`, `phone_line_id`, `attachments[]`, `effect`, `voice_note:{voice_note_id}`. Voice-note sends must NOT include `body`/`attachments`/`effect`/`rich_link`.

### https://docs.trychert.com/api/text-formatting
`text_decorations` on one text `part` in an existing direct iMessage chat (preview feature, line-enabled only — confirm access first). Styles: `bold`/`italic`/`underline`/`strikethrough`. `range` = `[start,end)` zero-based **UTF-16** code units (convert from Python's character offsets). Max 256 decorations. Unsupported line → error code `4099`. **Markdown is NOT parsed** — only explicit `text_decorations`.

### https://docs.trychert.com/api/messages/edit
`POST /api/v1/messages/{message_id}/edit` — `{new_text, edited_part_index, idempotency_key}`. **Apple enforces a 15-minute edit window from send time.** Native-edit-enabled lines: 202 `edit_requested` (older edit-enabled lines may give 200 `edited`). `retryable:false` ≠ recipient confirmed. Only `edited_part_index: 0`, single-text-part direct-chat originals — no groups/email/media/multipart.

### https://docs.trychert.com/api/voice-notes
Two-step: (1) `POST /api/v1/voice-notes` with uncompressed WAV or Opus-in-CAF → returns temp `voice_note_id` + `phone_line_id`; (2) `POST /api/v1/send` with that exact `voice_note_id` + same `phone_line_id`. **Staged ID expires after 15 minutes**, and is invalidated by a phone-line service restart. Not a generic attachment — don't put `voice_note_id` in `attachments[]`. Inbound voice memos arrive as ordinary `media` parts in `message.received` — no separate inbound endpoint, **no transcript provided**.

### https://docs.trychert.com/api/locations
`POST /api/v1/locations` — one-time pin, **not** Find My / live location. Fields: `phone`, `latitude`, `longitude`, `label`, `address`, `fallback_mode` (`auto`/`geo_url`), `expires_at`, `idempotency_key`. Unsupported line → `4099`. Location-card-enabled lines require E.164 phone + existing direct iMessage chat + idempotency key ≤128 chars; reject `chat_id`/email/`vcard`. Accepted → 202 with `status_url` (`GET /api/v1/locations/{message_id}`) to poll queued/acknowledged/sent/delivered.

### https://docs.trychert.com/api/chats/create
`POST /api/v1/chats` — creates chat + sends first message. `from`, `to[]`, `message.parts[]` (`text` via `value`, `rich_link` via `url`+optional `title/summary/image_url/icon_url`). **Media/rich-link not allowed on the first group-create call** — create with text only, then send media via the follow-up endpoint.

### https://docs.trychert.com/api/group-chats/create
Same route as `chats/create`, `to[]` with **2–31 recipients**. Returns `chat.id`, `is_group:true`. Typing indicators not supported on every line for groups — unsupported → `4099 NOT_SUPPORTED`.

### https://docs.trychert.com/api/chats/send-message
`POST /api/v1/chats/{chat_id}/messages` — follow-up send; body must be wrapped in `message` (top-level `parts` rejected). Supports `media` (`attachment_id`) and `rich_link` parts, combinable.

### https://docs.trychert.com/api/attachments
3-step: `POST /api/v1/attachments` (filename/content_type/size_bytes) → returns `attachment_id` + `upload_url` → `PUT` bytes with bearer auth (**HMAC not supported on the upload route**) → send via `{type:"media", attachment_id}` part. Single PUT limit **100 MB**. **Grouped images: set `parallel_attachments:true`** on the `chats/{id}/messages` send for multiple uploaded media parts to arrive as one grouped delivery; Apple's client decides collage/stack presentation. (llms.txt says grouped-image preview lines accept 2–10 images, ≤15 MiB each.)

### https://docs.trychert.com/api/phone-numbers
`GET /api/v1/phone-numbers` → `{phone_numbers:[{id, phone_line_id, phone_number, service:"imessage", is_active, capabilities:["imessage","send","receive"]}]}`. No separate voice-note capability flag exposed — must otherwise confirm voice-note enablement with Chert.

### https://docs.trychert.com/api/webhook-subscriptions
CRUD at `/api/v1/webhook-subscriptions`. `POST` requires HTTPS `url` + `events[]` (omit or `[]` = all events). Returns per-subscription `secret` **shown once** — store immediately; subsequent GETs never include it. Multiple subscriptions per tenant allowed, each with its own secret/filter.

### https://docs.trychert.com/api/receiving-replies
`message.received` fires in real time on every inbound iMessage (recommended default event). Subscribe with `events:["message.received"]`. Envelope includes `event_id`, `webhook_version`, `data.chat`, `data.message.parts[]` (text/media), `crm_deep_link`. Dev alternative without a public URL: SSE stream or dev inbox (see Events page).

### https://docs.trychert.com/api/events
`GET /api/v1/events` (filters: `type`,`status`,`lead_id`,`chat_id`,`since`,`limit` 1–200 default 50,`cursor`), `GET /api/v1/events/{id}`, `POST /api/v1/events/{id}/replay` (optional `?subscription_id=`), `GET /api/v1/events/stream` (SSE), `GET /api/v1/dev-inbox` (poll events with no webhook wired up yet — useful for a hackathon without a public endpoint).

### https://docs.trychert.com/api/messages/react
`POST /api/v1/messages/{message_id}/react` — `{reaction}`, one of **`love`/`like`/`dislike`/`laugh`/`emphasize`/`question`** (the 6 standard iMessage tapbacks). Not idempotent — each call posts a fresh tapback. Errors: `1002`/`2003 Message not found`/`4001 Delivery failed downstream`.

### https://docs.trychert.com/api/errors
Envelope: `{success:false, error:{status, code, message, retryable[, retry_after]}, trace_id}`. `error.code` is stable, build logic against it (not `message`, which can change). `retry_after` may accompany `1007`/`4002`. Note: **HTTP status is not derivable from the code's leading digit** (e.g. `1011` ships as HTTP 409).

### Not individually deep-read (time-boxed) — one-line each, from `/llms.txt` + sidebar:
- `/api/quickstart` — first API send from the Chert console.
- `/api/usage-examples` — copy-paste common API flows.
- `/api/chats/list-messages` — `GET /api/v1/chats/{id}/messages`.
- `/api/chats/mark-read` — `POST /api/v1/chats/{id}/mark-read`, no body.
- `/api/chats/typing` — `POST /api/v1/chats/{id}/typing` (typing indicator; `4099` on unsupported/group lines per group-chats page).
- `/api/group-chats/add-participant`, `/leave`, `/remove-participant`, `/rename` — group-chat management endpoints, not detailed in llms.txt beyond names (found via sidebar; **not independently verified this pass**).
- `/api/contact-sharing/send-card`, `/api/contact-sharing/share-info` — contact-card send/share endpoints (found via sidebar; not in llms.txt, **not independently verified this pass**).
- `/api/polls` — poll-message endpoint (found via sidebar; **not independently verified this pass**).
- `/introduction`, `/quickstart` — top-level path selector (API vs. Salesforce/HubSpot/Slack) — not relevant to this build.

## Integrations (one line each, per task scope)
- **Salesforce** (`/salesforce/overview`) — managed 2GP package for Lead/Contact/Account records.
- **HubSpot** (`/hubspot/overview`) — OAuth app for contact-sidebar sends, workflow actions, contact-created automation.
- **Slack** (`/slack/overview`) — reply triage and channel operations.

## Stable public-API caveats (from /llms.txt, cross-checked above)
- Text parts use `value`, not `text`.
- `/api/v1/chats/{id}/messages` takes a **chat** id; `/api/v1/messages/{id}/react` and `/edit` take a **message** id.
- Location sharing is one-time only, not Find My.
- `message.received` is the recommended real-time event; `lead_reply` is legacy.
- Webhook `events` filter values are exact strings; verify deliveries with the **per-subscription secret**, not the API signing secret.

## Open questions for Chert
1. **How is caller capture actually enabled on a free trial line?** All pages say "confirm caller capture is enabled on the line/worker" or "confirm with Chert" — no self-serve toggle or API field was found. Likely requires contacting Chert directly. (inferred: not self-service on a trial line)
2. **Frame rate / resolution of `facetime-remote-video`.** Not documented anywhere read — it's a standard LiveKit video track, so ordinary LiveKit subscriber frame-rate/resolution behavior presumably applies. (inferred)
3. **Do location cards, message edits, and grouped images work on a free trial line specifically?** Every relevant page says "existing line-enabled preview," "confirm access with Chert," or "other lines can reject... with 4099" — availability is explicitly per-line, and no page states trial-line eligibility either way.
4. **Does outbound FaceTime (video) work on a free trial line?** Outbound video needs "outbound-video-enabled" line with "fresh video readiness" — not confirmed for trial/free tier.
5. **Group FaceTime calling on a Free line** — docs say "on enabled shared lines during an active trial/allocation" for Free, implying it needs explicit enablement beyond just having a trial line.
6. **Is there a published rate limit for the Messaging API or Calls API** (requests/sec, calls/min)? Not stated on any read page; only error codes `1007`/`4002` imply rate/capacity limits exist with no documented numeric threshold.
7. **Exact behavior of `chert check` exit code 3** ("partial diagnostics") — docs flag it repeatedly but never fully enumerate what's incomplete.
8. **Whether the free trial line supports any outbound calling at all**, or outbound requires a paid/dedicated line — not stated explicitly in any page read.
9. **Object/vision-model recommendation** — docs explicitly say Chert supplies no object detection or drawing tool; confirm this is acceptable for the hackathon demo scope (agent must bring its own vision pipeline + frame annotation/rendering).
10. **Whether Node 24.x (vs. the pinned 22.23.2 starter) is safe for the hackathon's actual dependency versions** — commands-page says the CLI itself supports a wider Node range than the JS starter is tested on.
