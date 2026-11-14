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
  const consume = async (track, publication, participant) => {
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
        buffer.offer({ data: rgba.data, width: rgba.width, height: rgba.height });
        if (first) { first = false; onFirstFrame?.(rgba); }
      }
    } catch (error) { log(`[frames] stream ended: ${error.message}`); }
  };
  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    if (track.kind !== TrackKind.KIND_VIDEO) return;
    const isFaceTime = publication.name === FACETIME_VIDEO;
    if (current && !isFaceTime) return; // keep the FaceTime track once we have one
    void consume(track, publication, participant);
  });
  const drop = (_track, publication) => { if (current && publication?.sid === current.sid) { log('[frames] caller video gone'); stop(); } };
  room.on(RoomEvent.TrackUnsubscribed, drop);
  room.on(RoomEvent.TrackMuted, (publication) => { if (current && publication?.sid === current.sid) { log('[frames] caller video muted'); buffer.clear(); } });
  return stop;
}
