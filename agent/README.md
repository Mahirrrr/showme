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
