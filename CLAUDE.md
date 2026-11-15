# ShowMe: read this first (every teammate's Claude reads this file)

**What we're building:** a buyer about to purchase a used item makes a check link. The seller opens it and FaceTimes ShowMe. A Chert FaceTime agent runs at least three buyer-selected tests with clear instructions and up to two retries per test, Gemini judges each one Passed, Failed or Unverified, and the same link turns into a live report. Event: HackUTA 2026. Judging is Sunday at 1 PM.

## Read order
1. This file.
2. `shared/contract.md`: the API. It is the only source of truth for routes and shapes.
3. `docs/SHOWME_PLAN.md`: scope, risks, each person's step-by-step tasks (section 6), demo and pitch.
4. `docs/ARCHITECTURE.md`: components, state machines, what goes inside each folder, deploy, env, failure modes.
5. Your own start file: `docs/WAN.md` or `docs/YOUNGJUN.md`. Mahir's agent work also uses `docs/CHERT_DOCS_DIGEST.md`.

## Who owns what (edit only your own folder)

| Folder | Owner | Stack | Branch |
|---|---|---|---|
| `web/` | Wan | React + Vite + TypeScript: `/`, `/new`, `/v/:token`, deploy | `wan/web` |
| `vision/` | Youngjun | Python FastAPI + Gemini + MongoDB Atlas | `youngjun/vision` |
| `agent/` | Mahir | Node: Chert FaceTime starter + LiveKit | `mahir/agent` |
| `shared/` | everyone | contract, test catalog, mock data, test photos | change only when all 3 agree |
| `docs/`, root files | Mahir | plan, architecture, this file | ask Mahir |

- Never edit another person's folder. If you need a change there, message its owner.
- Only the folder's owner edits its `package.json` or `requirements.txt`.
- `shared/tests.json` is owned by Youngjun; `shared/contract.md` changes need all 3.

## Build against mocks first
- Web: `VITE_MOCK=1` reads `shared/mock_request.json` (it has every state: `awaiting_seller`, `in_call`, `complete`, `complete_recording`, `expired`).
- Vision: `MOCK=1` serves an in-memory store and canned results.
- Agent: `MOCK_VISION=1` skips HTTP and uses canned results.
- Every route lives under `/api`. nginx serves the web app at `/` and proxies `/api` to uvicorn, so no CORS is needed in production. In development, Vite proxies `/api` to `http://localhost:8000`.

## Git loop
- Work on your branch; commit and push every 30 to 60 minutes.
- Stage only your folder: `git add web/` (or `vision/`, `agent/`).
- Merges into `main`: Mahir at **8 PM, midnight and 7 AM**, Youngjun at **4 AM**. After each merge, run `git pull origin main` on your branch.
- Commit messages: `feat(web): ...`, `fix(vision): ...`.

## Hard rules
- **Secrets:** keys are shared by DM only and go into a local `.env`. Never commit `.env`. `.env.example` has names only.
- **Integrity:** we claim a sponsor prize only if the live demo really calls that product. Cut a feature, drop its claim. The README's sponsor receipts table must match the code.
- **Never claim what we couldn't see:** a check that the camera couldn't show after the retries is `unverified`, never `passed`.
- **Privacy:** at most one thumbnail per check (400 px wide max). Drop all other frames right after the check. Never show the seller's phone number.
- **Contract v5.1:** no surprise checks in new inspections. `summary.liveness = "not_run"`. Keep historical reports readable. Failed-then-passed tests count as passed; metadata-only attempt history is retained. Overall PASSED requires at least `PASSING_THRESHOLD_PERCENT` (default 60) of selected buyer tests to pass; individual outcomes never change because of the overall score.

## Key deadlines
- 6:00 PM Saturday: Plan A (live video) or Plan B (photo upload) decision.
- 8:00 PM: merge 1, end to end with a webcam.
- **10:30 PM: Devpost draft submitted** (the hard cutoff is 11:59 PM Saturday).
- 7:00 AM Sunday: code freeze. 10:00 AM: last Devpost edit. 1:00 PM: judging.
