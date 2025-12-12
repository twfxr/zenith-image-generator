import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Check if URL is from HuggingFace
 */
function isHuggingFaceUrl(url: string): boolean {
  return url.includes('.hf.space') || url.includes('huggingface.co')
}

/**
 * Download image, converting HuggingFace images to PNG format
 */
export async function downloadImage(
  url: string,
  filename: string,
  provider?: string
): Promise<void> {
  // Check if it's a HuggingFace image (by URL or provider name)
  const isHF = isHuggingFaceUrl(url) || provider?.toLowerCase().includes('huggingface')

  if (isHF && url.startsWith('http')) {
    try {
      // Fetch the image and convert to PNG blob
      const response = await fetch(url)
      const blob = await response.blob()

      // Create a canvas to convert to PNG
      const img = new Image()
      img.crossOrigin = 'anonymous'

      await new Promise<void>((resolve, reject) => {
        img.onload = () => {
          const canvas = document.createElement('canvas')
          canvas.width = img.naturalWidth
          canvas.height = img.naturalHeight
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            reject(new Error('Failed to get canvas context'))
            return
          }
          ctx.drawImage(img, 0, 0)

          canvas.toBlob(
            (pngBlob) => {
              if (!pngBlob) {
                reject(new Error('Failed to convert to PNG'))
                return
              }
              const blobUrl = URL.createObjectURL(pngBlob)
              const a = document.createElement('a')
              a.href = blobUrl
              a.download = filename.replace(/\.(jpg|jpeg|webp)$/i, '.png')
              a.click()
              URL.revokeObjectURL(blobUrl)
              resolve()
            },
            'image/png',
            1.0
          )
        }
        img.onerror = () => reject(new Error('Failed to load image'))
        img.src = URL.createObjectURL(blob)
      })
    } catch (error) {
      console.error('Failed to convert image to PNG, falling back to direct download:', error)
      // Fallback to direct download
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
    }
  } else {
    // Direct download for non-HF images
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
  }
}
