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

## Gemini test suggestions on /new (contract v4)

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
