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

// OpenLibrary cover IDs are always positive integers. Validating here (in
// the util, not just the route) means every caller gets the same
// guarantee regardless of where the id originated, and nothing
// non-numeric ever gets interpolated into the upstream URL.
function assertValidCoverId(id: string): void {
  if (!/^\d+$/.test(id)) {
    throw createError({ statusCode: 400, statusMessage: `Invalid cover id "${id}"` })
  }
}

// Tightened from 10s. This directly bounds the worst case for a fully
// cold page: N covers ÷ openLibraryCoverLimiter's concurrency = number
// of sequential batches, and each batch is capped at this timeout. A
// slower timeout doesn't rescue more covers — OpenLibrary is either
// going to respond promptly or it isn't — it just makes every cold page
// (an unpopular genre, a deep page nobody's hit before) wait longer
// before falling back to "No cover". Tighter here means a consistent,
// bounded worst case regardless of which page someone lands on, at the
// cost of slightly more covers timing out into that fallback instead of
// eventually succeeding.
const COVER_FETCH_TIMEOUT_MS = 6000

async function fetchCoverWebp(
  id: string,
  variant: CoverVariant,
  priority: CoverPriority
): Promise<Buffer> {
  assertValidCoverId(id)

  // Routed through the shared limiter — this is the function that both
  // real requests AND the warm-up plugin/background warming in books.ts
  // ultimately call, so this single choke point is what actually caps
  // how many concurrent downloads+resizes hit OpenLibrary's cover CDN at
  // once, no matter how many callers ask for covers simultaneously.
  //
  // The explicit timeout here matters more than it looks: without it, a
  // single slow/hanging response from covers.openlibrary.org never
  // settles, which means the limiter slot it's holding never frees (see
  // the watchdog note in limiter.ts) — and since this limiter is a
  // process-wide singleton, that's enough to eventually wedge cover
  // loading for every user, not just this request.
  //
  // `priority` passes straight through to the limiter — real HTTP
  // requests default to 'high', background warming explicitly passes
  // 'low' (see books.ts and the cover route), so a fast-paginating user
  // never queues behind speculative work for pages they've already
  // scrolled past.
  //
  // Rate token acquired BEFORE the concurrency slot, not after — waiting
  // on a rate-limit token doesn't need a concurrency slot held hostage
  // for it, that slot should only be occupied once work can actually
  // start. The rate limiter (shared across ALL OpenLibrary calls, JSON
  // and covers alike — see limiter.ts) is what actually keeps this
  // whole app under OpenLibrary's real requests/SECOND policy; the
  // concurrency limiter alone never guaranteed that, it only ever capped
  // how many requests could be simultaneously in flight.
  return openLibraryRateLimiter.run(() =>
    openLibraryCoverLimiter.run(async () => {
      const sourceUrl = `https://covers.openlibrary.org/b/id/${id}-${SOURCE_SIZE[variant]}.jpg`
      const buffer = await $fetch<ArrayBuffer>(sourceUrl, {
        responseType: 'arrayBuffer',
        timeout: COVER_FETCH_TIMEOUT_MS,
        headers: OPENLIBRARY_HEADERS,
      })

      const [width, height] = VARIANT_DIMENSIONS[variant]
      return await sharp(Buffer.from(buffer))
        .resize(width, height, { fit: 'cover' })
        .webp({ quality: 78 })
        .toBuffer()
    }, priority)
  )
}

// Covers essentially never change once published — a week-long freshness
// window is generous, and SWR means even a "stale" entry past that point
// is still served instantly while a fresh copy is quietly fetched.
//
// NOTE: `priority` is intentionally excluded from getKey — it only
// affects how urgently a COLD MISS gets fetched, not what's cached or
// where. Two requests for the same id+variant, one high and one low
// priority, still share exactly one cache entry.
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