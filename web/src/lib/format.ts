/** "+18175551234" -> "+1 (817) 555-1234"; anything else is returned as is. */
export function formatLine(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164)
  return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : e164
}

export function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export const CATEGORY_LABEL: Record<string, string> = {
  console: 'Game console',
  phone: 'Phone',
  laptop: 'Laptop',
  other: 'Other',
}
