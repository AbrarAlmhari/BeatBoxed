/**
 * Client-side image preparation for playlist covers.
 *
 * Covers are shown in a square grid, so they're squared and shrunk here
 * rather than on upload: a 4MB phone photo becomes roughly 40KB, which keeps
 * the Library grid quick and the bucket small. Cropping controls are out of
 * scope, so the crop is always centred.
 */

export const COVER_MAX_BYTES = 5 * 1024 * 1024
export const COVER_TYPES = ['image/png', 'image/jpeg', 'image/webp']

/** Big enough for the largest place a cover is shown, on a 2x screen. */
const COVER_SIZE = 600
const QUALITY = 0.85

export type CoverCheck = { ok: true } | { ok: false; message: string }

/** Validates before any decoding work, so a bad file fails instantly. */
export function checkCoverFile(file: File): CoverCheck {
  if (!COVER_TYPES.includes(file.type)) {
    return { ok: false, message: 'Pick a PNG, JPEG, or WebP image.' }
  }
  if (file.size > COVER_MAX_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1)
    return { ok: false, message: `That image is ${mb}MB. Keep it under 5MB.` }
  }
  return { ok: true }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, QUALITY))
}

export type PreparedCover = { blob: Blob; contentType: string; extension: string }

/**
 * Centre-crops to a square and resizes to 600x600.
 *
 * WebP where the browser will encode it, JPEG otherwise — toBlob falls back
 * to PNG silently when it doesn't know a type, which would undo the whole
 * point by producing a file larger than the original.
 */
export async function prepareCover(file: File): Promise<PreparedCover> {
  const bitmap = await createImageBitmap(file)
  try {
    const side = Math.min(bitmap.width, bitmap.height)
    const sx = (bitmap.width - side) / 2
    const sy = (bitmap.height - side) / 2

    const canvas = document.createElement('canvas')
    canvas.width = COVER_SIZE
    canvas.height = COVER_SIZE
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is unavailable')
    ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, COVER_SIZE, COVER_SIZE)

    const webp = await canvasToBlob(canvas, 'image/webp')
    if (webp && webp.type === 'image/webp') {
      return { blob: webp, contentType: 'image/webp', extension: 'webp' }
    }

    const jpeg = await canvasToBlob(canvas, 'image/jpeg')
    if (jpeg) return { blob: jpeg, contentType: 'image/jpeg', extension: 'jpg' }

    throw new Error('Could not encode the image')
  } finally {
    bitmap.close()
  }
}
