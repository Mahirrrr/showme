// Turns what the seller said into the 4-digit code, e.g. "it's four eight two seven" → "4827".
const WORDS = {
  zero: '0', oh: '0', o: '0', one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9',
};

/** Returns the first run of exactly 4 digits spoken in `transcript`, or null. */
export function parseCode(transcript) {
  const tokens = String(transcript || '').toLowerCase().match(/[a-z]+|\d+/g) || [];
  let run = '';
  for (const token of tokens) {
    const digits = /^\d+$/.test(token) ? token : WORDS[token];
    if (digits === undefined) {
      if (run.length === 4) return run;
      run = '';
      continue;
    }
    run += digits;
    if (run.length > 4 && /^\d+$/.test(token) && token.length === 4) run = token;
  }
  return run.length === 4 ? run : null;
}
