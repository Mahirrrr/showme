# Handoff: Mahir's agent work (written Saturday 7:12 PM)

Read this after `showme/CLAUDE.md`. It says where the `agent/` work stands, what is running on Mahir's laptop, and what comes next. Update it when you finish a step.

## Where things stand

**The agent works end to end on a real FaceTime call with mock vision** (5 test calls today).
- **Voice:** Gemini speech-to-text hears the code; ElevenLabs (`eleven_flash_v2_5`, default premade voice) speaks. Gemini text-to-speech was dropped because its free tier allows only 10 requests a day. `VOICE=openai` switches both to OpenAI as a fallback (needs `OPENAI_API_KEY`, which is empty).
- **Code:** a code said during the greeting is kept for 20 s (`makeCodeListener` in `code.mjs`). If the code isn't matched twice, the flow falls back to `latest-waiting`. Gemini speech-to-text once heard "4827" as "427", dropping the 8.
- **Cards:** "Aegean" style, Mahir's pick for the Odyssey theme (`card.mjs`). The frame is 1440x960 (3:2, FaceTime's Mac video shape), with the text in a 444 px phone-shaped center column. In FaceTime **fill** mode the column fills the iPhone screen; in **fit** mode the whole 3:2 frame shows, and the text is small. Double-tapping the video toggles between the two. Other options are in `agent/logs/options/` (gitignored), with the renderer in `agent/logs/card-options.mjs`.
- **Start:** the card track is published before the caller joins. The first card and the greeting ask the seller to flip to the back camera. A grey screen for about 7 s at call start is FaceTime connecting; nothing can draw there.
- **Debug record:**
  - `agent/logs/agent.log` has `[say]`, `[card]`, `[stt]`, `[frames]` and `[flow]` lines.
  - `SAVE_FRAMES=1` saves the last **cropped** frame of each check to `agent/logs/frames/` (exactly what vision gets).
  - `PROBE_FRAMES=1 PROBE_SHOTS=8 PROBE_EVERY_MS=3000` saves raw, **uncropped** 1280x720 caller frames to `agent/probe/` (shows the phone number; off since 7:18 PM).
  - `logs/` and `probe/` are gitignored. **They show Mahir's phone number. Never commit or share them publicly.**
- **Tests:** `cd agent && npm test` runs 29 tests, all passing; `npm run check` runs a syntax check. All work is pushed on `mahir/agent` (last code commit `17a6bcc`, auto-crop).

## The caller video (important for vision)

- Frames are a capture of the Mac's **FaceTime window**, not the raw camera. They are 1280x720, black everywhere except a **480 px wide portrait strip**.
- **The strip moves between calls:** x 64–544 on call 1, x 400–880 on later calls. It stays fixed within a call. **A fixed `VISION_CROP_BOX` will not work.**
- **FaceTime overlays inside the strip:**
  - a top bar that shows the **caller's phone number** (about y 0–60, only while FaceTime's controls are visible);
  - our own card as a small self-view tile in the bottom-left (about y 580–700);
  - call buttons at the bottom right.
- **Decision (DONE 7:18 PM, commit `17a6bcc`):** the **agent auto-crops** before sending frames (`makeCallerEncoder` / `cropToCallerVideo` / `findCallerStrip` in `frames.mjs`). It finds the non-black columns, then cuts the top bar and the bottom controls, so the phone number never leaves the laptop. Youngjun leaves `VISION_CROP_BOX` empty.
  - Measuring non-black columns (summed brightness above 40) found the strip exactly on all 9 sample frames.
  - Sample frames for tuning are in `agent/probe/for-youngjun/` (15 files: face shots plus back-camera shots of a case and a cup). Mahir sends them to Youngjun privately.

## Running on Mahir's laptop now

| What | How it was started | Log |
|---|---|---|
| Agent (restarted 7:18 PM with auto-crop) | `MOCK_VISION=1 SAVE_FRAMES=1 nohup npm start` in `agent/` | `agent/logs/agent.log` |
| `chert dev` (restarted 7:18 PM) | `nohup npx -y @trychert/facetime@0.1.0-beta.21 dev` in `agent/` | `agent/logs/chert-dev.log` |
| Youngjun's vision (mock) | worktree `../showme-vision` (branch `youngjun/vision` @ `6a3a882`), `vision/.venv/bin/uvicorn vision.main:app --port 8000` | `agent/logs/vision.log` |
| Wan's web | worktree `../showme-web` (branch `wan/web`), `npx vite --port 5173` | `agent/logs/web.log` |

- **Restart rule:** after restarting the agent, also restart `chert dev`. Its warm room holds the old agent, and calls ring forever otherwise.
  - Stop both with SIGINT and never SIGKILL `chert dev`. Use `pkill -9` only on stuck `agent.mjs` workers, after SIGINT fails.
- `chert` is not on PATH, so always use `npx -y @trychert/facetime@0.1.0-beta.21 <cmd>`. Check readiness with `doctor --agent showme-hackuta-agent`.
- **Line:** +1 702-510-9706 (Noah Wilson). It went "busy"/`line_offline` 3 times today; that was on Chert's side and was fixed at the Chert table or cleared on its own.
- **FaceTime minutes:** 41 of 50 left at 7:12 PM. Test in a plain LiveKit room where possible.
- **`agent/.env.local` (gitignored) holds:** LiveKit keys (Mahir's own LiveKit Cloud project), `GOOGLE_API_KEY`, `ELEVENLABS_API_KEY`, `AGENT_KEY` (also written into `../showme-vision/vision/.env`), `VISION_URL`, `MOCK_VISION=1`, and `CHERT_API_KEY` plus `CHERT_PROJECT_ID`.
  - The Chert key is tested: `GET https://facetime.trychert.com/api/v1/lines` returns 200.
  - `/v1/events` and `/v1/dev-inbox` return 404 on that base, so iMessage events probably use a different base URL. Check docs.trychert.com before building iMessage.

## Integration already checked

- The agent's `runCall` against Youngjun's real HTTP server (mock checker), using a real FaceTime frame, works:
  - `by-code` 4827, then `start` with 5 random challenges, then `check` ×5, then `finish` returns "5 of 5 passed".
  - The contract matches.
- Wan's `/v/mock-complete` renders against local vision through the Vite proxy.

## Next steps, in order

1. **DONE (7:18 PM): auto-crop in the agent.**
   - How it works: per call, find the non-black columns (mean brightness above 4, every 4th row); accept the run only if its width is within 10% of 2/3 of the frame height (480 px on 720), else reuse this call's last strip, else **drop the frame** (never send it uncropped). Cut y < 60 and y >= 580 (scaled to the frame height). Output is 480x520 JPEG.
   - Only frames from the `facetime-remote-video` track are cropped; a webcam in a plain LiveKit room passes through unchanged (needed for Merge 1).
   - Checked on all 19 frames in `agent/probe/`: strip found on 18 (x 398/399 or 63, width 482–484); the "Connecting…" frame is dropped. Contact sheet showed no top bar, no self-view tile, no buttons.
   - Not yet seen on a live call: on the next FaceTime test, look at `agent/logs/frames/`. A portrait-to-landscape phone rotation is untested (a landscape strip would be dropped, so that check comes back `unverified`).
   - Still to do: tell Youngjun to leave `VISION_CROP_BOX` empty.
   - Original plan, kept for reference:
   - Add a `cropToCallerVideo(frame)` in `frames.mjs`: find the non-black columns, cut the top bar (about 8% of the height) and the bottom controls (from y about 580 of 720), then JPEG it.
   - Use it in `grabFrames`, and also save the cropped version under `SAVE_FRAMES`.
   - Test it on the frames in `agent/probe/for-youngjun/`.
   - Tell Youngjun to leave `VISION_CROP_BOX` empty.
2. **Real Gemini judging:** get Youngjun's `MONGODB_URI` (by DM), set `MOCK=0` and `GEMINI_API_KEY` in `../showme-vision/vision/.env`, restart uvicorn, and run the agent with `MOCK_VISION=0`. Wrong answers must come back `failed` or `unverified`.
3. **Merge 1 at 8 PM:** end to end in a plain LiveKit room. Webcam, agent, real `vision/`, and `/v/<token>` updating live. Then merge the branches into `main` (Mahir's job).
4. **Devpost draft by 10:30 PM** (hard cutoff 11:59 PM Saturday).
5. **Later** (M10 slot, about 11:15 PM): iMessage. A texted 4-digit code feeds `codes.heard()` with about a 3-minute window, plus the `WATCH` notify. Optional: a "Start video check" tap-to-call button on `/v/<token>`, which needs a contract change all 3 agree on.
6. **Nice to have:**
   - A custom ElevenLabs voice via Voice Design ("calm, trustworthy marketplace inspector"), set as `ELEVENLABS_VOICE_ID`.
   - Speak "The Oracle looks…" while checking.
   - Silence the "call flow failed: AgentSession is not running" log line that appears after a hang-up.

## Pitch notes from today

- **Odyssey theme hook:** Penelope tested the disguised Odysseus with a secret only the real one knew (their bed built from a living olive tree). ShowMe's secret liveness challenges work the same way. The cards say "TRIAL II OF V", and "THE ORACLE LOOKS…" shows while Gemini judges.
- **Demo tip:** the seller must flip to the back camera, and the judge's phone should be in fill mode.
