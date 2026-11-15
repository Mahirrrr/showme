// ShowMe agent: answers the seller's FaceTime call, shows challenge cards on its own video,
// speaks each one, grabs the caller's frames and sends them to vision/ for a verdict.
//
// Env (.env.local): LIVEKIT_*, GOOGLE_API_KEY (Gemini STT), ELEVENLABS_API_KEY (+ optional ELEVENLABS_VOICE_ID) for the voice,
// VOICE=openai + OPENAI_API_KEY to fall back for both, AGENT_NAME, VISION_URL, AGENT_KEY, MOCK_VISION=1 to skip vision.
// PROBE_FRAMES=1 saves the first 3 caller frames to probe/ (Gate 1: can we see the caller's camera?).
// START_WITHOUT_BRIDGE=1 starts the flow as soon as a caller joins (plain LiveKit room, no FaceTime).
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AutoSubscribe, defineAgent, voice } from '@livekit/agents';
import * as elevenlabs from '@livekit/agents-plugin-elevenlabs';
import * as google from '@livekit/agents-plugin-google';
import * as openai from '@livekit/agents-plugin-openai';
import { LocalVideoTrack, TrackSource, VideoBufferType, VideoFrame, VideoSource } from '@livekit/rtc-node';
import { FPS, HEIGHT, WIDTH, renderCard, withPulse } from './card.mjs';
import { runAgent } from './chert-rooms.mjs';
import { makeCodeListener, parseCode } from './code.mjs';
import { runCall } from './flow.mjs';
import { FrameBuffer, attachCallerVideo, toJpegBase64 } from './frames.mjs';
import { greetOnBridgeReady } from './greet.mjs';
import { makeVision } from './vision.mjs';

const probeDir = fileURLToPath(new URL('./probe/', import.meta.url));

async function saveProbe(buffer) {
  await mkdir(probeDir, { recursive: true });
  // PROBE_SHOTS (default 3) shots, PROBE_EVERY_MS (default 1000) apart.
  const shots = Number(process.env.PROBE_SHOTS) || 3, every = Number(process.env.PROBE_EVERY_MS) || 1000;
  for (let n = 1; n <= shots; n++) {
    await new Promise(r => setTimeout(r, every));
    const [frame] = buffer.recent(2000, 1).slice(-1);
    if (!frame) { console.log(`[probe] no frame for shot ${n}`); continue; }
    const file = `${probeDir}caller-${Date.now()}-${n}.jpg`;
    await writeFile(file, Buffer.from(toJpegBase64(frame, { maxWidth: 1280, quality: 85 }), 'base64'));
    console.log(`[probe] saved ${file} (${frame.width}x${frame.height})`);
  }
}

const agent = defineAgent({
  entry: async ctx => {
    // Chert's rule: register the video handlers before joining, then subscribe to video too.
    const buffer = new FrameBuffer({ sampleMs: 500, keep: 8 });
    const stopVideo = attachCallerVideo(ctx.room, buffer, {
      onFirstFrame: () => { if (process.env.PROBE_FRAMES === '1') void saveProbe(buffer); },
    });
    await ctx.connect(undefined, AutoSubscribe.SUBSCRIBE_ALL);

    // Our own video: the current card, re-sent at FPS with a blinking dot.
    // Published before the caller joins, so FaceTime shows the card the moment its video starts.
    const source = new VideoSource(WIDTH, HEIGHT);
    const track = LocalVideoTrack.createVideoTrack('agent-video', source);
    let card = renderCard({ prompt: 'Flip to your back camera and show the item', status: 'info' }), tick = 0;
    const show = c => { card = renderCard(c); };
    const sendFrame = () => source.captureFrame(new VideoFrame(withPulse(card, tick++), WIDTH, HEIGHT, VideoBufferType.RGBA));
    sendFrame();
    await ctx.room.localParticipant.publishTrack(track, { source: TrackSource.SOURCE_CAMERA });
    const timer = setInterval(sendFrame, 1000 / FPS);

    let caller;
    try { caller = await ctx.waitForParticipant(); }
    catch (error) { clearInterval(timer); stopVideo(); await track.close(); await source.close(); throw error; }
    console.log(`[agent] caller joined: ${caller.identity}`);

    // Voice: speech-to-text to hear the code, text-to-speech for scripted lines. No LLM, so it never improvises.
    // Gemini hears, ElevenLabs speaks (Gemini TTS free tier is only 10 requests a day).
    // VOICE=openai is the fallback for both.
    const session = new voice.AgentSession(process.env.VOICE === 'openai'
      ? {
        stt: new openai.STT({ model: 'gpt-4o-mini-transcribe', useRealtime: true, language: 'en', prompt: 'The caller reads a 4-digit code, like 4 8 2 7.' }),
        tts: new openai.TTS({ model: 'gpt-4o-mini-tts', voice: 'coral' }),
      }
      : {
        stt: new google.beta.GeminiSTT({ language: 'en-US', customVocabulary: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'] }),
        tts: new elevenlabs.TTS({
          apiKey: process.env.ELEVENLABS_API_KEY,
          voiceId: process.env.ELEVENLABS_VOICE_ID || undefined,
          model: 'eleven_flash_v2_5',
        }),
      });
    const codes = makeCodeListener();
    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, ev => {
      if (!ev.isFinal) return;
      console.log(`[stt] ${ev.transcript}`);
      const code = parseCode(ev.transcript);
      if (code) codes.heard(code);
    });
    const listenForCode = ms => codes.listen(ms);

    const vision = makeVision();
    let state = null;
    ctx.addShutdownCallback(async () => {
      clearInterval(timer);
      stopVideo();
      if (state?.request && !state.finished) {
        console.log('[agent] call dropped before finish: abort');
        await vision.abort(state.request.request_id).catch(e => console.error('[agent] abort failed', e.message));
      }
      await session.close();
      await track.close();
      await source.close();
    });
    await session.start({
      room: ctx.room,
      agent: new voice.Agent({ instructions: 'You only speak scripted lines.' }),
      record: false,
      inputOptions: { participantIdentity: caller.identity, audioEnabled: true, videoEnabled: false, textEnabled: false, closeOnDisconnect: true, deleteRoomOnClose: false },
      outputOptions: { audioEnabled: true, transcriptionEnabled: false },
    });

    const deps = {
      say: text => { console.log(`[say] ${text}`); return session.say(text, { allowInterruptions: false }).waitForPlayout(); },
      show: c => { console.log(`[card] ${c.status ?? ''} ${c.prompt ?? ''}`); show(c); },
      listenForCode,
      grabFrames: () => {
        const frames = buffer.recent(2000, 4).map(f => toJpegBase64(f));
        // Debug record (logs/ is gitignored): the last frame of every check, to see what the camera saw.
        if (process.env.SAVE_FRAMES === '1' && frames.length) {
          const dir = fileURLToPath(new URL('./logs/frames/', import.meta.url));
          void mkdir(dir, { recursive: true })
            .then(() => writeFile(`${dir}${Date.now()}.jpg`, Buffer.from(frames.at(-1), 'base64')))
            .catch(e => console.error('[frames] save failed', e.message));
        }
        return frames;
      },
      vision,
      sleep: ms => new Promise(r => setTimeout(r, ms)),
      now: () => Date.now(),
      log: console.log,
    };
    const begin = async () => {
      // runCall fills `live` as it goes, so a dropped call can still abort the right request.
      const live = { request: null, finished: false };
      state = live;
      try {
        const result = await runCall({ ...deps, vision: { ...vision, start: async id => { live.request = { request_id: id }; return vision.start(id); }, finish: async id => { const r = await vision.finish(id); live.finished = true; return r; } } });
        Object.assign(live, result);
      } catch (error) { console.error('[agent] call flow failed', error); }
      ctx.shutdown('check finished');
    };
    // FaceTime: greet within 10 s of bridge_ready. Plain LiveKit room: start right away.
    if (process.env.START_WITHOUT_BRIDGE === '1') void begin();
    else ctx.addShutdownCallback(greetOnBridgeReady(ctx.room, () => void begin()));
  },
});

export default agent;

runAgent(agent, { file: fileURLToPath(import.meta.url), agentName: process.env.AGENT_NAME || 'showme-agent' });
