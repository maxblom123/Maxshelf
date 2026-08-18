const VALID_SUBJECTS = [
  'fiction',
  'fantasy',
  'science_fiction',
  'mystery',
  'romance',
  'history',
  'biography',
  'science',
]

const MAX_PAGE = 1_000_000
const BOOKS_PER_PAGE = 24
const LAST_PAGE_GRACE = 1

function parseSubject(query: Record<string, unknown>): string {
  const subject = (query.q as string) || 'fiction'

  if (!VALID_SUBJECTS.includes(subject)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Unknown subject "${subject}". Must be one of: ${VALID_SUBJECTS.join(', ')}.`,
    })
  }

  return subject
}

function parsePage(query: Record<string, unknown>): number {
  const rawPage = Number(query.page)
  return Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= MAX_PAGE ? rawPage : 1
}

function assertPageExists(subject: string, page: number, total: number): void {
  const lastPage = Math.ceil(total / BOOKS_PER_PAGE)

  if (page > lastPage + LAST_PAGE_GRACE) {
    throw createError({
      statusCode: 404,
      statusMessage: `Page ${page} does not exist for "${subject}" — it only has ${lastPage} pages.`,
    })
  }
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const subject = parseSubject(query)
  const page = parsePage(query)

  const result = await getBooksForSubject(subject, page)

  assertPageExists(subject, page, result.total)

  setResponseHeader(event, 'Cache-Control', 'public, max-age=60, stale-while-revalidate=300')

  return result
})