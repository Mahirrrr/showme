import catalogJson from '../../../shared/tests.json'
import type { Category, TestSpec } from '../types'

/** shared/tests.json: the fallback when Gemini suggestions aren't available. */
export const catalog = catalogJson as Record<Category, TestSpec[]>

const KEYWORDS: [Category, RegExp][] = [
  ['phone', /\b(i ?phone|phone|galaxy|pixel|android|smartphone)\b/i],
  ['laptop', /\b(laptop|macbook|notebook|thinkpad|chromebook|xps|surface)\b/i],
  ['console', /\b(ps[1-5]|playstation|xbox|switch|nintendo|console|controller|joy-?con|steam deck)\b/i],
]

/** Rough category from the item name, only used for the offline fallback. */
export function guessCategory(itemName: string): Category {
  return KEYWORDS.find(([, re]) => re.test(itemName))?.[0] ?? 'other'
}
