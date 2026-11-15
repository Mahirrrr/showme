// The agent's own video: one challenge card per state, rendered to RGBA for LiveKit's VideoSource.
// Style "Aegean": sea-blue field that turns olive on pass and red on fail, marble-white serif type,
// a Greek key band and Roman numerals (HackUTA 2026's Odyssey theme). Fonts are macOS system fonts.
import { createCanvas } from '@napi-rs/canvas';

// FaceTime's video on the Mac is 3:2. An iPhone in fill mode shows only a phone-shaped (9:19.5)
// center column of it; in fit mode it shows the whole frame. So the text lives in that column and
// the background, key band and big numerals stretch across the full width.
export const WIDTH = 1440;
export const HEIGHT = 960;
const P_W = 540, P_H = 1170; // design space for the column
const COLUMN_W = Math.round(HEIGHT * P_W / P_H / 2) * 2; // 444: even, about 9:19.5
export const COLUMN = { x: (WIDTH - COLUMN_W) / 2, width: COLUMN_W };
const SCALE = HEIGHT / P_H;
const M = 48; // side margin inside the column (design units)
export const FPS = 10;

const BG = {
  info: '#14306E', waiting: '#14306E', checking: '#2A2364',
  passed: '#2E5A2C', failed: '#8E2A1A', unverified: '#8A6512',
};
const MARBLE = '#F4F1EA';
const VERDICT = { passed: 'Passed', failed: 'Failed', unverified: 'Unclear' };
const FOOTER = { waiting: 'SHOW IT TO THE CAMERA', checking: 'CHECKING…' };
const SERIF = 'Baskerville, Georgia, serif';
const DISPLAY = 'Didot, Baskerville, Georgia, serif';

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];
export const roman = n => ROMAN[n] ?? String(n);

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

/** A running Greek key (meander) band from x0 to x1, top edge at y, unit u. */
function meander(g, x0, x1, y, u, color) {
  g.save();
  g.strokeStyle = color; g.lineWidth = Math.max(2, u * 0.6); g.lineJoin = 'miter'; g.lineCap = 'square';
  g.beginPath();
  g.moveTo(x0, y); g.lineTo(x1, y); g.moveTo(x0, y + u * 6); g.lineTo(x1, y + u * 6);
  g.stroke();
  const key = [[0, 5], [0, 1], [4, 1], [4, 4], [1.8, 4], [1.8, 2.6], [2.8, 2.6]];
  for (let x = x0; x < x1; x += u * 5) {
    g.beginPath();
    key.forEach(([a, b], i) => (i ? g.lineTo : g.moveTo).call(g, x + a * u, y + (b + 0.5) * u));
    g.stroke();
  }
  g.restore();
}

/**
 * Draws a card. `status` is one of info | waiting | checking | passed | failed | unverified.
 * Returns WIDTH × HEIGHT RGBA bytes.
 */
export function renderCard({ step, total, title = '', prompt = '', status = 'info', note = '' } = {}) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const g = canvas.getContext('2d');
  g.fillStyle = BG[status] || BG.info; g.fillRect(0, 0, WIDTH, HEIGHT);

  // Full width: the key band, and in fit mode the big step numerals either side of the column.
  meander(g, 0, WIDTH, 55 * SCALE, 10 * SCALE, 'rgba(244,241,234,0.85)');
  if (step && total) {
    g.fillStyle = 'rgba(244,241,234,0.10)'; g.font = `520px ${DISPLAY}`; g.textBaseline = 'middle';
    g.textAlign = 'right'; g.fillText(roman(step), COLUMN.x - 30, HEIGHT / 2 + 30);
    g.textAlign = 'left'; g.fillText(roman(total), COLUMN.x + COLUMN.width + 30, HEIGHT / 2 + 30);
  }

  // The column, in 540 × 1170 design units.
  g.save(); g.translate(COLUMN.x, 0); g.scale(SCALE, SCALE);
  g.textBaseline = 'alphabetic'; g.textAlign = 'left'; g.fillStyle = MARBLE;
  const measure = t => g.measureText(t).width, maxW = P_W - 2 * M;

  g.globalAlpha = 0.8; g.font = `24px ${DISPLAY}`;
  g.fillText(step && total ? `CHECK ${step} OF ${total}` : 'SHOWME · LIVE CHECK', M, 230);
  if (title) { g.font = `italic 30px ${SERIF}`; g.fillText(wrapText(title, maxW, measure)[0] ?? '', M, 272); }
  g.globalAlpha = 1;

  const verdict = VERDICT[status];
  if (verdict) {
    g.font = `118px ${DISPLAY}`; g.fillText(verdict, M - 8, 630);
    let y = 700;
    if (note) { g.font = `30px ${DISPLAY}`; wrapText(note, maxW, measure).slice(0, 2).forEach(l => { g.fillText(l, M, y); y += 42; }); y += 8; }
    g.globalAlpha = 0.85; g.font = `italic 32px ${SERIF}`;
    wrapText(prompt, maxW, measure).slice(0, 4).forEach(l => { g.fillText(l, M, y); y += 42; });
    g.globalAlpha = 1;
  } else {
    g.font = `68px ${SERIF}`;
    const lines = wrapText(prompt, maxW, measure).slice(0, 6), lh = 76;
    const top = 580 - (lines.length * lh) / 2 + 40;
    lines.forEach((l, i) => g.fillText(l, M - 2, top + i * lh));
    const footer = note || FOOTER[status];
    if (footer) {
      // A hint can be a sentence: wrap it (up to 3 lines) instead of running off the column.
      g.font = `${note ? 28 : 24}px ${DISPLAY}`;
      wrapText(note ? footer : footer.toUpperCase(), maxW, measure).slice(0, 3).forEach((l, i) => g.fillText(l, M, 900 + i * 38));
    }
  }
  g.restore();
  return new Uint8Array(g.getImageData(0, 0, WIDTH, HEIGHT).data.buffer);
}

/** Copies a card and adds a small blinking dot (top right of the column), so a frozen picture is easy to spot. */
export function withPulse(card, tick) {
  const out = new Uint8Array(card);
  const on = Math.floor(tick / (FPS / 2)) % 2 === 0;
  const color = on ? [244, 241, 234] : [120, 120, 130];
  const px0 = COLUMN.x + COLUMN.width - Math.round(M * SCALE), py0 = Math.round(212 * SCALE);
  for (let y = py0; y < py0 + 10; y++) for (let x = px0 - 10; x < px0; x++) {
    const i = (y * WIDTH + x) * 4;
    out[i] = color[0]; out[i + 1] = color[1]; out[i + 2] = color[2]; out[i + 3] = 255;
  }
  return out;
}
