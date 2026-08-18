/**
 * "Buffering" = stale-while-revalidate (SWR): serve the last known-good
 * result instantly, refresh it in the background, and only make a real
 * caller wait when there's truly nothing cached yet. This is a real,
 * well-established pattern — Nitro (which powers server/) has it built
 * in as `defineCachedFunction`. This file wraps that for our JSON-safe
 * data, and hand-writes an equivalent for binary data (cover images),
 * since defineCachedFunction's binary-safety isn't something we've
 * verified and image bytes are exactly the kind of thing that fails
 * silently if serialized wrong.
 *
 * Why this used to be missing: server/utils/books.ts, bookDetail.ts, and
 * cover.ts need to be called both from HTTP routes AND from the startup
 * warmer plugin, which ruled out defineCachedEventHandler (HTTP-only).
 * The workaround at the time was raw useStorage calls with no expiry —
 * which is why stale data from before a shape change kept getting served
 * indefinitely until we manually versioned the cache key. This restores
 * real TTL-based freshness instead.
 *
 * SINGLE-FLIGHT DEDUPE — added after we traced the "times out the moment
 * you click fast" bug to a stampede: rapid genre switching / repeated
 * cover misses meant multiple concurrent callers for the SAME key were
 * each independently hitting OpenLibrary and (for covers) independently
 * re-running sharp. Both `buffered` and `bufferedBinary` now guarantee
 * that only one upstream call is ever in flight per key at a time —
 * every other concurrent caller for that key shares the same promise.
 * This is on top of, not instead of, the concurrency limiter in
 * server/utils/limiter.ts: dedupe collapses N identical requests into 1,
 * the limiter caps how many DIFFERENT keys can be in flight at once.
 */

export function buffered<Args extends any[], Result>(
  name: string,
  fn: (...args: Args) => Promise<Result>,
  options: {
    maxAge: number
    getKey: (...args: Args) => string
  }
) {
  const cachedFn = defineCachedFunction(fn, {
    name,
    maxAge: options.maxAge,
    getKey: (...args: Args) => options.getKey(...args),
    swr: true,
  })

  const inFlight = new Map<string, Promise<Result>>()

  return async (...args: Args): Promise<Result> => {
    const key = options.getKey(...args)

    const existing = inFlight.get(key)
    if (existing) return existing

    const promise = cachedFn(...args).finally(() => {
      inFlight.delete(key)
    })
    inFlight.set(key, promise)
    return promise
  }
}

export function bufferedBinary<Args extends any[]>(
  name: string,
  fn: (...args: Args) => Promise<Buffer>,
  options: {
    maxAge: number
    getKey: (...args: Args) => string
  }
) {
  const inFlight = new Map<string, Promise<Buffer>>()
  const revalidating = new Set<string>()

  async function fetchAndStore(key: string, args: Args): Promise<Buffer> {
    const storage = useStorage('cache')
    const metaKey = `${key}-meta`
    const fresh = await fn(...args)
    await storage.setItemRaw(key, fresh)
    await storage.setItem(metaKey, { expiresAt: Date.now() + options.maxAge * 1000 })
    return fresh
  }

  return async (...args: Args): Promise<Buffer> => {
    const storage = useStorage('cache')
    const key = `${name}-${options.getKey(...args)}`
    const metaKey = `${key}-meta`

    const [meta, cached] = await Promise.all([
      storage.getItem<{ expiresAt: number }>(metaKey),
      storage.getItemRaw<Buffer>(key),
    ])

    const isFresh = Boolean(meta && Date.now() < meta.expiresAt)

    if (cached && isFresh) {
      return cached
    }

    if (cached && !isFresh) {
      // Stale-while-revalidate: hand back the old bytes immediately —
      // this request never waits on the network. Only ONE background
      // revalidation runs per key at a time (`revalidating` guards this)
      // — a burst of requests landing in the stale window shares the one
      // in-flight refresh instead of each kicking off their own.
      if (!revalidating.has(key)) {
        revalidating.add(key)
        fetchAndStore(key, args)
          .catch(() => {
            // A failed background revalidation just means the stale
            // value stays in place until the next attempt succeeds.
          })
          .finally(() => revalidating.delete(key))
      }
      return cached
    }

    // True cold miss — nothing to serve yet. Everyone who lands here
    // while the first caller is still fetching shares that ONE in-flight
    // promise, instead of each firing their own request at OpenLibrary
    // and running their own sharp resize.
    const existing = inFlight.get(key)
    if (existing) return existing

    const promise = fetchAndStore(key, args).finally(() => inFlight.delete(key))
    inFlight.set(key, promise)
    return promise
  }
}