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

const PAGE_SIZE = 24
const SUBJECT_TIMEOUT_MS = 15000
const MAX_SUBJECTS_PER_BOOK = 5

async function fetchBooksForSubject(subject: string, page: number): Promise<BooksResult> {
  const offset = (page - 1) * PAGE_SIZE

  const url = new URL(`https://openlibrary.org/subjects/${subject}.json`)
  url.searchParams.set('limit', String(PAGE_SIZE))
  url.searchParams.set('offset', String(offset))

  let response: SubjectResponse
  try {
    response = await openLibraryRateLimiter.run(() =>
      openLibraryApiLimiter.run(() =>
        $fetch<SubjectResponse>(url.toString(), {
          timeout: SUBJECT_TIMEOUT_MS,
          headers: OPENLIBRARY_HEADERS,
        })
      )
    )
  } catch {
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
    subjects: work.subject?.slice(0, MAX_SUBJECTS_PER_BOOK) ?? [],
    languages: [] as string[],
    coverId: work.cover_id ?? null,
    rating: null as null,
  }))

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