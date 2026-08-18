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

const currentPage = computed({
  get: () => {
    const rawPage = Number(route.query.page)
    return Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= MAX_PAGE ? rawPage : 1
  },
  set: (value: number) => {
    router.push({ query: { ...route.query, page: value } })
  },
})

const paginationPages = computed(() =>
  [pendingPage.value, pendingPage.value + 1, pendingPage.value + 2].filter((p) => p <= lastPage.value)
)

const committedPaginationPages = computed(() =>
  [currentPage.value, currentPage.value + 1, currentPage.value + 2].filter((p) => p <= lastPage.value)
)

const BOOKS_PER_PAGE = 24
const lastPage = computed(() => {
  if (!data.value) return 1
  return Math.max(1, Math.ceil(data.value.total / BOOKS_PER_PAGE))
})

const PAGE_DEBOUNCE_MS = 250
const PAGE_MAX_WAIT_MS = 600
const pendingPage = ref(currentPage.value)
let pageDebounceTimer: ReturnType<typeof setTimeout> | null = null
let pageMaxWaitTimer: ReturnType<typeof setTimeout> | null = null

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
  if (page < 1 || page > lastPage.value) return
  pendingPage.value = page

  if (pageDebounceTimer) clearTimeout(pageDebounceTimer)
  pageDebounceTimer = setTimeout(commitPendingPage, PAGE_DEBOUNCE_MS)

  if (!pageMaxWaitTimer) {
    pageMaxWaitTimer = setTimeout(commitPendingPage, PAGE_MAX_WAIT_MS)
  }
}

onUnmounted(() => {
  if (pageDebounceTimer) clearTimeout(pageDebounceTimer)
  if (pageMaxWaitTimer) clearTimeout(pageMaxWaitTimer)
})

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

const PAGE_CACHE_MAX_ENTRIES = 50

const query = computed(() => ({
  q: selectedGenre.value,
  page: currentPage.value,
}))

const pageCache = new Map<string, BooksResult>()
const pageCacheKey = (genre: string, page: number) => `${genre}-${page}`

const { data, status, error, refresh } = await useFetch<BooksResult>('/api/books', {
  key: 'books-list',
  query,
  getCachedData: () => pageCache.get(pageCacheKey(selectedGenre.value, currentPage.value)),
})

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
  { immediate: true }
)

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

const pagePrefetchesInFlight = new Set<string>()

function prefetchPage(page: number) {
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
    })
    .finally(() => {
      pagePrefetchesInFlight.delete(key)
    })
}

function warmCoverImages(result: BooksResult) {
  for (const book of result.books) {
    if (!book.coverUrl) continue
    fetch(book.coverUrl, {
      headers: { 'X-Cover-Priority': 'low' },
      priority: 'low',
    }).catch(() => {
    })
  }
}

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

const IMAGE_STATE_MAX_ENTRIES = 500

function onImageLoad(bookId: string) {
  addBounded(loadedImages.value, bookId, IMAGE_STATE_MAX_ENTRIES)
}

function onImageError(bookId: string) {
  addBounded(failedImages.value, bookId, IMAGE_STATE_MAX_ENTRIES)
}

function setCoverRef(bookId: string, el: Element | null) {
  if (el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0) {
    onImageLoad(bookId)
  }
}

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
    overflow: visible;
  }

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