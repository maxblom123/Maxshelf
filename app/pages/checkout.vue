<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import type { BookDetail } from '~~/server/utils/bookDetail'

definePageMeta({
  layout: 'blank',
})

useHead({
  title: 'Checkout | Maxshelf',
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

// Same inlined-not-imported pattern as bag.vue and [slug].vue — see the
// comment on the matching function in [slug].vue for why: a shared
// file's import path is one more thing that can be placed wrong.
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

const form = reactive({
  fullName: '',
  address: '',
  email: '',
  phone: '',
})

const CHECKOUT_INFO_KEY = 'maxshelf-checkout-info'

// Native HTML5 validation (required + type="email"/"tel") does the
// field-level checking — reportValidity() surfaces the browser's own
// "please fill this in" prompts on whichever field is invalid, rather
// than needing hand-rolled validation messages for the same thing.
//
// This no longer confirms the order itself — it saves the delivery
// details to localStorage (read back by /pay, so the payment page can
// show who/where it's shipping to) and hands off to the actual payment
// step. The bag itself isn't cleared here; that only happens once
// payment is "completed" on /pay.
async function confirmOrder(event: Event) {
  const formEl = event.target as HTMLFormElement
  if (!formEl.checkValidity()) {
    formEl.reportValidity()
    return
  }

  try {
    localStorage.setItem(CHECKOUT_INFO_KEY, JSON.stringify({ ...form }))
  } catch {
    // If this fails (private browsing, storage disabled), /pay just
    // won't have a "shipping to" summary to show — not fatal, the
    // payment flow itself doesn't depend on it.
  }

  await navigateTo('/pay')
}
</script>

<template>
  <main class="page">
    <NuxtLink to="/bag" class="back-link">Back to bag</NuxtLink>

    <h1 class="title">Checkout</h1>

    <div class="checkout-layout">
      <section class="order-summary">
        <h2 class="section-heading">Your order</h2>

        <p v-if="isLoading" class="status-text">Loading your order&hellip;</p>

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
                width="52"
                height="78"
                loading="lazy"
              />
              <div v-else class="bag-cover bag-cover-empty" />
              <div class="bag-item-info">
                <p class="bag-item-title">{{ item.title }}</p>
                <p class="bag-item-qty">Qty {{ item.quantity }}</p>
              </div>
              <p class="bag-item-price">{{ lineTotal(item) }}</p>
            </li>
          </ul>

          <div class="bag-total-row">
            <span class="meta-label">Total</span>
            <span class="price">{{ total }}</span>
          </div>
        </template>
      </section>

      <section v-if="items.length > 0" class="delivery-section">
        <h2 class="section-heading">Delivery details</h2>

        <form class="checkout-form" novalidate @submit.prevent="confirmOrder">
          <label class="field">
            <span class="field-label">Full name</span>
            <input v-model="form.fullName" type="text" autocomplete="name" placeholder="Jane Doe" required />
          </label>

          <label class="field">
            <span class="field-label">Address</span>
            <input
              v-model="form.address"
              type="text"
              autocomplete="street-address"
              placeholder="123 Main St, Springfield"
              required
            />
          </label>

          <label class="field">
            <span class="field-label">Email</span>
            <input
              v-model="form.email"
              type="email"
              autocomplete="email"
              placeholder="jane@example.com"
              required
            />
          </label>

          <label class="field">
            <span class="field-label">Phone number</span>
            <input v-model="form.phone" type="tel" autocomplete="tel" placeholder="(555) 123-4567" required />
          </label>

          <button type="submit" class="add-to-cart-btn confirm-btn">Confirm order</button>
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
  /* Universal reset, not a per-element patch — this same bug (width:
     100% + padding/border with no box-sizing = real overflow past the
     container) turned up in more than one place here (the confirm
     button, the form inputs), which is a sign it's a systemic gap in
     this file rather than one isolated mistake. Resetting box-sizing
     for everything under .page closes the whole bug class at once
     instead of chasing individual instances and potentially missing
     one — every future padded/bordered element on this page inherits
     the safe default automatically.
  */
  box-sizing: border-box;
}

.page {
  --paper: #fff;
  --ink: #000;
  --accent: #ff2400;
  --stone: #666;

  max-width: 1040px;
  width: 100%;
  margin: 0 auto;
  padding: 3rem 2rem 6rem;
  background: var(--paper);
  color: var(--ink);
  font-family: 'Inter', sans-serif;
  /* Same vertical + horizontal centering as bag.vue — min-height (not a
     fixed height) means this only visibly centers content shorter than
     the viewport; a bag with enough items to fill the two-column layout
     past 100vh just grows normally with a scrollbar, nothing clipped.
     100dvh handles the same mobile browser-chrome issue as elsewhere:
     100vh can be taller than what's actually visible behind the address
     bar on a phone. */
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

.checkout-layout {
  display: flex;
  gap: 3rem;
  align-items: flex-start;
}

.order-summary {
  flex: 1;
  min-width: 0;
}

.delivery-section {
  flex: 1;
  min-width: 0;
  padding: 2rem;
  border: 3px solid var(--ink);
  box-shadow: 8px 8px 0 var(--ink);
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

.bag-list {
  list-style: none;
  margin: 0 0 1.5rem;
  padding: 0;
  border-top: 3px solid var(--ink);
  max-height: 396px;
  overflow-y: auto;
}

.bag-item {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 1rem 0;
  border-bottom: 3px solid var(--ink);
}

.bag-cover {
  width: 52px;
  height: 78px;
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
  margin: 0 0 0.2rem;
  font-size: 0.9rem;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bag-item-qty {
  margin: 0;
  font-size: 0.75rem;
  color: var(--stone);
}

.bag-item-price {
  margin: 0;
  font-size: 0.9rem;
  font-weight: 700;
  flex-shrink: 0;
}

.bag-total-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
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

.checkout-form {
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
  font-family: inherit;
  font-size: 0.95rem;
  color: var(--ink);
}

/* This rule only actually works if every input has a placeholder — an
   empty required field is :invalid by default in HTML5, and without a
   placeholder, :placeholder-shown never matches anything (there's
   nothing to show), so :not(:placeholder-shown) is always true and this
   selector collapses to just :invalid — meaning every empty required
   field showed red immediately on page load, before anyone had typed
   a single character. Adding placeholder text to each input (see the
   template) is what makes :placeholder-shown correctly reflect "empty,
   not yet touched" and suppress the red border until there's actually
   invalid content in the field. */
.field input:invalid:not(:placeholder-shown) {
  border-color: var(--accent);
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

@media (max-width: 800px) {
  .checkout-layout {
    flex-direction: column;
  }

  .order-summary,
  .delivery-section {
    width: 100%;
  }

  .page {
    padding: 2rem 1.25rem 4rem;
  }

  .delivery-section {
    padding: 1.5rem;
  }
}
</style>