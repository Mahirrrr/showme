// The caller's camera: subscribes to their video track, keeps a few recent frames, and encodes them as JPEG.
import { createCanvas, ImageData } from '@napi-rs/canvas';
import { RoomEvent, TrackKind, VideoBufferType, VideoStream } from '@livekit/rtc-node';

/** Ring buffer of recent RGBA frames, sampled at most once every `sampleMs`. */
export class FrameBuffer {
  constructor({ sampleMs = 500, keep = 8, now = Date.now } = {}) {
    Object.assign(this, { sampleMs, keep, now, frames: [], lastSampleAt: -Infinity });
  }
  /** Returns true when the frame was kept. */
  offer(frame) {
    const at = this.now();
    if (at - this.lastSampleAt < this.sampleMs) return false;
    this.lastSampleAt = at;
    this.frames.push({ ...frame, at });
    if (this.frames.length > this.keep) this.frames.shift();
    return true;
  }
  /** Up to `max` frames from the last `maxAgeMs`, oldest first. Stale frames are never returned. */
  recent(maxAgeMs = 2000, max = 4) {
    const cutoff = this.now() - maxAgeMs;
    return this.frames.filter(f => f.at >= cutoff).slice(-max);
  }
  clear() { this.frames = []; this.lastSampleAt = -Infinity; }
}

/** RGBA frame → base64 JPEG, scaled down to at most maxWidth pixels wide. */
export function toJpegBase64({ data, width, height }, { maxWidth = 640, quality = 75 } = {}) {
  const src = createCanvas(width, height);
  src.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width, height), 0, 0);
  const scale = Math.min(1, maxWidth / width);
  const w = Math.round(width * scale), h = Math.round(height * scale);
  const out = createCanvas(w, h);
  out.getContext('2d').drawImage(src, 0, 0, w, h);
  return out.encodeSync('jpeg', quality).toString('base64');
}

// ---------- FaceTime-window crop
// Chert's caller video is a capture of the Mac's FaceTime window: 1280x720, black except a 480 px portrait
// strip whose x position moves between calls (64–544 or 400–880). Inside the strip FaceTime draws a top bar
// with the caller's phone number (y < 60) and, at the bottom, our self-view tile and the call buttons (y >= 580).
// The agent crops all of that away so the phone number never leaves the laptop.
const STRIP_ASPECT = 2 / 3;      // strip width / frame height (480 / 720)
const STRIP_TOLERANCE = 0.1;     // accept a measured width within ±10% of that
const TOP_CUT = 60 / 720;        // top bar
const BOTTOM_CUT = 580 / 720;    // self-view tile and call buttons start here
const BLACK_MEAN = 4;            // a column whose mean brightness is above this is not window background

/** Finds the caller's portrait strip: `{ x, width }`, or null when the frame has none (connecting screen, all black, webcam). */
export function findCallerStrip({ data, width, height }) {
  const rowStep = 4, rows = Math.ceil(height / rowStep);
  let first = -1, last = -1;
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = 0; y < height; y += rowStep) {
      const i = (y * width + x) * 4;
      sum += data[i] + data[i + 1] + data[i + 2];
    }
    if (sum / (3 * rows) > BLACK_MEAN) { if (first < 0) first = x; last = x; }
  }
  if (first < 0) return null;
  const stripWidth = last - first + 1, expected = height * STRIP_ASPECT;
  return Math.abs(stripWidth - expected) <= expected * STRIP_TOLERANCE ? { x: first, width: stripWidth } : null;
}

/** RGBA FaceTime-window frame → base64 JPEG of just the caller's video, or null when no strip is found or given. */
export function cropToCallerVideo(frame, { strip = findCallerStrip(frame), quality = 75 } = {}) {
  if (!strip) return null;
  const { data, width, height } = frame;
  const src = createCanvas(width, height);
  src.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width, height), 0, 0);
  const top = Math.round(height * TOP_CUT), bottom = Math.round(height * BOTTOM_CUT);
  const out = createCanvas(strip.width, bottom - top);
  out.getContext('2d').drawImage(src, strip.x, top, strip.width, bottom - top, 0, 0, strip.width, bottom - top);
  return out.encodeSync('jpeg', quality).toString('base64');
}

/**
 * One per call. FaceTime frames are cropped; the strip stays put within a call, so a frame where it can't be
 * measured (a very dark scene) reuses the last one. Frames from any other camera (plain LiveKit room) pass through.
 * Returns null rather than ever sending an uncropped FaceTime frame.
 */
export function makeCallerEncoder() {
  let strip = null;
  return frame => {
    if (!frame.facetime) return toJpegBase64(frame);
    strip = findCallerStrip(frame) ?? strip;
    return cropToCallerVideo(frame, { strip });
  };
}

const FACETIME_VIDEO = 'facetime-remote-video';

/**
 * Feeds the caller's video into `buffer`. Register before joining the room (Chert's rule).
 * Prefers FaceTime's `facetime-remote-video` track; in a plain LiveKit room it takes any remote camera.
 * On mute, unsubscribe or track replacement the buffer is cleared, so no stale frame is ever checked.
 */
export function attachCallerVideo(room, buffer, { log = console.log, onFirstFrame } = {}) {
  let current = null; // { sid, reader }
  const stop = () => {
    if (current) { current.reader.cancel().catch(() => {}); current = null; }
    buffer.clear();
  };
  const consume = async (track, publication, participant, facetime) => {
    stop();
    const reader = new VideoStream(track).getReader();
    current = { sid: publication.sid, reader };
    log(`[frames] caller video: ${publication.name || '(unnamed)'} from ${participant.identity}`);
    let first = true;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (buffer.now() - buffer.lastSampleAt < buffer.sampleMs) continue; // skip the RGBA conversion
        const rgba = value.frame.convert(VideoBufferType.RGBA);
        buffer.offer({ data: rgba.data, width: rgba.width, height: rgba.height, facetime });
        if (first) { first = false; onFirstFrame?.(rgba); }
      }
    } catch (error) { log(`[frames] stream ended: ${error.message}`); }
  };
  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    if (track.kind !== TrackKind.KIND_VIDEO) return;
    const isFaceTime = publication.name === FACETIME_VIDEO;
    if (current && !isFaceTime) return; // keep the FaceTime track once we have one
    void consume(track, publication, participant, isFaceTime);
  });
  const drop = (_track, publication) => { if (current && publication?.sid === current.sid) { log('[frames] caller video gone'); stop(); } };
  room.on(RoomEvent.TrackUnsubscribed, drop);
  room.on(RoomEvent.TrackMuted, (publication) => { if (current && publication?.sid === current.sid) { log('[frames] caller video muted'); buffer.clear(); } });
  return stop;
}
