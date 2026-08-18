<script setup lang="ts">
import type { BookDetail } from '~~/server/utils/bookDetail'

definePageMeta({
  layout: 'blank',
})

interface BagItem {
  id: string
  price: string
  quantity: number
}

const BAG_STORAGE_KEY = 'maxshelf-bag'

function addToBag(item: { id: string; price: string }, addQuantity: number): boolean {
  try {
    const raw = localStorage.getItem(BAG_STORAGE_KEY)
    let bag: BagItem[] = []
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        bag = Array.isArray(parsed) ? parsed : []
      } catch {
        bag = []
      }
    }
    const existing = bag.find((b) => b.id === item.id)
    if (existing) {
      existing.quantity = (existing.quantity ?? 1) + addQuantity
    } else {
      bag.push({ id: item.id, price: item.price, quantity: addQuantity })
    }
    localStorage.setItem(BAG_STORAGE_KEY, JSON.stringify(bag))
    return true
  } catch {
    return false
  }
}

const route = useRoute()
const slug = route.params.slug as string
const id = extractIdFromSlug(slug)

const fromGenre = route.query.from as string | undefined
const backTo = computed(() => (fromGenre ? { path: '/books', query: { genre: fromGenre } } : '/books'))

if (!id) {
  throw createError({ statusCode: 404, statusMessage: 'Book not found', fatal: true })
}

const { data, error, refresh } = await useFetch<BookDetail>(`/api/book/${id}`, {
  key: `book-detail-${id}`,
  dedupe: 'defer',
})

watch(
  error,
  (err) => {
    const statusCode = (err as { statusCode?: number })?.statusCode
    if (statusCode === 404) {
      showError(err as any)
    }
  },
  { immediate: true }
)

const META_DESCRIPTION_MAX_LENGTH = 160
const META_DESCRIPTION_TRUNCATE_LENGTH = 157

const metaDescription = computed(() => {
  if (!data.value) return 'Browse books on Maxshelf.'
  const raw =
    data.value.description ||
    `${data.value.title} by ${data.value.authors?.length ? data.value.authors.join(', ') : 'an unknown author'}, available on Maxshelf.`
  return raw.length > META_DESCRIPTION_MAX_LENGTH
    ? `${raw.slice(0, META_DESCRIPTION_TRUNCATE_LENGTH)}...`
    : raw
})

const requestUrl = useRequestURL()
const absoluteCoverUrl = computed(() =>
  data.value?.coverUrl ? new URL(data.value.coverUrl, requestUrl.origin).toString() : undefined
)

const canonicalUrl = computed(() => {
  const path = data.value ? `/books/${bookSlug(data.value.title, id ?? '')}` : `/books/${slug}`
  return new URL(path, requestUrl.origin).toString()
})

const bookSchema = computed(() => {
  if (!data.value) return null
  return {
    '@context': 'https://schema.org',
    '@type': 'Book',
    name: data.value.title,
    author: (data.value.authors ?? []).map((name) => ({ '@type': 'Person', name })),
    description: data.value.description || undefined,
    image: absoluteCoverUrl.value,
    datePublished: data.value.firstPublishDate || undefined,
    genre: data.value.subjects?.slice(0, 5),
    url: canonicalUrl.value,
  }
})

useHead({
  title: computed(() => (data.value ? `${data.value.title} | Maxshelf` : 'Book | Maxshelf')),
  meta: [
    { name: 'theme-color', content: '#ffffff' },
    { name: 'description', content: metaDescription },
    { property: 'og:type', content: 'book' },
    { property: 'og:title', content: computed(() => data.value?.title || 'Book | Maxshelf') },
    { property: 'og:description', content: metaDescription },
    { property: 'og:url', content: canonicalUrl },
    ...(absoluteCoverUrl.value ? [{ property: 'og:image', content: absoluteCoverUrl }] : []),
    { name: 'twitter:card', content: absoluteCoverUrl.value ? 'summary_large_image' : 'summary' },
    { name: 'twitter:title', content: computed(() => data.value?.title || 'Book | Maxshelf') },
    { name: 'twitter:description', content: metaDescription },
    ...(absoluteCoverUrl.value ? [{ name: 'twitter:image', content: absoluteCoverUrl }] : []),
  ],
  link: [
    { rel: 'canonical', href: canonicalUrl },
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
    {
      rel: 'stylesheet',
      href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap',
    },
  ],
  script: bookSchema.value
    ? [
        {
          type: 'application/ld+json',
          innerHTML: JSON.stringify(bookSchema.value).replace(/<\//g, '<\\/'),
        },
      ]
    : [],
})

const eyebrow = computed(() => {
  if (!fromGenre) return null
  return fromGenre.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
})

function hashStringToUint32(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(hash, 31) + str.charCodeAt(i)) >>> 0
  }
  return hash
}

const price = computed(() => {
  if (!data.value) return null
  const dollars = 7 + (hashStringToUint32(data.value.id) % 23)
  return `$${dollars}.99`
})

const addedToCart = ref(false)
const addToCartFailed = ref(false)
let cartMessageTimer: ReturnType<typeof setTimeout> | null = null

const MAX_QUANTITY = 99
const quantity = ref(1)

function decrementQuantity() {
  quantity.value = Math.max(1, quantity.value - 1)
}

function incrementQuantity() {
  quantity.value = Math.min(MAX_QUANTITY, quantity.value + 1)
}

function onQuantityInput(event: Event) {
  const raw = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(raw)) return
  quantity.value = Math.min(MAX_QUANTITY, Math.max(1, Math.round(raw)))
}

function addToCart() {
  if (!data.value || !price.value) return

  const success = addToBag({ id: data.value.id, price: price.value }, quantity.value)

  if (cartMessageTimer) clearTimeout(cartMessageTimer)

  if (success) {
    addedToCart.value = true
    addToCartFailed.value = false
    quantity.value = 1
    cartMessageTimer = setTimeout(() => {
      addedToCart.value = false
    }, 2500)
  } else {
    addToCartFailed.value = true
    addedToCart.value = false
    cartMessageTimer = setTimeout(() => {
      addToCartFailed.value = false
    }, 3500)
  }
}

onUnmounted(() => {
  if (cartMessageTimer) clearTimeout(cartMessageTimer)
  if (favoritesMessageTimer) clearTimeout(favoritesMessageTimer)
})

const FAVORITES_KEY = 'maxshelf-favorites'

function getFavoriteIds(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function setFavoriteIds(ids: string[]) {
  try {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(ids))
  } catch {
  }
}

const isFavorited = ref(false)
const favoritesMessage = ref('')
let favoritesMessageTimer: ReturnType<typeof setTimeout> | null = null

onMounted(() => {
  if (id) isFavorited.value = getFavoriteIds().includes(id)
})

function toggleFavorite() {
  if (!id) return

  const favorites = getFavoriteIds()
  const index = favorites.indexOf(id)

  if (index === -1) {
    favorites.push(id)
    isFavorited.value = true
    favoritesMessage.value = 'Added to favorites'
  } else {
    favorites.splice(index, 1)
    isFavorited.value = false
    favoritesMessage.value = 'Removed from favorites'
  }

  setFavoriteIds(favorites)

  if (favoritesMessageTimer) clearTimeout(favoritesMessageTimer)
  favoritesMessageTimer = setTimeout(() => {
    favoritesMessage.value = ''
  }, 2500)
}

const coverLoaded = ref(false)
const coverErrored = ref(false)

function onCoverLoad() {
  coverLoaded.value = true
}

function onCoverError() {
  coverErrored.value = true
}

function setCoverRef(el: Element | null) {
  if (el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0) {
    onCoverLoad()
  }
}
</script>

<template>
  <main class="page">
    <NuxtLink :to="backTo" class="back-link">Back to books</NuxtLink>

    <div v-if="error" class="error-box">
      <p style="margin: 0 0 0.5rem;">
        {{ error.statusMessage || 'Something went wrong loading this book.' }}
      </p>
      <button class="retry-btn" type="button" @click="refresh()">Try again</button>
    </div>

    <template v-else-if="data">
      <p v-if="eyebrow" class="eyebrow">{{ eyebrow }}</p>

      <div class="plate">
        <div class="plate-cover">
          <div
            v-if="data.coverUrl"
            class="cover-wrap"
            :class="{ 'is-loaded': coverLoaded, 'is-errored': coverErrored }"
          >
            <img
              :src="data.coverUrl"
              :alt="data.title"
              width="300"
              height="450"
              loading="eager"
              fetchpriority="high"
              decoding="async"
              class="detail-cover"
              :ref="(el) => setCoverRef(el as Element | null)"
              @load="onCoverLoad"
              @error="onCoverError"
            />
          </div>
          <p class="catalog-no">{{ data.id }}</p>
        </div>

        <div class="plate-info">
          <h1 class="title">{{ data.title }}</h1>
          <p class="author">{{ data.authors?.length ? data.authors.join(', ') : 'Unknown author' }}</p>

          <p v-if="data.firstPublishDate" class="meta-row">
            <span class="meta-label">Published</span>
            <span class="meta-value">{{ data.firstPublishDate }}</span>
          </p>

          <div v-if="data.subjects?.length" class="tags">
            <span v-for="subject in data.subjects" :key="subject" class="tag">{{ subject }}</span>
          </div>
        </div>
      </div>

      <div class="description-col">
        <p v-if="data.description" class="description">{{ data.description }}</p>
        <p v-else class="description description-empty">No description available for this book.</p>
      </div>

      <div class="purchase-row">
        <p class="price">{{ price }}</p>

        <div class="quantity-stepper" role="group" aria-label="Quantity">
          <button
            type="button"
            class="stepper-btn"
            :disabled="quantity <= 1"
            aria-label="Decrease quantity"
            @click="decrementQuantity"
          >
            &minus;
          </button>
          <input
            type="number"
            class="stepper-input"
            :value="quantity"
            min="1"
            :max="MAX_QUANTITY"
            aria-label="Quantity"
            @input="onQuantityInput"
          />
          <button
            type="button"
            class="stepper-btn"
            :disabled="quantity >= MAX_QUANTITY"
            aria-label="Increase quantity"
            @click="incrementQuantity"
          >
            &plus;
          </button>
        </div>

        <button type="button" class="add-to-cart-btn" :class="{ 'is-added': addedToCart }" @click="addToCart">
          {{ addedToCart ? 'Added to bag' : 'Add to bag' }}
        </button>

        <button
          type="button"
          class="favorite-btn"
          :class="{ 'is-favorited': isFavorited }"
          :aria-pressed="isFavorited"
          @click="toggleFavorite"
        >
          <span aria-hidden="true">{{ isFavorited ? '&starf;' : '&star;' }}</span>
          {{ isFavorited ? 'Favorited' : 'Add to favorites' }}
        </button>
      </div>
      <p v-if="addedToCart" class="cart-message cart-message-success" role="status">
        Added to bag &check;
      </p>
      <p v-if="addToCartFailed" class="cart-message cart-message-error" role="alert">
        Couldn't add to bag — your browser may be blocking storage.
      </p>
      <p v-if="favoritesMessage" class="cart-message cart-message-success" role="status">
        {{ favoritesMessage }}
      </p>
    </template>

    <div v-else class="plate">
      <div class="plate-cover">
        <div class="cover-wrap" />
      </div>
      <div class="plate-info">
        <div class="skeleton-line skeleton-title" />
        <div class="skeleton-line skeleton-author" />
      </div>
    </div>
  </main>
</template>

<style scoped>
.page {
  --paper: #fff;
  --ink: #000;
  --accent: #ff2400;
  --stone: #666;

  max-width: 960px;
  margin: 0 auto;
  padding: 3rem 2rem 6rem;
  background: var(--paper);
  color: var(--ink);
  font-family: 'Inter', sans-serif;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 3rem;
  color: var(--accent);
  text-decoration: none;
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.back-link:focus-visible,
.retry-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

.eyebrow {
  margin: 0 0 1rem;
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--accent);
}

.plate {
  display: flex;
  gap: 3rem;
  align-items: flex-start;
  padding-bottom: 3rem;
  border-bottom: 1px solid var(--ink);
}

.plate-cover {
  flex-shrink: 0;
  width: 260px;
}

.cover-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 2 / 3;
  overflow: hidden;
  border: 3px solid var(--ink);
  background: linear-gradient(100deg, #ece9e0 30%, #f5f3ec 50%, #ece9e0 70%);
  background-size: 200% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
  box-shadow: 8px 8px 0 var(--ink);
}

.cover-wrap.is-loaded {
  animation: none;
  background: none;
}

.cover-wrap.is-errored {
  animation: none;
  background: #f1efe8;
}

.cover-wrap.is-errored::after {
  content: 'No cover available';
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 1.5rem;
  text-align: center;
  font-size: 0.8rem;
  color: var(--stone);
}

@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .cover-wrap,
  .skeleton-line {
    animation: none;
  }
}

.detail-cover {
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0;
  transition: opacity 0.3s ease;
  display: block;
}

.cover-wrap.is-loaded .detail-cover {
  opacity: 1;
}

.catalog-no {
  margin: 0.85rem 0 0;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  color: var(--stone);
  text-align: center;
}

.plate-info {
  flex: 1;
  min-width: 0;
  padding-top: 0.25rem;
}

.title {
  margin: 0 0 0.6rem;
  font-size: clamp(2.25rem, 4.5vw, 3.5rem);
  font-weight: 900;
  letter-spacing: -0.03em;
  line-height: 1.05;
}

.author {
  margin: 0 0 1.5rem;
  font-size: 1.15rem;
  font-weight: 500;
  color: var(--stone);
}

.meta-row {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  margin: 0 0 2rem;
}

.meta-label {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--accent);
}

.meta-value {
  font-size: 0.95rem;
  color: var(--ink);
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.tag {
  padding: 0.35rem 0.8rem;
  border: 3px solid var(--ink);
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--accent);
}

.description-col {
  max-width: 640px;
  margin-top: 3rem;
}

.description {
  margin: 0;
  font-size: 1.05rem;
  line-height: 1.75;
  color: var(--ink);
  white-space: pre-line;
}

.description-empty {
  color: var(--stone);
  font-style: italic;
}

.purchase-row {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  max-width: 640px;
  margin-top: 2.5rem;
  padding-top: 2rem;
  border-top: 1px solid var(--ink);
}

.quantity-stepper {
  display: flex;
  align-items: stretch;
  border: 3px solid var(--ink);
}

.stepper-btn {
  width: 2.25rem;
  background: #fff;
  border: none;
  color: var(--ink);
  font-family: inherit;
  font-size: 1.1rem;
  line-height: 1;
  cursor: pointer;
}

.stepper-btn:hover:not(:disabled) {
  background: #f1efe8;
}

.stepper-btn:disabled {
  color: var(--ink);
  cursor: not-allowed;
}

.stepper-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.stepper-input {
  width: 2.75rem;
  border: none;
  border-left: 1px solid var(--ink);
  border-right: 1px solid var(--ink);
  text-align: center;
  font-family: inherit;
  font-size: 0.95rem;
  color: var(--ink);
  -moz-appearance: textfield;
}

.stepper-input::-webkit-outer-spin-button,
.stepper-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.stepper-input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}

.price {
  margin: 0;
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.add-to-cart-btn {
  padding: 0.85rem 2rem;
  background: var(--ink);
  color: var(--paper);
  border: none;
  font-family: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: background 0.15s ease;
}

.add-to-cart-btn:hover {
  background: var(--accent);
}

.add-to-cart-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

.add-to-cart-btn.is-added {
  background: var(--accent);
}

.favorite-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.85rem 1.5rem;
  background: #fff;
  color: var(--ink);
  border: 3px solid var(--ink);
  font-family: inherit;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.favorite-btn span {
  font-size: 1.05rem;
  line-height: 1;
}

.favorite-btn:hover {
  border-color: var(--accent);
}

.favorite-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.favorite-btn.is-favorited {
  border-color: var(--accent);
  color: var(--accent);
}

.cart-message {
  margin: 0.85rem 0 0;
  font-size: 0.9rem;
  font-weight: 600;
}

.cart-message-success {
  color: var(--accent);
}

.cart-message-error {
  color: var(--accent);
}

@media (max-width: 640px) {
  .purchase-row {
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }
}

.error-box {
  padding: 1.25rem;
  border: 3px solid var(--accent);
  background: #fff;
}

.retry-btn {
  padding: 0.6rem 1.4rem;
  background: var(--ink);
  color: var(--paper);
  border: none;
  font-family: inherit;
  font-size: 0.9rem;
  cursor: pointer;
}

.retry-btn:hover {
  background: var(--accent);
}

.skeleton-line {
  background: linear-gradient(100deg, #ece9e0 30%, #f5f3ec 50%, #ece9e0 70%);
  background-size: 200% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}

.skeleton-title {
  width: 70%;
  height: 2.75rem;
  margin: 0.25rem 0 1rem;
}

.skeleton-author {
  width: 40%;
  height: 1.15rem;
}

@media (max-width: 640px) {
  .page {
    padding: 2rem 1.25rem 4rem;
  }

  .plate {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  .plate-cover {
    width: 200px;
  }

  .meta-row {
    justify-content: center;
  }

  .tags {
    justify-content: center;
  }

  .purchase-row {
    flex-wrap: wrap;
    justify-content: center;
  }
}
</style>