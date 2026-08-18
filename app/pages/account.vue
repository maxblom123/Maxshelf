<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { BookDetail } from '~~/server/utils/bookDetail'

definePageMeta({
  layout: 'blank',
})

useHead({
  title: 'Your Account | Maxshelf',
  // Safari tints its own chrome (iOS status bar/toolbar, macOS 15+ tab
  // bar) to match theme-color, and Nuxt's useHead updates it
  // automatically on every client-side navigation. This one is
  // genuinely different from every other page in the app — black, not
  // white — because .hero (the reversed black bar) sits right at the
  // very top of this page's viewport, unlike anywhere else that's
  // plain white top-to-bottom. Matching THIS page's real color here
  // rather than reusing the white value everywhere else is the actual
  // point of doing this per-page instead of once globally.
  meta: [{ name: 'theme-color', content: '#000000' }],
  link: [
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
    {
      rel: 'stylesheet',
      href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap',
    },
  ],
})

interface OrderRecord {
  orderNumber: string
  date: string
  items: Array<{ id: string; title: string; price: string; quantity: number }>
  total: string
  shipping: { fullName: string; address: string; email: string; phone: string } | null
}

const ORDERS_KEY = 'maxshelf-orders'

// localStorage only exists client-side, so this read has to happen in
// onMounted, not top-level setup, or it'd throw during SSR. Orders are
// written by /pay on successful "payment" — see saveOrder() there. This
// is a read-only view of that same key, newest first (the write side
// already unshifts new orders to the front).
const orders = ref<OrderRecord[]>([])
const isLoading = ref(true)

// Favorites — written by the toggle button on the book detail page
// (app/pages/books/[slug].vue), stored as a plain array of book ids.
// Only ids are stored there, so this fetches title/cover here the same
// way the bag/order flows fetch book details from the id-only storage
// they keep — one canonical source for book metadata (/api/book/:id),
// not duplicated into every localStorage key that references a book.
const FAVORITES_KEY = 'maxshelf-favorites'

interface FavoriteBook {
  id: string
  title: string
  authors: string[]
  coverUrl: string | null
}

const favorites = ref<FavoriteBook[]>([])
const favoritesLoading = ref(true)

onMounted(async () => {
  try {
    const raw = localStorage.getItem(ORDERS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      orders.value = Array.isArray(parsed) ? parsed : []
    }
  } catch {
    orders.value = []
  }
  isLoading.value = false

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
    favoritesLoading.value = false
    return
  }

  const results = await Promise.allSettled(
    favoriteIds.map((favId) =>
      $fetch<BookDetail>(`/api/book/${favId}`).then(
        (detail): FavoriteBook => ({
          id: favId,
          title: detail.title,
          authors: detail.authors,
          coverUrl: detail.coverUrl,
        })
      )
    )
  )

  favorites.value = results
    .filter((r): r is PromiseFulfilledResult<FavoriteBook> => r.status === 'fulfilled')
    .map((r) => r.value)

  favoritesLoading.value = false
})

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return iso
  }
}
</script>

<template>
  <main class="page">
    <!-- Full-bleed reversed header bar — the signature move here: a
         solid black band with the wordmark treatment reversed out to
         white, the numbered index style ("N.") is a direct Swiss/ISOTYPE
         convention for labeling grid modules, not a fake sequence — it's
         literally counting the sections below. -->
    <header class="hero">
      <NuxtLink to="/books" class="back-link">BACK TO BOOKS</NuxtLink>
      <h1 class="title">YOUR<br />ACCOUNT</h1>
    </header>

    <div class="grid">
      <section class="module">
        <div class="module-head">
          <span class="module-index">01</span>
          <h2 class="module-title">FAVORITE BOOKS</h2>
        </div>

        <div class="module-body">
          <p v-if="favoritesLoading" class="status-text">LOADING&hellip;</p>

          <div v-else-if="favorites.length === 0" class="empty-state">
            <p class="status-text">NO FAVORITES YET.</p>
            <NuxtLink to="/books" class="btn">BROWSE BOOKS</NuxtLink>
          </div>

          <div v-else class="favorites-grid">
            <NuxtLink
              v-for="book in favorites"
              :key="book.id"
              :to="`/books/${bookSlug(book.title, book.id)}`"
              class="favorite-card"
            >
              <img
                v-if="book.coverUrl"
                :src="book.coverUrl"
                :alt="book.title"
                class="favorite-cover"
                width="90"
                height="135"
                loading="lazy"
              />
              <div v-else class="favorite-cover favorite-cover-empty" />
              <p class="favorite-title">{{ book.title }}</p>
              <p class="favorite-author">{{ book.authors?.[0] || 'UNKNOWN AUTHOR' }}</p>
            </NuxtLink>
          </div>
        </div>
      </section>

      <section class="module">
        <div class="module-head">
          <span class="module-index">02</span>
          <h2 class="module-title">RECENT ORDERS</h2>
        </div>

        <div class="module-body">
          <p v-if="isLoading" class="status-text">LOADING&hellip;</p>

          <div v-else-if="orders.length === 0" class="empty-state">
            <p class="status-text">NO ORDERS YET.</p>
            <NuxtLink to="/books" class="btn">BROWSE BOOKS</NuxtLink>
          </div>

          <ul v-else class="order-list">
            <li v-for="order in orders" :key="order.orderNumber" class="order-card">
              <div class="order-header">
                <div>
                  <p class="order-number">{{ order.orderNumber }}</p>
                  <p class="order-date">{{ formatDate(order.date) }}</p>
                </div>
                <p class="order-total">{{ order.total }}</p>
              </div>

              <ul class="order-items">
                <li v-for="item in order.items" :key="item.id" class="order-item">
                  <span class="order-item-title">{{ item.title }}</span>
                  <span class="order-item-qty">&times;{{ item.quantity }}</span>
                </li>
              </ul>

              <p v-if="order.shipping" class="order-shipping">
                SHIPPED TO {{ order.shipping.fullName }}, {{ order.shipping.address }}
              </p>
            </li>
          </ul>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
/* SWISS / BRUTALIST — deliberate departure from the soft "bookstore"
   language used elsewhere in this app (paper/moss/hairline, rounded
   corners, soft shadows). This page now runs on its own token set:
   pure black/white, ONE accent (red — the classic Swiss International
   Style accent, Müller-Brockmann posters etc.), zero border-radius
   anywhere, zero blurred shadows. Where a shadow is used at all, it's a
   hard, non-blurred offset block (box-shadow: Npx Npx 0 #000) — the
   neo-brutalist device that reads as a solid object, not a soft
   elevation cue. Borders are thick (2-3px) and always pure black, not
   thin hairlines. */
.page {
  --ink: #000;
  --paper: #fff;
  --accent: #ff2400;
  --stone: #666;

  max-width: 1200px;
  margin: 0 auto;
  background: var(--paper);
  color: var(--ink);
  font-family: 'Inter', sans-serif;
  /* This is what actually makes "sections scroll, not the page" work:
     .page is pinned to exactly the viewport height and clips anything
     that doesn't fit at this level. Everything below has to fit inside
     that budget — .hero keeps its natural height (flex-shrink: 0), and
     .grid gets whatever's left over (flex: 1). No guessed pixel heights
     anywhere, which is what broke last time (an estimated max-height on
     the list itself cut cards off mid-render instead of scrolling
     cleanly).

     100vh, then 100dvh as an override — this matters specifically on
     phones: 100vh is defined as the LARGEST possible viewport (address
     bar hidden), so on a phone where the browser chrome is currently
     showing, a page pinned to 100vh is taller than what's actually
     visible and its bottom edge — including part of the second module
     on a stacked mobile layout — ends up clipped behind that chrome.
     100dvh tracks the viewport that's ACTUALLY available right now and
     resizes live as the browser bars show/hide on scroll. Declared as a
     second, later rule rather than a single dvh value so browsers that
     don't yet support dvh still get the vh fallback instead of an
     invalid height. */
  height: 100vh;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.hero {
  background: var(--ink);
  color: var(--paper);
  padding: 1.75rem 2rem 2rem;
  margin-bottom: 0;
  flex-shrink: 0;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 3rem;
  color: var(--paper);
  text-decoration: none;
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.1em;
}

.back-link:hover {
  color: var(--accent);
}

.back-link:focus-visible,
.btn:focus-visible,
.favorite-card:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}

.title {
  margin: 0;
  font-size: clamp(2.75rem, 7vw, 5rem);
  font-weight: 900;
  line-height: 0.88;
  letter-spacing: -0.03em;
  text-transform: uppercase;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  /* No more align-items: start here — that was the previous fix for a
     different problem (the divider running past short content when the
     PAGE scrolled freely). Now that each module has a genuinely fixed
     height (see .page above) and scrolls its own content internally,
     modules stretching to match the row (the default) is correct: both
     panels are meant to occupy the same fixed height regardless of how
     much they contain, the same way two panes in a real app UI would. */
  border-top: 3px solid var(--ink);
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.module {
  padding: 2.5rem 2rem;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.module:first-child {
  border-right: 3px solid var(--ink);
}

.module-head {
  display: flex;
  align-items: baseline;
  gap: 1rem;
  margin-bottom: 2rem;
  flex-shrink: 0;
  padding-bottom: 1rem;
  border-bottom: 3px solid var(--ink);
}

.module-index {
  font-size: 1rem;
  font-weight: 900;
  color: var(--accent);
}

.module-title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 900;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

/* THE scroll container — everything below the fixed head scrolls in
   here, within whatever height .module actually has (which is bounded
   by .grid, which is bounded by .page's 100vh). This is the piece that
   makes it work correctly instead of guessing: flex: 1 + min-height: 0
   means it always exactly fills the remaining space, no matter how tall
   the head or hero happen to render at any given screen size. */
.module-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 0.75rem;
  /* Bottom padding matters for the same reason as the right padding —
     the last card's hard offset shadow (6-8px, non-blurred) would
     otherwise get clipped right at the scroll boundary instead of
     having room to actually render. */
  padding-bottom: 0.75rem;
}

.module-body::-webkit-scrollbar {
  width: 6px;
}

.module-body::-webkit-scrollbar-thumb {
  background: var(--ink);
}

.module-body::-webkit-scrollbar-track {
  background: transparent;
}

.status-text {
  color: var(--stone);
  font-size: 0.9rem;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1.25rem;
}

.btn {
  display: inline-block;
  padding: 0.9rem 2rem;
  background: var(--ink);
  color: var(--paper);
  border: 3px solid var(--ink);
  font-family: inherit;
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.1s ease, color 0.1s ease;
}

.btn:hover {
  background: var(--paper);
  color: var(--ink);
}

/* No internal scroll box here — an earlier attempt capped this with a
   guessed max-height, but that cut cards off mid-render instead of
   scrolling cleanly (the estimate never quite matched real card
   heights). Simpler and actually correct: let this grow naturally as
   part of the page's own single scrollbar. */
.favorites-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1.5rem;
}

.favorite-card {
  display: block;
  text-decoration: none;
  color: inherit;
}

.favorite-cover {
  width: 100%;
  aspect-ratio: 2 / 3;
  object-fit: cover;
  border: 3px solid var(--ink);
  box-shadow: 6px 6px 0 var(--ink);
  margin-bottom: 0.75rem;
  transition: transform 0.1s ease, box-shadow 0.1s ease;
}

.favorite-card:hover .favorite-cover {
  transform: translate(-3px, -3px);
  box-shadow: 9px 9px 0 var(--accent);
}

.favorite-cover-empty {
  background: #eee;
}

.favorite-title {
  margin: 0 0 0.2rem;
  font-size: 0.85rem;
  font-weight: 700;
  line-height: 1.3;
  text-transform: uppercase;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.favorite-author {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--stone);
  text-transform: uppercase;
}

.order-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.order-card {
  background: var(--paper);
  border: 3px solid var(--ink);
  box-shadow: 6px 6px 0 var(--ink);
  padding: 1.5rem;
}

.order-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 1rem;
  padding-bottom: 1rem;
  border-bottom: 3px solid var(--ink);
}

.order-number {
  margin: 0 0 0.2rem;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 0.85rem;
  font-weight: 700;
}

.order-date {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--stone);
  text-transform: uppercase;
}

.order-total {
  margin: 0;
  font-size: 1.3rem;
  font-weight: 900;
  color: var(--accent);
}

.order-items {
  list-style: none;
  margin: 0 0 1rem;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.order-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  font-size: 0.88rem;
  font-weight: 600;
}

.order-item-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-right: 1rem;
  text-transform: uppercase;
}

.order-item-qty {
  flex-shrink: 0;
  color: var(--stone);
  font-size: 0.82rem;
}

.order-shipping {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--stone);
  text-transform: uppercase;
}

@media (max-width: 860px) {
  .grid {
    grid-template-columns: 1fr;
    /* Explicit row heights matter here — without this, each stacked
       module would size to its own content (the grid's default row
       behavior) and the second one would just get clipped by .grid's
       overflow: hidden instead of getting its fair share of height.
       This gives each module exactly half the available space, same
       bounded-panel-with-internal-scroll behavior as the desktop
       side-by-side layout. */
    grid-template-rows: 1fr 1fr;
  }

  .module:first-child {
    border-right: none;
    border-bottom: 3px solid var(--ink);
  }

  .hero {
    padding: 1.5rem 1.25rem 1.75rem;
  }

  .module {
    padding: 1.5rem 1.25rem;
  }

  .module-head {
    margin-bottom: 1.25rem;
    padding-bottom: 0.75rem;
  }
}

@media (max-width: 480px) {
  /* Single column, not the previous (no-op) repeat(2, 1fr) — at genuinely
     phone-narrow widths, 2 favorite-book columns leave each card too
     cramped (cover + title + author squeezed into ~120px), and a single
     wider card reads far better than two tiny ones. */
  .favorites-grid {
    grid-template-columns: 1fr;
  }

  .title {
    font-size: clamp(2.25rem, 11vw, 5rem);
  }

  .order-card {
    padding: 1.1rem;
  }

  .order-header {
    flex-wrap: wrap;
    gap: 0.5rem;
  }
}
</style>