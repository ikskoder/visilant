import jsQR from 'jsqr'

// Downscale guard: huge images blow up memory and jsQR handles ~1500px fine
const MAX_DIM = 1500

export function decodeQrFromImageData(img: ImageData): string | null {
  const result = jsQR(img.data, img.width, img.height)
  const payload = result?.data?.trim()
  return payload || null
}

/**
 * Decode a QR code from any ImageBitmapSource (Blob, File, ImageBitmap...).
 * Works in both the service worker and popup – OffscreenCanvas is native in
 * both contexts (Chrome, Firefox ≥105), no DOM canvas needed.
 */
export async function decodeQrFromImageBitmapSource(src: ImageBitmapSource): Promise<string | null> {
  const bitmap = await createImageBitmap(src)
  try {
    const scale = Math.min(1, MAX_DIM / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx)
      return null

    ctx.drawImage(bitmap, 0, 0, width, height)
    return decodeQrFromImageData(ctx.getImageData(0, 0, width, height))
  }
  finally {
    bitmap.close()
  }
}
