<script setup lang="ts">
import { AppHeader, AppFooter } from '@maxblom/headlessmax-appshell'

const { data } = await useFetch('/api/books', {
  query: { q: 'subject:fiction', page: 1 },
})
</script>

<template>
  <AppHeader title="maxshelf" />
  <main style="padding: 2rem;">
    <h1>maxshelf</h1>
    <p v-if="data">{{ data.total.toLocaleString() }} books found</p>

    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 1.5rem; margin-top: 2rem;">
      <div v-for="book in data?.books" :key="book.id">
        <img
          v-if="book.coverUrl"
          :src="book.coverUrl"
          :alt="book.title"
          style="width: 100%; height: auto;"
        />
        <p style="font-weight: bold; margin: 0.5rem 0 0.25rem;">{{ book.title }}</p>
        <p style="margin: 0; color: #555;">{{ book.authors.join(', ') }}</p>
      </div>
    </div>
  </main>
  <AppFooter />
</template>