// Shapes from shared/contract.md (API contract v3). Keep in sync with that file only.

export type Category = 'console' | 'phone' | 'laptop' | 'other'
export type Status = 'awaiting_seller' | 'in_call' | 'complete' | 'expired'
export type Verdict = 'passed' | 'failed' | 'unverified'
export type CheckKind = 'buyer' | 'liveness' | 'custom'

export interface TestRef {
  id: string
  label: string
}

/** A full test: what the seller is asked (prompt) and what Gemini looks for (expect).
 *  Comes from shared/tests.json or from POST /api/tests/suggest. */
export interface TestSpec extends TestRef {
  prompt: string
  expect: string
}

/** POST /api/tests/suggest (PROPOSED, contract v4) */
export interface SuggestBody {
  item_name: string
  category?: Category
  /** Tests the buyer kept (checked). The answer never repeats them. */
  keep?: TestSpec[]
  /** Labels the buyer already dropped. The answer avoids them. */
  exclude?: string[]
  /** How many NEW tests to return (default 6 - keep.length). */
  count?: number
}
export interface SuggestResponse {
  category: Category
  /** Only the NEW tests (not the kept ones) */
  tests: TestSpec[]
  /** "gemini" when the model wrote them, "catalog" when it fell back to shared/tests.json */
  source: 'gemini' | 'catalog'
}

export interface CheckResult {
  prompt: string
  kind: CheckKind
  result: Verdict
  confidence: number
  reason: string
  attempts: number
  thumb_url?: string | null
}

export interface Summary {
  passed: number
  failed: number
  unverified: number
  total: number
  liveness: 'passed' | 'failed'
}

/** GET /api/requests/{token} */
export interface RequestView {
  status: Status
  item_name: string
  category: Category
  listing_url?: string | null
  /** The ShowMe FaceTime line, never the seller's number */
  line_number: string
  /** Only while status is awaiting_seller */
  code?: string
  tests: TestRef[]
  current_challenge?: { prompt: string; attempt: number } | null
  results: CheckResult[]
  summary?: Summary | null
  verified_at?: string | null
}

/** POST /api/requests body (PROPOSED v4: full test objects instead of test ids) */
export interface CreateRequestBody {
  item_name: string
  category: Category
  listing_url?: string
  tests: TestSpec[]
  custom_test?: string
}

/** POST /api/requests response */
export interface CreateResponse {
  request_id: string
  token: string
  code: string
  link_url: string
  line_number: string
  status: 'awaiting_seller'
  expires_at: string
}
