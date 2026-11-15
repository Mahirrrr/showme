import type { TestSpec } from '../types'

/** A check runs 2 to 5 buyer tests. The buyer's own test is one of them and counts like any other. */
export const MIN_TESTS = 2
export const MAX_TESTS = 5

export function canSubmitSelection(count: number): boolean {
  return Number.isInteger(count) && count >= MIN_TESTS && count <= MAX_TESTS
}

export type SelectionTone = 'need' | 'ok' | 'full'

export function selectionTone(count: number): SelectionTone {
  if (count < MIN_TESTS || count > MAX_TESTS) return 'need'
  return count === MAX_TESTS ? 'full' : 'ok'
}

export function selectionMessage(count: number): string {
  const head = `${count} of ${MAX_TESTS} selected`
  if (count < MIN_TESTS) return `${head} · pick ${MIN_TESTS - count} more`
  if (count > MAX_TESTS) return `${head} · untick ${count - MAX_TESTS}`
  return count === MAX_TESTS ? `${head} · maximum reached` : `${head} · ready`
}

// Limits match vision's TestSpec model (id and label 40, prompt and expect 200).
const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`

// Vision re-slugs ids to 32 chars, so "own_" + 24 + "_N" stays under that and never collides there.
function slug(text: string): string {
  const s = text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (s.length <= 24) return s || 'test'
  const cut = s.slice(0, 24)
  return cut.includes('_') ? cut.slice(0, cut.lastIndexOf('_')) : cut
}

/** Turns the buyer's free text into a normal test, so it counts toward the minimum and the score. */
export function ownTest(text: string, takenIds: Set<string>): TestSpec | null {
  const words = text.trim().replace(/\s+/g, ' ')
  if (!words) return null
  let id = `own_${slug(words)}`
  for (let n = 2; takenIds.has(id); n++) id = `own_${slug(words)}_${n}`
  return {
    id,
    label: clip(words, 40),
    prompt: clip(words, 200),
    expect: clip(`The video clearly shows this request done: ${words}`, 200),
  }
}
