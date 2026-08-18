<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { BookDetail } from '~~/server/utils/bookDetail'

definePageMeta({
  layout: 'blank',
})

useHead({
  title: 'Your Bag | Maxshelf',
  // Safari tints its own chrome (iOS status bar/toolbar, macOS 15+ tab
  // bar) to match theme-color, and Nuxt's useHead updates it
  // automatically on every client-side navigation — this page's
  // background is plain white top-to-bottom, matching this value.
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

// Inlined here (and identically in app/pages/books/[slug].vue) rather
// than imported from a separate app/utils/bag.ts file — see the comment
// on the matching function in [slug].vue for why: a shared file's import
// path is one more thing that can be placed wrong, and that's exactly
// what broke last time. Both copies read/write the exact same
// localStorage key, so they stay in sync regardless of which page wrote
// what.
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

// localStorage only exists client-side — this whole read has to happen
// in onMounted, not at top-level setup, or it would throw during SSR.
onMounted(async () => {
  const bag = getBag()

  if (bag.length === 0) {
    isLoading.value = false
    return
  }

  // Deliberately storing only {id, price, quantity} in localStorage —
  // title and cover are fetched here instead of also being duplicated
  // into storage, reusing the same cached /api/book route the detail
  // page already warms rather than inventing a second place book
  // metadata lives. `entry.quantity ?? 1` covers bag entries saved
  // before quantity existed at all.
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

// Unit price × quantity, not just price — this is the actual line
// amount for a row with more than one of the same book.
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

// Persists an exact quantity for one bag entry back to localStorage —
// different from [slug].vue's addToBag, which ADDS to whatever's
// already there; this SETS it directly, since that's what changing the
// stepper on an existing line means.
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
    // If localStorage is genuinely unavailable (private browsing, quota,
    // disabled), the mutation to `item.quantity` below still updates
    // what's on screen — it just won't survive a reload. Not silently
    // pretending it's fully persisted, but also not blocking the
    // in-session UI update over a storage failure.
  }
}

// Same genuinely-interactive stepper as the book detail page — click
// +/- OR type a number directly, both clamped to [1, MAX_QUANTITY].
// Mutating `item.quantity` directly is what makes this reactive: `item`
// here is the actual element inside the `items` ref's array, and Vue's
// reactivity tracks that nested mutation, so lineTotal/total above
// recompute immediately without any extra wiring.
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
    <!-- Everything wrapped in ONE inner container, not left as several
         separate top-level children of .page — this is the actual
         structural fix. Centering several sibling elements together
         relies on flexbox treating the whole sequence as one group,
         which is more fragile than it needs to be. Wrapping them in a
         single .page-inner block removes that ambiguity entirely: .page
         centers exactly one item, full stop, with no room for a subtle
         multi-child edge case to throw it off. -->
    <!-- page-inner-empty only applies while there's nothing substantial to
         show (loading or genuinely empty) — items.length is 0 in both
         cases. The populated branch (v-else below) never gets this class,
         so its full-width list/total/checkout layout is untouched. -->
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
  /* .page itself no longer does the centering — see .page-inner below,
     which centers against the viewport directly via position: fixed.
     .page just needs to be at least full-viewport height so the white
     background fills the screen behind that fixed, centered box.
     100dvh (with 100vh as a fallback for older browsers) tracks the
     ACTUAL visible viewport on mobile, where 100vh can be taller than
     what's currently shown behind the browser's address bar.
     position: relative here is deliberate: it's a plain static-position
     ancestor, NOT a transformed/positioned one, which is exactly what
     .page-inner's `position: fixed` needs in order to size itself
     against the real viewport instead of against this element. */
  min-height: 100vh;
  min-height: 100dvh;
  box-sizing: border-box;
  position: relative;
}

.page-inner {
  /* position: fixed + top/left 50% + translate(-50%, -50%) centers
     .page-inner against the VIEWPORT directly (100vw/100vh), not
     against .page's own box. That matters: flex/grid centering only
     ever centers a child within its immediate parent's content box —
     if anything upstream of .page (a container, a stray max-width, an
     injected wrapper from a layout/module) is narrower than the true
     viewport or isn't itself centered, every child inherits that same
     offset no matter how "correctly" it centers within its parent.
     Fixed positioning breaks that chain entirely: its containing block
     is the viewport itself (as long as no ancestor has a `transform`,
     which .page doesn't), so this is centered on the real screen
     regardless of what any ancestor element is doing.
     calc(100vw - 4rem) / calc(100dvh - 4rem) keep the same 2rem
     breathing room .page's old padding gave on all sides; max-height +
     overflow-y let a long bag scroll internally instead of being
     clipped, since a fixed element no longer grows the page itself. */
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: min(720px, calc(100vw - 4rem));
  max-height: calc(100dvh - 4rem);
  overflow-y: auto;
}

/* The populated bag's own rows/total/checkout-button all stretch to
   .page-inner's full width, so they fill this box edge-to-edge
   regardless of internal text alignment — that's what makes the
   populated state read as "centered" even though nothing inside it is
   explicitly centered. Loading/empty content has no such full-width
   element: it's just a short line of text and a button, both far
   narrower than 720px, so left-aligning them (the default) strands
   them near the left edge of this same box. This variant turns
   .page-inner itself into a centered flex column for exactly those two
   states (see the :class binding in the template — items.length is 0
   during loading AND when genuinely empty), so the back link, heading,
   message, and button all sit centered as a group instead. The
   populated branch never gets this class, so its full-width layout is
   completely unaffected. */
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
  /* Caps at roughly 3 rows (each ~131px: 90px cover + 2×20px padding +
     1px border) and scrolls beyond that instead of pushing the total
     and checkout button further down the page for a long bag. With 3
     or fewer items this has no visible effect at all — content simply
     doesn't reach the cap, so no scrollbar appears; it only kicks in
     once there's actually more than fits. */
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

/* Same stepper styling as the book detail page's quantity control
   (app/pages/books/[slug].vue) — kept visually identical for
   consistency, even though this file has its own copy of the CSS (same
   reasoning as the inlined localStorage functions: no shared file whose
   path can be wrong). */
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
  /* box-sizing: border-box is the actual fix for the button overflowing
     its container — .checkout-btn sets width: 100%, but the default
     box-sizing (content-box) means that 100% only covers the content
     box, with padding (2rem = 32px each side) and the 3px border added
     ON TOP of it. That's 70px of real overflow past the container's
     right edge, worse the narrower the screen. border-box makes the
     100% include padding and border, so it can never exceed its
     container regardless of screen size. */
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