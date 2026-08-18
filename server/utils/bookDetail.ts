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
const AUTHOR_TIMEOUT_MS = 5000
const MAX_SUBJECTS = 12
const UNKNOWN_AUTHOR = 'Unknown'

function isNotFoundError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'response' in err &&
    (err as { response?: { status?: number } }).response?.status === 404
  )
}

async function fetchWork(id: string): Promise<WorkResponse> {
  try {
    return await openLibraryRateLimiter.run(() =>
      openLibraryApiLimiter.run(() =>
        $fetch<WorkResponse>(`https://openlibrary.org/works/${id}.json`, {
          timeout: DETAIL_TIMEOUT_MS,
          headers: OPENLIBRARY_HEADERS,
        })
      )
    )
  } catch (err) {
    if (isNotFoundError(err)) {
      throw createError({ statusCode: 404, statusMessage: 'Book not found' })
    }
    throw createError({
      statusCode: 504,
      statusMessage: 'OpenLibrary took too long to respond. Please try again.',
    })
  }
}

async function fetchAuthorName(key: string): Promise<string> {
  try {
    const author = await openLibraryRateLimiter.run(() =>
      openLibraryApiLimiter.run(() =>
        $fetch<{ name?: string }>(`https://openlibrary.org${key}.json`, {
          timeout: AUTHOR_TIMEOUT_MS,
          headers: OPENLIBRARY_HEADERS,
        })
      )
    )
    return author.name ?? UNKNOWN_AUTHOR
  } catch {
    return UNKNOWN_AUTHOR
  }
}

async function fetchBookDetail(id: string): Promise<BookDetail> {
  const work = await fetchWork(id)

  const authorKeys = (work.authors ?? [])
    .map((a) => a.author?.key)
    .filter((key): key is string => Boolean(key))

  const authorNames = await Promise.all(authorKeys.map(fetchAuthorName))

  const description =
    typeof work.description === 'string' ? work.description : (work.description?.value ?? null)

  const coverId = work.covers?.find((c) => c > 0) ?? null

  return {
    id: work.key.replace('/works/', ''),
    title: work.title,
    authors: authorNames,
    description,
    subjects: work.subjects?.slice(0, MAX_SUBJECTS) ?? [],
    firstPublishDate: work.first_publish_date ?? null,
    coverUrl: coverId ? `/api/cover/${coverId}?size=large` : null,
    coverId,
  }
}

const bufferedFetch = buffered('book-detail', (id: string) => fetchBookDetail(id), {
  maxAge: 60 * 60,
  getKey: (id: string) => id,
})

export async function getBookDetail(id: string): Promise<BookDetail> {
  return bufferedFetch(id)
}