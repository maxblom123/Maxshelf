import sharp from 'sharp'
import { bufferedBinary } from '../buffering'
import { openLibraryCoverLimiter, openLibraryRateLimiter } from './limiter'
import { OPENLIBRARY_HEADERS } from './openlibrary'

export type CoverVariant = 'thumb' | 'large'
export type CoverPriority = 'high' | 'low'

const VARIANT_DIMENSIONS: Record<CoverVariant, [number, number]> = {
  thumb: [150, 225],
  large: [300, 450],
}

const SOURCE_SIZE: Record<CoverVariant, 'M' | 'L'> = {
  thumb: 'M',
  large: 'L',
}

const COVER_ID_PATTERN = /^\d+$/
const COVER_FETCH_TIMEOUT_MS = 6000

function assertValidCoverId(id: string): void {
  if (!COVER_ID_PATTERN.test(id)) {
    throw createError({ statusCode: 400, statusMessage: `Invalid cover id "${id}"` })
  }
}

async function fetchCoverWebp(
  id: string,
  variant: CoverVariant,
  priority: CoverPriority
): Promise<Buffer> {
  assertValidCoverId(id)

  return openLibraryRateLimiter.run(() =>
    openLibraryCoverLimiter.run(async () => {
      const sourceUrl = `https://covers.openlibrary.org/b/id/${id}-${SOURCE_SIZE[variant]}.jpg`
      const buffer = await $fetch<ArrayBuffer>(sourceUrl, {
        responseType: 'arrayBuffer',
        timeout: COVER_FETCH_TIMEOUT_MS,
        headers: OPENLIBRARY_HEADERS,
      })

      const [width, height] = VARIANT_DIMENSIONS[variant]
      return sharp(Buffer.from(buffer))
        .resize(width, height, { fit: 'cover' })
        .webp({ quality: 78 })
        .toBuffer()
    }, priority)
  )
}

const bufferedFetch = bufferedBinary(
  'cover',
  (id: string, variant: CoverVariant, priority: CoverPriority) =>
    fetchCoverWebp(id, variant, priority),
  {
    maxAge: 60 * 60 * 24 * 7,
    getKey: (id: string, variant: CoverVariant) => `${id}-${variant}`,
  }
)

export async function getCoverWebp(
  id: string,
  variant: CoverVariant = 'thumb',
  priority: CoverPriority = 'high'
): Promise<Buffer> {
  return bufferedFetch(id, variant, priority)
}