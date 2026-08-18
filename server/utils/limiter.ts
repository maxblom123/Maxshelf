/**
 * A tiny concurrency semaphore. Nothing upstream-specific here — it just
 * guarantees "at most N of these running at once, everything else queues."
 *
 * Why this exists: Node's fetch implementation (undici) keeps a small,
 * fixed pool of concurrent connections per origin. If we fire more
 * concurrent requests at openlibrary.org / covers.openlibrary.org than
 * that pool allows, the excess doesn't fail — it queues silently at the
 * socket layer, and OUR OWN timeouts (SUBJECT_TIMEOUT_MS etc.) then fire
 * while the request is just sitting there waiting for a connection. This
 * is almost certainly what "times out the moment you click fast" is: we
 * were self-DDoSing our own connection pool. Capping concurrency here
 * means requests queue in our own code, visibly and boundedly, instead
 * of getting stuck invisibly at the OS/socket level.
 *
 * WATCHDOG TIMEOUT — added after tracing "covers stop loading entirely
 * after a reload, for everyone, until the server restarts" to a starved
 * queue. `active` only ever decrements in `run`'s `finally`, which only
 * fires once the caller's `fn()` settles. If a caller passes a `fn` that
 * hangs forever (e.g. an upstream fetch with no timeout of its own — see
 * the cover fetch this was guarding), that slot is gone permanently: not
 * failed, not slow, just gone. A burst of concurrent tasks (a full page
 * reload firing ~24 cover requests through a 6-slot limiter) only needs
 * ONE unlucky hang to eventually claim every slot and wedge the whole
 * queue shut. Every caller SHOULD set their own timeout (and now do —
 * see cover.ts), but this is the backstop: the limiter itself guarantees
 * a slot is reclaimed within `watchdogMs` no matter what a future caller
 * forgets. The original hung promise is abandoned (JS can't cancel an
 * in-flight fetch from here), but the queue keeps moving either way.
 *
 * PRIORITY — added for fast repeated pagination. Every task used to
 * share one plain FIFO queue: a real, user-facing cover request (the
 * page someone is looking at right now) and a purely speculative one
 * (server-side warming for a page fetch, or the client's neighbor-page
 * browser-cache warming) waited in the exact same line. Click through
 * pages 2, 3, 4, 5 fast enough and by the time you land on 5, its real
 * covers can be queued BEHIND a pile of warming work for pages 2-4 that
 * you've already scrolled past and no longer care about — speculative
 * work starving the request that actually matters. `run(fn, priority)`
 * now has two queues; a freed slot always drains 'high' first. Real
 * HTTP requests (the actual /api/cover route, default) are 'high'.
 * Anything speculative — server-side fire-and-forget warming, the
 * client's off-DOM neighbor-page prewarm — is explicitly 'low', so it
 * only ever uses capacity the current page isn't asking for.
 */
export function createLimiter(concurrency: number, watchdogMs = 20000) {
  let active = 0
  const highQueue: Array<() => void> = []
  const lowQueue: Array<() => void> = []

  function releaseNext() {
    active--
    const resolve = highQueue.shift() ?? lowQueue.shift()
    if (resolve) {
      active++
      resolve()
    }
  }

  async function run<T>(fn: () => Promise<T>, priority: 'high' | 'low' = 'high'): Promise<T> {
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

/**
 * A token-bucket RATE limiter — a genuinely different dimension from the
 * concurrency semaphore above, and one nothing in this app was enforcing
 * until now. createLimiter caps how many requests run SIMULTANEOUSLY;
 * it says nothing about how many complete per SECOND. OpenLibrary's own
 * documented policy (see openlibrary.ts) is a rate — "3 requests/sec for
 * identified traffic" — not a concurrency cap. A concurrency limiter of
 * 9 with fast-completing requests (a quick JSON response, a cache hit)
 * can easily produce far more than 3 completions/sec, meaning the
 * concurrency limiter alone doesn't actually guarantee compliance with
 * the limit we're relying on for our "identified = higher allowance"
 * headroom. Getting rate-limited mid-request doesn't just mean slower —
 * it can mean a truncated or error response we'd otherwise have to
 * detect and recover from, which is a correctness risk (a book's total
 * count or cover coming back wrong/incomplete), not just a speed one.
 *
 * Tokens refill continuously (not in discrete per-second chunks) so
 * throughput stays smooth rather than bursting once per second and
 * stalling for the rest of it.
 */
export function createRateLimiter(requestsPerSecond: number) {
  const refillIntervalMs = 1000 / requestsPerSecond
  let tokens = requestsPerSecond
  let lastRefill = Date.now()
  const queue: Array<() => void> = []

  function refill() {
    const now = Date.now()
    const elapsed = now - lastRefill
    const newTokens = elapsed / refillIntervalMs
    if (newTokens >= 1) {
      tokens = Math.min(requestsPerSecond, tokens + newTokens)
      lastRefill = now
    }
  }

  function drainQueue() {
    while (tokens >= 1 && queue.length > 0) {
      tokens--
      const resolve = queue.shift()
      resolve?.()
    }
  }

  setInterval(() => {
    refill()
    drainQueue()
  }, Math.max(10, Math.floor(refillIntervalMs / 2))).unref?.()

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

// Layered on top of the concurrency limiters below: every OpenLibrary
// call now has to clear BOTH a concurrency slot AND a rate-limiter
// token before it's allowed through. Set at 2.5/sec (comfortably under
// OpenLibrary's documented 3/sec identified-traffic allowance, not
// pushed right up against it) — the margin matters because our own
// clock/timing isn't going to line up with theirs perfectly, and this
// budget is shared across every concurrent user this server has, not
// just one page load.
export const openLibraryRateLimiter = createRateLimiter(2.5)

// Two independent budgets for two very different kinds of upstream work.
// JSON metadata calls (subjects/works/authors) are latency-bound and
// cheap; cover fetches are bandwidth- AND CPU-bound (sharp resize on top
// of the download). Separate limiters mean a burst of cover warming can
// never starve out the metadata call the user is actually waiting on for
// the page to render, and vice versa.
//
// Cover concurrency raised from 6 to 9. A fully cold page is 24 covers;
// at 6 concurrent that's 4 sequential batches through COVER_FETCH_TIMEOUT_MS
// each — worst case ~24s (was 40s before the timeout was also tightened).
// At 9 it's 3 batches, worst case ~18s. This is safe to raise now in a
// way it wasn't before: every request identifies itself via
// OPENLIBRARY_HEADERS (see openlibrary.ts), and OpenLibrary's own docs
// give identified traffic 3x the allowance of anonymous requests — we're
// no longer the anonymous-burst case their rate limiting is aimed at.
export const openLibraryApiLimiter = createLimiter(10)
export const openLibraryCoverLimiter = createLimiter(9)