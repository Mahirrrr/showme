import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Verdict } from '../types'

export function Page({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-lg px-4 pb-12">
        <header className="flex h-14 items-center">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Logo />
            ShowMe
          </Link>
        </header>
        {children}
      </div>
    </div>
  )
}

export function Logo() {
  return (
    <span
      aria-hidden
      className="grid size-7 place-items-center rounded-lg bg-ink text-[13px] font-bold text-white"
    >
      <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.4">
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </span>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-card p-5 ${className}`}>{children}</section>
  )
}

const VERDICT_STYLE: Record<Verdict, { label: string; cls: string; icon: string }> = {
  passed: { label: 'Passed', cls: 'bg-pass-soft text-pass', icon: '✓' },
  failed: { label: 'Failed', cls: 'bg-fail-soft text-fail', icon: '✕' },
  unverified: { label: 'Unverified', cls: 'bg-unv-soft text-unv', icon: '?' },
}

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  const v = VERDICT_STYLE[verdict]
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${v.cls}`}
    >
      <span aria-hidden>{v.icon}</span>
      {v.label}
    </span>
  )
}

export function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-16 text-muted" role="status">
      <span className="size-4 animate-spin rounded-full border-2 border-line border-t-ink" />
      {label}
    </div>
  )
}

export const buttonPrimary =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-ink px-6 font-semibold text-white transition-transform duration-150 active:scale-[0.97] disabled:opacity-50 select-none'
export const buttonSecondary =
  'inline-flex h-12 w-full items-center justify-center gap-2 rounded-full border border-line bg-card px-6 font-semibold text-ink transition-transform duration-150 active:scale-[0.97] select-none'
