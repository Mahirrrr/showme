import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Verdict } from '../types'

export function Page({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto w-full max-w-lg px-4 pb-12">
        <header className="pt-3">
          <div className="flex h-12 items-center">
            <Link to="/" className="flex items-center gap-2 font-display text-lg tracking-[0.18em] uppercase">
              <Logo />
              ShowMe
            </Link>
          </div>
          <div aria-hidden className="meander mb-2" />
        </header>
        {children}
      </div>
    </div>
  )
}

export function Logo() {
  return (
    // Same mark as public/favicon.svg: a video-call camera with a check.
    <svg aria-hidden viewBox="0 0 64 64" className="size-7 shrink-0">
      <rect width="64" height="64" rx="15" fill="#14306e" />
      <rect x="9" y="19" width="32" height="26" rx="7" fill="#fff" />
      <path d="M41 28l13-8v24l-13-8z" fill="#c9a24e" />
      <path
        d="M17 32l5 5 10-11"
        fill="none"
        stroke="#14306e"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
