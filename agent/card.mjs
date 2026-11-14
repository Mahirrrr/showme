// The agent's own video: one challenge card per state, rendered to RGBA for LiveKit's VideoSource.
import { createCanvas } from '@napi-rs/canvas';

export const WIDTH = 960;
export const HEIGHT = 540;
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

  g.fillStyle = COLORS.dim; g.font = '600 24px sans-serif'; g.textBaseline = 'top';
  g.fillText(step && total ? `Check ${step} of ${total}` : 'ShowMe', 48, 36);
  if (title) { g.textAlign = 'right'; g.fillText(title, WIDTH - 48, 36); g.textAlign = 'left'; }

  g.fillStyle = COLORS.ink; g.font = '700 56px sans-serif';
  const lines = wrapText(prompt, WIDTH - 96, t => g.measureText(t).width).slice(0, 4);
  const lineH = 68, top = (HEIGHT - lines.length * lineH) / 2 - 30;
  lines.forEach((l, i) => g.fillText(l, 48, top + i * lineH));

  const label = note || STATUS_TEXT[status] || '';
  if (label) {
    g.fillStyle = COLORS[status] || COLORS.info;
    g.fillRect(0, HEIGHT - 110, WIDTH, 70);
    g.fillStyle = '#ffffff'; g.font = '700 34px sans-serif'; g.textBaseline = 'middle';
    g.fillText(label, 48, HEIGHT - 75);
  }

  g.fillStyle = COLORS.dim; g.font = '500 18px sans-serif'; g.textBaseline = 'bottom';
  g.fillText('ShowMe · live check', 48, HEIGHT - 10);
  return new Uint8Array(g.getImageData(0, 0, WIDTH, HEIGHT).data.buffer);
}

/** Copies a card and adds a small blinking dot (top right), so a frozen picture is easy to spot. */
export function withPulse(card, tick) {
  const out = new Uint8Array(card);
  const on = Math.floor(tick / (FPS / 2)) % 2 === 0;
  const color = on ? [239, 68, 68] : [80, 30, 30];
  for (let y = 14; y < 26; y++) for (let x = WIDTH - 26; x < WIDTH - 14; x++) {
    const i = (y * WIDTH + x) * 4;
    out[i] = color[0]; out[i + 1] = color[1]; out[i + 2] = color[2]; out[i + 3] = 255;
  }
  return out;
}
