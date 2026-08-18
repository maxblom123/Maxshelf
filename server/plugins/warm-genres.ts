const CURATED_GENRES = [
  'fiction',
  'fantasy',
  'science_fiction',
  'mystery',
  'romance',
  'history',
  'biography',
  'science',
] as const

type Genre = (typeof CURATED_GENRES)[number]
type BooksListing = Awaited<ReturnType<typeof getBooksForSubject>>

const DETAIL_WARM_COUNT = 8
const PAGES_TO_WARM = 10

async function warmListings(): Promise<Record<Genre, BooksListing[]>> {
  console.log(
    `[warm-genres] phase 1: warming grid listings + thumb covers for pages 1-${PAGES_TO_WARM}…`
  )

  const pageListings = {} as Record<Genre, BooksListing[]>

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

  console.log(`[warm-genres] phase 1 done — grid should now be fast for every genre, pages 1-${PAGES_TO_WARM}`)

  return pageListings
}

async function warmDetailsForGenre(genre: Genre, listings: BooksListing[]): Promise<void> {
  for (const [pageIndex, listing] of listings.entries()) {
    const idsToWarm = listing.books.slice(0, DETAIL_WARM_COUNT).map((book) => book.id)

    const results = await Promise.allSettled(idsToWarm.map((id) => getBookDetail(id)))

    const failed = results.filter((result) => result.status === 'rejected').length
    console.log(
      `[warm-genres] phase 2: warmed ${idsToWarm.length - failed}/${idsToWarm.length} details for "${genre}" page ${pageIndex + 1}`
    )
  }
}

async function warmDetails(pageListings: Record<Genre, BooksListing[]>): Promise<void> {
  console.log('[warm-genres] phase 2: warming book detail metadata…')

  for (const genre of CURATED_GENRES) {
    await warmDetailsForGenre(genre, pageListings[genre] ?? [])
  }
}

async function warmGenres(): Promise<void> {
  const pageListings = await warmListings()
  await warmDetails(pageListings)
  console.log('[warm-genres] all done')
}

export default defineNitroPlugin(() => {
  void warmGenres()
})