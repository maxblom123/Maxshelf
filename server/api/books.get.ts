export default defineEventHandler(async (event) => {
  const query = getQuery(event)

  const q = (query.q as string) || 'subject:fiction'
  const page = Number(query.page) || 1
  const limit = 24

  const url = new URL('https://openlibrary.org/search.json')
  url.searchParams.set('q', q)
  url.searchParams.set('page', String(page))
  url.searchParams.set('limit', String(limit))
  url.searchParams.set(
    'fields',
    'key,title,author_name,first_publish_year,subject,language,cover_i,ratings_average'
  )

  const response = await $fetch<{
    numFound: number
    docs: Array<{
      key: string
      title: string
      author_name?: string[]
      first_publish_year?: number
      subject?: string[]
      language?: string[]
      cover_i?: number
      ratings_average?: number
    }>
  }>(url.toString())

  return {
    total: response.numFound,
    page,
    books: response.docs.map((doc) => ({
      id: doc.key,
      title: doc.title,
      authors: doc.author_name ?? [],
      year: doc.first_publish_year ?? null,
      subjects: doc.subject?.slice(0, 5) ?? [],
      languages: doc.language ?? [],
      coverUrl: doc.cover_i
        ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
        : null,
      rating: doc.ratings_average ?? null,
    })),
  }
})