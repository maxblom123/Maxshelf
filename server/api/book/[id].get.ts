export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id || !/^OL\d+W$/.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid book id' })
  }

  const { coverId, ...detail } = await getBookDetail(id)
  return detail
})