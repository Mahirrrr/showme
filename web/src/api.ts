// The only place the web app talks to the API (shared/contract.md).
// VITE_MOCK=1 serves shared/mock_request.json instead of fetching.
//   /v/<token>?state=awaiting_seller|in_call|complete|complete_recording|expired
//   /v/<token>?state=demo   plays awaiting -> in_call (results tick in) -> complete
//   Test suggestions always hit /api/tests/suggest on vision/ (Gemini when it has a key).
import { catalog, guessCategory } from './lib/catalog'
import type {
  CreateRequestBody,
  CreateResponse,
  RequestView,
  SuggestBody,
  SuggestResponse,
} from './types'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch('/api' + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = typeof body?.detail === 'string' ? body.detail : detail
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, detail)
  }
  return res.json() as Promise<T>
}

export async function getRequest(token: string): Promise<RequestView> {
  if (import.meta.env.VITE_MOCK === '1') return mockGet()
  return request<RequestView>('/requests/' + encodeURIComponent(token))
}

export interface CreateResult extends CreateResponse {
  /** true when the server only took contract v3 test ids, so the standard tests were used */
  usedStandardTests?: boolean
}

/**
 * Sends full test objects (proposed contract v4). Until vision/ accepts them it
 * answers 422; then we retry once with the category's standard test ids (v3)
 * and flag it, so the page can say so instead of pretending Gemini's tests ran.
 * vision/ supports v4 since wan/vision-v4; the retry only matters against an old v3 server.
 */
export async function createRequest(body: CreateRequestBody): Promise<CreateResult> {
  if (import.meta.env.VITE_MOCK === '1') return mockCreate()
  try {
    return await request<CreateResponse>('/requests', { method: 'POST', body: JSON.stringify(body) })
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 422) throw err
    const v3 = { ...body, tests: catalog[body.category].map((t) => t.id) }
    const res = await request<CreateResponse>('/requests', { method: 'POST', body: JSON.stringify(v3) })
    return { ...res, usedStandardTests: true }
  }
}

/**
 * Gemini picks the 6 best tests for this exact item. vision/ serves it
 * (contract v4) and holds the key; the browser never sees it. If the call fails we fall back to the standard
 * list from shared/tests.json and say so (source: "catalog").
 */
export async function suggestTests(body: SuggestBody): Promise<SuggestResponse> {
  try {
    return await request<SuggestResponse>('/tests/suggest', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  } catch {
    const category = body.category ?? guessCategory(body.item_name)
    const used = new Set([...(body.keep ?? []).flatMap((t) => [t.id, t.label]), ...(body.exclude ?? [])])
    const count = body.count ?? 6 - (body.keep?.length ?? 0)
    const tests = catalog[category].filter((t) => !used.has(t.id) && !used.has(t.label)).slice(0, count)
    return { category, tests: structuredClone(tests), source: 'catalog' }
  }
}

// ---------- mock mode (dynamic import keeps the JSON out of production builds) ----------

type MockFile = Record<string, unknown>
let mockFile: Promise<MockFile> | null = null
const loadMock = () =>
  (mockFile ??= import('../../shared/mock_request.json').then((m) => m.default as MockFile))

const demoStart = Date.now()
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function mockGet(): Promise<RequestView> {
  await wait(250)
  const mock = await loadMock()
  const state = new URLSearchParams(window.location.search).get('state') ?? 'awaiting_seller'
  if (state === 'demo') return demoState(mock)
  const view = mock[state] as RequestView | undefined
  if (!view) throw new ApiError(404, `No mock state "${state}"`)
  return structuredClone(view)
}

/** A timed run through the states so the live view can be watched without a call. */
function demoState(mock: MockFile): RequestView {
  const s = (Date.now() - demoStart) / 1000
  const awaiting = mock.awaiting_seller as RequestView
  const complete = mock.complete as RequestView
  if (s < 6) return structuredClone(awaiting)
  const step = 3 // seconds per check
  const done = Math.floor((s - 6) / step)
  if (done >= complete.results.length) return structuredClone(complete)
  const next = complete.results[done]
  return {
    ...structuredClone(complete),
    status: 'in_call',
    summary: null,
    verified_at: null,
    results: structuredClone(complete.results.slice(0, done)),
    current_challenge: { prompt: next.prompt, attempt: 1 },
  }
}

async function mockCreate(): Promise<CreateResponse> {
  await wait(500)
  const mock = await loadMock()
  const res = structuredClone(mock.create_response as CreateResponse)
  res.link_url = `${window.location.origin}/v/${res.token}?state=demo`
  return res
}
