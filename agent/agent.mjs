// ShowMe agent: answers the seller's FaceTime call, shows challenge cards on its own video,
// speaks each one, grabs the caller's frames and sends them to vision/ for a verdict.
//
// Env (.env.local): LIVEKIT_*, OPENAI_API_KEY, AGENT_NAME, VISION_URL, AGENT_KEY, MOCK_VISION=1 to skip vision.
// PROBE_FRAMES=1 saves the first 3 caller frames to probe/ (Gate 1: can we see the caller's camera?).
// START_WITHOUT_BRIDGE=1 starts the flow as soon as a caller joins (plain LiveKit room, no FaceTime).
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AutoSubscribe, defineAgent, voice } from '@livekit/agents';
import * as openai from '@livekit/agents-plugin-openai';
import { LocalVideoTrack, TrackSource, VideoBufferType, VideoFrame, VideoSource } from '@livekit/rtc-node';
import { FPS, HEIGHT, WIDTH, renderCard, withPulse } from './card.mjs';
import { runAgent } from './chert-rooms.mjs';
import { parseCode } from './code.mjs';
import { runCall } from './flow.mjs';
import { FrameBuffer, attachCallerVideo, toJpegBase64 } from './frames.mjs';
import { greetOnBridgeReady } from './greet.mjs';
import { makeVision } from './vision.mjs';

const probeDir = fileURLToPath(new URL('./probe/', import.meta.url));

async function saveProbe(buffer) {
  await mkdir(probeDir, { recursive: true });
  for (let n = 1; n <= 3; n++) {
    await new Promise(r => setTimeout(r, 1000));
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
    const caller = await ctx.waitForParticipant();
    console.log(`[agent] caller joined: ${caller.identity}`);

    // Our own video: the current card, re-sent at FPS with a blinking dot.
    const source = new VideoSource(WIDTH, HEIGHT);
    const track = LocalVideoTrack.createVideoTrack('agent-video', source);
    let card = renderCard({ prompt: 'Connecting…', status: 'info' }), tick = 0;
    const show = c => { card = renderCard(c); };
    const sendFrame = () => source.captureFrame(new VideoFrame(withPulse(card, tick++), WIDTH, HEIGHT, VideoBufferType.RGBA));
    sendFrame();
    await ctx.room.localParticipant.publishTrack(track, { source: TrackSource.SOURCE_CAMERA });
    const timer = setInterval(sendFrame, 1000 / FPS);

    // Voice: speech-to-text to hear the code, text-to-speech for scripted lines. No LLM, so it never improvises.
    const session = new voice.AgentSession({
      stt: new openai.STT({ model: 'gpt-4o-mini-transcribe', useRealtime: true, language: 'en', prompt: 'The caller reads a 4-digit code, like 4 8 2 7.' }),
      tts: new openai.TTS({ model: 'gpt-4o-mini-tts', voice: 'coral' }),
    });
    const codeWaiters = new Set();
    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, ev => {
      if (!ev.isFinal) return;
      console.log(`[stt] ${ev.transcript}`);
      const code = parseCode(ev.transcript);
      if (code) for (const resolve of codeWaiters) resolve(code);
    });
    const listenForCode = ms => new Promise(resolve => {
      const done = code => { clearTimeout(t); codeWaiters.delete(done); resolve(code); };
      const t = setTimeout(() => done(null), ms);
      codeWaiters.add(done);
    });

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
      say: text => session.say(text, { allowInterruptions: false }).waitForPlayout(),
      show,
      listenForCode,
      grabFrames: () => buffer.recent(2000, 4).map(f => toJpegBase64(f)),
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
