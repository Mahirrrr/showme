# Wan: start here (`web/`, deploy, Devpost visuals, props)

Your pages **are** the demo. A judge opens `/v/<token>` on their own phone and watches it change live during the call. Build mobile first.

## Your tasks
The step-by-step list, with times and "done when" checks, is `docs/SHOWME_PLAN.md`, section 6, steps **W1 to W13**. The page specs are in `docs/ARCHITECTURE.md`, section 6. In short:
1. **W1 (now):** claim the GoDaddy Registry domain with the MLH code, create the Vultr Rocky Linux 9 instance, and run `npm create vite@latest web -- --template react-ts`.
2. **W2 (first, most important):** `/v/:token` built from `shared/mock_request.json`, in every state:
   - `awaiting_seller`: seller instructions, the big 4-digit code, a `facetime:` button to the line number, the buyer's tests.
   - `in_call`: "Live now", the current challenge, results appearing as they arrive.
   - `complete`: the report. Banner: red "Live check failed: possible recording" if liveness failed (see `complete_recording`), green "Verified live" if everything passed, otherwise amber "N passed · N failed · N unverified". One row per check with its thumbnail and reason.
   - `expired`: a short "this check has expired" message.
3. **W3:** `/new`: item name, category, a test picker driven by `shared/tests.json`, an optional free-text test, then the link with a copy button and a QR code.
4. **W4:** `/`: the landing page. "Buying used? Make the seller prove it live." 3 steps, and a "Create a check" button.
5. **W5:** switch from the mock to the real API; poll every 2 seconds while `in_call`.
6. Then the props, the Devpost draft with Mahir, the Vultr deploy with Youngjun, the share card, the QR poster and the sponsor audit.

## Talking to the API
- All routes are under `/api` (see `shared/contract.md`). Use relative URLs such as `fetch('/api/requests/' + token)`.
- In `vite.config.ts`, proxy `/api` to `http://localhost:8000` for development.
- Put every call in one typed client, `src/api.ts`. When `VITE_MOCK=1`, it returns states from `shared/mock_request.json` instead of fetching. Tip: in mock mode, let `?state=in_call` in the URL pick which state to show.

## Design: skills you can use with Claude Code
**Already in this repo** (Claude Code loads them automatically when you open the `showme/` folder):
- **`emil-design-eng`:** polish, component details, animations, the small things that make UI feel great. Use it for the results ticking in and the banner reveal.
- **`mobile-native`:** makes the web app feel native on a phone (safe areas, the 100vh bug, inputs zooming, tap highlights). Run it on `/v/:token` before judging.
- **`break-ui`:** throws worst-case data at a screen (long item names, 0 results, 10 results, emoji). Run it on the report.

Ask Claude, for example: "use emil-design-eng to polish the report rows", or "run mobile-native on Verify.tsx".

**Install gstack** (free and open source, needs [Bun](https://bun.sh)) for the bigger design skills:
```bash
git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack && cd ~/.claude/skills/gstack && ./setup
```
Then in Claude Code:
- `/design-consultation`: proposes a full design system (type, color, spacing, motion) for the product. Run it once at the start.
- `/design-shotgun`: generates several design variants to compare. Good for the report page.
- `/design-review`: finds spacing, hierarchy and "generic AI look" problems on a running page, then fixes them. Run it after W5.

**Borrow a real site's design system** (optional, fast): download one style file into `web/` and tell Claude to follow it for every color, font and spacing value. Take the pattern, never the brand (no logos, names or copy). Good fits for a trust product:
- Revolut: white, grayscale, pill buttons, one blue accent. Leaves room for the green, red and amber results.
- Wise: deep green with a lime accent.
- Stripe: indigo on frosted glass.
```bash
curl -sL -o web/DESIGN.md https://ui.gradientdeck.com/styles/revolut/design.md
```
(Swap `revolut` for `wise` or `stripe`.)

## Rules
- Edit only `web/`. Ask Youngjun about the API and Mahir about the shared files.
- The page never shows the seller's phone number and never shows the liveness challenges before the call.
- Mobile first. Test on a real phone over cellular data, not just in a desktop browser.
