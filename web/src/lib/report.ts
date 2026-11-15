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
  const liveness = view.results.filter((x) => x.kind === 'liveness')
  return {
    passed: count('passed'),
    failed: count('failed'),
    unverified: count('unverified'),
    total: view.results.length,
    liveness: liveness.length === 0 ? 'not_run' : liveness.every(x => x.result === 'passed') ? 'passed' : 'failed',
  }
}

type ScoredSummary = Summary & Required<Pick<Summary,
  'overall_verdict' | 'pass_percentage' | 'passed_tests' | 'total_selected_tests' | 'passing_threshold_percent'>>

export function hasScore(summary: Summary): summary is ScoredSummary {
  return (summary.overall_verdict === 'passed' || summary.overall_verdict === 'failed') &&
    [summary.pass_percentage, summary.passed_tests, summary.total_selected_tests, summary.passing_threshold_percent]
      .every(value => typeof value === 'number' && Number.isFinite(value))
}

export function formatPercentage(value: number): string {
  return `${Number(value.toFixed(2))}%`
}

/** Warnings remain visible even when the selected-test threshold is met. */
export function reportWarning(view: RequestView): string | null {
  const summary = summarize(view)
  const warnings: string[] = []
  if (hasScore(summary) && summary.overall_verdict === 'passed' && (summary.failed > 0 || summary.unverified > 0)) {
    warnings.push(`The overall score passed, but ${summary.failed} check(s) failed and ${summary.unverified} were unverified. These individual checks did not pass. Review them before buying.`)
  }
  if (hasScore(summary) && summary.liveness === 'failed') {
    warnings.push('Historical liveness check failed: possible recording. The selected-test score does not remove this warning.')
  }
  return warnings.length ? warnings.join(' ') : null
}

/** Backend scores are authoritative. Old server responses retain their legacy banners. */
export function bannerFor(view: RequestView): Banner {
  const s = summarize(view)
  if (hasScore(s)) {
    return {
      tone: s.overall_verdict === 'passed' ? 'pass' : 'fail',
      title: `Overall ${s.overall_verdict.toUpperCase()}`,
      detail: `${s.passed_tests} / ${s.total_selected_tests} selected tests passed · ${formatPercentage(s.pass_percentage)} · Passing threshold ${formatPercentage(s.passing_threshold_percent)}`,
    }
  }
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
      title: s.liveness === 'not_run' ? 'All checks passed' : 'Verified live',
      detail: s.liveness === 'not_run' ? `All ${s.total} selected checks passed. No separate liveness test was run.` : `All ${s.total} checks passed on a live call.`,
    }
  }
  return {
    tone: 'unv',
    title: `${s.passed} passed · ${s.failed} failed · ${s.unverified} unverified`,
    detail: 'Read each check below before you pay.',
  }
}
