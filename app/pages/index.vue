<script setup lang="ts">
definePageMeta({
  layout: 'blank',
})

useHead({
  title: 'Home | Maxshelf',
})
</script>

<template>
  <div class="hero">
    <NuxtLink to="/books" class="cta">Browse books</NuxtLink>
  </div>
</template>

<style scoped>
.hero {
  height: 100vh;
  width: 100vw;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cta {
  display: inline-block;
  padding: 0.75rem 2rem;
  background: #111;
  color: #fff;
  text-decoration: none;
  border-radius: 4px;
  font-weight: bold;
}
</style>

<style>
body {
  margin: 0;
}
</style>