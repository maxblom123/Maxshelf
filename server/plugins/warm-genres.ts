// Nitro auto-loads every file in server/plugins/ once, at server startup.

const CURATED_GENRES = [
  'fiction',
  'fantasy',
  'science_fiction',
  'mystery',
  'romance',
  'history',
  'biography',
  'science',
]

const DETAIL_WARM_COUNT = 8

// How many pages deep to pre-warm per genre at startup. This is the
// direct answer to "why does page 234 feel different from page 1" —
// it doesn't, it's just never been fetched by anyone before. Warming
// only page 1 (the old behavior) meant every single page past that was
// a guaranteed cold cache on someone's first visit. This can't cover
// literally all 500 possible pages per genre without warming 4,000
// listing calls and ~96,000 covers at startup, which would make the
// server unusably slow to boot and hammer OpenLibrary far past what's
// reasonable for a catalog this size — so this covers the pages real
// navigation actually reaches (chevron-clicking a few pages in), not
// every theoretical destination. A page 200+ deep, essentially never
// organically reached by clicking through, will still be cold on a
// true first visit; nothing short of warming the entire catalog changes
// that, and that's not a reasonable trade for this app's scale.
const PAGES_TO_WARM = 10

export default defineNitroPlugin(() => {
  ;(async () => {
    console.log(
      `[warm-genres] phase 1: warming grid listings + thumb covers for pages 1-${PAGES_TO_WARM}…`
    )

    // Keyed by genre, holding EVERY warmed page's listing (not just page
    // 1). Phase 2 below previously only ever saw page 1 here — that's
    // the actual bug behind "clicking a book only works on page 1":
    // detail warming had zero visibility into any other page's books,
    // so every single book beyond page 1 (and even books 9-24 of page 1
    // itself) was a guaranteed cold detail fetch, capable of taking up
    // to ~17s and stalling the whole route transition since [slug].vue
    // awaits it before rendering anything.
    const pageListings: Record<string, Awaited<ReturnType<typeof getBooksForSubject>>[]> = {}

    // Breadth-first across genres, not depth-first per genre: warming
    // page 1 of every genre before page 2 of any genre matches how
    // people actually browse (checking a few genres) better than fully
    // warming one genre 10 pages deep while every other genre still only
    // has page 1 ready.
    for (let page = 1; page <= PAGES_TO_WARM; page++) {
      for (const genre of CURATED_GENRES) {
        try {
          const listing = await getBooksForSubject(genre, page)
          ;(pageListings[genre] ??= []).push(listing)
          console.log(`[warm-genres] phase 1: warmed "${genre}" page ${page}`)
        } catch (error) {
          console.error(`[warm-genres] phase 1: failed to warm "${genre}" page ${page}:`, error)
        }
      }
    }

    console.log('[warm-genres] phase 1 done — grid should now be fast for every genre, pages 1-' + PAGES_TO_WARM)

    console.log('[warm-genres] phase 2: warming book detail metadata…')

    for (const genre of CURATED_GENRES) {
      const listings = pageListings[genre] ?? []

      // DETAIL_WARM_COUNT books per warmed page, not just per genre —
      // this is what actually gets coverage past page 1. At 8 books x 10
      // pages x 8 genres that's 640 detail warms total; sequential and
      // startup-only, so it doesn't compete with real traffic, it just
      // means the tail of "haven't been warmed yet" shrinks a lot faster
      // than the old 8-books-total-per-genre version.
      for (const [pageIndex, listing] of listings.entries()) {
        const idsToWarm = listing.books.slice(0, DETAIL_WARM_COUNT).map((book) => book.id)

        const results = await Promise.allSettled(idsToWarm.map((id) => getBookDetail(id)))

        const failed = results.filter((r) => r.status === 'rejected').length
        console.log(
          `[warm-genres] phase 2: warmed ${idsToWarm.length - failed}/${idsToWarm.length} details for "${genre}" page ${pageIndex + 1}`
        )
      }
    }

    console.log('[warm-genres] all done')
  })()
})