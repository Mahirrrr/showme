import { QRCodeSVG } from 'qrcode.react'
import { useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { createRequest, suggestTests, type CreateResult } from '../api'
import { guessCategory } from '../lib/catalog'
import { CATEGORY_LABEL } from '../lib/format'
import type { SuggestResponse } from '../types'
import { buttonPrimary, buttonSecondary, Card, Page } from '../components/ui'

const input =
  'mt-1.5 block h-12 w-full rounded-xl border border-line bg-card px-4 outline-none transition-colors focus:border-ink'

export default function NewCheck() {
  const [itemName, setItemName] = useState('')
  const [suggestion, setSuggestion] = useState<SuggestResponse | null>(null)
  const [suggestedFor, setSuggestedFor] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [customTest, setCustomTest] = useState('')
  const [listingUrl, setListingUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreateResult | null>(null)
  const [swapping, setSwapping] = useState(false)
  const [rejected, setRejected] = useState<string[]>([]) // labels dropped so far, never suggested again
  const [fresh, setFresh] = useState<Set<string>>(new Set()) // ids that just arrived ("New" tag)
  const [notice, setNotice] = useState<string | null>(null)
  const latest = useRef(0) // ignore answers from older suggest calls

  const name = itemName.trim()
  const stale = suggestion !== null && name !== suggestedFor

  const suggest = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!name || suggesting) return
    const call = ++latest.current
    setSuggesting(true)
    setError(null)
    const res = await suggestTests({ item_name: name, category: guessCategory(name) })
    if (call !== latest.current) return
    setSuggestion(res)
    setSuggestedFor(name)
    setSelected(new Set(res.tests.map((t) => t.id)))
    setRejected([])
    setFresh(new Set())
    setNotice(null)
    setSuggesting(false)
  }

  // Keep the checked tests, ask Gemini for new ones in place of the unchecked.
  const unchecked = suggestion?.tests.filter((t) => !selected.has(t.id)) ?? []
  const swap = async () => {
    if (!suggestion || unchecked.length === 0 || swapping) return
    const keep = suggestion.tests.filter((t) => selected.has(t.id))
    const exclude = [...new Set([...rejected, ...unchecked.map((t) => t.label)])].slice(-40)
    const call = ++latest.current
    setSwapping(true)
    setNotice(null)
    const res = await suggestTests({
      item_name: suggestedFor,
      category: suggestion.category,
      keep,
      exclude,
      count: unchecked.length,
    })
    if (call !== latest.current) return

    // New tests go into the unchecked slots; a slot with no replacement keeps its old test.
    const queue = [...res.tests]
    const ids = new Set(keep.map((t) => t.id))
    const added: string[] = []
    const tests = suggestion.tests.map((t) => {
      if (selected.has(t.id)) return t
      const next = queue.shift()
      if (!next) return t
      let id = next.id
      while (ids.has(id)) id += '_2'
      ids.add(id)
      added.push(id)
      return { ...next, id }
    })

    setSuggestion({ ...suggestion, tests, source: res.source === 'catalog' ? 'catalog' : suggestion.source })
    setRejected(exclude)
    setFresh(new Set(added))
    setSelected((prev) => new Set([...prev, ...added]))
    if (added.length === 0) setNotice('No new tests left to suggest. Add your own below.')
    else if (added.length < unchecked.length) setNotice(`Only ${added.length} new test${added.length === 1 ? '' : 's'} found.`)
    else if (res.source === 'catalog') setNotice("Couldn't reach AI, so these come from the standard list.")
    setSwapping(false)
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const custom = customTest.trim()
  const canCreate =
    suggestion !== null && !stale && !suggesting && !swapping && !busy && (selected.size > 0 || custom.length > 0)

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (!canCreate || !suggestion) return
    setBusy(true)
    setError(null)
    try {
      const res = await createRequest({
        item_name: name,
        category: suggestion.category,
        tests: suggestion.tests.filter((t) => selected.has(t.id)),
        ...(custom && { custom_test: custom }),
        ...(listingUrl.trim() && { listing_url: listingUrl.trim() }),
      })
      setCreated(res)
      window.scrollTo({ top: 0 })
    } catch {
      setError("Couldn't create the check. Try again in a moment.")
    } finally {
      setBusy(false)
    }
  }

  if (created) return <Created res={created} itemName={name} />

  return (
    <Page>
      <h1 className="mt-2 text-[28px] leading-tight font-semibold tracking-tight">New check</h1>
      <p className="mt-1 text-muted">Tell us what you're buying. AI picks the tests that prove it works.</p>

      <form onSubmit={suggest} className="mt-6">
        <label className="block">
          <span className="text-sm font-medium">What are you buying?</span>
          <input
            className={input}
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
            placeholder="PS5 DualSense controller"
            maxLength={80}
            autoComplete="off"
            enterKeyHint="go"
            required
          />
        </label>
        {(suggestion === null || stale) && (
          <button type="submit" className={`${buttonPrimary} mt-3`} disabled={!name || suggesting}>
            {suggesting ? 'Picking tests…' : stale ? 'Update tests for this item' : 'Suggest tests'}
          </button>
        )}
      </form>

      {suggesting && <TestSkeleton itemName={name} />}

      {suggestion && !suggesting && (
        <form onSubmit={create} className={`mt-6 space-y-6 transition-opacity ${stale ? 'opacity-40' : ''}`}>
          <fieldset disabled={stale}>
            <div className="flex items-end justify-between gap-3">
              <legend className="min-w-0 text-sm font-medium">
                Tests for <span className="wrap-break-word">{suggestedFor}</span>
                <span className="block text-xs font-normal text-faint">
                  {CATEGORY_LABEL[suggestion.category] ?? suggestion.category} ·{' '}
                  {suggestion.source === 'gemini' ? 'picked by Gemini' : 'standard list (AI suggestions unavailable)'}
                </span>
              </legend>
              <button
                type="button"
                onClick={swap}
                disabled={unchecked.length === 0 || swapping}
                className="shrink-0 rounded-full px-3 py-1.5 text-sm font-medium text-accent active:bg-line/60 disabled:text-faint"
              >
                {swapping
                  ? 'Finding…'
                  : unchecked.length > 0
                    ? `Swap ${unchecked.length} for new`
                    : 'Suggest again'}
              </button>
            </div>
            <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
              {suggestion.tests.map((t, i) => (
                <li
                  key={t.id}
                  className={`animate-row-in transition-opacity ${swapping && !selected.has(t.id) ? 'animate-pulse opacity-40' : ''}`}
                  style={{ animationDelay: `${fresh.has(t.id) ? 0 : i * 40}ms` }}
                >
                  <label className="flex cursor-pointer items-start gap-3 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(t.id)}
                      onChange={() => toggle(t.id)}
                      className="mt-0.5 size-5 shrink-0 accent-ink"
                    />
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 font-medium wrap-break-word">
                        {t.label}
                        {fresh.has(t.id) && (
                          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">
                            New
                          </span>
                        )}
                      </span>
                      <span className="block text-sm text-muted wrap-break-word">{t.prompt}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {notice && (
              <p className="mt-2 rounded-lg bg-unv-soft px-3 py-2 text-xs text-unv" role="status">
                {notice}
              </p>
            )}
            <p className="mt-2 text-xs text-faint">
              {unchecked.length === 0
                ? 'Uncheck any test you don\'t want, then swap it for a new one. Checked tests stay.'
                : `Checked tests stay. ${unchecked.length} unchecked will be replaced.`}{' '}
              ShowMe also adds 1 or 2 secret surprise checks, so a recorded video can't pass.
            </p>
          </fieldset>

          <label className="block">
            <span className="text-sm font-medium">
              Your own test <span className="font-normal text-faint">(optional)</span>
            </span>
            <input
              className={input}
              value={customTest}
              onChange={(e) => setCustomTest(e.target.value)}
              placeholder="Show the charging port up close"
              maxLength={140}
              autoComplete="off"
              disabled={stale}
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">
              Listing link <span className="font-normal text-faint">(optional)</span>
            </span>
            <input
              className={input}
              type="url"
              inputMode="url"
              value={listingUrl}
              onChange={(e) => setListingUrl(e.target.value)}
              placeholder="https://"
              autoComplete="off"
              disabled={stale}
            />
          </label>

          {error && (
            <p className="rounded-xl bg-fail-soft px-4 py-3 text-sm text-fail" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className={buttonPrimary} disabled={!canCreate}>
            {busy ? 'Creating…' : 'Create the check link'}
          </button>
        </form>
      )}
    </Page>
  )
}

function TestSkeleton({ itemName }: { itemName: string }) {
  return (
    <div className="mt-6" role="status">
      <p className="text-sm text-muted">
        Picking the best tests for <span className="font-medium text-ink wrap-break-word">{itemName}</span>…
      </p>
      <ul className="mt-2 divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i} className="flex gap-3 px-4 py-3">
            <span className="size-5 shrink-0 animate-pulse rounded bg-line" />
            <span className="flex-1 space-y-2">
              <span className="block h-4 w-2/5 animate-pulse rounded bg-line" />
              <span className="block h-3 w-4/5 animate-pulse rounded bg-line/70" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Created({ res, itemName }: { res: CreateResult; itemName: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(res.link_url)
    } catch {
      // Older iOS / insecure origins: fall back to a hidden textarea
      const ta = document.createElement('textarea')
      ta.value = res.link_url
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  const share = async () => {
    try {
      await navigator.share({ title: 'ShowMe check', text: `Show me the ${itemName} working live:`, url: res.link_url })
    } catch {
      /* cancelled */
    }
  }

  return (
    <Page>
      <h1 className="mt-2 text-[28px] leading-tight font-semibold tracking-tight">Send this to the seller</h1>
      <p className="mt-1 text-muted">Paste it in your Marketplace or OfferUp chat. This page becomes the live report.</p>
      {res.usedStandardTests && (
        <p className="mt-4 rounded-xl bg-unv-soft px-4 py-3 text-sm text-unv" role="status">
          AI-picked tests aren't supported by the server yet, so this check uses the standard tests for this category.
        </p>
      )}

      <Card className="mt-6 animate-row-in">
        <div className="mx-auto w-fit rounded-xl bg-white p-3">
          <QRCodeSVG value={res.link_url} size={176} marginSize={0} />
        </div>
        <p className="mt-4 rounded-xl bg-page px-4 py-3 font-mono text-sm break-all select-all">{res.link_url}</p>
        <div className="mt-3 grid gap-2">
          <button type="button" onClick={copy} className={buttonPrimary}>
            {copied ? 'Copied ✓' : 'Copy link'}
          </button>
          {typeof navigator.share === 'function' && (
            <button type="button" onClick={share} className={buttonSecondary}>
              Share…
            </button>
          )}
        </div>
      </Card>

      <a href={res.link_url} className="mt-5 block text-center font-medium underline underline-offset-4">
        Open the check page
      </a>
      <p className="mt-6 text-center">
        <Link to="/new" reloadDocument className="text-sm text-muted">
          Make another check
        </Link>
      </p>
    </Page>
  )
}
