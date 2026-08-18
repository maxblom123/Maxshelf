<script setup lang="ts">
definePageMeta({
  layout: 'blank',
})

useHead({
  title: 'Home | Maxshelf',
})
</script>

<template>
  <div
    style="
      height: 100vh;
      width: 100vw;
      display: flex;
      align-items: center;
      justify-content: center;
    "
  >
    <NuxtLink
      to="/books"
      style="
        display: inline-block;
        padding: 0.75rem 2rem;
        background: #111;
        color: #fff;
        text-decoration: none;
        border-radius: 4px;
        font-weight: bold;
      "
    >
      Browse books
    </NuxtLink>
  </div>
</template>

<style>
/* unscoped, since :global(body) needs to reach outside this component —
   removes the browser's default 8px body margin, which combined with
   100vh was pushing the page just past the viewport and causing a
   scrollbar */
body {
  margin: 0;
}
</style>