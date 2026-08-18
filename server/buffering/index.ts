interface BufferedOptions<Args extends any[]> {
  maxAge: number
  getKey: (...args: Args) => string
}

export function buffered<Args extends any[], Result>(
  name: string,
  fn: (...args: Args) => Promise<Result>,
  options: BufferedOptions<Args>
): (...args: Args) => Promise<Result> {
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

interface CacheMeta {
  expiresAt: number
}

export function bufferedBinary<Args extends any[]>(
  name: string,
  fn: (...args: Args) => Promise<Buffer>,
  options: BufferedOptions<Args>
): (...args: Args) => Promise<Buffer> {
  const inFlight = new Map<string, Promise<Buffer>>()
  const revalidating = new Set<string>()

  async function fetchAndStore(key: string, args: Args): Promise<Buffer> {
    const storage = useStorage('cache')
    const fresh = await fn(...args)
    await storage.setItemRaw(key, fresh)
    await storage.setItem<CacheMeta>(`${key}-meta`, { expiresAt: Date.now() + options.maxAge * 1000 })
    return fresh
  }

  function revalidateInBackground(key: string, args: Args): void {
    if (revalidating.has(key)) return

    revalidating.add(key)
    fetchAndStore(key, args)
      .catch(() => {})
      .finally(() => revalidating.delete(key))
  }

  return async (...args: Args): Promise<Buffer> => {
    const storage = useStorage('cache')
    const key = `${name}-${options.getKey(...args)}`
    const metaKey = `${key}-meta`

    const [meta, cached] = await Promise.all([
      storage.getItem<CacheMeta>(metaKey),
      storage.getItemRaw<Buffer>(key),
    ])

    const isFresh = Boolean(meta && Date.now() < meta.expiresAt)

    if (cached && isFresh) {
      return cached
    }

    if (cached && !isFresh) {
      revalidateInBackground(key, args)
      return cached
    }

    const existing = inFlight.get(key)
    if (existing) return existing

    const promise = fetchAndStore(key, args).finally(() => inFlight.delete(key))
    inFlight.set(key, promise)
    return promise
  }
}