<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { BookDetail } from '~~/server/utils/bookDetail'

definePageMeta({
  layout: 'blank',
})

useHead({
  title: 'Your Bag | Maxshelf',
  meta: [{ name: 'theme-color', content: '#ffffff' }],
  link: [
    { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
    { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
    {
      rel: 'stylesheet',
      href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap',
    },
  ],
})

interface BagItem {
  id: string
  price: string
  quantity: number
}

const BAG_STORAGE_KEY = 'maxshelf-bag'

function getBag(): BagItem[] {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(BAG_STORAGE_KEY)
  } catch {
    return []
  }
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

interface BagLineItem {
  id: string
  price: string
  quantity: number
  title: string
  coverUrl: string | null
}

const items = ref<BagLineItem[]>([])
const isLoading = ref(true)

onMounted(async () => {
  const bag = getBag()

  if (bag.length === 0) {
    isLoading.value = false
    return
  }

  const results = await Promise.allSettled(
    bag.map((entry) =>
      $fetch<BookDetail>(`/api/book/${entry.id}`).then(
        (detail): BagLineItem => ({
          id: entry.id,
          price: entry.price,
          quantity: entry.quantity ?? 1,
          title: detail.title,
          coverUrl: detail.coverUrl,
        })
      )
    )
  )

  items.value = results
    .filter((r): r is PromiseFulfilledResult<BagLineItem> => r.status === 'fulfilled')
    .map((r) => r.value)

  isLoading.value = false
})

function lineTotal(item: BagLineItem): string {
  return `$${(parseFloat(item.price.replace('$', '')) * item.quantity).toFixed(2)}`
}

const total = computed(() => {
  const sum = items.value.reduce(
    (acc, item) => acc + parseFloat(item.price.replace('$', '')) * item.quantity,
    0
  )
  return `$${sum.toFixed(2)}`
})

function setBagItemQuantity(id: string, newQuantity: number) {
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
    const existing = bag.find((b) => b.id === id)
    if (existing) {
      existing.quantity = newQuantity
      localStorage.setItem(BAG_STORAGE_KEY, JSON.stringify(bag))
    }
  } catch {
  }
}

const MAX_QUANTITY = 99

function decrementQuantity(item: BagLineItem) {
  const next = Math.max(1, item.quantity - 1)
  item.quantity = next
  setBagItemQuantity(item.id, next)
}

function incrementQuantity(item: BagLineItem) {
  const next = Math.min(MAX_QUANTITY, item.quantity + 1)
  item.quantity = next
  setBagItemQuantity(item.id, next)
}

function onQuantityInput(item: BagLineItem, event: Event) {
  const raw = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(raw)) return
  const next = Math.min(MAX_QUANTITY, Math.max(1, Math.round(raw)))
  item.quantity = next
  setBagItemQuantity(item.id, next)
}
</script>

<template>
  <main class="page">
    <div class="page-inner" :class="{ 'page-inner-empty': items.length === 0 }">
      <NuxtLink to="/books" class="back-link">Back to books</NuxtLink>

      <h1 class="title">Your Bag</h1>

      <p v-if="isLoading" class="status-text">Loading your bag&hellip;</p>

      <div v-else-if="items.length === 0" class="empty-state">
        <p class="status-text">Your bag is empty.</p>
        <NuxtLink to="/books" class="add-to-cart-btn">Browse books</NuxtLink>
      </div>

      <template v-else>
        <ul class="bag-list">
          <li v-for="item in items" :key="item.id" class="bag-item">
            <img
              v-if="item.coverUrl"
              :src="item.coverUrl"
              :alt="item.title"
              class="bag-cover"
              width="60"
              height="90"
              loading="lazy"
            />
            <div v-else class="bag-cover bag-cover-empty" />
            <div class="bag-item-info">
              <p class="bag-item-title">{{ item.title }}</p>
              <p class="bag-item-id">{{ item.id }}</p>

              <div class="quantity-stepper" role="group" :aria-label="`Quantity for ${item.title}`">
                <button
                  type="button"
                  class="stepper-btn"
                  :disabled="item.quantity <= 1"
                  aria-label="Decrease quantity"
                  @click="decrementQuantity(item)"
                >
                  &minus;
                </button>
                <input
                  type="number"
                  class="stepper-input"
                  :value="item.quantity"
                  min="1"
                  :max="MAX_QUANTITY"
                  :aria-label="`Quantity for ${item.title}`"
                  @input="onQuantityInput(item, $event)"
                />
                <button
                  type="button"
                  class="stepper-btn"
                  :disabled="item.quantity >= MAX_QUANTITY"
                  aria-label="Increase quantity"
                  @click="incrementQuantity(item)"
                >
                  &plus;
                </button>
              </div>
            </div>
            <div class="bag-item-amounts">
              <p v-if="item.quantity > 1" class="bag-item-unit-price">{{ item.price }} each</p>
              <p class="bag-item-price">{{ lineTotal(item) }}</p>
            </div>
          </li>
        </ul>

        <div class="bag-total-row">
          <span class="meta-label">Total</span>
          <span class="price">{{ total }}</span>
        </div>

        <NuxtLink to="/checkout" class="add-to-cart-btn checkout-btn">
          Continue to checkout
        </NuxtLink>
      </template>
    </div>
  </main>
</template>

<style scoped>
.page {
  --paper: #fff;
  --ink: #000;
  --accent: #ff2400;
  --stone: #666;

  width: 100%;
  background: var(--paper);
  color: var(--ink);
  font-family: 'Inter', sans-serif;
  min-height: 100vh;
  min-height: 100dvh;
  box-sizing: border-box;
  position: relative;
}

.page-inner {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(720px, calc(100vw - 4rem));
  max-height: calc(100dvh - 4rem);
  overflow-y: auto;
}

.page-inner-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.back-link {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-bottom: 2rem;
  color: var(--accent);
  text-decoration: none;
  font-size: 0.85rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.back-link:focus-visible,
.add-to-cart-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

.title {
  margin: 0 0 2rem;
  font-size: clamp(2rem, 4vw, 2.75rem);
  font-weight: 900;
  letter-spacing: -0.03em;
  text-transform: uppercase;
}

.status-text {
  color: var(--stone);
  font-size: 1rem;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.25rem;
}

.bag-list {
  list-style: none;
  margin: 0 0 2rem;
  padding: 0;
  border-top: 3px solid var(--ink);
  max-height: 396px;
  overflow-y: auto;
}

.bag-list::-webkit-scrollbar {
  width: 6px;
}

.bag-list::-webkit-scrollbar-thumb {
  background: var(--ink);
}

.bag-list::-webkit-scrollbar-track {
  background: transparent;
}

.bag-item {
  display: flex;
  align-items: center;
  gap: 1.25rem;
  padding: 1.25rem 0;
  border-bottom: 3px solid var(--ink);
}

.bag-cover {
  width: 60px;
  height: 90px;
  object-fit: cover;
  flex-shrink: 0;
  border: 3px solid var(--ink);
}

.bag-cover-empty {
  background: #f1efe8;
}

.bag-item-info {
  flex: 1;
  min-width: 0;
}

.bag-item-title {
  margin: 0 0 0.25rem;
  font-size: 1rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bag-item-id {
  margin: 0;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 0.7rem;
  color: var(--stone);
}

.quantity-stepper {
  display: inline-flex;
  align-items: stretch;
  margin-top: 0.5rem;
  border: 3px solid var(--ink);
}

.stepper-btn {
  width: 1.9rem;
  background: #fff;
  border: none;
  color: var(--ink);
  font-family: inherit;
  font-size: 1rem;
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
  width: 2.5rem;
  border: none;
  border-left: 3px solid var(--ink);
  border-right: 3px solid var(--ink);
  text-align: center;
  font-family: inherit;
  font-size: 0.85rem;
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

.bag-item-amounts {
  flex-shrink: 0;
  text-align: right;
}

.bag-item-unit-price {
  margin: 0 0 0.25rem;
  font-size: 0.75rem;
  color: var(--stone);
}

.bag-item-price {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
}

.bag-total-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 2rem;
}

.meta-label {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--accent);
}

.price {
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.add-to-cart-btn {
  display: inline-block;
  padding: 0.85rem 2rem;
  background: var(--ink);
  color: var(--paper);
  border: 3px solid var(--ink);
  box-sizing: border-box;
  font-family: inherit;
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.15s ease;
}

.add-to-cart-btn:hover {
  background: var(--accent);
}

.checkout-btn {
  width: 100%;
  text-align: center;
}

@media (max-width: 480px) {
  .page-inner {
    width: min(720px, calc(100vw - 2.5rem));
    max-height: calc(100dvh - 2.5rem);
  }

  .bag-item {
    gap: 0.85rem;
  }
}

</style>