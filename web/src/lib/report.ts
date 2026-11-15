import type { CheckResult, RequestView, Summary } from '../types'

export type BannerTone = 'fail' | 'pass' | 'unv'

export interface Banner {
  tone: BannerTone
  title: string
  detail: string
}

/** Use the server's summary when present, otherwise count the results. */
export function summarize(view: RequestView): Summary {
  if (view.summary) return view.summary
  const count = (r: CheckResult['result']) => view.results.filter((x) => x.result === r).length
  const livenessFailed = view.results.some((x) => x.kind === 'liveness' && x.result === 'failed')
  return {
    passed: count('passed'),
    failed: count('failed'),
    unverified: count('unverified'),
    total: view.results.length,
    liveness: livenessFailed ? 'failed' : 'passed',
  }
}

/**
 * ARCHITECTURE.md §6 banner rules, in order:
 * 1. liveness failed -> red "possible recording", whatever else passed
 * 2. everything passed -> green "Verified live"
 * 3. otherwise -> amber counts
 */
export function bannerFor(view: RequestView): Banner {
  const s = summarize(view)
  const livenessFailed =
    s.liveness === 'failed' ||
    view.results.some((x) => x.kind === 'liveness' && x.result === 'failed')

  if (livenessFailed) {
    return {
      tone: 'fail',
      title: 'Live check failed: possible recording',
      detail: "The seller didn't respond to a surprise request. Treat the whole video as untrusted.",
    }
  }
  if (s.total > 0 && s.passed === s.total) {
    return {
      tone: 'pass',
      title: 'Verified live',
      detail: `All ${s.total} checks passed on a live call.`,
    }
  }
  return {
    tone: 'unv',
    title: `${s.passed} passed · ${s.failed} failed · ${s.unverified} unverified`,
    detail: 'Read each check below before you pay.',
  }
}
