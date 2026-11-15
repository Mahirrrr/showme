// The agent's own video: one challenge card per state, rendered to RGBA for LiveKit's VideoSource.
import { createCanvas } from '@napi-rs/canvas';

// Portrait, about iPhone-shaped (9:19.5): FaceTime fills the phone screen, so a landscape card loses its sides.
export const WIDTH = 540;
export const HEIGHT = 1170;
const M = 56; // side margin, wide enough to survive a small crop
export const FPS = 10;

const COLORS = {
  bg: '#0f1419', panel: '#1b232c', ink: '#f5f7fa', dim: '#9aa7b4',
  info: '#3b82f6', waiting: '#3b82f6', checking: '#a78bfa',
  passed: '#22c55e', failed: '#ef4444', unverified: '#f59e0b',
};
const STATUS_TEXT = {
  info: '', waiting: 'Show it to the camera', checking: 'Checking…',
  passed: 'Passed', failed: 'Failed', unverified: 'Unverified', // no ✓/✗: the system font may lack them
};

/** Splits text into lines no wider than maxWidth, using measure(text) → px. */
export function wrapText(text, maxWidth, measure) {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > maxWidth) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Draws a card. `status` is one of info | waiting | checking | passed | failed | unverified.
 * Returns WIDTH × HEIGHT RGBA bytes.
 */
export function renderCard({ step, total, title = '', prompt = '', status = 'info', note = '' } = {}) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const g = canvas.getContext('2d');
  g.fillStyle = COLORS.bg; g.fillRect(0, 0, WIDTH, HEIGHT);

  // Header: step, then the item name on its own line (FaceTime's own buttons cover the very top).
  g.textBaseline = 'top';
  g.fillStyle = COLORS.dim; g.font = '600 28px sans-serif';
  g.fillText(step && total ? `Check ${step} of ${total}` : 'ShowMe', M, 150);
  if (title) {
    g.fillStyle = COLORS.ink; g.font = '600 30px sans-serif';
    g.fillText(wrapText(title, WIDTH - 2 * M, t => g.measureText(t).width)[0] ?? '', M, 192);
  }

  // The challenge, big and centered vertically.
  g.fillStyle = COLORS.ink; g.font = '700 52px sans-serif';
  const lines = wrapText(prompt, WIDTH - 2 * M, t => g.measureText(t).width).slice(0, 8);
  const lineH = 64, top = (HEIGHT - lines.length * lineH) / 2 - 40;
  lines.forEach((l, i) => g.fillText(l, M, top + i * lineH));

  // Status bar, above FaceTime's bottom controls.
  const label = note || STATUS_TEXT[status] || '';
  if (label) {
    g.fillStyle = COLORS[status] || COLORS.info;
    g.fillRect(0, HEIGHT - 330, WIDTH, 90);
    g.fillStyle = '#ffffff'; g.font = '700 36px sans-serif'; g.textBaseline = 'middle';
    g.fillText(label, M, HEIGHT - 285);
  }

  g.fillStyle = COLORS.dim; g.font = '500 22px sans-serif'; g.textBaseline = 'top';
  g.fillText('ShowMe · live check', M, HEIGHT - 220);
  return new Uint8Array(g.getImageData(0, 0, WIDTH, HEIGHT).data.buffer);
}

/** Copies a card and adds a small blinking dot (top right), so a frozen picture is easy to spot. */
export function withPulse(card, tick) {
  const out = new Uint8Array(card);
  const on = Math.floor(tick / (FPS / 2)) % 2 === 0;
  const color = on ? [239, 68, 68] : [80, 30, 30];
  for (let y = 156; y < 172; y++) for (let x = WIDTH - M - 16; x < WIDTH - M; x++) {
    const i = (y * WIDTH + x) * 4;
    out[i] = color[0]; out[i + 1] = color[1]; out[i + 2] = color[2]; out[i + 3] = 255;
  }
  return out;
}
