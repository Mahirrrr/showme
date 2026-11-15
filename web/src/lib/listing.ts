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

const PHOTO_EXT = /\.(jpe?g|png|webp|heic|heif|gif|bmp|avif)$/i

/** True for anything that looks like a picture, including iPhone HEIC photos some browsers leave untyped. */
export function isImageFile(file: { type: string; name?: string }): boolean {
  return file.type.startsWith('image/') || (!file.type && PHOTO_EXT.test(file.name ?? ''))
}

async function decode(file: Blob): Promise<{ img: CanvasImageSource; w: number; h: number; done: () => void }> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    return { img: bitmap, w: bitmap.width, h: bitmap.height, done: () => bitmap.close() }
  } catch {
    // Safari decodes HEIC in <img> even where createImageBitmap refuses.
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.src = url
    try {
      await img.decode()
    } catch (err) {
      URL.revokeObjectURL(url)
      throw err
    }
    return { img, w: img.naturalWidth, h: img.naturalHeight, done: () => URL.revokeObjectURL(url) }
  }
}

function rawDataUrl(file: Blob & { name?: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      // Untyped HEIC comes through as application/octet-stream: label it so the server accepts it.
      resolve(/\.hei[cf]$/i.test(file.name ?? '') ? url.replace(/^data:[^;]*;/, 'data:image/heic;') : url)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/**
 * Shrink a screenshot or camera photo to at most 1600 px on its long side as a JPEG data URL
 * (keeps uploads small). If this browser can't decode it (HEIC on desktop Chrome), send the
 * original file and let Gemini read it.
 */
export async function imageToDataUrl(file: Blob & { name?: string }, max = 1600): Promise<string> {
  let decoded
  try {
    decoded = await decode(file)
  } catch {
    return rawDataUrl(file)
  }
  const scale = Math.min(1, max / Math.max(decoded.w, decoded.h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(decoded.w * scale)
  canvas.height = Math.round(decoded.h * scale)
  canvas.getContext('2d')!.drawImage(decoded.img, 0, 0, canvas.width, canvas.height)
  decoded.done()
  return canvas.toDataURL('image/jpeg', 0.85)
}
