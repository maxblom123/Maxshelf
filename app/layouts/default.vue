<script setup lang="ts">
import { AppFooter } from '@maxblom/headlessmax-appshell'
</script>

<template>
  <div style="min-height: 100vh; display: flex; flex-direction: column;">
    <div style="flex: 1 0 auto;">
      <slot />
    </div>
    <AppFooter style="text-align: center; padding: 1.5rem 0; flex-shrink: 0;" />
  </div>
</template>