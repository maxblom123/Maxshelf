type Priority = 'high' | 'low'

interface Limiter {
  run: <T>(fn: () => Promise<T>, priority?: Priority) => Promise<T>
}

interface RateLimiter {
  run: <T>(fn: () => Promise<T>) => Promise<T>
}

export function createLimiter(concurrency: number, watchdogMs = 20000): Limiter {
  let active = 0
  const highQueue: Array<() => void> = []
  const lowQueue: Array<() => void> = []

  function releaseNext(): void {
    active--
    const resolve = highQueue.shift() ?? lowQueue.shift()
    if (resolve) {
      active++
      resolve()
    }
  }

  async function run<T>(fn: () => Promise<T>, priority: Priority = 'high'): Promise<T> {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => {
        ;(priority === 'high' ? highQueue : lowQueue).push(resolve)
      })
    } else {
      active++
    }

    let settled = false
    const watchdog = new Promise<never>((_, reject) => {
      setTimeout(() => {
        if (!settled) reject(new Error(`Task exceeded watchdog timeout of ${watchdogMs}ms`))
      }, watchdogMs)
    })

    try {
      return await Promise.race([fn(), watchdog])
    } finally {
      settled = true
      releaseNext()
    }
  }

  return { run }
}

export function createRateLimiter(requestsPerSecond: number): RateLimiter {
  const refillIntervalMs = 1000 / requestsPerSecond
  let tokens = requestsPerSecond
  let lastRefill = Date.now()
  const queue: Array<() => void> = []

  function refill(): void {
    const now = Date.now()
    const elapsed = now - lastRefill
    const newTokens = elapsed / refillIntervalMs
    if (newTokens >= 1) {
      tokens = Math.min(requestsPerSecond, tokens + newTokens)
      lastRefill = now
    }
  }

  function drainQueue(): void {
    while (tokens >= 1 && queue.length > 0) {
      tokens--
      const resolve = queue.shift()
      resolve?.()
    }
  }

  setInterval(
    () => {
      refill()
      drainQueue()
    },
    Math.max(10, Math.floor(refillIntervalMs / 2))
  ).unref?.()

  async function acquire(): Promise<void> {
    refill()
    if (tokens >= 1) {
      tokens--
      return
    }
    await new Promise<void>((resolve) => queue.push(resolve))
  }

  async function run<T>(fn: () => Promise<T>): Promise<T> {
    await acquire()
    return fn()
  }

  return { run }
}

export const openLibraryRateLimiter = createRateLimiter(2.5)
export const openLibraryApiLimiter = createLimiter(10)
export const openLibraryCoverLimiter = createLimiter(9)