<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import type { BookDetail } from '~~/server/utils/bookDetail'

definePageMeta({
  layout: 'blank',
})

useHead({
  title: 'Payment | Maxshelf',
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
const CHECKOUT_INFO_KEY = 'maxshelf-checkout-info'

// Same inlined-not-imported pattern used throughout the bag/checkout
// flow — see the comment on the matching function in [slug].vue for why.
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

function clearBag() {
  try {
    localStorage.removeItem(BAG_STORAGE_KEY)
  } catch {
    // Not fatal — the confirmation still shows below either way, it
    // just means the bag might still have items in it next visit.
  }
}

interface CheckoutInfo {
  fullName: string
  address: string
  email: string
  phone: string
}

// Read once on mount, purely for display ("shipping to") — /pay doesn't
// require this to exist (someone could land here directly), it just has
// nothing to show under "Shipping to" if it's missing.
const checkoutInfo = ref<CheckoutInfo | null>(null)

interface BagLineItem {
  id: string
  price: string
  quantity: number
  title: string
}

const items = ref<BagLineItem[]>([])
const isLoading = ref(true)

onMounted(async () => {
  try {
    const raw = localStorage.getItem(CHECKOUT_INFO_KEY)
    if (raw) checkoutInfo.value = JSON.parse(raw)
  } catch {
    checkoutInfo.value = null
  }

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
        })
      )
    )
  )

  items.value = results
    .filter((r): r is PromiseFulfilledResult<BagLineItem> => r.status === 'fulfilled')
    .map((r) => r.value)

  isLoading.value = false
})

const total = computed(() => {
  const sum = items.value.reduce(
    (acc, item) => acc + parseFloat(item.price.replace('$', '')) * item.quantity,
    0
  )
  return `$${sum.toFixed(2)}`
})

const card = reactive({
  number: '',
  cvc: '',
})

// Mock only — this is card-shape validation (digit count, spacing), not
// a real payment integration. No card network is contacted, nothing is
// charged; "Pay" just checks the numbers look roughly like a card
// number and CVC and then treats that as success. A real payment step
// would go through an actual processor (Stripe et al.), never handle
// raw card numbers directly in application code at all, and this app
// does neither.
function formatCardNumber(event: Event) {
  const input = event.target as HTMLInputElement
  const digitsOnly = input.value.replace(/\D/g, '').slice(0, 19)
  card.number = digitsOnly.replace(/(\d{4})(?=\d)/g, '$1 ').trim()
}

function formatCvc(event: Event) {
  const input = event.target as HTMLInputElement
  card.cvc = input.value.replace(/\D/g, '').slice(0, 4)
}

const cardError = ref('')
const orderConfirmed = ref(false)
const orderNumber = ref('')

const ORDERS_KEY = 'maxshelf-orders'

interface OrderRecord {
  orderNumber: string
  date: string
  items: Array<{ id: string; title: string; price: string; quantity: number }>
  total: string
  shipping: CheckoutInfo | null
}

// Newest first. This is what makes /account's order history real
// instead of invented — without this, "Order confirmed" just cleared
// the bag and forgot everything, so there'd be nothing to show there at
// all. Storing title/price/quantity directly on the record (not just
// ids) rather than re-fetching from /api/book later — a past order
// should show what was actually ordered at the time, an immutable
// snapshot, not live current data that could drift if a book's listing
// ever changed.
function saveOrder(order: OrderRecord) {
  try {
    const raw = localStorage.getItem(ORDERS_KEY)
    let orders: OrderRecord[] = []
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        orders = Array.isArray(parsed) ? parsed : []
      } catch {
        orders = []
      }
    }
    orders.unshift(order)
    localStorage.setItem(ORDERS_KEY, JSON.stringify(orders))
  } catch {
    // Not fatal — the confirmation still shows on screen either way, it
    // just won't appear in /account's history for next time.
  }
}

function pay() {
  const digitCount = card.number.replace(/\s/g, '').length
  if (digitCount < 13 || digitCount > 19) {
    cardError.value = 'Enter a valid card number.'
    return
  }
  if (card.cvc.length < 3) {
    cardError.value = 'Enter a valid CVC.'
    return
  }

  cardError.value = ''
  orderNumber.value = `MX-${Math.floor(100000 + Math.random() * 900000)}`
  orderConfirmed.value = true

  saveOrder({
    orderNumber: orderNumber.value,
    date: new Date().toISOString(),
    items: items.value.map((item) => ({
      id: item.id,
      title: item.title,
      price: item.price,
      quantity: item.quantity,
    })),
    total: total.value,
    shipping: checkoutInfo.value,
  })

  clearBag()

  try {
    localStorage.removeItem(CHECKOUT_INFO_KEY)
  } catch {
    // Not fatal — order is already confirmed either way.
  }
}
</script>

<template>
  <main class="page">
    <NuxtLink to="/checkout" class="back-link">Back to checkout</NuxtLink>

    <h1 class="title">Payment</h1>

    <div v-if="orderConfirmed" class="confirmation">
      <p class="confirmation-mark" aria-hidden="true">&check;</p>
      <h2 class="confirmation-heading">Order confirmed</h2>
      <p class="status-text">Confirmation number {{ orderNumber }}</p>
      <NuxtLink to="/books" class="add-to-cart-btn">Continue browsing</NuxtLink>
    </div>

    <div v-else-if="!isLoading && items.length === 0" class="empty-state">
      <p class="status-text">Your bag is empty.</p>
      <NuxtLink to="/books" class="add-to-cart-btn">Browse books</NuxtLink>
    </div>

    <div v-else class="pay-layout">
      <section class="pay-summary">
        <p v-if="isLoading" class="status-text">Loading&hellip;</p>
        <template v-else>
          <p class="meta-label">Amount due</p>
          <p class="price">{{ total }}</p>

          <div v-if="checkoutInfo" class="shipping-block">
            <p class="meta-label">Shipping to</p>
            <p class="shipping-line">{{ checkoutInfo.fullName }}</p>
            <p class="shipping-line">{{ checkoutInfo.address }}</p>
            <p class="shipping-line">{{ checkoutInfo.email }}</p>
            <p class="shipping-line">{{ checkoutInfo.phone }}</p>
          </div>
        </template>
      </section>

      <section class="pay-form-section">
        <h2 class="section-heading">Card details</h2>

        <form class="pay-form" @submit.prevent="pay">
          <label class="field">
            <span class="field-label">Card number</span>
            <input
              :value="card.number"
              type="text"
              inputmode="numeric"
              autocomplete="cc-number"
              placeholder="4242 4242 4242 4242"
              required
              @input="formatCardNumber"
            />
          </label>

          <label class="field">
            <span class="field-label">CVC</span>
            <input
              :value="card.cvc"
              type="text"
              inputmode="numeric"
              autocomplete="cc-csc"
              placeholder="123"
              required
              @input="formatCvc"
            />
          </label>

          <p v-if="cardError" class="cart-message-error">{{ cardError }}</p>

          <button type="submit" class="add-to-cart-btn confirm-btn">Pay {{ total }}</button>
        </form>
      </section>
    </div>
  </main>
</template>

<style scoped>
.page,
.page *,
.page *::before,
.page *::after {
  /* Same universal reset as bag.vue/checkout.vue — this exact bug class
     (width: 100% + padding/border with no box-sizing = overflow past
     the container) turned up in both those files too; resetting it here
     the same way rather than leaving this one file inconsistent. */
  box-sizing: border-box;
}

.page {
  --paper: #fff;
  --ink: #000;
  --accent: #ff2400;
  --stone: #666;

  max-width: 880px;
  width: 100%;
  margin: 0 auto;
  padding: 3rem 2rem 6rem;
  background: var(--paper);
  color: var(--ink);
  font-family: 'Inter', sans-serif;
  /* Same vertical + horizontal centering, same 100dvh mobile-chrome fix
     as bag.vue/checkout.vue. */
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
  justify-content: center;
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
.add-to-cart-btn:focus-visible,
.field input:focus-visible {
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
  align-items: flex-start;
  gap: 1.25rem;
}

.pay-layout {
  display: flex;
  gap: 3rem;
  align-items: flex-start;
}

.pay-summary {
  flex: 1;
  min-width: 0;
  padding: 2rem;
  border: 3px solid var(--ink);
  box-shadow: 8px 8px 0 var(--ink);
}

.meta-label {
  margin: 0 0 0.4rem;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--accent);
}

.price {
  margin: 0 0 2rem;
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.shipping-block {
  padding-top: 1.5rem;
  border-top: 3px solid var(--ink);
}

.shipping-line {
  margin: 0 0 0.3rem;
  font-size: 0.9rem;
  color: var(--ink);
}

.pay-form-section {
  flex: 1;
  min-width: 0;
  padding: 2rem;
  box-shadow: 8px 8px 0 var(--ink);
  border: 3px solid var(--ink);
}

.section-heading {
  margin: 0 0 1.5rem;
  font-size: 0.85rem;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding-bottom: 0.75rem;
  border-bottom: 3px solid var(--ink);
}

.pay-form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.field-label {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--accent);
}

.field input {
  padding: 0.75rem 0.85rem;
  border: 3px solid var(--ink);
  background: #fff;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 0.95rem;
  letter-spacing: 0.03em;
  color: var(--ink);
}

.cart-message-error {
  margin: -0.5rem 0 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--accent);
}

.add-to-cart-btn {
  display: inline-block;
  padding: 0.85rem 2rem;
  background: var(--ink);
  color: var(--paper);
  border: 3px solid var(--ink);
  font-family: inherit;
  font-size: 0.85rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-decoration: none;
  text-align: center;
  cursor: pointer;
  transition: background 0.15s ease;
}

.add-to-cart-btn:hover {
  background: var(--accent);
}

.confirm-btn {
  width: 100%;
  margin-top: 0.5rem;
}

/* text-align: center in addition to align-items: center — align-items
   only centers each flex child as a BLOCK (the checkmark box, the
   heading, the button), it doesn't center the TEXT inside a child that
   spans the full available width (like .status-text, which wraps at
   the column's max-width) — without text-align too, multi-line text
   would still ratchet left inside its own now-centered box. Combined
   with .page's own min-height: 100dvh + justify-content: center (see
   above), this centers the confirmation both horizontally (this rule)
   and vertically (that one) at any screen size — the page-level
   centering was already there, but did nothing for THIS block since it
   still explicitly left-aligned its own children regardless of where
   the column itself sat. */
.confirmation {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.5rem;
  padding: 3rem 0;
}

.confirmation-mark {
  margin: 0 0 0.5rem;
  width: 3rem;
  height: 3rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 3px solid var(--accent);
  color: var(--accent);
  font-size: 1.5rem;
}

.confirmation-heading {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 900;
  letter-spacing: -0.02em;
}

.confirmation .add-to-cart-btn {
  margin-top: 1.5rem;
}

@media (max-width: 700px) {
  .pay-layout {
    flex-direction: column;
  }

  .pay-summary,
  .pay-form-section {
    width: 100%;
  }

  .page {
    padding: 2rem 1.25rem 4rem;
  }

  .pay-summary,
  .pay-form-section {
    padding: 1.5rem;
  }
}
</style>