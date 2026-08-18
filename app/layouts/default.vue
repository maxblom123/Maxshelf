<script setup lang="ts">
import { AppFooter } from '@maxblom/headlessmax-appshell'
</script>

<template>
  <div class="app-shell">
    <div class="app-shell__content">
      <slot />
    </div>
    <AppFooter class="app-shell__footer" />
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.app-shell__content {
  flex: 1 0 auto;
}

.app-shell__footer {
  text-align: center;
  padding: 1.5rem 0;
  flex-shrink: 0;
}
</style>