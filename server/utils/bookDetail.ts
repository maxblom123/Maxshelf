import { buffered } from '../buffering'
import { openLibraryApiLimiter, openLibraryRateLimiter } from './limiter'
import { OPENLIBRARY_HEADERS } from './openlibrary'

interface WorkAuthorRef {
  author?: { key: string }
}

interface WorkResponse {
  key: string
  title: string
  description?: string | { value: string }
  subjects?: string[]
  covers?: number[]
  first_publish_date?: string
  authors?: WorkAuthorRef[]
}

export interface BookDetail {
  id: string
  title: string
  authors: string[]
  description: string | null
  subjects: string[]
  firstPublishDate: string | null
  coverUrl: string | null
  coverId: number | null
}

const DETAIL_TIMEOUT_MS = 12000

async function fetchBookDetail(id: string): Promise<BookDetail> {
  let work: WorkResponse
  try {
    // Rate token before the concurrency slot — same shared limiter as
    // every other OpenLibrary call, see the note in limiter.ts.
    work = await openLibraryRateLimiter.run(() =>
      openLibraryApiLimiter.run(() =>
        $fetch<WorkResponse>(`https://openlibrary.org/works/${id}.json`, {
          timeout: DETAIL_TIMEOUT_MS,
          headers: OPENLIBRARY_HEADERS,
        })
      )
    )
  } catch (err: any) {
    if (err?.response?.status === 404) {
      throw createError({ statusCode: 404, statusMessage: 'Book not found' })
    }
    throw createError({
      statusCode: 504,
      statusMessage: 'OpenLibrary took too long to respond. Please try again.',
    })
  }

  const authorKeys = (work.authors ?? [])
    .map((a) => a.author?.key)
    .filter((key): key is string => Boolean(key))

  // Each author fetch also goes through the shared limiter — without
  // this, a book with many co-authors, multiplied by someone clicking
  // through several detail pages in quick succession, is exactly the
  // kind of unbounded fan-out that was starving the connection pool.
  const authorNames = await Promise.all(
    authorKeys.map(async (key) => {
      try {
        const author = await openLibraryRateLimiter.run(() =>
          openLibraryApiLimiter.run(() =>
            $fetch<{ name?: string }>(`https://openlibrary.org${key}.json`, {
              timeout: 5000,
              headers: OPENLIBRARY_HEADERS,
            })
          )
        )
        return author.name ?? 'Unknown'
      } catch {
        return 'Unknown'
      }
    })
  )

  const description =
    typeof work.description === 'string' ? work.description : work.description?.value ?? null

  const coverId = work.covers?.find((c) => c > 0) ?? null

  return {
    id: work.key.replace('/works/', ''),
    title: work.title,
    authors: authorNames,
    description,
    subjects: work.subjects?.slice(0, 12) ?? [],
    firstPublishDate: work.first_publish_date ?? null,
    coverUrl: coverId ? `/api/cover/${coverId}?size=large` : null,
    coverId,
  }
}

const bufferedFetch = buffered(
  'book-detail',
  (id: string) => fetchBookDetail(id),
  {
    maxAge: 60 * 60,
    getKey: (id: string) => id,
  }
)

export async function getBookDetail(id: string): Promise<BookDetail> {
  return bufferedFetch(id)
}