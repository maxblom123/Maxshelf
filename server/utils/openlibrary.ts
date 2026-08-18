/**
 * OpenLibrary explicitly rate-limits by whether a request identifies
 * itself: unidentified requests (no User-Agent) are capped at 1 req/sec,
 * identified ones (User-Agent + contact) get 3x that — and OpenLibrary's
 * own docs warn that unidentified traffic "may result in aggressive
 * rate limiting or blocking" under burst load.
 * https://openlibrary.org/developers/api
 *
 * None of our outgoing requests (subjects, works, authors, covers) were
 * setting this, which fits the "everything intermittently and silently
 * fails under a burst" pattern we kept hitting — a page load easily
 * fires 20+ concurrent requests, exactly the burst OpenLibrary's docs
 * describe as likely to get throttled or dropped when unidentified. Our
 * own per-request timeouts and the limiter's watchdog only convert that
 * into a clean failure instead of a hang — they can't make a throttled
 * request succeed. Identifying ourselves is the actual fix.
 *
 * Centralized here (not repeated per call site) so it's structurally
 * impossible for a future upstream call to forget it.
 */
export const OPENLIBRARY_HEADERS = {
  'User-Agent': 'Maxshelf/1.0 (https://github.com/maxblom123/maxshelf)',
}