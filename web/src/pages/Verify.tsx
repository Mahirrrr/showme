import type { ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { CATEGORY_LABEL, formatLine, formatWhen } from '../lib/format'
import { bannerFor, type BannerTone } from '../lib/report'
import { useRequestPoll } from '../lib/useRequestPoll'
import type { CheckResult, RequestView } from '../types'
import { buttonPrimary, buttonSecondary, Card, Page, Spinner, VerdictBadge } from '../components/ui'

// One URL for buyer and seller: the page changes by status, not by who is looking.
export default function Verify() {
  const { token = '' } = useParams()
  const poll = useRequestPoll(token)

  return (
    <Page>
      {poll.kind === 'loading' && <Spinner label="Loading the check…" />}
      {poll.kind === 'offline' && <Spinner label="Can't reach ShowMe, retrying…" />}
      {poll.kind === 'not_found' && (
        <Message title="Check not found" body="This link doesn't match any check. Ask the buyer to send it again." />
      )}
      {poll.kind === 'ready' && (
        <>
          {poll.offline && (
            <p className="mb-3 rounded-xl bg-unv-soft px-4 py-2 text-sm text-unv" role="status">
              Can't reach ShowMe, retrying…
            </p>
          )}
          <View view={poll.view} />
        </>
      )}
    </Page>
  )
}

function View({ view }: { view: RequestView }) {
  switch (view.status) {
    case 'awaiting_seller':
      return <Awaiting view={view} />
    case 'in_call':
      return <InCall view={view} />
    case 'complete':
      return <Report view={view} />
    case 'expired':
      return <Message title="This check has expired" body="Links last 24 hours. The buyer can make a new one in a minute." />
  }
}

function ItemHeader({ view, eyebrow }: { view: RequestView; eyebrow: ReactNode }) {
  return (
    <div className="mb-5 mt-2">
      <div className="mb-2 text-sm font-medium text-muted">{eyebrow}</div>
      <h1 className="text-[28px] leading-tight font-semibold tracking-tight wrap-break-word">{view.item_name}</h1>
      <p className="mt-1 text-sm text-muted">
        {CATEGORY_LABEL[view.category] ?? view.category}
        {view.listing_url && (
          <>
            {' · '}
            <a href={view.listing_url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
              listing
            </a>
          </>
        )}
      </p>
    </div>
  )
}

// ---------- awaiting_seller ----------

function Awaiting({ view }: { view: RequestView }) {
  const code = view.code ?? '····'
  return (
    <>
      <ItemHeader view={view} eyebrow="A buyer wants to see it working" />

      <Card>
        <p className="text-sm font-medium text-muted">Your code</p>
        <p
          className="mt-1 font-mono text-[56px] leading-none font-semibold tracking-[0.18em] tabular-nums"
          aria-label={`Code ${code.split('').join(' ')}`}
        >
          {code}
        </p>
        <a href={`facetime:${view.line_number}`} className={`${buttonPrimary} mt-5 bg-pass`}>
          <VideoIcon /> FaceTime ShowMe
        </a>
        <p className="mt-2 text-center text-xs text-faint">{formatLine(view.line_number)}</p>
      </Card>

      <Card className="mt-3">
        <h2 className="font-semibold">How it works (about 2 minutes)</h2>
        <ol className="mt-3 space-y-3 text-[15px]">
          {[
            'Tap FaceTime ShowMe and point your camera at the item.',
            'Say your 4-digit code when asked.',
            'Follow each prompt. Expect a couple of quick surprise requests too.',
          ].map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-page text-xs font-semibold">
                {i + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </Card>

      {view.tests.length > 0 && (
        <Card className="mt-3">
          <h2 className="font-semibold">The buyer asked to see</h2>
          <ul className="mt-3 divide-y divide-line">
            {view.tests.map((t) => (
              <li key={t.id} className="py-2.5 text-[15px]">
                {t.label}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-6 rounded-2xl border border-dashed border-line p-4 text-center">
        <p className="text-sm text-muted">Buyer? Keep this page open. It turns into the live report.</p>
        {view.code && (
          <a href={watchSmsHref(view.line_number, view.code)} className={`${buttonSecondary} mt-3`}>
            <MessageIcon /> Text me the result
          </a>
        )}
      </div>
    </>
  )
}

// ---------- in_call ----------

function InCall({ view }: { view: RequestView }) {
  // vision/ keeps current_challenge on the last submitted check until the next
  // one starts, so hide it once that same check (same attempt) already has a result.
  const cur = view.current_challenge
  const done = cur && view.results.some((r) => r.prompt === cur.prompt && r.attempts >= cur.attempt)
  const ch = done ? null : cur
  return (
    <>
      <ItemHeader
        view={view}
        eyebrow={
          <span className="inline-flex items-center gap-2 font-semibold text-fail">
            <span className="size-2 animate-live-dot rounded-full bg-fail" /> Live now
          </span>
        }
      />

      {ch && (
        <Card className="border-ink/10 bg-ink text-white" key={ch.prompt + ch.attempt}>
          <div className="animate-row-in">
            <p className="text-sm text-white/60">
              Checking now{ch.attempt > 1 ? ` · try ${ch.attempt}` : ''}
            </p>
            <p className="mt-1 text-xl leading-snug font-semibold">{ch.prompt}</p>
          </div>
        </Card>
      )}

      <ResultList results={view.results} emptyText="Results appear here as each check finishes." />
    </>
  )
}

// ---------- complete ----------

const BANNER_STYLE: Record<BannerTone, string> = {
  fail: 'bg-fail text-white',
  pass: 'bg-pass text-white',
  unv: 'bg-unv-soft text-unv',
}

function Report({ view }: { view: RequestView }) {
  const banner = bannerFor(view)
  return (
    <>
      <ItemHeader view={view} eyebrow="ShowMe report" />

      <section className={`animate-row-in rounded-2xl p-5 ${BANNER_STYLE[banner.tone]}`} role="status">
        <p className="text-xl leading-snug font-semibold">{banner.title}</p>
        <p className="mt-1 text-[15px] opacity-85">{banner.detail}</p>
      </section>

      <ResultList results={view.results} emptyText="No checks were recorded." />

      {view.verified_at && (
        <p className="mt-5 text-center text-sm text-muted">Checked live on {formatWhen(view.verified_at)}</p>
      )}
      <p className="mt-1 text-center text-xs text-faint">
        Judged by AI from the video call. "Unverified" means the camera couldn't show it.
      </p>
    </>
  )
}

// ---------- shared pieces ----------

function ResultList({ results, emptyText }: { results: CheckResult[]; emptyText: string }) {
  if (results.length === 0) {
    return <p className="mt-3 rounded-2xl border border-dashed border-line p-5 text-center text-sm text-muted">{emptyText}</p>
  }
  return (
    <ul className="mt-3 space-y-2">
      {results.map((r, i) => (
        <ResultRow key={`${i}-${r.prompt}`} r={r} />
      ))}
    </ul>
  )
}

function ResultRow({ r }: { r: CheckResult }) {
  return (
    <li className="flex animate-row-in gap-3 rounded-2xl border border-line bg-card p-3">
      {r.thumb_url ? (
        <img
          src={r.thumb_url}
          alt=""
          loading="lazy"
          className="size-18 shrink-0 rounded-xl bg-page object-cover"
        />
      ) : (
        <div className="size-18 shrink-0 rounded-xl bg-page" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 text-[15px] leading-snug font-medium wrap-break-word">{r.prompt}</p>
          <VerdictBadge verdict={r.result} />
        </div>
        <p className="mt-1 text-sm leading-snug text-muted wrap-break-word">{r.reason}</p>
        <p className="mt-1.5 text-xs text-faint">
          {r.kind === 'liveness' ? 'Surprise check' : r.kind === 'custom' ? "Buyer's own test" : 'Buyer test'}
          {r.attempts > 1 && ` · ${r.attempts} tries`}
        </p>
      </div>
    </li>
  )
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div className="py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mx-auto mt-2 max-w-xs text-muted">{body}</p>
    </div>
  )
}

/**
 * Opens Messages to the ShowMe line with "WATCH <code>" typed in. The agent
 * (agent/src/imessage.mjs) replies with the verdict when the call finishes.
 * "?&body=" works on both iOS (wants &body) and Android (wants ?body).
 */
function watchSmsHref(line: string, code: string) {
  return `sms:${line}?&body=${encodeURIComponent(`WATCH ${code}`)}`
}

function MessageIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
      <path d="M12 3C6.5 3 2 6.8 2 11.5c0 2.6 1.4 4.9 3.6 6.5-.2 1.2-.8 2.4-1.8 3.3 0 0 2.9.1 5.1-1.6 1 .3 2 .4 3.1.4 5.5 0 10-3.8 10-8.6S17.5 3 12 3Z" />
    </svg>
  )
}

function VideoIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="currentColor" aria-hidden>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h7A2.5 2.5 0 0 1 16 6.5v1.4l3.6-2.4A1 1 0 0 1 21 6.3v11.4a1 1 0 0 1-1.4.8L16 16.1v1.4a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 4 17.5v-11Z" />
    </svg>
  )
}
