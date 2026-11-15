// Helpers for the "paste a listing link" box on /new.

/** The first http(s) link in pasted text (share sheets often add words around it), or null. */
export function findUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"']+/i)
  if (!match) return null
  try {
    const url = new URL(match[0].replace(/[).,;!?]+$/, ''))
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

/** Shrink a screenshot to at most 1600 px on its long side as a JPEG data URL (keeps uploads small). */
export async function imageToDataUrl(file: Blob, max = 1600): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', 0.85)
}
