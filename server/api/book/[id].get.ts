const BOOK_ID_PATTERN = /^OL\d+W$/

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id || !BOOK_ID_PATTERN.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid book id' })
  }

  const { coverId, ...detail } = await getBookDetail(id)
  return detail
})