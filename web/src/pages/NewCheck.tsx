import { canSubmitSelection, MAX_TESTS, MIN_TESTS, ownTest, selectionMessage, selectionTone } from '../lib/selection'
import { QRCodeSVG } from 'qrcode.react'
import { useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { createRequest, parseListing, suggestTests, type CreateResult, type ListingResult } from '../api'
import { guessCategory } from '../lib/catalog'
import { CATEGORY_LABEL } from '../lib/format'
import { findUrl, imageToDataUrl, isImageFile } from '../lib/listing'
import type { Category, SuggestResponse } from '../types'
import { buttonPrimary, buttonSecondary, Card, Page } from '../components/ui'

const field = 'block h-12 w-full rounded-xl border border-line bg-card px-4 outline-none transition-colors focus:border-ink'
const input = `mt-1.5 ${field}`

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
  const [reading, setReading] = useState(false) // reading a pasted listing link or screenshot
  const [listingNote, setListingNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [askShot, setAskShot] = useState(false) // link unreadable: offer a screenshot
  const latestListing = useRef(0)
  const lastRead = useRef<string | null>(null) // link already read, so blur or edits don't re-read it

  const name = itemName.trim()
  const stale = suggestion !== null && name !== suggestedFor

  const suggest = async (e?: FormEvent, forName = name, category?: Category | null) => {
    e?.preventDefault()
    if (!forName || suggesting) return
    const call = ++latest.current
    setSuggesting(true)
    setError(null)
    const res = await suggestTests({ item_name: forName, category: category ?? guessCategory(forName) })
    if (call !== latest.current) return
    setSuggestion(res)
    setSuggestedFor(forName)
    setSelected(new Set(res.tests.slice(0, MIN_TESTS).map((t) => t.id))) // the buyer ticks up to 5
    setRejected([])
    setFresh(new Set())
    setNotice(null)
    setSuggesting(false)
  }

  // A pasted listing link (or screenshot) fills in the item name, then picks the tests for it.
  const applyListing = (res: ListingResult, from: 'link' | 'screenshot') => {
    if (res.reason === 'not_for_sale') {
      setAskShot(false)
      setListingNote({
        ok: false,
        text: "That listing doesn't look like an item for sale (maybe a lost pet or a wanted post). Type what you're buying below.",
      })
      return
    }
    if (!res.item_name) {
      setAskShot(true)
      setListingNote({
        ok: false,
        text: from === 'link'
          ? `Couldn't read that ${res.site ?? 'link'} listing. Tap the picture icon to add a screenshot or photo, or type the item below.`
          : "Couldn't make out the item in that picture. Try a clearer photo or screenshot, or type it below.",
      })
      return
    }
    setAskShot(false)
    setListingNote({ ok: true, text: `Found on ${res.site ?? (from === 'screenshot' ? 'your picture' : 'the listing')}` })
    setItemName(res.item_name)
    void suggest(undefined, res.item_name.trim(), res.category)
  }

  const readLink = async (raw: string) => {
    const url = findUrl(raw)
    if (!url) {
      if (raw.trim()) setListingNote({ ok: false, text: 'That doesn’t look like a link. Paste the listing’s URL.' })
      return
    }
    setListingUrl(url)
    lastRead.current = url
    const call = ++latestListing.current
    setReading(true)
    setListingNote(null)
    const res = await parseListing({ url })
    if (call !== latestListing.current) return
    setReading(false)
    applyListing(res, 'link')
  }

  const readShot = async (file: File | null | undefined) => {
    if (!file) return
    if (!isImageFile(file)) {
      setListingNote({ ok: false, text: 'That file isn’t a picture. Pick a screenshot or a photo.' })
      return
    }
    const call = ++latestListing.current
    setReading(true)
    setListingNote(null)
    let res: ListingResult
    try {
      res = await parseListing({ image: await imageToDataUrl(file) })
    } catch {
      res = { item_name: null, category: null, site: null, source: null }
    }
    if (call !== latestListing.current) return
    setReading(false)
    applyListing(res, 'screenshot')
  }

  const onLinkPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const image = [...e.clipboardData.files].find(isImageFile)
    if (image) {
      e.preventDefault()
      void readShot(image)
      return
    }
    const text = e.clipboardData.getData('text')
    if (findUrl(text)) {
      e.preventDefault()
      setListingUrl(findUrl(text)!)
      void readLink(text)
    }
  }
  // Paste events don't fire for iOS keyboard suggestions, autofill or drag-in text: treat any
  // multi-character insertion that contains a link as a paste and read it right away.
  const onLinkChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value
    const jumped = next.length - listingUrl.length >= 8
    setListingUrl(next)
    if (jumped && findUrl(next) && findUrl(next) !== lastRead.current) void readLink(next)
  }
  const onLinkKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    void readLink(listingUrl)
  }
  // Typed by hand: read when the buyer leaves the box, so no Enter is needed.
  const onLinkBlur = () => {
    if (findUrl(listingUrl) && findUrl(listingUrl) !== lastRead.current) void readLink(listingUrl)
  }
  const onLinkDrop = (e: DragEvent<HTMLInputElement>) => {
    const image = [...e.dataTransfer.files].find(isImageFile)
    if (!image) return
    e.preventDefault()
    void readShot(image)
  }
  const onShotPick = (e: ChangeEvent<HTMLInputElement>) => {
    void readShot(e.target.files?.[0])
    e.target.value = '' // picking the same file again still fires
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
    const room = Math.max(0, MAX_TESTS - selected.size)
    setSelected((prev) => new Set([...prev, ...added.slice(0, room)]))
    if (added.length === 0) setNotice('No new tests left to suggest. Add your own below.')
    else if (added.length < unchecked.length) setNotice(`Only ${added.length} new test${added.length === 1 ? '' : 's'} found.`)
    else if (res.source === 'catalog') setNotice("Couldn't reach AI, so these come from the standard list.")
    setSwapping(false)
  }

  const toggle = (id: string) => {
    if (!selected.has(id) && selected.size >= MAX_TESTS) {
      setNotice(`${MAX_TESTS} tests max. Untick one to pick this.`)
      return
    }
    setNotice(null)
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // The buyer's own test joins the list at the top as a normal test, so it counts.
  const custom = customTest.trim()
  const addOwn = () => {
    if (!suggestion) return
    const spec = ownTest(customTest, new Set(suggestion.tests.map((t) => t.id)))
    if (!spec) return
    const room = selected.size < MAX_TESTS
    setSuggestion({ ...suggestion, tests: [spec, ...suggestion.tests] })
    if (room) setSelected((prev) => new Set([...prev, spec.id]))
    setFresh(new Set([spec.id]))
    setNotice(room ? null : `Added, but ${MAX_TESTS} tests is the max. Untick one to include yours.`)
    setCustomTest('')
  }
  const onOwnKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    e.preventDefault() // Enter adds the test; it never submits the form
    addOwn()
  }

  // Text still in the box counts too: it is added when the link is created.
  const count = selected.size + (custom ? 1 : 0)
  const tone = selectionTone(count)
  const canCreate = suggestion !== null && !stale && !suggesting && !swapping && !busy && canSubmitSelection(count)

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (!canCreate || !suggestion) return
    setBusy(true)
    setError(null)
    try {
      const pending = ownTest(customTest, new Set(suggestion.tests.map((t) => t.id)))
      const res = await createRequest({
        item_name: name,
        category: suggestion.category,
        tests: [...(pending ? [pending] : []), ...suggestion.tests.filter((t) => selected.has(t.id))],
        ...(findUrl(listingUrl) && { listing_url: findUrl(listingUrl)! }),
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

      <div className="mt-6">
        <label htmlFor="listing-link" className="text-sm font-medium">
          Listing link <span className="font-normal text-faint">(optional)</span>
        </label>
        <div className="relative mt-1.5">
          <input
            id="listing-link"
            className={`${field} pr-14 text-base`}
            type="url"
            inputMode="url"
            value={listingUrl}
            onChange={onLinkChange}
            onPaste={onLinkPaste}
            onKeyDown={onLinkKey}
            onBlur={onLinkBlur}
            onDrop={onLinkDrop}
            placeholder="Paste a Marketplace, eBay, OfferUp… link"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            readOnly={reading}
          />
          <label
            className={`absolute inset-y-0 right-0 flex w-12 cursor-pointer items-center justify-center rounded-r-xl transition-colors hover:text-ink ${askShot ? 'text-accent' : 'text-faint'} ${reading ? 'pointer-events-none' : ''}`}
            title="Use a screenshot or photo"
          >
            <input type="file" accept="image/*" className="sr-only" onChange={onShotPick} disabled={reading} />
            <span className="sr-only">Use a screenshot or photo</span>
            {reading ? (
              <span className="size-5 animate-spin rounded-full border-2 border-line border-t-ink" aria-hidden />
            ) : (
              <ImageIcon />
            )}
          </label>
        </div>
        <p
          className={`mt-1.5 text-xs ${listingNote && !listingNote.ok ? 'text-unv' : 'text-faint'}`}
          role="status"
          aria-live="polite"
        >
          {reading
            ? 'Reading the listing…'
            : listingNote
              ? (listingNote.ok ? '✓ ' : '') + listingNote.text
              : 'Paste a link, or tap the picture icon for a screenshot or photo.'}
        </p>
      </div>

      <form onSubmit={suggest} className="mt-5">
        <label className="block">
          <span className="text-sm font-medium">What are you buying?</span>
          <input
            className={input}
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
            placeholder="Type what you want to buy"
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
                {suggestion.source !== 'gemini' && suggestion.category === 'other' ? (
                  <span className="block text-xs font-normal text-unv">
                    Couldn't match tests to this item. These are general checks: add your own below, or try a
                    clearer name (brand and model).
                  </span>
                ) : (
                  <span className="block text-xs font-normal text-faint">
                    {CATEGORY_LABEL[suggestion.category] ?? suggestion.category} ·{' '}
                    {suggestion.source === 'gemini' ? 'picked by Gemini' : 'standard list (AI suggestions unavailable)'}
                  </span>
                )}
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
            <Counter count={count} tone={tone} className="mt-3" />
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
                        {t.id.startsWith('own_') ? (
                          <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-semibold text-gold-ink">
                            Yours
                          </span>
                        ) : fresh.has(t.id) && (
                          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">
                            New
                          </span>
                        )}
                      </span>
                      {t.prompt !== t.label && (
                        <span className="block text-sm text-muted wrap-break-word">{t.prompt}</span>
                      )}
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
              Only the tests you choose will be requested during the call.
            </p>
          </fieldset>

          <div>
            <label htmlFor="own-test" className="text-sm font-medium">
              Your own test <span className="font-normal text-faint">(optional, counts as one of the {MAX_TESTS})</span>
            </label>
            <div className="mt-1.5 flex gap-2">
              <input
                id="own-test"
                className={field}
                value={customTest}
                onChange={(e) => setCustomTest(e.target.value)}
                onKeyDown={onOwnKey}
                placeholder="Show the charger working"
                maxLength={140}
                autoComplete="off"
                enterKeyHint="done"
                disabled={stale}
              />
              <button
                type="button"
                onClick={addOwn}
                disabled={!custom || stale}
                className="h-12 shrink-0 rounded-xl border border-line bg-card px-4 font-semibold text-ink active:scale-[0.97] disabled:text-faint"
              >
                Add
              </button>
            </div>
            <p className="mt-1.5 text-xs text-faint">Press Enter or Add to put it at the top of the list.</p>
          </div>

          {error && (
            <p className="rounded-xl bg-fail-soft px-4 py-3 text-sm text-fail" role="alert">
              {error}
            </p>
          )}

          <Counter count={count} tone={tone} live />
          <button type="submit" className={buttonPrimary} disabled={!canCreate}>
            {busy ? 'Creating…' : 'Create the check link'}
          </button>
        </form>
      )}
    </Page>
  )
}

const COUNTER_STYLE = {
  need: 'border-fail/30 bg-fail-soft text-fail',
  ok: 'border-pass/30 bg-pass-soft text-pass',
  full: 'border-pass/30 bg-pass-soft text-pass',
} as const

function Counter({ count, tone, live = false, className = '' }: {
  count: number; tone: keyof typeof COUNTER_STYLE; live?: boolean; className?: string
}) {
  return (
    <p
      {...(live && { role: 'status', 'aria-live': 'polite' as const })}
      className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-base font-semibold ${COUNTER_STYLE[tone]} ${className}`}
    >
      <span aria-hidden className="text-lg leading-none">{tone === 'need' ? '!' : '✓'}</span>
      {selectionMessage(count)}
    </p>
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

/** "Use a screenshot" glyph: a picture frame with a mountain and sun. */
function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="m21 16-5-5-8 9" />
    </svg>
  )
}
