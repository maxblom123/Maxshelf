<script setup lang="ts">
import { ref } from 'vue'
import { AppHeader, AppFooter } from '@maxblom/headlessmax-appshell'
import { Select, Dialog, Tabs } from '@maxblom/headlessmax'

const selected = ref<string | null>(null)
const options = [
  { label: 'Fiction', value: 'fiction' },
  { label: 'Non-fiction', value: 'nonfiction' },
  { label: 'Science', value: 'science' },
]

const dialogOpen = ref(false)

const activeTab = ref('grid')
const tabs = [
  { id: 'grid', label: 'Grid view' },
  { id: 'list', label: 'List view' },
]
</script>

<template>
  <AppHeader title="maxshelf" />
  <main style="padding: 2rem;">
    <h1>Component smoke test</h1>

    <section style="margin-bottom: 2rem;">
      <h2>Select</h2>
      <Select v-model="selected" :options="options" placeholder="Choose a genre" />
      <p>Selected: {{ selected ?? 'none' }}</p>
    </section>

    <section style="margin-bottom: 2rem;">
      <h2>Dialog</h2>
      <button @click="dialogOpen = true">Open dialog</button>
      <Dialog v-model="dialogOpen" title="Test dialog">
        <p>If you can see this, Dialog is working.</p>
        <template #footer>
          <button @click="dialogOpen = false">Close</button>
        </template>
      </Dialog>
    </section>

    <section>
      <h2>Tabs</h2>
      <Tabs v-model="activeTab" :tabs="tabs">
        <template #grid><p>Grid view content</p></template>
        <template #list><p>List view content</p></template>
      </Tabs>
    </section>
  </main>
  <AppFooter />
</template>