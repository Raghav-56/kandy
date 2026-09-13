<script setup lang="ts">
/**
 * The kandy mark: three notes assembling into a lowercase k.
 *
 * The same SVG the app draws, so the docs and the product cannot drift apart.
 */
defineProps<{ size?: number }>()
</script>

<template>
  <svg :width="size ?? 32" :height="size ?? 32" viewBox="0 0 32 32" aria-hidden="true">
    <rect x="3" y="4" width="8" height="24" rx="2" fill="#e87fa4" />
    <path d="M12.5 11 20 4h8L16.5 15h-4Z" fill="#e8c56a" />
    <path d="M12.5 18h4L28 28h-8l-7.5-7Z" fill="#74d6ac" />
  </svg>
</template>
