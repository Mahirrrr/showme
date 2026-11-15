# ShowMe

**Buying used? Make the seller prove it live.**

The buyer creates a check link and sends it to the seller. The seller FaceTimes ShowMe, and an AI agent runs the buyer's tests with clear instructions and up to two retries per test. Each check comes back Passed, Failed or Unverified, and the same link turns into the inspection report. Overall verification passes when at least 60% of selected tests pass; individual failures remain visible.

Built at HackUTA 2026 by Mahir, Wan and Youngjun.

## How it works
1. **Buyer:** opens `/new`, picks the item category and at least three tests, and gets a link plus a 4-digit code.
2. **Seller:** opens the link, taps to FaceTime ShowMe, and says the code.
3. **Agent:** shows each challenge as a card on its own video and reads it aloud. Gemini checks the frames.
4. **Report:** the link updates live during the call and ends as a report with a thumbnail per check.

## Repo layout
```
web/      Wan       React + Vite: /, /new, /v/:token
vision/   Youngjun  FastAPI + Gemini + MongoDB Atlas, all routes under /api
agent/    Mahir     Node: Chert FaceTime agent on LiveKit
shared/   contract.md, tests.json, mock_request.json, test_frames/
docs/     SHOWME_PLAN.md, ARCHITECTURE.md, CHERT_DOCS_DIGEST.md, WAN.md, YOUNGJUN.md
```

## Setup
1. `cp .env.example .env` and fill in the keys (shared by DM, never committed).
2. Run each part as its folder's README says. Start with the mock flags on (`VITE_MOCK=1`, `MOCK=1`, `MOCK_VISION=1`).

## Sponsor receipts
Each row is claimed on Devpost only once it is ticked, and it must point at real code that runs in the live demo.

| Sponsor | What it does in ShowMe | Code | Running in demo |
|---|---|---|---|
| Chert (FaceTime) | The seller's live FaceTime call, the agent's video cards | `agent/` | ☐ |
| Gemini API | Judges each challenge from the call frames | `vision/` | ☐ |
| MongoDB Atlas | Stores requests, results and thumbnails | `vision/` | ☐ |
| ElevenLabs | The agent's voice | `agent/` | ☐ |
| Vultr (Rocky Linux, for CIQ) | Hosts `web/` and `vision/` | deploy | ☐ |
| GoDaddy Registry | Our domain | deploy | ☐ |
