import { useEffect, useState } from 'react'
import { ApiError, getRequest } from '../api'
import type { RequestView } from '../types'

const POLL_MS = 2000

export type PollState =
  | { kind: 'loading' }
  | { kind: 'not_found' }
  | { kind: 'ready'; view: RequestView; offline: boolean }
  | { kind: 'offline' } // never loaded, still retrying

/**
 * Fetches /api/requests/:token and keeps polling every 2 s while the check
 * can still change (awaiting_seller, in_call). Stops at complete / expired.
 * Network errors keep the last good view and show a "retrying" note.
 */
export function useRequestPoll(token: string): PollState {
  const [state, setState] = useState<PollState>({ kind: 'loading' })

  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined

    const tick = async () => {
      try {
        const view = await getRequest(token)
        if (!alive) return
        setState({ kind: 'ready', view, offline: false })
        if (view.status === 'awaiting_seller' || view.status === 'in_call') {
          timer = setTimeout(tick, POLL_MS)
        }
      } catch (err) {
        if (!alive) return
        if (err instanceof ApiError && err.status === 404) {
          setState({ kind: 'not_found' })
          return
        }
        setState((prev) =>
          prev.kind === 'ready' ? { ...prev, offline: true } : { kind: 'offline' },
        )
        timer = setTimeout(tick, POLL_MS)
      }
    }

    tick()
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [token])

  return state
}
