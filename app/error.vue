<script setup lang="ts">
import { computed } from 'vue'
import type { NuxtError } from '#app'

const props = defineProps<{
  error: NuxtError
}>()

const isNotFound = computed(() => props.error?.statusCode === 404)

useHead({
  meta: [{ name: 'theme-color', content: '#ffffff' }],
})

function goHome() {
  clearError({ redirect: '/books' })
}
</script>

<template>
  <main class="error-page">
    <p class="code">{{ isNotFound ? '404' : (error?.statusCode ?? 'ERROR') }}</p>
    <h1>{{ isNotFound ? 'PAGE NOT FOUND' : 'SOMETHING WENT WRONG' }}</h1>
    <p class="message">
      {{ isNotFound ? "THAT PAGE DOESN'T EXIST." : (error?.statusMessage || 'PLEASE TRY AGAIN.') }}
    </p>
    <button type="button" @click="goHome">BACK TO HOME</button>
  </main>
</template>

<style scoped>
.error-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 2rem;
  text-align: center;
  background: #fff;
  color: #000;
  font-family: 'Inter', sans-serif;
}

.code {
  margin: 0;
  font-size: clamp(6rem, 20vw, 12rem);
  font-weight: 900;
  line-height: 0.85;
  letter-spacing: -0.03em;
  color: #ff2400;
}

h1 {
  margin: 0.75rem 0 0;
  font-size: 1.75rem;
  font-weight: 900;
  letter-spacing: -0.01em;
  text-transform: uppercase;
}

.message {
  margin: 0 0 2rem;
  color: #666;
  font-weight: 600;
  text-transform: uppercase;
  font-size: 0.9rem;
  letter-spacing: 0.04em;
}

button {
  padding: 0.9rem 2.25rem;
  background: #000;
  color: #fff;
  border: 3px solid #000;
  font-family: inherit;
  font-size: 0.9rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
  transition: transform 0.1s ease, background 0.1s ease, color 0.1s ease;
}

button:hover {
  background: #ff2400;
  border-color: #ff2400;
}

button:active {
  transform: translate(2px, 2px);
}

button:focus-visible {
  outline: 3px solid #ff2400;
  outline-offset: 2px;
}
</style>