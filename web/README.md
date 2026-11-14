# web/ (Wan)

React + Vite + TypeScript + Tailwind v4. Pages: `/`, `/new`, `/v/:token`. Start with `docs/WAN.md`.

## Run

```bash
cd web
npm install
cp .env.example .env.local    # then paste GEMINI_API_KEY (no VITE_ prefix, never commit)
npm run dev:mock              # /v/:token and "create" use shared/mock_request.json
npm run dev                   # real API: /api is proxied to http://localhost:8000 (vision/)
```

Mock states: `/v/k3v9xq?state=awaiting_seller|in_call|complete|complete_recording|expired`, or `?state=demo` to watch awaiting → in_call → complete play out.

## Gemini test suggestions on /new

- The buyer types the product, then Gemini picks 6 tests. Unchecked tests can be swapped for new ones while checked ones stay.
- `POST /api/tests/suggest` `{ item_name, category?, keep?, exclude?, count? }` → `{ category, tests: [{id,label,prompt,expect}], source }`
- **Dev only:** `server/suggestTests.ts` answers it inside the Vite dev server (Node), using `GEMINI_API_KEY` from `.env.local`. The key never reaches the browser bundle.
- **Production:** nginx serves static files only, so `vision/` must serve this route (proposed contract v4). If it fails, the page falls back to `shared/tests.json` and labels it "standard list".

## Layout

```
src/api.ts                 the only API client (mock mode lives here)
src/pages/Verify.tsx       /v/:token, one page for buyer and seller, changes by status
src/pages/NewCheck.tsx     /new
src/pages/Home.tsx         /
src/lib/report.ts          report banner rules (liveness failed → red, all passed → green, else amber)
src/lib/useRequestPoll.ts  2 s polling while awaiting_seller / in_call
server/suggestTests.ts     dev-only Gemini route
```
