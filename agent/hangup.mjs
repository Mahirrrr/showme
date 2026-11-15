// Hangs up the FaceTime call when the check is done. Leaving the LiveKit room alone does not end the call:
// the seller would be left on an open FaceTime. Chert's Calls API ends it (POST /v1/calls/{id}/end).
import { randomUUID } from 'node:crypto';

const BASE = 'https://facetime.trychert.com/api/v1';

/** The Chert bridge joins as "chert-bridge-<call id>". Any other identity (a webcam in a plain room) has no call. */
export function callIdFromIdentity(identity) {
  const m = /^chert-bridge-([0-9a-f-]{36})$/i.exec(identity ?? '');
  return m ? m[1] : null;
}

/** Returns end(callId) → "ended" | "already ended" | "failed" | "skipped". Never throws. */
export function makeCallEnder({ apiKey, projectId, fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  return async callId => {
    if (!apiKey || !projectId || !callId) return 'skipped';
    try {
      const res = await fetchImpl(`${BASE}/calls/${callId}/end`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'x-chert-project-id': projectId,
          'content-type': 'application/json',
          'idempotency-key': `showme-end-${randomUUID()}`,
        },
        body: '{}',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return 'ended';
      if (res.status === 404 || res.status === 409) return 'already ended';
      return 'failed';
    } catch {
      return 'failed';
    }
  };
}
