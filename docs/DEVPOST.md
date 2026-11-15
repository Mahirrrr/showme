## Inspiration

Every used-item sale on Marketplace or OfferUp ends with the same message: *"Can you FaceTime me and show it works?"* Most sellers say yes, and the call proves very little. The seller picks what you see, a pre-recorded clip looks live, the unit on camera may not be the one in the box, and you're judging a blurry screen while trying to remember what to ask.

We wanted the buyer to control that call without being on it: the buyer decides what has to be shown, and an agent makes the seller show it, including checks the seller can't prepare for.

The theme fit naturally. In the *Odyssey*, Penelope tests the stranger who claims to be Odysseus with a secret only the real one would know: their bed is built from a living olive tree. ShowMe's secret liveness challenges work the same way, so our cards call each step a **Trial**, and **"The Oracle looks…"** while Gemini decides.

## What it does

1. **The buyer makes a check** at [showme.photo](https://showme.photo). They type the item ("iPhone 13"), Gemini suggests the tests that matter for it (battery health, IMEI, Apple ID signed out), and the buyer keeps the ones they want.
2. **The buyer sends the link** to the seller. It holds a 4-digit code.
3. **The seller FaceTimes ShowMe** and says the code. An AI agent answers the call, speaks each task, and shows it as a card in the video.
4. **The agent runs the buyer's tests plus 1 or 2 secret liveness challenges** ("hold up 3 fingers next to it", "turn it upside down"). No public route reveals them before the call, so a recording can't answer them.
5. **Gemini judges each check** from the live frames as **Passed**, **Failed** or **Unverified**, with a one-line reason.
6. **The buyer's link becomes the report.** It updates live during the call, with one thumbnail and one sentence of evidence per check.

During the call, the seller can say **"again"**, **"skip"** or **"ready"**. FaceTime can't send taps to an agent, so voice is the only control.

The rules that matter are code, not model output: a check the camera couldn't show is **Unverified, never Passed**, and the secret challenges are picked at random on the server.

## How we built it

| Part | What | Why it mattered |
|---|---|---|
| **Call** | **Chert** FaceTime line, with the agent connected through `chert dev` | A real FaceTime number the seller already knows how to call, with no app to install |
| **Agent** | Node.js on **LiveKit Agents** | Receives the caller's audio and video and publishes our video track (the task cards) |
| **Voice** | **Gemini** speech-to-text, **ElevenLabs** Flash v2.5 text-to-speech, LiveKit background voice cancellation | Hears the code in a noisy hall; speaks fast enough to keep each check under 30 s |
| **Cards** | Drawn on a canvas at 1440x960, the shape of FaceTime's video, with the text in a phone-width column | Readable in both FaceTime fit and fill modes |
| **Vision API** | Python **FastAPI** + **Gemini** | Judges each check, picks the thumbnail, suggests tests, enforces the rules |
| **Data** | **MongoDB Atlas** | One document per check: tests, secret challenges, results, one thumbnail each |
| **Web** | React + Vite + TypeScript | `/new` to create a check, `/v/<token>` for the live report |
| **Deploy** | **Vultr** VM on **Rocky Linux 9.8**, nginx, systemd, Let's Encrypt, at **showme.photo** | One HTTPS origin: the web at `/`, the API at `/api` |

**Privacy by design:**
- The caller's video arrives as a capture of the Mac's FaceTime window, and that window shows the caller's **phone number**. The agent finds the caller's video inside the frame and crops away the top bar and the controls **on the laptop**, so the number never reaches our server or Gemini.
- We keep at most one small thumbnail per check (400 px wide max) and drop every other frame after the check.

## Challenges we ran into

- **The video wasn't the camera.** We expected raw camera frames and got a 1280x720 picture of the FaceTime window: black, with a 480 px portrait strip that moved between calls (x 64 on one call, x 400 on the next). A fixed crop would have broken, so the agent measures the strip on every call and drops any frame where it can't find one.
- **Our two crops fought.** The backend added its own crop, tuned on old 640x360 samples, and rejected the agent's already-cropped frames. We settled on one owner for cropping, the agent.
- **The first real call was too chatty.** It repeated every prompt, ran 7 checks in shuffled order ("tap it twice" between Battery Health and the lock screen), and hit the 5-minute call cap. We rebuilt the flow:
  - each task is spoken once;
  - the agent then looks silently for up to 30 s, with hints on screen;
  - checks run in a logical order (power on → Settings screens → physical), with the liveness challenges last;
  - the voice runs about 20% faster.
- **Speech-to-text and codes.** Gemini once heard "4827" as "427". The agent keeps a code said during the greeting, asks once more, and only accepts exactly 4 digits that match a waiting check.
- **Infrastructure surprises.** The FaceTime line went offline three times on Chert's side. Our Atlas cluster only accepted one teammate's IP. And 3 ticked tests became 6, because a fallback quietly sent the whole catalog.

## Accomplishments that we're proud of

- End to end on real FaceTime calls: code by voice, live Gemini verdicts usually in 1.5 to 2.5 s per check, and a report that updates while the call is still going.
- Wrong answers never pass. In our tests, a paper cup shown for "show the serial label" came back Unverified, with the reason "no serial number or model label is visible".
- The seller's phone number never leaves the laptop.
- Three people, three folders, one API contract: the agent, the vision service and the web app were built in parallel and merged without conflicts.

## What we learned

- Read the real data before designing around it. Our crop plan changed completely after one probe that saved 8 frames.
- On a voice call, every extra sentence costs time the seller feels. Showing a hint beats saying it.
- "Unverified" is a feature. Being honest about what the camera couldn't show is what makes a "Passed" worth trusting.

## What's next for ShowMe

- Text the code over iMessage instead of saying it, and send a "WATCH" alert when the report is ready.
- Keep partial results when a call drops.
- A dedicated line any phone can call; our trial line only accepts one verified caller.
- More item categories, plus a replay of the evidence frames for disputes.
