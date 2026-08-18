export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id || !/^\d+$/.test(id)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid cover id' })
  }

  const sizeParam = getQuery(event).size
  const variant = sizeParam === 'large' ? 'large' : 'thumb'

  // Real, user-facing requests default to 'high'. The client's neighbor-
  // page cover warming (warmCoverImages, in pages/books/index.vue) tags
  // itself explicitly 'low' via this header — deliberately a header, not
  // a query param, so the request URL (and therefore the browser's HTTP
  // cache key) stays identical to what a real <img> will request later.
  // See the priority note in server/utils/limiter.ts for why this
  // matters: without it, speculative warming for pages someone has
  // already scrolled past could queue ahead of the page they're
  // actually looking at right now.
  const priority = getHeader(event, 'x-cover-priority') === 'low' ? 'low' : 'high'

  const buffer = await getCoverWebp(id, variant, priority)

  setResponseHeader(event, 'Content-Type', 'image/webp')
  setResponseHeader(event, 'Cache-Control', 'public, max-age=604800, immutable')

  return buffer
})