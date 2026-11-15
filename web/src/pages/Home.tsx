import { Link } from 'react-router-dom'
import { buttonPrimary, Page } from '../components/ui'

const STEPS = [
  { title: 'Pick the tests', body: 'Power on, every button, the serial label: whatever you need to see.' },
  { title: 'Send the link', body: 'The seller opens it and FaceTimes ShowMe. No app, no account.' },
  {
    title: 'Watch it live',
    body: 'The seller follows your selected tests. AI checks the camera evidence.',
  },
]

export default function Home() {
  return (
    <Page>
      <section className="pt-10 pb-8">
        <h1 className="text-[40px] leading-[1.05] font-semibold tracking-tight">
          Buying used?
          <br />
          Make the seller prove it live.
        </h1>
        <p className="mt-4 text-lg text-muted">
          A 2-minute FaceTime check, judged by AI, turned into a report you can trust before you pay.
        </p>
        <Link to="/new" className={`${buttonPrimary} mt-8`}>
          Create a check
        </Link>
      </section>

      <ol className="space-y-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-4 rounded-2xl border border-line bg-card p-5">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ink text-sm font-semibold text-white">
              {i + 1}
            </span>
            <div>
              <h2 className="font-semibold">{s.title}</h2>
              <p className="mt-0.5 text-[15px] text-muted">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-8 text-center text-sm text-faint">
        Every check ends as Passed, Failed, or Unverified. We never mark something passed that the camera couldn't show.
      </p>
    </Page>
  )
}
