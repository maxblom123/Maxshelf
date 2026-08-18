// Kept in sync with the curated list in pages/index.vue (genreOptions) and
// server/plugins/warm-genres.ts (CURATED_GENRES). All three currently need
// to agree by hand — see note below for a follow-up to centralize this.
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

// A sanity ceiling against pathological/manual input (someone typing
// ?page=99999999999 by hand), NOT the real upper bound of any genre's
// results. This used to BE treated as the real limit — the client would
// show "last page: 500" regardless of a genre's actual size, and any
// deep page beyond it silently fell back to page 1 here, mismatching
// what the client displayed. Raised well above any realistic genre size
// (Fiction alone is 665,155 books ÷ 24/page = 27,714 real pages) so a
// legitimate deep page — including the actual computed last page —
// lands where it says it will, instead of quietly redirecting. Must
// match index.vue's own MAX_PAGE (duplicated by hand across the two
// files, same as VALID_SUBJECTS already is).
const MAX_PAGE = 1_000_000

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const subject = (query.q as string) || 'fiction'

  if (!VALID_SUBJECTS.includes(subject)) {
    throw createError({
      statusCode: 400,
      statusMessage: `Unknown subject "${subject}". Must be one of: ${VALID_SUBJECTS.join(', ')}.`,
    })
  }

  const rawPage = Number(query.page)
  const page = Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= MAX_PAGE ? rawPage : 1

  const result = await getBooksForSubject(subject, page)

  // Simple, direct: compute the real last page from the total this
  // genre actually has, and compare the requested page against it.
  // page > lastPage means it doesn't exist — nothing indirect to reason
  // through (no inferring "does this page exist" from an empty books
  // array as a proxy), just a number compared against a number.
  const BOOKS_PER_PAGE = 24
  const lastPage = Math.ceil(result.total / BOOKS_PER_PAGE)
  // page > lastPage + 1, not just page > lastPage — OpenLibrary's
  // reported total can drift very slightly between requests (a classic
  // trait of eventually-consistent search backends), so a page that IS
  // the real last page can occasionally compute as one page past what a
  // strict `page > lastPage` check allows, on a total that's off by a
  // handful of books from what an earlier request saw. A one-page grace
  // margin absorbs that drift without opening the door to anything
  // actually absurd (?page=99999999 is still nowhere close).
  if (page > lastPage + 1) {
    throw createError({
      statusCode: 404,
      statusMessage: `Page ${page} does not exist for "${subject}" — it only has ${lastPage} pages.`,
    })
  }

  // Was missing entirely before — every navigation, including landing
  // back on a page you'd already visited in the last few minutes, hit
  // our server no matter what. This is the actual gap behind "the
  // pageCache Map doesn't help after a reload": that cache lives in JS
  // memory and is gone the instant the tab reloads, but an HTTP cache
  // header persists across reloads and feeds the browser's own
  // back/forward cache too. Mirrors the server-side buffered() window
  // (maxAge: 300s in books.ts): fully fresh for 60s, then served
  // stale-while-revalidate for the rest of that 5-minute window.
  setResponseHeader(event, 'Cache-Control', 'public, max-age=60, stale-while-revalidate=300')

  return result
})