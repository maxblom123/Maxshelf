import { buffered } from '../buffering'
import { openLibraryApiLimiter, openLibraryRateLimiter } from './limiter'
import { OPENLIBRARY_HEADERS } from './openlibrary'

interface SubjectWork {
  key: string
  title: string
  authors?: Array<{ name: string; key: string }>
  cover_id?: number
  first_publish_year?: number
  subject?: string[]
}

interface SubjectResponse {
  work_count: number
  works: SubjectWork[]
}

export interface BooksResult {
  total: number
  page: number
  books: Array<{
    id: string
    title: string
    authors: string[]
    year: number | null
    subjects: string[]
    languages: string[]
    coverUrl: string | null
    rating: null
  }>
}

const SUBJECT_TIMEOUT_MS = 15000

// Cover warming used to be awaited here with a 2000ms budget — every
// cold genre/page paid up to 2s while we fired 24 concurrent cover
// downloads+resizes, and rapid genre switching stacked those bursts on
// top of each other with no cap. That's what caused the click-fast
// timeouts. Warming is now fire-and-forget: the listing response goes
// out as soon as the subject metadata is back, and warming happens in
// the background bounded by openLibraryCoverLimiter, so it can never
// stampede regardless of how fast someone clicks through genres.

async function fetchBooksForSubject(subject: string, page: number): Promise<BooksResult> {
  const limit = 24
  const offset = (page - 1) * limit

  const url = new URL(`https://openlibrary.org/subjects/${subject}.json`)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('offset', String(offset))

  let response: SubjectResponse
  try {
    // Rate token acquired before the concurrency slot, same reasoning as
    // cover.ts — see the shared openLibraryRateLimiter note in
    // limiter.ts. This limiter is shared across JSON and cover requests
    // alike, since OpenLibrary's own rate policy doesn't distinguish
    // between the two.
    response = await openLibraryRateLimiter.run(() =>
      openLibraryApiLimiter.run(() =>
        $fetch<SubjectResponse>(url.toString(), {
          timeout: SUBJECT_TIMEOUT_MS,
          headers: OPENLIBRARY_HEADERS,
        })
      )
    )
  } catch {
    // Thrown, not returned — a cached function should never cache a
    // failure as if it were valid data. Nitro logs thrown errors and
    // routes them through its own error handling instead of caching them.
    throw createError({
      statusCode: 504,
      statusMessage: `OpenLibrary took too long to respond for subject "${subject}". Please try again.`,
    })
  }

  const booksWithCoverId = response.works.map((work) => ({
    id: work.key.replace('/works/', ''),
    title: work.title,
    authors: work.authors?.map((a) => a.name) ?? [],
    year: work.first_publish_year ?? null,
    subjects: work.subject?.slice(0, 5) ?? [],
    languages: [] as string[],
    coverId: work.cover_id ?? null,
    rating: null as null,
  }))

  // Fire-and-forget, bounded by openLibraryCoverLimiter (via getCoverWebp
  // itself — see the note on the double-wrap bug this replaced below).
  // We deliberately do NOT await this on the response path (see note
  // above). The listing response — all the client actually needs to
  // start rendering — goes out immediately; images warm themselves in
  // the background and are picked up by bufferedBinary's single-flight
  // cache the moment the browser requests them.
  //
  // priority: 'low' — this is purely speculative warming for a page that
  // may not even be the one someone lands on. Explicitly low priority
  // means it only ever consumes limiter capacity that real, user-facing
  // cover requests (the actual /api/cover route, 'high' by default)
  // aren't asking for — so a fast-paginating user's CURRENT page never
  // queues behind warming work for pages already scrolled past.
  //
  // Previously this wrapped getCoverWebp in ITS OWN openLibraryCoverLimiter
  // .run() call on top of the one getCoverWebp already makes internally
  // (cover.ts, on any cold miss) — a redundant nested wrap that held TWO
  // of the limiter's slots per single cover fetch during warming instead
  // of one, silently halving real warming throughput. Removed; getCoverWebp
  // already owns its own concurrency, this just needed to pass priority
  // through to it.
  void Promise.allSettled(
    booksWithCoverId
      .filter((book) => book.coverId !== null)
      .map((book) => getCoverWebp(String(book.coverId), 'thumb', 'low'))
  )

  return {
    total: response.work_count,
    page,
    books: booksWithCoverId.map(({ coverId, ...book }) => ({
      ...book,
      coverUrl: coverId ? `/api/cover/${coverId}` : null,
    })),
  }
}

const bufferedFetch = buffered(
  'books',
  (subject: string, page: number) => fetchBooksForSubject(subject, page),
  {
    maxAge: 60 * 5,
    getKey: (subject: string, page: number) => `${subject}-${page}`,
  }
)

export async function getBooksForSubject(subject: string, page = 1): Promise<BooksResult> {
  return bufferedFetch(subject, page)
}