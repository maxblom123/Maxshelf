<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { Select } from '@maxblom/headlessmax'
import type { BookDetail } from '~~/server/utils/bookDetail'
import type { BooksResult } from '~~/server/utils/books'

definePageMeta({
  layout: 'blank',
})

useHead({
  title: 'Books | Maxshelf',
  // Safari (both iOS's status bar/toolbar and macOS 15+'s tab bar) tints
  // its own chrome to match theme-color, and — since Nuxt's useHead is
  // reactive to route changes — updates it automatically on every
  // client-side navigation between pages, no manual work needed beyond
  // setting the right value per page. This has to match this page's
  // ACTUAL top-of-viewport color, not just "the site's" color generically
  // — the topnav here is white, but /account's hero bar is black, so a
  // single global value would be wrong on at least one of them.
  meta: [{ name: 'theme-color', content: '#ffffff' }],
  link: [
    { rel: 'preconnect', href: 'https://covers.openlibrary.org' },
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
    {
      rel: 'stylesheet',
      href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
    },
  ],
})

// Every card gets this same flat background — the earlier per-index
// palette was a misread of the ask. Uniform card sizing below is what
// actually needs to be deterministic.
const CARD_BACKGROUND = '#fff'

const genreOptions = [
  { label: 'Fiction', value: 'fiction' },
  { label: 'Fantasy', value: 'fantasy' },
  { label: 'Science Fiction', value: 'science_fiction' },
  { label: 'Mystery', value: 'mystery' },
  { label: 'Romance', value: 'romance' },
  { label: 'History', value: 'history' },
  { label: 'Biography', value: 'biography' },
  { label: 'Science', value: 'science' },
]

const route = useRoute()
const router = useRouter()

const validGenres = genreOptions.map((g) => g.value)

// The URL is now the source of truth for the selected genre, not local
// state. Reading falls back to 'fiction' if the query param is missing or
// contains something outside our curated list (e.g. someone hand-editing
// the URL). Writing uses router.replace (not push) so picking a different
// genre doesn't spam the browser's back-button history with every change.
// Also resets page back to 1 — otherwise switching genres while deep on
// page 12 of Fiction could land you past the end of a smaller genre's
// results.
// A sanity ceiling against pathological/manual input (someone typing
// ?page=99999999999 by hand), NOT a stand-in for "the real last page."
// Fiction alone has 665,155 books ÷ 24/page = 27,714 real pages — well
// past the old value of 500 this used to be, which is exactly why that
// old value was silently mismatching what lastPage (below) actually
// computes. Set generously above any realistic genre size rather than
// tied to one; must match books.get.ts's own MAX_PAGE (duplicated by
// hand across the two files, same as VALID_SUBJECTS already is).
const MAX_PAGE = 1_000_000

const selectedGenre = computed({
  get: () => {
    const genre = route.query.genre as string | undefined
    return genre && validGenres.includes(genre) ? genre : 'fiction'
  },
  set: (value: string) => {
    router.replace({ query: { ...route.query, genre: value, page: undefined } })
  },
})

// Page navigation uses push (not replace, unlike genre) so the back
// button steps back through pages the way people expect for pagination.
const currentPage = computed({
  get: () => {
    const rawPage = Number(route.query.page)
    return Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= MAX_PAGE ? rawPage : 1
  },
  set: (value: number) => {
    router.push({ query: { ...route.query, page: value } })
  },
})

// The rule requested: always show the current page plus the two pages
// after it (e.g. on page 1 -> 1, 2, 3; on page 5 -> 5, 6, 7). Based on
// pendingPage (below), not currentPage — this is what makes the button
// labels/highlight feel instantly responsive during a rapid click burst
// even though the actual navigation is debounced.
//
// Filtered against lastPage, not MAX_PAGE — MAX_PAGE is just a sanity
// ceiling (1,000,000), completely disconnected from any real genre's
// actual result count. Without this, the window could show page numbers
// that don't exist at all (e.g. on page 4379 of Science with a real
// lastPage of 4380, the old MAX_PAGE-only filter would still offer 4380
// AND a nonexistent 4381) — this is what makes pagination genuinely end
// at the real boundary instead of just visually implying more exists.
const paginationPages = computed(() =>
  [pendingPage.value, pendingPage.value + 1, pendingPage.value + 2].filter((p) => p <= lastPage.value)
)

// Separate from the visual one above — this tracks the ACTUAL committed
// page (post-debounce), used only to decide which pages are worth
// prewarming. Prewarming every page someone's cursor merely passed
// through during a rapid click burst would be wasted work; only the
// page that's actually going to render matters. Same lastPage bound as
// above, for the same reason — no point prewarming a page number past
// the genre's actual last page.
const committedPaginationPages = computed(() =>
  [currentPage.value, currentPage.value + 1, currentPage.value + 2].filter((p) => p <= lastPage.value)
)

// The API's fixed page size (books.ts: limit = 24) — used to derive the
// actual last page for whichever genre is currently selected, from the
// real total book count the most recent successful fetch returned.
// Deliberately NOT clamped to MAX_PAGE — that constant exists as a
// sanity ceiling against pathological input (see books.get.ts), not as
// a stand-in for "the real answer is too big to compute." A clamped
// value here would show a "last page" that doesn't match what's real,
// and worse, would silently mismatch the server's own validation range
// (see the MAX_PAGE bump below) — clicking it needs to land on the
// actual last page, not get redirected back to page 1. Falls back to 1
// before any data has loaded yet, since "unknown" isn't a valid page.
const BOOKS_PER_PAGE = 24
const lastPage = computed(() => {
  if (!data.value) return 1
  return Math.max(1, Math.ceil(data.value.total / BOOKS_PER_PAGE))
})

// DEBOUNCED PAGE NAVIGATION, WITH A MAX WAIT — fast repeated clicking
// (mashing "next") used to be a real "stuck on loading" bug, not just a
// feel issue: every click calls currentPage's setter, which calls
// router.push, which triggers a watched refetch — and useFetch's default
// dedupe CANCELS an in-flight request the instant a new one starts.
// Click faster than a single fetch can complete and every request
// cancels the one before it before ANY of them ever resolves; the grid
// just stays dimmed indefinitely for as long as clicking continues, with
// nothing ever finishing. `pendingPage` updates instantly on every click
// — so the highlighted number, visible page range, and disabled states
// all stay snappy — while the actual `currentPage` commit (the thing
// that fires router.push and the real fetch) only happens once clicking
// has paused for `PAGE_DEBOUNCE_MS`.
//
// A pure debounce isn't enough at genuinely sustained speed, though: at
// ~10 clicks/sec (one every ~100ms), each click arrives well inside the
// 250ms debounce window and keeps resetting it — meaning if someone
// sustains that rate for several seconds straight, the debounce alone
// would NEVER fire until they fully stop, showing zero progress the
// entire time. `PAGE_MAX_WAIT_MS` is the fix: a second timer, started
// once at the beginning of a burst (not reset per click), that forces a
// commit at a steady cadence regardless of how continuously clicking
// keeps coming. The result: brief pauses collapse a burst into one
// navigation (debounce), and sustained mashing still makes real,
// periodic progress instead of going silent (max wait) — this is the
// same debounce+maxWait pattern behind e.g. lodash's `_.debounce` with
// its `maxWait` option, just written by hand rather than pulling in a
// dependency for it.
const PAGE_DEBOUNCE_MS = 250
const PAGE_MAX_WAIT_MS = 600
const pendingPage = ref(currentPage.value)
let pageDebounceTimer: ReturnType<typeof setTimeout> | null = null
let pageMaxWaitTimer: ReturnType<typeof setTimeout> | null = null

// Keeps pendingPage in sync when currentPage changes from anywhere else
// (browser back/forward, a genre switch resetting to page 1, a direct
// URL edit) — otherwise the pagination UI could keep showing a stale
// target that no longer matches the actual page.
watch(currentPage, (page) => {
  pendingPage.value = page
})

function commitPendingPage() {
  if (pageDebounceTimer) clearTimeout(pageDebounceTimer)
  if (pageMaxWaitTimer) clearTimeout(pageMaxWaitTimer)
  pageDebounceTimer = null
  pageMaxWaitTimer = null
  currentPage.value = pendingPage.value
}

function goToPage(page: number) {
  // Bounded by lastPage, not just MAX_PAGE — this is the actual "genuine
  // end" the navigation stops at. MAX_PAGE alone (a disconnected sanity
  // ceiling) would still let a "next" click or a manually-typed
  // ?page=99999 land past the real last page and render an empty/broken
  // page; clamping here means it's simply not possible to navigate past
  // the true end at all, only back from it.
  if (page < 1 || page > lastPage.value) return
  pendingPage.value = page

  if (pageDebounceTimer) clearTimeout(pageDebounceTimer)
  pageDebounceTimer = setTimeout(commitPendingPage, PAGE_DEBOUNCE_MS)

  // Only ever started, never reset, while a burst is already in
  // progress — that's what turns this into a periodic ceiling rather
  // than just a second debounce.
  if (!pageMaxWaitTimer) {
    pageMaxWaitTimer = setTimeout(commitPendingPage, PAGE_MAX_WAIT_MS)
  }
}

onUnmounted(() => {
  if (pageDebounceTimer) clearTimeout(pageDebounceTimer)
  if (pageMaxWaitTimer) clearTimeout(pageMaxWaitTimer)
})

// BOUNDED CACHES — a genuinely sustained session (the kind that prompted
// this: minutes of continuous rapid pagination) touches a LOT of
// distinct pages over time. pageCache, loadedImages, and failedImages
// all grow by one entry per distinct page/book seen and never shrank on
// their own — over a long enough session that's unbounded memory
// growth, the one thing the debounce/maxWait logic above doesn't
// protect against (that logic is stateless per click and behaves
// identically at 2 seconds or 200; what actually scales with DURATION is
// accumulated state, not click-handling logic). These two tiny helpers
// give every growing cache a hard ceiling with FIFO eviction (JS Maps
// and Sets both iterate in insertion order, so the "oldest" entry is
// just whatever `.keys().next()` / `.values().next()` returns) — cheap,
// dependency-free, and bounded regardless of how long someone keeps
// paginating.
function setBounded<K, V>(map: Map<K, V>, key: K, value: V, maxEntries: number) {
  map.set(key, value)
  if (map.size > maxEntries) {
    const oldestKey = map.keys().next().value
    if (oldestKey !== undefined) map.delete(oldestKey)
  }
}

function addBounded<T>(set: Set<T>, value: T, maxEntries: number) {
  set.add(value)
  if (set.size > maxEntries) {
    const oldestValue = set.values().next().value
    if (oldestValue !== undefined) set.delete(oldestValue)
  }
}

// 50 pages is generous headroom past what a genuinely sustained rapid-
// pagination session actually needs to keep instantly revisitable (the
// most recent stretch of browsing), while keeping a hard ceiling on how
// much listing data can ever be held in memory at once.
const PAGE_CACHE_MAX_ENTRIES = 50

const query = computed(() => ({
  q: selectedGenre.value,
  page: currentPage.value,
}))

// CLIENT-SIDE PAGE CACHE — useFetch's own `key` is fixed at setup time
// (it doesn't re-evaluate per genre/page like `query` does), so it can't
// natively give each genre+page combo its own cache slot. This plain Map
// does that job ourselves: `getCachedData` is consulted on every watch-
// triggered refetch (genre change, page change), and if we already have
// that combo cached, useFetch skips the network call entirely — flipping
// back to a page you've already visited this session is instant and
// costs zero requests, which also means less load on the OpenLibrary-
// backed API behind it, not just a snappier UI.
const pageCache = new Map<string, BooksResult>()
const pageCacheKey = (genre: string, page: number) => `${genre}-${page}`

const { data, status, error, refresh } = await useFetch<BooksResult>('/api/books', {
  key: 'books-list',
  query,
  getCachedData: () => pageCache.get(pageCacheKey(selectedGenre.value, currentPage.value)),
})

// AUTOMATIC RETRY WITH BACKOFF — a timeout used to just show a static
// error with a manual button. If the failure is genuinely transient
// (OpenLibrary took too long, a network blip), the very next attempt
// often just works — no reason to make someone click for that. Backoff
// (1s, 2s, 4s, 8s, capped at 10s) rather than immediate retry matters
// specifically for the reason we've hit this exact class of problem
// before in this app: a timeout is frequently a SIGN of the upstream
// already being under load, so retrying instantly would just add to
// that load right when it's least able to take it — buffering the retry
// gives it room to actually recover.
//
// Only retries genuinely transient failures. A 400 (invalid genre) or
// 404 is a deterministic client-side problem retrying can't fix — only
// backs off on no status code at all (a raw network failure) or 5xx
// (which is what our own server's timeout wrapper throws: 504).
const RETRY_MAX_ATTEMPTS = 5
const RETRY_BASE_DELAY_MS = 1000
const RETRY_MAX_DELAY_MS = 10000

const retryAttempt = ref(0)
const retryCountdown = ref(0)
let retryTimer: ReturnType<typeof setTimeout> | null = null
let retryCountdownInterval: ReturnType<typeof setInterval> | null = null

function isRetryableError(err: unknown): boolean {
  const statusCode = (err as { statusCode?: number })?.statusCode
  return statusCode === undefined || statusCode >= 500
}

function clearRetryTimers() {
  if (retryTimer) clearTimeout(retryTimer)
  if (retryCountdownInterval) clearInterval(retryCountdownInterval)
  retryTimer = null
  retryCountdownInterval = null
}

function scheduleRetry() {
  clearRetryTimers()
  const delay = Math.min(RETRY_BASE_DELAY_MS * 2 ** retryAttempt.value, RETRY_MAX_DELAY_MS)
  retryCountdown.value = Math.ceil(delay / 1000)

  retryCountdownInterval = setInterval(() => {
    retryCountdown.value = Math.max(0, retryCountdown.value - 1)
  }, 1000)

  retryTimer = setTimeout(() => {
    clearRetryTimers()
    retryAttempt.value++
    refresh()
  }, delay)
}

function manualRetry() {
  retryAttempt.value = 0
  clearRetryTimers()
  refresh()
}

watch(
  error,
  (err) => {
    // A 404 (nonexistent page — see the check in books.get.ts) is
    // deliberately NOT handled by the local retry UI at all: it's not
    // transient (isRetryableError already excludes it from auto-retry),
    // and it deserves more than a small error box inside the grid —
    // showError() escalates it into Nuxt's actual global error page
    // (app/error.vue), with the correct HTTP status code and a real
    // "back to home" experience, same as a genuinely broken URL should
    // get.
    const statusCode = (err as { statusCode?: number })?.statusCode
    if (statusCode === 404) {
      clearRetryTimers()
      showError(err as any)
      return
    }

    if (err && isRetryableError(err) && retryAttempt.value < RETRY_MAX_ATTEMPTS) {
      scheduleRetry()
    } else {
      clearRetryTimers()
    }
  },
  // immediate: true matters here specifically for a direct/fresh
  // navigation straight to an already-invalid URL (e.g. typing
  // ?page=277152 and hitting enter): the blocking `await useFetch` above
  // means error.value can ALREADY be the 404 on the very first render,
  // with no prior "valid" state to change FROM. A plain watch (default
  // immediate: false) only fires on a subsequent CHANGE, so it would
  // silently never run at all in that case — the escalation only worked
  // for errors that occurred AFTER an initial successful load (e.g.
  // clicking into a bad page from a working one), not a direct hit.
  { immediate: true }
)

// A fresh navigation target (a different page or genre) gets a clean
// retry budget — an exhausted retry count from a PREVIOUS failed page
// shouldn't carry over and suppress auto-retry on a new one, and any
// retry timer still pending for the old target is cancelled rather than
// firing late against whatever query is current by then.
watch([currentPage, selectedGenre], () => {
  retryAttempt.value = 0
  clearRetryTimers()
})

watch(data, (value) => {
  if (value) {
    retryAttempt.value = 0
    clearRetryTimers()
    setBounded(pageCache, pageCacheKey(selectedGenre.value, currentPage.value), value, PAGE_CACHE_MAX_ENTRIES)
  }
})

onUnmounted(() => {
  clearRetryTimers()
})

// FAVORITES VIEW — a self-contained overlay on top of the normal
// paginated grid, not woven into it. Toggling it swaps what's shown in
// .content entirely; it doesn't touch currentPage/selectedGenre/query or
// any of the pagination machinery above, which keeps this from putting
// the already-fairly-complex debounce/prefetch/retry system at risk of
// a regression for the sake of a feature that's logically independent
// of it. Same inlined-not-imported localStorage pattern as the
// bag/favorites logic elsewhere (see [slug].vue's toggleFavorite for the
// full reasoning) — a plain array of book ids, read fresh whenever the
// view is turned on.
const FAVORITES_KEY = 'maxshelf-favorites'

interface FavoriteBook {
  id: string
  title: string
  authors: string[]
  coverUrl: string | null
}

const showFavoritesOnly = ref(false)
const favoriteBooks = ref<FavoriteBook[]>([])
const favoritesLoading = ref(false)

async function loadFavorites() {
  favoritesLoading.value = true

  let favoriteIds: string[] = []
  try {
    const raw = localStorage.getItem(FAVORITES_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      favoriteIds = Array.isArray(parsed) ? parsed : []
    }
  } catch {
    favoriteIds = []
  }

  if (favoriteIds.length === 0) {
    favoriteBooks.value = []
    favoritesLoading.value = false
    return
  }

  const results = await Promise.allSettled(
    favoriteIds.map((id) =>
      $fetch<BookDetail>(`/api/book/${id}`).then(
        (detail): FavoriteBook => ({
          id,
          title: detail.title,
          authors: detail.authors,
          coverUrl: detail.coverUrl,
        })
      )
    )
  )

  favoriteBooks.value = results
    .filter((r): r is PromiseFulfilledResult<FavoriteBook> => r.status === 'fulfilled')
    .map((r) => r.value)

  favoritesLoading.value = false
}

function toggleFavoritesView() {
  showFavoritesOnly.value = !showFavoritesOnly.value
  if (showFavoritesOnly.value) loadFavorites()
}

// Prefetches a page on hover/focus of the pagination controls, same
// spirit as prefetchBook below: a raw $fetch (not useAsyncData — that
// pattern threw NUXT_E3003 the last time it was tried from an event
// handler, see prefetchBook's note) written straight into pageCache, so
// by the time the click actually lands, getCachedData above often finds
// it already there and the click is instant instead of waiting on a
// fresh request.
const pagePrefetchesInFlight = new Set<string>()

function prefetchPage(page: number) {
  // Same lastPage bound as goToPage — no point prefetching (or even
  // being able to hover-trigger a prefetch for) a page number past the
  // genre's real last page.
  if (page < 1 || page > lastPage.value) return

  const genre = selectedGenre.value
  const key = pageCacheKey(genre, page)
  if (pageCache.has(key) || pagePrefetchesInFlight.has(key)) return

  pagePrefetchesInFlight.add(key)
  $fetch<BooksResult>('/api/books', { query: { q: genre, page } })
    .then((result) => {
      setBounded(pageCache, key, result, PAGE_CACHE_MAX_ENTRIES)
      warmCoverImages(result)
    })
    .catch(() => {
      // Silent on prefetch failure — an actual click will surface the
      // error normally through the real useFetch call if it still fails.
    })
    .finally(() => {
      pagePrefetchesInFlight.delete(key)
    })
}

// The listing $fetch above only warms the server's cache — the browser
// itself still hasn't seen these cover images, so navigating to the
// neighbor page would still cost a real network round-trip per cover
// even with the server fully warm. This closes that gap: silently
// loading each cover URL into an off-DOM Image means the browser's own
// HTTP cache has it (the /api/cover route already sends a week-long
// immutable Cache-Control), so when the neighbor page actually renders,
// its <img> tags resolve from that cache with zero network involved —
// genuinely instant rather than just "fast".
//
// fetchPriority: 'low' matters here — this fires ~24 requests behind
// the scenes while the CURRENT page's own visible covers may still be
// loading. Without deprioritizing, these background prefetches would
// compete for the same handful of concurrent browser connections and
// could slow down the covers someone is actually looking at right now.
// Consistency for the neighbor page shouldn't come at the cost of
// consistency for the current one.
//
// Uses fetch(), not `new Image()`, specifically so a custom header can
// ride along: `X-Cover-Priority: low` tells the server (see the cover
// route) to queue this behind real, user-facing requests in
// openLibraryCoverLimiter — see the priority note in limiter.ts. This
// deliberately does NOT touch the URL itself (no query param, nothing)
// — the browser's HTTP cache is keyed on the exact URL, and the real
// <img> on the eventual page requests this same bare /api/cover/:id.
// Any difference in the URL would mean the warmed response never gets
// reused, defeating the entire point of this function. Response body is
// discarded; the point is purely to make the browser cache it.
function warmCoverImages(result: BooksResult) {
  for (const book of result.books) {
    if (!book.coverUrl) continue
    fetch(book.coverUrl, {
      headers: { 'X-Cover-Priority': 'low' },
      priority: 'low',
    }).catch(() => {
      // Silent — this is purely speculative, a real <img> request will
      // just fetch normally if this never lands.
    })
  }
}

// Beyond hover — proactively prewarm every page that's ACTUALLY
// clickable in the pagination nav right now, not just the immediate
// ±1 neighbor. The nav shows three page-number buttons (current,
// current+1, current+2 — see paginationPages) plus both chevrons, so
// current+2 was sitting there as a real, visible, clickable target that
// was never being warmed at all. This is the actual "physical limit"
// worth pushing to: warm exactly the surface someone can click without
// typing a new URL — nothing wasted on pages that aren't reachable yet,
// nothing left cold that is. Landing on page 5 warms 4, 6, and 7 (the
// prev chevron's target, plus both forward number buttons beyond the
// current one), all immediately, without waiting for hover.
//
// Deliberately client-only (inside onMounted, not a bare top-level
// watch) — the server already warms whatever page THIS request is for
// via the fire-and-forget cover warming in books.ts, so doing this
// during SSR too would just double up that work for no benefit; this is
// purely about warming pages adjacent to the one already rendered.
onMounted(() => {
  watch(
    [currentPage, committedPaginationPages],
    ([page, visiblePages]) => {
      prefetchPage(page - 1)
      for (const p of visiblePages) {
        if (p !== page) prefetchPage(p)
      }
    },
    { immediate: true }
  )
})

const loadedImages = ref<Set<string>>(new Set())
const failedImages = ref<Set<string>>(new Set())

// Same bounded principle as pageCache above — one entry per book id ever
// seen, across however many pages a sustained session visits, with no
// natural ceiling otherwise. 500 is comfortably more than what's ever
// simultaneously relevant on screen or one prefetch-hop away.
const IMAGE_STATE_MAX_ENTRIES = 500

function onImageLoad(bookId: string) {
  addBounded(loadedImages.value, bookId, IMAGE_STATE_MAX_ENTRIES)
}

function onImageError(bookId: string) {
  addBounded(failedImages.value, bookId, IMAGE_STATE_MAX_ENTRIES)
}

// SSR HYDRATION RACE — this is why covers appeared stuck on a hard
// reload but always worked after client-side navigation. These <img>
// tags are rendered server-side, so the browser can start (and finish)
// loading them the instant it parses the HTML — before our JS bundle
// has even downloaded, let alone hydrated and attached the @load
// listener below. If the image's native `load` event fires before that
// listener exists, it's gone: nobody catches it, `loadedImages` never
// gets the id, and the cover sits at opacity:0 under the shimmer
// forever, even though the bytes are already sitting in the browser.
// Client-side navigation never hits this (Vue creates the <img> and
// attaches the listener before the request even starts), which is
// exactly why "click a book, then go back" always showed the covers.
//
// Fix: don't rely solely on catching the event. Once the element is
// mounted, check its `.complete` state directly — that's a snapshot of
// current status, not an event, so it works whether or not we missed
// the `load` event firing earlier.
//
// This also already covers pagination: each page swap replaces the book
// array with new ids, so v-for's :key="book.id" fully unmounts/remounts
// every card's <img>. The .complete check re-runs on every one of those
// fresh mounts, so a page navigated to from cache (see pageCache below,
// image already sitting in the browser's HTTP cache from a prior visit
// or hover-prefetch) still gets marked loaded correctly instead of
// re-triggering the same class of race this was built to fix.
function setCoverRef(bookId: string, el: Element | null) {
  if (el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0) {
    onImageLoad(bookId)
  }
}

// Prefetches a book's detail data on hover/focus, seeded under the SAME
// key the detail page uses (`book-detail-${id}`). NuxtLink already
// prefetches the destination's .vue chunk on visibility by default, but
// NOT its data — this fills that gap so the actual click has nothing left
// to wait on.
//
// Deliberately a raw $fetch, not useAsyncData/useFetch: those composables
// must be called during a component's setup() to work correctly — calling
// them from an event handler after mount (like this) throws NUXT_E3003.
// The tradeoff is we lose automatic request-dedup with the detail page's
// own useFetch call for the same key, so a fast click can still cause two
// requests in flight for the same id. What we DON'T lose safety on: we
// only ever write `data.value` if it's still empty at the moment this
// resolves. That means whichever request the user is actually waiting on
// (the detail page's own useFetch, once mounted) always wins — a slower,
// straggling prefetch response can never come back later and silently
// overwrite already-rendered, correct data. And if the prefetch DOES
// resolve first, useFetch on the detail page will see the key already
// populated and skip firing its own request, so the common (non-race)
// case still avoids the duplicate fetch.
function prefetchBook(id: string) {
  const nuxtApp = useNuxtApp()
  const key = `book-detail-${id}`

  nuxtApp.runWithContext(() => {
    const { data } = useNuxtData<BookDetail>(key)
    if (data.value) return

    $fetch<BookDetail>(`/api/book/${id}`)
      .then((result) => {
        if (!data.value) {
          data.value = result
        }
      })
      .catch(() => {
        // Silent on prefetch failure — the real navigation's useFetch will
        // surface the error normally if it still fails on click.
      })
  })
}
</script>

<template>
  <nav class="topnav">
    <NuxtLink to="/books" class="topnav-brand">MAXSHELF.COM</NuxtLink>
    <div class="topnav-links">
      <NuxtLink to="/bag" class="topnav-link">Bag</NuxtLink>
      <NuxtLink to="/account" class="topnav-link">Account</NuxtLink>
    </div>
  </nav>
  <main class="layout">
    <aside class="sidebar">
      <div v-if="error" class="error-box">
        <p style="margin: 0 0 0.5rem;">
          {{ error.statusMessage || 'Something went wrong loading books.' }}
        </p>
        <p v-if="retryAttempt < RETRY_MAX_ATTEMPTS && retryCountdown > 0" class="retry-status">
          Retrying in {{ retryCountdown }}s… (attempt {{ retryAttempt + 1 }}/{{ RETRY_MAX_ATTEMPTS }})
        </p>
        <p v-else-if="retryAttempt >= RETRY_MAX_ATTEMPTS" class="retry-status">
          Gave up after {{ RETRY_MAX_ATTEMPTS }} attempts.
        </p>
        <button @click="manualRetry">Try again</button>
      </div>

      <template v-else>
        <p v-if="data" class="count">{{ data.total.toLocaleString('en-US') }} books found</p>
      </template>

      <!-- Grouped specifically so these two controls (not the count
           text above, which is fine scrolling away) can be pinned
           together as one sticky unit on mobile — see .sidebar-controls
           below. -->
      <div class="sidebar-controls">
        <Select v-model="selectedGenre" :options="genreOptions" />

        <button
          type="button"
          class="favorites-toggle-btn"
          :class="{ 'is-active': showFavoritesOnly }"
          @click="toggleFavoritesView"
        >
          {{ showFavoritesOnly ? 'Showing Favorites' : 'View Favorites' }}
        </button>
      </div>
    </aside>

    <section class="content" style="position: relative;">
      <template v-if="showFavoritesOnly">
        <p v-if="favoritesLoading" class="status-text">Loading favorites&hellip;</p>

        <div v-else-if="favoriteBooks.length === 0" class="empty-state">
          <p class="status-text">No favorites yet.</p>
        </div>

        <div
          v-else
          :style="{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 280px))',
            gap: '2rem',
            justifyContent: 'center',
            minWidth: 0,
          }"
        >
          <div v-for="book in favoriteBooks" :key="book.id" class="book-card" :style="{ background: CARD_BACKGROUND }">
            <NuxtLink
              :to="`/books/${bookSlug(book.title, book.id)}`"
              style="display: block; text-decoration: none; color: inherit;"
            >
              <div v-if="book.coverUrl" class="cover-wrap is-loaded">
                <img
                  :src="book.coverUrl"
                  :alt="book.title"
                  width="150"
                  height="225"
                  loading="lazy"
                  decoding="async"
                />
              </div>
              <p class="book-title">{{ book.title }}</p>
              <p class="book-author">{{ book.authors?.[0] || 'Unknown author' }}</p>
            </NuxtLink>
          </div>
        </div>
      </template>

      <template v-else>
        <div v-if="status === 'pending'" class="loading-overlay" aria-live="polite" aria-label="Loading">
          <div class="spinner" />
        </div>

        <div
          v-if="!error"
          :style="{ opacity: status === 'pending' ? 0.5 : 1, transition: 'opacity 0.2s' }"
        >
          <div
          :style="{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 280px))',
            gap: '2rem',
            justifyContent: 'center',
            minWidth: 0,
          }"
        >
          <div
            v-for="(book, index) in data?.books"
            :key="book.id"
            class="book-card"
            :style="{ background: CARD_BACKGROUND }"
          >
            <NuxtLink
              :to="{ path: `/books/${bookSlug(book.title, book.id)}`, query: { from: selectedGenre } }"
              style="display: block; text-decoration: none; color: inherit;"
              @pointerenter="prefetchBook(book.id)"
              @focus="prefetchBook(book.id)"
            >
              <div
                v-if="book.coverUrl"
                class="cover-wrap"
                :class="{ 'is-loaded': loadedImages.has(book.id), 'is-errored': failedImages.has(book.id) }"
              >
                <img
                  :src="book.coverUrl"
                  :alt="book.title"
                  width="150"
                  height="225"
                  :loading="index < 6 ? 'eager' : 'lazy'"
                  :fetchpriority="index < 6 ? 'high' : 'auto'"
                  decoding="async"
                  :ref="(el) => setCoverRef(book.id, el as Element | null)"
                  @load="onImageLoad(book.id)"
                  @error="onImageError(book.id)"
                />
              </div>
              <p class="book-title">{{ book.title }}</p>
              <p class="book-author">{{ book.authors[0] || 'Unknown author' }}</p>
            </NuxtLink>
          </div>
        </div>

        <nav class="pagination" aria-label="Page navigation">
          <button
            type="button"
            class="page-btn chevron"
            :disabled="pendingPage <= 1"
            aria-label="Previous page"
            @pointerenter="prefetchPage(pendingPage - 1)"
            @focus="prefetchPage(pendingPage - 1)"
            @click="goToPage(pendingPage - 1)"
          >
            &lsaquo;
          </button>

          <!-- Always-visible destinations, requested on top of the
               sliding "current, +1, +2" window: page 1 and the actual
               last page. Only rendered when NOT already covered by that
               window (avoids a duplicate "1" button when already on
               page 1 or 2, same idea for the last page), with an
               ellipsis in between whenever there's a real gap to skip
               over rather than an adjacent page that'd make the ellipsis
               misleading (e.g. window [3,4,5] and lastPage 6 shouldn't
               show "3 4 5 … 6" for a gap of zero). -->
          <button
            v-if="!paginationPages.includes(1)"
            type="button"
            class="page-btn page-btn-edge"
            :class="{ 'is-current': pendingPage === 1 }"
            :aria-current="pendingPage === 1 ? 'page' : undefined"
            @pointerenter="prefetchPage(1)"
            @focus="prefetchPage(1)"
            @click="goToPage(1)"
          >
            1
          </button>
          <span v-if="paginationPages[0] > 2" class="page-ellipsis page-btn-edge" aria-hidden="true">…</span>

          <button
            v-for="page in paginationPages"
            :key="page"
            type="button"
            class="page-btn"
            :class="{ 'is-current': page === pendingPage }"
            :aria-current="page === pendingPage ? 'page' : undefined"
            @pointerenter="prefetchPage(page)"
            @focus="prefetchPage(page)"
            @click="goToPage(page)"
          >
            {{ page }}
          </button>

          <!-- status !== 'pending' guard here matters for correctness,
               not just polish: lastPage is derived from data.value.total,
               and during a genre switch, data.value briefly still holds
               the PREVIOUS genre's result until the new fetch resolves.
               Without this guard, switching from Fiction (27,714 pages)
               to a smaller genre would flash Fiction's stale last-page
               number for a moment before the real one arrives — showing
               a number that's simply wrong, not just momentarily stale
               in a harmless way. Safer to show nothing here than to show
               an incorrect number. -->
          <span
            v-if="status !== 'pending' && paginationPages[paginationPages.length - 1] < lastPage - 1"
            class="page-ellipsis page-btn-edge"
            aria-hidden="true"
            >…</span
          >
          <button
            v-if="status !== 'pending' && !paginationPages.includes(lastPage)"
            type="button"
            class="page-btn page-btn-edge"
            :class="{ 'is-current': pendingPage === lastPage }"
            :aria-current="pendingPage === lastPage ? 'page' : undefined"
            @pointerenter="prefetchPage(lastPage)"
            @focus="prefetchPage(lastPage)"
            @click="goToPage(lastPage)"
          >
            {{ lastPage }}
          </button>

          <button
            type="button"
            class="page-btn chevron"
            :disabled="pendingPage >= lastPage"
            aria-label="Next page"
            @pointerenter="prefetchPage(pendingPage + 1)"
            @focus="prefetchPage(pendingPage + 1)"
            @click="goToPage(pendingPage + 1)"
          >
            &rsaquo;
          </button>
        </nav>
      </div>
      </template>
    </section>
  </main>
</template>

<style scoped>
.pagination {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: center;
  margin-top: 3rem;
}

.page-btn {
  min-width: 40px;
  height: 40px;
  padding: 0 0.75rem;
  font-family: inherit;
  font-size: 0.95rem;
  background: #fff;
  border: 3px solid #000;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.page-btn:hover {
  border-color: #ff2400;
}

.page-ellipsis {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  color: #666;
  font-weight: 700;
  user-select: none;
}

.page-btn.is-current {
  background: #000;
  color: #fff;
  border-color: #000;
  font-weight: 600;
}

.page-btn.chevron {
  font-size: 1.2rem;
  line-height: 1;
}

.page-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  border-color: #000;
}

.topnav {
  width: 100%;
  height: 80px;
  background: #fff;
  border-bottom: 3px solid #000;
  position: sticky;
  top: 0;
  z-index: 20;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2rem;
}

.topnav-brand {
  font-family: 'Inter', sans-serif;
  font-size: 1.1rem;
  font-weight: 900;
  letter-spacing: -0.01em;
  color: #000;
  text-decoration: none;
}

.topnav-links {
  display: flex;
  align-items: center;
  gap: 2rem;
}

.topnav-link {
  font-family: 'Inter', sans-serif;
  font-size: 0.95rem;
  font-weight: 500;
  color: #000;
  text-decoration: none;
}

.topnav-link:hover {
  text-decoration: underline;
}

.layout {
  display: flex;
  align-items: flex-start;
  min-height: 100vh;
  font-family: 'Inter', sans-serif;
}

.sidebar {
  width: 15%;
  flex-shrink: 0;
  box-sizing: border-box;
  padding: 2rem 1.5rem;
  position: sticky;
  top: 80px;
  height: calc(100vh - 80px);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.sidebar-controls {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.sidebar .count {
  margin: 0;
  color: #000;
  width: 100%;
  text-align: center;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Deliberately NOT inside the opacity-dimmed grid wrapper — this is a
     sibling positioned over it via .content's own position: relative, so
     the spinner itself stays fully visible while only the grid behind it
     dims to 0.5. Nested inside that wrapper, the spinner would inherit
     the same dimming and look half-transparent, which defeats the point
     of a loading indicator. pointer-events: none so it never blocks
     clicks on the pagination controls below it (which — per the earlier
     "don't get stuck on loading" fix — stay fully interactive during a
     fetch on purpose). */
  pointer-events: none;
}

.spinner {
  width: 44px;
  height: 44px;
  border: 4px solid #e4e4e4;
  border-top-color: #000;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.favorites-toggle-btn {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.85rem 1rem;
  background: #fff;
  border: 3px solid #000;
  font-family: inherit;
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: #000;
  cursor: pointer;
  transition: transform 0.1s ease, background 0.1s ease, color 0.1s ease;
}

.favorites-toggle-btn::before {
  content: '\2606';
  font-size: 1rem;
  line-height: 1;
}

.favorites-toggle-btn:hover {
  background: #ff2400;
  color: #fff;
  border-color: #ff2400;
}

.favorites-toggle-btn:active {
  transform: translate(2px, 2px);
}

.favorites-toggle-btn:focus-visible {
  outline: 3px solid #ff2400;
  outline-offset: 2px;
}

.favorites-toggle-btn.is-active {
  background: #000;
  color: #fff;
  border-color: #000;
}

.favorites-toggle-btn.is-active::before {
  content: '\2605';
  color: #ff2400;
}

.status-text {
  color: #666;
  font-size: 1rem;
  font-weight: 700;
  text-transform: uppercase;
}

.empty-state {
  padding: 2rem 0;
}

.error-box {
  padding: 1rem;
  background: #fff;
  border: 3px solid #ff2400;
}

.retry-status {
  margin: 0 0 0.5rem;
  color: #666;
  font-size: 0.9rem;
  font-weight: 600;
  text-transform: uppercase;
}

.content {
  width: 85%;
  /* Flex items default to min-width: auto, which means they refuse to
     shrink below their CONTENT's intrinsic minimum width — even though
     this is explicitly told to be 85%. If the grid inside (4 fixed-width
     280px cards + gaps) has a larger intrinsic minimum than the 85% slot
     actually has room for, the flex item just... doesn't shrink, and the
     whole page gets pushed wider than the viewport, producing the
     horizontal scrollbar. min-width: 0 overrides that default and lets
     this actually respect its 85% allocation, clipping/wrapping its
     contents instead of blowing out the layout. This is the standard,
     well-known fix for this exact class of flexbox overflow bug — not
     specific to any one genre's data, it was a general layout gap.
  */
  min-width: 0;
  box-sizing: border-box;
  padding: 2rem 2rem 2rem 0;
}

@media (max-width: 800px) {
  .layout {
    flex-direction: column;
  }

  .sidebar,
  .content {
    width: 100%;
    position: static;
    height: auto;
  }

  .sidebar {
    padding: 1.5rem;
    /* Overrides the base .sidebar rule (overflow-y: auto), which is what
       was actually clipping the open filter dropdown here — with
       height: auto above, the sidebar's box only sizes to its
       non-absolute content, but the Select's open options list is
       position: absolute (it doesn't count toward that height), so
       overflow-y: auto was cutting it off at the sidebar's shrink-to-fit
       boundary. */
    overflow: visible;
  }

  /* The actual fix for "filter and favorites must not get cut off AND
     must be sticky on mobile": the whole .sidebar isn't sticky anymore
     here (it stacks above the grid in normal flow, which is correct —
     the book count text scrolling away is fine), but THIS specific
     group is pinned on its own, right below the sticky topnav (top:
     80px matches its height exactly, so they sit flush with no gap or
     overlap), so the filter and favorites toggle stay reachable no
     matter how far down the grid someone has scrolled. */
  .sidebar-controls {
    position: sticky;
    top: 80px;
    z-index: 15;
    background: #fff;
    padding: 1rem 0;
    margin: 0 -1.5rem;
    padding-left: 1.5rem;
    padding-right: 1.5rem;
    border-bottom: 3px solid #000;
  }

  .content {
    padding: 0 1.5rem 2rem;
  }

  .topnav {
    padding: 0 1.25rem;
  }

  .topnav-brand {
    font-size: 0.95rem;
  }

  .topnav-links {
    gap: 1.25rem;
  }
}

@media (max-width: 480px) {
  /* This is the actual fix for the crooked wrap — not a nicer wrap, but
     removing the need to wrap at all. Button widths vary a lot (compare
     "1" to "27715"), so flex-wrap naturally produces an uneven last row
     no matter how the sizing is tuned — that's what the lone orphaned
     "›" on its own row was. Hiding the jump-to-first/jump-to-last
     shortcuts (and their ellipses) leaves only the chevrons + the
     3-button sliding window — 5 buttons max, which reliably fits one
     line even on a narrow phone without ever needing to wrap. The
     shortcuts themselves aren't gone, just not worth the space at this
     width; paging through via next/prev still works exactly the same.
  */
  .page-btn-edge {
    display: none;
  }
}

@media (max-width: 420px) {
  .topnav-brand {
    font-size: 0.8rem;
  }

  .pagination {
    gap: 0.5rem;
  }

  .page-btn {
    min-width: 36px;
    height: 36px;
    padding: 0 0.5rem;
    font-size: 0.85rem;
  }
}
/* Card height no longer needs content-visibility/contain-intrinsic-size:
   each page of this grid only ever renders 24 items (the API's fixed
   page size) — nowhere near the list length content-visibility is
   meant for. It was buying negligible render-cost savings while causing
   a real cost: contain-intrinsic-size is a FIXED pixel estimate, but the
   grid's columns (minmax(150px, 1fr)) stretch to fill available width,
   so actual card height at any real viewport width was nowhere near the
   fixed estimate — that mismatch, not just title-length variance, was
   the bigger driver of the reflow/jitter as cards crossed the render
   boundary during scroll. Keeping the title/author clamping below since
   uniform card heights are good regardless; just dropping the
   content-visibility trick that wasn't earning its keep at this scale.
*/
/* Card sizing now lives on the grid tracks themselves
   (gridTemplateColumns: repeat(auto-fit, minmax(min(150px, 100%), 280px))
   + justify-content: center, above), not here. Grid tracks — like flex
   items — have their own separate "automatic minimum size" default
   based on content, which a min-width on the grid CONTAINER does
   nothing to change; the actual fix is minmax(...) on each TRACK. That
   superseded an earlier attempt at this (1fr columns + width:
   min(280px, 100%) here) which fixed the OUTER flex-vs-layout overflow
   but left this INNER grid-track overflow completely unaddressed —
   hence the same horizontal-scrollbar symptom persisting after that
   first fix.

   auto-fit (not a fixed repeat(4, ...)) is what makes this genuinely
   responsive without any hand-picked breakpoints: the browser fits as
   many 280px-max columns as actually fit the available width, and
   min(150px, 100%) as the floor means that minimum itself shrinks to
   whatever room exists on a screen narrower than 150px rather than
   forcing an overflow. 4 columns on a wide desktop, naturally down to 1
   on a narrow phone, with every step in between figured out by the grid
   algorithm itself — not a set of guessed max-width media queries that
   only cover the specific device widths someone thought to test.
   justify-content: center keeps the used columns centered as a set
   whenever fewer of them fit than would fill the row exactly.
*/
.book-card {
  width: 100%;
  padding: 1.25rem;
  box-sizing: border-box;
  border: 3px solid #000;
  box-shadow: 6px 6px 0 #000;
}

.book-title {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-weight: 900;
  text-transform: uppercase;
  margin: 0.5rem 0 0.25rem;
  line-height: 1.3;
  min-height: 2.6em;
}

.book-author {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin: 0;
  color: #666;
}

/* aspect-ratio, not a fixed height — with repeat(auto-fit, minmax(...))
   above, every track in the grid is already guaranteed the same width
   (CSS Grid distributes space evenly among repeated tracks), so same
   width -> same height under a fixed ratio gives every card in a row
   identical height without needing to hardcode one. Crucially, this is
   also what makes covers scale correctly at any screen size: a fixed
   px height stayed 320px tall even as columns shrank toward 150px on a
   phone, badly distorting the 2:3 book-cover proportions into something
   closer to 1:2.1. aspect-ratio scales the height WITH whatever width
   the responsive grid actually lands on, at every breakpoint, with no
   media query needed for this specifically either.
*/
.cover-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 2 / 3;
  overflow: hidden;
  border: 3px solid #000;
  background: linear-gradient(100deg, #ddd 30%, #eee 50%, #ddd 70%);
  background-size: 200% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}

.cover-wrap.is-loaded {
  animation: none;
  background: none;
}

.cover-wrap.is-errored {
  animation: none;
  background: #eee;
}

.cover-wrap.is-errored::after {
  content: 'NO COVER';
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: #666;
}

.cover-wrap img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.3s ease;
  display: block;
}

.cover-wrap.is-loaded img {
  opacity: 1;
}

@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* --- Select styling ---
   Select is a headless component (no built-in styles by design), and its
   button/list are rendered by ITS OWN template, not this page's — so
   plain scoped selectors can't reach them. :deep() pierces Vue's style
   scoping to target the component's internal DOM from here. */

:deep(.select-root) {
  position: relative;
  display: block;
  width: 100%;
  font-family: inherit;
}

:deep(.select-root > button) {
  width: 100%;
  box-sizing: border-box;
  padding: 0.85rem 2.75rem 0.85rem 1.15rem;
  font-size: 0.9rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  text-align: left;
  background: #fff;
  border: 3px solid #000;
  cursor: pointer;
  position: relative;
  transition: transform 0.1s ease;
}

:deep(.select-root > button::after) {
  content: '';
  position: absolute;
  right: 1.15rem;
  top: 50%;
  width: 8px;
  height: 8px;
  border-right: 2px solid #ff2400;
  border-bottom: 2px solid #ff2400;
  transform: translateY(-70%) rotate(45deg);
  transition: transform 0.2s ease;
  pointer-events: none;
}

:deep(.select-root > button[aria-expanded='true']::after) {
  transform: translateY(-30%) rotate(225deg);
}

:deep(.select-root > button:hover) {
  background: #ff2400;
  color: #fff;
  border-color: #ff2400;
}

:deep(.select-root > button:hover::after) {
  border-color: #fff;
}

:deep(.select-root > button:active) {
  transform: translate(2px, 2px);
}

:deep(.select-root > button:focus-visible) {
  outline: 3px solid #ff2400;
  outline-offset: 2px;
}

:deep(.select-root > button[aria-expanded='true']) {
  border-color: #ff2400;
}

:deep(.select-root ul[role='listbox']) {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  min-width: 100%;
  max-height: 280px;
  overflow-y: auto;
  margin: 0;
  padding: 0.4rem;
  list-style: none;
  background: #fff;
  border: 3px solid #000;
  box-shadow: 6px 6px 0 #000;
  z-index: 20;
}

:deep(.select-root li[role='option']) {
  padding: 0.6rem 0.85rem;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 600;
  text-transform: uppercase;
  transition: background 0.1s ease;
}

:deep(.select-root li[role='option'].highlighted) {
  background: #000;
  color: #fff;
}

:deep(.select-root li[role='option'][aria-selected='true']) {
  font-weight: 700;
  color: #ff2400;
}

:deep(.select-root li[role='option'][aria-disabled='true']) {
  color: #aaa;
  cursor: not-allowed;
}
</style>