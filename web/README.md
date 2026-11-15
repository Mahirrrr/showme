# web/ (Wan)

React + Vite + TypeScript + Tailwind v4. Pages: `/`, `/new`, `/v/:token`. Start with `docs/WAN.md`.

## Run

```bash
cd web
npm install
npm run dev:mock              # no backend: /v/:token and "create" use shared/mock_request.json
npm run dev                   # real API: /api is proxied to http://localhost:8000 (vision/)
```

Mock states: `/v/k3v9xq?state=awaiting_seller|in_call|complete|complete_recording|expired`, or `?state=demo` to watch awaiting → in_call → complete play out.

Backend for `npm run dev` (from the repo root):

```bash
MOCK=1 AGENT_KEY=test GEMINI_API_KEY=<your key> vision/.venv/bin/uvicorn vision.main:app --port 8000
```

Without `GEMINI_API_KEY`, /new shows the standard tests (labelled "standard list").

## Gemini test suggestions on /new (contract v5)

- The buyer types the product, then Gemini picks 6 tests. Unchecked tests can be swapped for new ones while checked ones stay.
- `POST /api/tests/suggest` on vision/: `{ item_name, category?, keep?, exclude?, count? }` → `{ category, tests: [{id,label,prompt,expect}], source }`
- `POST /api/requests` sends the chosen tests as full objects. If the server is still v3 (422), the page retries with the standard test ids and says so.

## Deploy

`web/deploy/deploy.sh root@<server-ip>` from the repo root builds web/, syncs web/dist + vision/ + shared/, and restarts. Secrets live only in `/etc/showme/vision.env` on the server.

## Layout

```
src/api.ts                 the only API client (mock mode lives here)
src/pages/Verify.tsx       /v/:token, one page for buyer and seller, changes by status
src/pages/NewCheck.tsx     /new
src/pages/Home.tsx         /
src/lib/report.ts          report banner rules (liveness failed → red, all passed → green, else amber)
src/lib/useRequestPoll.ts  2 s polling while awaiting_seller / in_call
deploy/                    nginx, systemd unit, deploy.sh (Vultr, Rocky Linux 9, HTTPS)
```


## Coordinated verification UX (Contract v5)

New requests require at least three selected tests, including suggested objects or standard IDs. The optional custom-text test is additional. Only selected buyer/custom tests run; there are no surprise challenges. New summaries use `liveness: "not_run"`; Contract v5.1 reports display the authoritative overall score described below. Completed historical reports are preserved, including older liveness banners.

Each test has an initial attempt plus up to two retries. Cards show "Try N of 3" and retries are spoken. Sellers receive 12 seconds to act each time; the agent checks the remaining 4:30 budget before evaluations and reserves 15 seconds for finish. Slow calls may end before every retry; unperformed tests are unverified. The backend keeps ordered, image-free `attempt_history`, and uses the last saved result for the final verdict and totals. Failed → passed counts as one passed test.

Authentication, camera-mode preprocessing, sanitized ≤400 px thumbnails, the 20-second Gemini deadline and 30-second agent check HTTP timeout are unchanged. Restart all components together for the new summary value and minimum selection rule. Do not reuse obsolete local test scripts that create fewer than three tests.


## Overall scoring (Contract v5.1)

The backend now supplies an authoritative overall verdict: at least **60%** of selected buyer tests must pass. Configure `PASSING_THRESHOLD_PERCENT` in the backend (default 60, valid range >0 to 100). Scores count final outcomes once after retries; failed, unverified and unperformed tests remain not passed. With three selected tests, two passes (66.7%) meet the default threshold; with five selections, three passes (60%) meet it exactly.

New summaries add `overall_verdict`, `pass_percentage`, `passed_tests`, `total_selected_tests` and `passing_threshold_percent` inside the existing MongoDB summary. Optional custom-text checks and historical liveness checks stay visible but are excluded from selected-test scoring. Existing aggregate counts are unchanged. The threshold is saved at finish so future configuration changes do not alter that completed score. Legacy documents without score fields are enriched on read under the current threshold without modifying stored records.

The report and agent use the backend verdict. Passing overall never changes an individual Failed/Unverified row. Show a warning whenever overall passes with individual issues, and preserve historical liveness warnings. The UI rounds percentages for display only; the decision uses the exact ratio. Restart components together; the API routes, three-test minimum, authentication, camera-mode/privacy processing, Gemini and Atlas adapters, and existing timeouts are unchanged.
