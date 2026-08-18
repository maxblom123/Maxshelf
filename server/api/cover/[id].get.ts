const COVER_ID_PATTERN = /^\d+$/
const COVER_CACHE_CONTROL = 'public, max-age=604800, immutable'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id || !COVER_ID_PATTERN.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid cover id' })
  }

  const sizeParam = getQuery(event).size
  const variant = sizeParam === 'large' ? 'large' : 'thumb'
  const priority = getHeader(event, 'x-cover-priority') === 'low' ? 'low' : 'high'

  const buffer = await getCoverWebp(id, variant, priority)

  setResponseHeader(event, 'Content-Type', 'image/webp')
  setResponseHeader(event, 'Cache-Control', COVER_CACHE_CONTROL)

  return buffer
})